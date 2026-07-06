import type { ChatInputCommandInteraction } from "discord.js";
import mongoose from "mongoose";
import { LeagueModel, type League } from "~/db/League";
import {
  BracketModel,
  type Bracket,
  getSeedingParticipantId,
} from "~/db/Bracket";
import { GameModel, type Game } from "~/db/Game";
import { SchedulingMessageModel } from "~/db/SchedulingMessage";
import { resolveLeagueTypeConfig } from "~/services/league-configs/index";
import type {
  FinalStageDefinition,
  LeagueTypeConfig,
} from "~/services/league-configs/types";
import {
  computeBracket,
  type BracketContext,
  type ComputedStage,
} from "~/services/bracketUtils";
import { resolveBracketStagesForConfig } from "~/services/league-strategies/finalPhaseStrategies";
import { resolveFinalDeltaComputer } from "~/services/league-strategies/finalPhaseStrategies";
import {
  buildFinalsGameMatch,
  resolveFinalPhaseGameCutoff,
} from "~/services/league-configs/index";
import { TeamModel, type Team } from "~/db/Team";
import { UserModel, type User } from "~/db/User";
import {
  resolveRound,
  composeRoundMessage,
  loadStageParticipantsByIds,
  buildUserMap,
  loadSubstituteMap,
  buildPersistedTables,
  buildOfficialSubstituteTeamMap,
} from "~/services/schedulingMessageService.server";
import {
  sendChannelMessage,
  deleteChannelMessages,
} from "~/services/discordPublisher.server";
import { getSchedulingQueue } from "~/services/schedulingQueue.server";
import { LeagueService } from "~/services/LeagueService.server";
import {
  generateTeamBracketSeating,
  generateIndividualScheduling,
} from "~/services/league-configs/teamBracketSeating";
import { strings } from "~/bot/localization/strings";
import { localize } from "~/bot/localizationUtils";
import { stringFormat } from "~/bot/stringUtils";

const reply = strings.commands.league.startnext.reply;

/**
 * Resolves the [team1, team2, team3, team4] roster sizes for a stage based on
 * the order of teamIds in `computedTeams`. Falls back to 4 when a team is
 * missing from the size map. Pads/truncates to exactly 4 entries.
 */
function resolveTeamSizes(
  computedTeams: string[],
  teamSizeMap: Map<string, number>
): [number, number, number, number] {
  const sizes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const teamId = computedTeams[i];
    const size = teamId ? (teamSizeMap.get(teamId) ?? 4) : 4;
    sizes.push(size > 0 ? size : 4);
  }
  return [sizes[0], sizes[1], sizes[2], sizes[3]];
}

/**
 * /league startnext — starts the next batch of bracket games.
 *
 * 1. Finds the league for this Discord server
 * 2. Validates the final phase has started
 * 3. Determines ongoing stages and the next round for each
 * 4. Posts a scheduling message per stage to the scheduling channel
 * 5. Enqueues a one-shot scheduling worker job for each stage
 */
export async function executeStartNext(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const locale = interaction.locale;
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply(localize(locale, reply.mustBeInServer));
    return;
  }

  // ── 1. Find league for this guild ──────────────────────────────────────
  const league = await LeagueModel.findOne({
    "discordConfig.serverId": guildId,
    endTime: { $gt: new Date() },
  })
    .populate("leagueTypeConfig")
    .lean<(League & { _id: mongoose.Types.ObjectId }) | null>();

  if (!league) {
    await interaction.editReply(localize(locale, reply.noActiveLeague));
    return;
  }

  // ── 2. Validate final phase ────────────────────────────────────────────
  const config = resolveLeagueTypeConfig(
    league.leagueTypeConfig as LeagueTypeConfig | null
  );
  if (!config?.finalPhase) {
    await interaction.editReply(localize(locale, reply.noFinalPhase));
    return;
  }

  const finalsCutoff = resolveFinalPhaseGameCutoff(config, league);
  if (finalsCutoff && new Date() < finalsCutoff) {
    const timestamp = `<t:${Math.floor(finalsCutoff.getTime() / 1000)}:F>`;
    await interaction.editReply(
      stringFormat(locale, reply.finalPhaseNotStartedFormat, timestamp)
    );
    return;
  }

  const channelId = league.discordConfig?.schedulingChannel;
  if (!channelId) {
    await interaction.editReply(localize(locale, reply.noSchedulingChannel));
    return;
  }

  // ── 2b. Block if a previous round is still pending or in progress ──────
  // We only allow /startnext when the slate is clean: no scheduling
  // messages at all (first round), or every existing message is completed.
  const pendingCount = await SchedulingMessageModel.countDocuments({
    league: league._id,
    status: { $in: ["upcoming", "in_progress"] },
  });

  if (pendingCount > 0) {
    await interaction.editReply(localize(locale, reply.pendingRoundExists));
    return;
  }

  // ── 3. Load bracket seedings & compute current bracket state ───────────
  let bracket = (await BracketModel.findOne({
    league: league._id,
  }).lean()) as Bracket | null;

  if (!bracket) {
    // Auto-seed the bracket on demand (e.g. for finals-only tournaments
    // where the regular ranking-update tick wouldn't trigger seeding).
    try {
      await LeagueService.instance.ensureBracketSeedings(league, config);
    } catch (error) {
      console.warn(
        `startNext: ensureBracketSeedings failed for ${league.name}:`,
        error
      );
    }
    bracket = (await BracketModel.findOne({
      league: league._id,
    }).lean()) as Bracket | null;
  }

  if (!bracket) {
    await interaction.editReply(localize(locale, reply.noBracketSeedings));
    return;
  }

  const isTeamMode = config.isTeamMode !== false;

  const resolvedSeedings = new Map(
    bracket.seedings.map((s) => [
      s.seed,
      getSeedingParticipantId(s, isTeamMode).toString(),
    ])
  );

  // Build lookup maps for bracket computation
  const teamNameMap = new Map<string, string>();
  const userTeamMap = new Map<string, string>();
  const teamSizeMap = new Map<string, number>();

  if (isTeamMode) {
    const allTeams = (await TeamModel.find({
      leagueId: league._id,
    }).lean()) as Team[];
    for (const team of allTeams) {
      const teamId = team._id.toString();
      teamNameMap.set(teamId, team.displayName || team.simpleName);
      teamSizeMap.set(teamId, team.roster.members.length);
      for (const memberId of [
        ...team.roster.members,
        ...(team.roster.substitutes ?? []),
      ]) {
        userTeamMap.set(memberId.toString(), teamId);
      }
    }
  } else {
    // Individual mode — participants are users, map userId → userId
    const participantIds = new Set<string>();
    for (const seededId of resolvedSeedings.values()) {
      participantIds.add(seededId);
    }

    const users = await UserModel.find({
      _id: { $in: Array.from(participantIds) },
    }).lean<User[]>();
    for (const user of users) {
      const userId = user._id.toString();
      teamNameMap.set(userId, user.name || "?");
      userTeamMap.set(userId, userId);
    }
  }

  // Get final-phase games
  const gameFilter: Record<string, unknown> = {
    league: league._id,
    isValid: true,
  };
  const finalsMatch = buildFinalsGameMatch(config, league);
  if (finalsMatch) {
    Object.assign(gameFilter, finalsMatch);
  }
  const games = await GameModel.find(gameFilter).lean<Game[]>();
  const bracketGames = games.map((g) => ({
    results: (g.results ?? []).map((r) => ({
      userId: r.userId.toString(),
      score: r.score,
    })),
  }));

  const configuredStages = resolveBracketStagesForConfig(config.finalPhase);
  const officialSubTeamMap = await buildOfficialSubstituteTeamMap(league._id);
  const bracketCtx: BracketContext = {
    seedings: resolvedSeedings,
    userToTeamMap: userTeamMap,
    teamNameMap,
    games: bracketGames,
    rules: league.rulesConfig.gameRules,
    deltaComputer: resolveFinalDeltaComputer(
      config,
      league.rulesConfig.gameRules
    ),
    officialSubIds: new Set(
      (league.officialSubstitutes ?? []).map((id) => id.toString())
    ),
    officialSubTeamMap,
  };

  const computedStages = computeBracket(configuredStages, bracketCtx);

  // ── 4. Determine ongoing stages + next round ──────────────────────────
  const stagesToSchedule: Array<{
    stage: FinalStageDefinition;
    computed: ComputedStage;
    roundIndex: number;
  }> = [];

  for (let i = 0; i < config.finalPhase.stages.length; i++) {
    const stageDef = config.finalPhase.stages[i];
    const computed = computedStages[i];

    // Stage must have all teams resolved
    const expectedTeamCount =
      stageDef.seeds.length +
      stageDef.fromStages.reduce(
        (acc, e) => acc + (e.places?.length ?? e.topN),
        0
      );
    if (computed.teams.length < expectedTeamCount) {
      continue;
    }

    // Stage must not be completed
    if (computed.isComplete) {
      continue;
    }

    // Generate seating for this stage
    const scheduling = isTeamMode
      ? generateTeamBracketSeating(
          stageDef.gameCount,
          resolveTeamSizes(computed.teams, teamSizeMap)
        )
      : generateIndividualScheduling(stageDef.gameCount);

    // Determine next round: count completed SchedulingMessage docs for this stage
    const completedRounds = await SchedulingMessageModel.countDocuments({
      league: league._id,
      stageId: stageDef.id,
      status: "completed",
    });

    const nextRoundIndex = completedRounds;
    if (nextRoundIndex >= scheduling.length) {
      // All scheduling rounds exhausted
      continue;
    }

    // Guard: check if there's already an upcoming/in_progress message for this round
    const existing = await SchedulingMessageModel.findOne({
      league: league._id,
      stageId: stageDef.id,
      roundIndex: nextRoundIndex,
      status: { $in: ["upcoming", "in_progress"] },
    }).lean();

    if (existing) {
      continue;
    }

    stagesToSchedule.push({
      stage: stageDef,
      computed,
      roundIndex: nextRoundIndex,
    });
  }

  if (stagesToSchedule.length === 0) {
    await interaction.editReply(localize(locale, reply.noStagesToSchedule));
    return;
  }

  // ── 4b. Delete the previous round's Discord messages ───────────────────
  // startNext only proceeds when no round is pending (every existing
  // SchedulingMessage is completed), so all current scheduling messages belong
  // to an earlier round. Remove their Discord messages so the channel only
  // shows the round being scheduled now. The documents are kept — the
  // next-round counter relies on the count of completed docs per stage.
  const priorMsgs = await SchedulingMessageModel.find({
    league: league._id,
  })
    .select("messageId")
    .lean();
  const priorMessageIds = priorMsgs.map((m) => m.messageId);
  const { failed: undeletedMessageIds } = await deleteChannelMessages(
    channelId,
    priorMessageIds
  );
  if (undeletedMessageIds.length > 0) {
    console.error(
      `startNext: ${undeletedMessageIds.length} prior scheduling message(s) ` +
        `could not be deleted in channel ${channelId} for league ` +
        `${league.name}: ${undeletedMessageIds.join(", ")}`
    );
  }

  // ── 5. Post one scheduling message per stage + enqueue worker ─────────
  const stageData: Array<{
    stage: FinalStageDefinition;
    roundIndex: number;
    totalRounds: number;
    tableCount: number;
  }> = [];

  for (const { stage, computed, roundIndex } of stagesToSchedule) {
    const scheduling = isTeamMode
      ? generateTeamBracketSeating(
          stage.gameCount,
          resolveTeamSizes(computed.teams, teamSizeMap)
        )
      : generateIndividualScheduling(stage.gameCount);
    const participants = await loadStageParticipantsByIds(
      league._id,
      computed.teams.map((id) => new mongoose.Types.ObjectId(id)),
      isTeamMode,
      stage.id,
      roundIndex
    );
    const userMap = await buildUserMap(
      participants,
      league.platformConfig.platformName
    );
    const substituteMap = await loadSubstituteMap(
      league._id,
      league.officialSubstitutes ?? []
    );

    const resolved = resolveRound(
      stage,
      scheduling,
      roundIndex,
      participants,
      userMap,
      substituteMap
    );
    const totalRounds = scheduling.length;

    // Post a dedicated Discord message for this stage so each one stays
    // well under Discord's per-message character limit even with many
    // players.
    const content = composeRoundMessage(
      stage.id,
      roundIndex,
      totalRounds,
      resolved,
      "upcoming"
    );
    const msg = await sendChannelMessage(channelId, content);

    await SchedulingMessageModel.create({
      messageId: msg.id,
      league: league._id,
      stageId: stage.id,
      roundIndex,
      status: "upcoming",
      participantIds: computed.teams.map(
        (id) => new mongoose.Types.ObjectId(id)
      ),
      tables: buildPersistedTables(resolved, participants),
    });

    await getSchedulingQueue().add(
      `scheduling-poll:${league._id}:${msg.id}`,
      {
        leagueId: league._id.toString(),
        messageId: msg.id,
      },
      { delay: 5_000 }
    );

    stageData.push({
      stage,
      roundIndex,
      totalRounds,
      tableCount: scheduling[roundIndex].length,
    });
  }

  const results = stageData.map(
    ({ stage, roundIndex, totalRounds, tableCount }) =>
      stringFormat(
        locale,
        reply.stageLineFormat,
        stage.id.toUpperCase(),
        String(roundIndex + 1),
        String(totalRounds),
        String(tableCount),
        tableCount !== 1 ? "s" : ""
      )
  );

  await interaction.editReply(
    stringFormat(locale, reply.schedulingStartedFormat, results.join("\n"))
  );
}

import type { ChatInputCommandInteraction } from "discord.js";
import mongoose from "mongoose";
import { LeagueModel, type League, Platform } from "~/db/League";
import {
  BracketModel,
  type Bracket,
  getSeedingParticipantId,
} from "~/db/Bracket";
import { GameModel, type Game } from "~/db/Game";
import { SchedulingMessageModel } from "~/db/SchedulingMessage";
import { SubstitutionModel } from "~/db/Substitution";
import { TeamModel, type Team } from "~/db/Team";
import { UserModel, type User } from "~/db/User";
import { resolveLeagueTypeConfig } from "~/services/league-configs/index";
import type { LeagueTypeConfig } from "~/services/league-configs/types";
import { computeBracket, type BracketContext } from "~/services/bracketUtils";
import { buildOfficialSubstituteTeamMap } from "~/services/schedulingMessageService.server";
import { resolveBracketStagesForConfig } from "~/services/league-strategies/finalPhaseStrategies";
import { resolveFinalDeltaComputer } from "~/services/league-strategies/finalPhaseStrategies";
import { buildFinalsGameMatch } from "~/services/league-configs/index";
import {
  generateTeamBracketSeating,
  generateIndividualScheduling,
  type StageScheduling,
} from "~/services/league-configs/teamBracketSeating";
import { invariantLocale, strings } from "~/bot/localization/strings";
import { localize } from "~/bot/localizationUtils";
import { stringFormat } from "~/bot/stringUtils";
import { emitLeagueUpdated } from "~/services/cacheInvalidation.server";

const reply = strings.commands.league.sub.reply;
const subParams = strings.commands.league.sub.params;

function optionName(path: { name: string }) {
  return localize(invariantLocale, path.name);
}

/**
 * Look up a user by their in-game platform ID.
 */
async function findUserByPlatformId(
  platformName: string,
  inGameId: string
): Promise<User | null> {
  if (platformName === Platform.MAJSOUL) {
    return UserModel.findOne({
      "majsoulIdentity.friendId": inGameId,
    }).lean<User | null>();
  }
  if (platformName === Platform.RIICHICITY) {
    return UserModel.findOne({
      "riichiCityIdentity.id": inGameId,
    }).lean<User | null>();
  }
  return null;
}

/**
 * Parse a user-supplied round selection into a sorted, de-duplicated list of
 * 1-based round numbers. Accepts comma-separated values and ranges, e.g.
 * "2,3", "2-3" or "1,3-5". Returns `null` when the input is malformed.
 */
function parseRoundList(input: string): number[] | null {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return null;
  }
  const rounds = new Set<number>();
  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start < 1 || end < 1 || start > end) {
        return null;
      }
      for (let r = start; r <= end; r++) {
        rounds.add(r);
      }
      continue;
    }
    if (/^\d+$/.test(part)) {
      const r = parseInt(part, 10);
      if (r < 1) {
        return null;
      }
      rounds.add(r);
      continue;
    }
    return null;
  }
  if (rounds.size === 0) {
    return null;
  }
  return [...rounds].sort((a, b) => a - b);
}

/** Format a 1-based round list for display, e.g. [2, 3] → "2, 3". */
function formatRounds(rounds: number[]): string {
  return rounds.join(", ");
}

/**
 * Check whether a given player (identified by their stage participant index
 * and member index, both 0-based) is seated in a specific round of the
 * scheduling grid. `roundIndex` is 0-based.
 */
function isPlayerScheduledInRound(
  scheduling: StageScheduling,
  roundIndex: number,
  participantStageIndex: number,
  playerMemberIndex: number
): boolean {
  const round = scheduling[roundIndex];
  if (!round) {
    return false;
  }
  for (const table of round) {
    for (const seat of table) {
      if (
        seat.team === participantStageIndex + 1 &&
        seat.player === playerMemberIndex + 1
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolve the [team1, team2, team3, team4] roster sizes for a stage based on
 * the order of teamIds in `computedTeams`. Falls back to 4 when a team is
 * missing from the size map. Pads/truncates to exactly 4 entries. Mirrors the
 * logic in startNext so the round count matches what the scheduler produces.
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
 * /league sub — register a player substitution for the next bracket round.
 *
 * Validations:
 * 1. The substitute must be in the finalsRoster (or roster) substitutes list
 * 2. The replaced player must be scheduled to play in the next round
 */
export async function executeSub(
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

  const platformName = league.platformConfig.platformName;
  if (
    platformName !== Platform.MAJSOUL &&
    platformName !== Platform.RIICHICITY
  ) {
    await interaction.editReply(localize(locale, reply.unsupportedPlatform));
    return;
  }

  // ── 3. Resolve in-game IDs to DB users ─────────────────────────────────
  const playerInGameId = interaction.options.getString(
    optionName(subParams.player),
    true
  );
  const substituteInGameId = interaction.options.getString(
    optionName(subParams.substitute),
    true
  );

  const playerUser = await findUserByPlatformId(platformName, playerInGameId);
  if (!playerUser) {
    await interaction.editReply(
      stringFormat(locale, reply.playerNotFound, playerInGameId)
    );
    return;
  }

  const substituteUser = await findUserByPlatformId(
    platformName,
    substituteInGameId
  );
  if (!substituteUser) {
    await interaction.editReply(
      stringFormat(locale, reply.substituteNotFound, substituteInGameId)
    );
    return;
  }

  // ── 3b. Cancellation path ──────────────────────────────────────────────
  // If an existing substitution has the two users in swapped roles (i.e.
  // `playerUser` is the registered substitute and `substituteUser` is the
  // replaced player), treat this invocation as a cancellation. This bypasses
  // the team / scheduling validation since the substitution must already be
  // valid to exist.
  const playerObjectId = (playerUser as User & { _id: mongoose.Types.ObjectId })
    ._id;
  const substituteObjectId = (
    substituteUser as User & { _id: mongoose.Types.ObjectId }
  )._id;

  const inverseSubs = await SubstitutionModel.find({
    league: league._id,
    replacedPlayer: substituteObjectId,
    substitutePlayer: playerObjectId,
  }).lean();

  if (inverseSubs.length > 0) {
    const roundsInput = interaction.options.getString(
      optionName(subParams.rounds),
      false
    );
    let targetRounds: number[] | null = null;
    if (roundsInput && roundsInput.trim() !== "") {
      const parsed = parseRoundList(roundsInput);
      if (parsed === null) {
        await interaction.editReply(
          stringFormat(locale, reply.invalidRoundsFormat, roundsInput)
        );
        return;
      }
      targetRounds = parsed;
    }

    const removedRounds: number[] = [];
    for (const ex of inverseSubs) {
      const exRounds = ex.rounds ?? [];
      const roundsToRemove = targetRounds
        ? exRounds.filter((r) => targetRounds!.includes(r))
        : [...exRounds];
      if (roundsToRemove.length === 0) {
        continue;
      }
      const remaining = exRounds.filter((r) => !roundsToRemove.includes(r));
      if (remaining.length === 0) {
        await SubstitutionModel.deleteOne({ _id: ex._id });
      } else {
        await SubstitutionModel.updateOne(
          { _id: ex._id },
          { $set: { rounds: remaining } }
        );
      }
      removedRounds.push(...roundsToRemove);
    }

    if (removedRounds.length === 0) {
      await interaction.editReply(
        stringFormat(
          locale,
          reply.cancelNoMatchingRounds,
          substituteUser.name,
          playerUser.name,
          roundsInput ?? ""
        )
      );
      return;
    }

    emitLeagueUpdated(league._id.toString());

    const sortedRemoved = [...new Set(removedRounds)].sort((a, b) => a - b);
    await interaction.editReply(
      stringFormat(
        locale,
        reply.cancelSuccessFormat,
        substituteUser.name,
        playerUser.name,
        formatRounds(sortedRemoved)
      )
    );
    return;
  }

  // ── 4–6. Validate team membership / roster (team mode only) ─────────
  const isTeamMode = config.isTeamMode !== false;
  const playerUserId = (
    playerUser as User & { _id: mongoose.Types.ObjectId }
  )._id.toString();
  const subUserId = (
    substituteUser as User & { _id: mongoose.Types.ObjectId }
  )._id.toString();

  // participantId: in team mode this is the team _id; in individual mode it
  // is the player's user _id.
  let participantId: string;
  let playerMemberIndex: number;
  let isOfficialSub = false;

  if (isTeamMode) {
    const team = (await TeamModel.getUsersTeam(
      playerUserId,
      league._id.toString()
    )) as (Team & { _id: mongoose.Types.ObjectId }) | null;

    if (!team) {
      await interaction.editReply(
        stringFormat(locale, reply.playerNotInTeam, playerUser.name)
      );
      return;
    }

    // Validate substitute is in the roster's substitutes list
    const effectiveRoster = team.finalsRoster ?? team.roster;

    isOfficialSub = (league.officialSubstitutes ?? []).some(
      (id: any) => id.toString() === subUserId
    );

    const isInSubstituteList = effectiveRoster.substitutes.some(
      (s) => s.toString() === subUserId
    );
    if (!isOfficialSub && !isInSubstituteList) {
      await interaction.editReply(
        stringFormat(
          locale,
          reply.substituteNotInRoster,
          substituteUser.name,
          team.displayName
        )
      );
      return;
    }

    // Validate replaced player is in roster members
    const memberIds = team.roster.members.map((m) => m.toString());
    playerMemberIndex = memberIds.indexOf(playerUserId);

    if (playerMemberIndex === -1) {
      await interaction.editReply(
        stringFormat(locale, reply.playerNotInTeam, playerUser.name)
      );
      return;
    }

    participantId = team._id.toString();
  } else {
    // Individual mode: the player IS the participant, member index is always 0
    participantId = playerUserId;
    playerMemberIndex = 0;
  }

  // ── 7. Validate player is scheduled in the next round ──────────────────

  const bracket = (await BracketModel.findOne({
    league: league._id,
  }).lean()) as Bracket | null;

  if (!bracket) {
    await interaction.editReply(localize(locale, reply.finalsNotStarted));
    return;
  }

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
    for (const t of allTeams) {
      teamNameMap.set(t._id.toString(), t.displayName || t.simpleName);
      teamSizeMap.set(t._id.toString(), t.roster.members.length);
      for (const memberId of [
        ...t.roster.members,
        ...(t.roster.substitutes ?? []),
      ]) {
        userTeamMap.set(memberId.toString(), t._id.toString());
      }
    }
  }

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

  // ── 7. Resolve the upcoming stage this participant belongs to ──────────
  let targetStage: {
    stageId: string;
    scheduling: StageScheduling;
    completedRounds: number;
    totalRounds: number;
    participantStageIndex: number;
  } | null = null;

  for (let i = 0; i < config.finalPhase.stages.length; i++) {
    const stageDef = config.finalPhase.stages[i];
    const computed = computedStages[i];

    const expectedTeamCount =
      stageDef.seeds.length +
      stageDef.fromStages.reduce(
        (acc, e) => acc + (e.places?.length ?? e.topN),
        0
      );
    if (computed.teams.length < expectedTeamCount) {
      continue;
    }
    if (computed.isComplete) {
      continue;
    }

    const scheduling = isTeamMode
      ? generateTeamBracketSeating(
          stageDef.gameCount,
          resolveTeamSizes(computed.teams, teamSizeMap)
        )
      : generateIndividualScheduling(stageDef.gameCount);

    const completedRounds = await SchedulingMessageModel.countDocuments({
      league: league._id,
      stageId: stageDef.id,
      status: "completed",
    });

    if (completedRounds >= scheduling.length) {
      continue;
    }

    // The seating grid's team index (seat.team) is 1-based over the stage's
    // resolved participants, in the same order as `computed.teams` (seeds
    // first, then teams advancing from earlier stages). Use that ordering
    // — not `stageDef.seeds` — so stages whose participants come from
    // advancement (empty seeds) resolve correctly.
    const participantStageIndex = computed.teams.indexOf(participantId);
    if (participantStageIndex === -1) {
      continue;
    }

    targetStage = {
      stageId: stageDef.id,
      scheduling,
      completedRounds,
      totalRounds: scheduling.length,
      participantStageIndex,
    };
    break;
  }

  if (!targetStage) {
    await interaction.editReply(
      stringFormat(locale, reply.playerNotScheduled, playerUser.name)
    );
    return;
  }
  const stage = targetStage;

  // ── 8. Resolve and validate the targeted rounds (1-based) ──────────────
  const nextRound1Based = stage.completedRounds + 1;
  const roundsInput = interaction.options.getString(
    optionName(subParams.rounds),
    false
  );

  let targetRounds: number[];
  let roundsExplicit: boolean;
  if (!roundsInput || roundsInput.trim() === "") {
    targetRounds = [nextRound1Based];
    roundsExplicit = false;
  } else {
    const parsed = parseRoundList(roundsInput);
    if (parsed === null) {
      await interaction.editReply(
        stringFormat(locale, reply.invalidRoundsFormat, roundsInput)
      );
      return;
    }
    targetRounds = parsed;
    roundsExplicit = true;
  }

  // 8a. Range check: rounds must exist within the stage.
  const outOfRange = targetRounds.filter((r) => r < 1 || r > stage.totalRounds);
  if (outOfRange.length > 0) {
    await interaction.editReply(
      stringFormat(
        locale,
        reply.roundOutOfRange,
        formatRounds(outOfRange),
        String(stage.totalRounds)
      )
    );
    return;
  }

  // 8b. Completed check: cannot target a round that has already been played.
  const alreadyCompleted = targetRounds.filter((r) => r < nextRound1Based);
  if (alreadyCompleted.length > 0) {
    await interaction.editReply(
      stringFormat(
        locale,
        reply.roundAlreadyCompleted,
        formatRounds(alreadyCompleted)
      )
    );
    return;
  }

  // 8c. Seating check: the player must actually be seated in each round.
  const notScheduled = targetRounds.filter(
    (r) =>
      !isPlayerScheduledInRound(
        stage.scheduling,
        r - 1,
        stage.participantStageIndex,
        playerMemberIndex
      )
  );
  if (notScheduled.length > 0) {
    if (roundsExplicit) {
      await interaction.editReply(
        stringFormat(
          locale,
          reply.playerNotScheduledInRound,
          playerUser.name,
          formatRounds(notScheduled)
        )
      );
    } else {
      await interaction.editReply(
        stringFormat(locale, reply.playerNotScheduled, playerUser.name)
      );
    }
    return;
  }

  // ── 9. Reject overlapping substitutions for the same player ────────────
  const existingSubs = await SubstitutionModel.find({
    league: league._id,
    replacedPlayer: playerObjectId,
  }).lean();

  for (const ex of existingSubs) {
    const overlaps =
      ex.stageId === stage.stageId &&
      targetRounds.some((r) => (ex.rounds ?? []).includes(r));
    if (overlaps) {
      await interaction.editReply(
        stringFormat(locale, reply.overlappingSubstitution, playerUser.name)
      );
      return;
    }
  }

  // ── 10. Create the substitution ────────────────────────────────────────
  await SubstitutionModel.create({
    league: league._id,
    ...(isTeamMode ? { team: new mongoose.Types.ObjectId(participantId) } : {}),
    replacedPlayer: playerObjectId,
    substitutePlayer: substituteObjectId,
    stageId: stage.stageId,
    rounds: targetRounds,
  });

  emitLeagueUpdated(league._id.toString());

  const roundsLabel = formatRounds(targetRounds);
  if (isOfficialSub) {
    await interaction.editReply(
      stringFormat(
        locale,
        reply.officialSubFormat,
        substituteUser.name,
        playerUser.name,
        roundsLabel
      )
    );
  } else {
    await interaction.editReply(
      stringFormat(
        locale,
        reply.successFormat,
        playerUser.name,
        substituteUser.name,
        roundsLabel
      )
    );
  }
}

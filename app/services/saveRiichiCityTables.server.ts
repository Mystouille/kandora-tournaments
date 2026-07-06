import mongoose from "mongoose";
import { LeagueModel, type League } from "~/db/League";
import { Platform } from "~/types/league-enums";
import {
  BracketModel,
  type Bracket,
  getSeedingParticipantId,
} from "~/db/Bracket";
import { GameModel, type Game } from "~/db/Game";
import { SchedulingMessageModel } from "~/db/SchedulingMessage";
import { TeamModel, type Team } from "~/db/Team";
import { UserModel, type User } from "~/db/User";
import {
  resolveLeagueTypeConfig,
  buildFinalsGameMatch,
} from "~/services/league-configs/index";
import type { LeagueTypeConfig } from "~/services/league-configs/types";
import { computeBracket, type BracketContext } from "~/services/bracketUtils";
import {
  resolveBracketStagesForConfig,
  resolveFinalDeltaComputer,
} from "~/services/league-strategies/finalPhaseStrategies";
import {
  generateTeamBracketSeating,
  generateIndividualScheduling,
} from "~/services/league-configs/teamBracketSeating";
import {
  resolveRound,
  loadStageParticipantsByIds,
  buildUserMap,
  loadSubstituteMap,
  buildOfficialSubstituteTeamMap,
  type ResolvedRound,
} from "~/services/schedulingMessageService.server";
import { LeagueService } from "~/services/LeagueService.server";
import { RiichiCityLeagueConnector } from "~/services/connectors/RiichiCityLeagueConnector.server";

export interface SaveRcTablesResult {
  stagesProcessed: { stageId: string; roundsSaved: number }[];
  totalRoundsSaved: number;
  totalTablesSaved: number;
  skippedStages: { stageId: string; reason: string }[];
}

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

function resolvedToRcTables(
  resolved: ResolvedRound
): Array<{ userID: number; nickname: string }[]> {
  const tables: Array<{ userID: number; nickname: string }[]> = [];
  for (const table of resolved) {
    const seats: { userID: number; nickname: string }[] = [];
    let skip = false;
    for (const seat of table) {
      if (seat.platformAccountId == null) {
        skip = true;
        break;
      }
      const userID =
        typeof seat.platformAccountId === "number"
          ? seat.platformAccountId
          : parseInt(seat.platformAccountId, 10);
      if (Number.isNaN(userID)) {
        skip = true;
        break;
      }
      seats.push({ userID, nickname: seat.userName });
    }
    if (skip || seats.length !== 4) {
      continue;
    }
    tables.push(seats);
  }
  return tables;
}

/**
 * Failsafe: pre-save Riichi City table pairings for every remaining round
 * of every stage whose participants are fully resolved. Used when admins
 * suspect the Discord bot may not be able to schedule rounds in time.
 *
 * Idempotency: a round whose `SchedulingMessage` already exists is skipped
 * (the bot already pushed those tables when it created the message).
 */
export async function saveAllRiichiCityTablesForLeague(
  leagueId: string | mongoose.Types.ObjectId
): Promise<SaveRcTablesResult> {
  const id =
    typeof leagueId === "string"
      ? new mongoose.Types.ObjectId(leagueId)
      : leagueId;

  const league = await LeagueModel.findById(id)
    .populate("leagueTypeConfig")
    .lean<(League & { _id: mongoose.Types.ObjectId }) | null>();

  if (!league) {
    throw new Error(`League not found: ${id.toString()}`);
  }

  if (league.platformConfig.platformName !== Platform.RIICHICITY) {
    throw new Error("League is not a Riichi City tournament");
  }
  const tournamentId = league.platformConfig.tournamentId;
  if (!tournamentId) {
    throw new Error("League has no Riichi City tournamentId configured");
  }

  const config = resolveLeagueTypeConfig(
    league.leagueTypeConfig as LeagueTypeConfig | null
  );
  if (!config?.finalPhase) {
    throw new Error("League has no final phase configured");
  }

  let bracket = (await BracketModel.findOne({
    league: id,
  }).lean()) as Bracket | null;

  if (!bracket) {
    try {
      await LeagueService.instance.ensureBracketSeedings(league, config);
    } catch (error) {
      console.warn(
        `saveAllRiichiCityTablesForLeague: ensureBracketSeedings failed for ${league.name}:`,
        error
      );
    }
    bracket = (await BracketModel.findOne({
      league: id,
    }).lean()) as Bracket | null;
  }

  if (!bracket) {
    throw new Error("Bracket seedings are not available yet");
  }

  const isTeamMode = config.isTeamMode !== false;

  const resolvedSeedings = new Map(
    bracket.seedings.map((s) => [
      s.seed,
      getSeedingParticipantId(s, isTeamMode).toString(),
    ])
  );

  const teamNameMap = new Map<string, string>();
  const userTeamMap = new Map<string, string>();
  const teamSizeMap = new Map<string, number>();

  if (isTeamMode) {
    const allTeams = (await TeamModel.find({
      leagueId: id,
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

  const gameFilter: Record<string, unknown> = {
    league: id,
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

  const stagesProcessed: { stageId: string; roundsSaved: number }[] = [];
  const skippedStages: { stageId: string; reason: string }[] = [];
  let totalRoundsSaved = 0;
  let totalTablesSaved = 0;

  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Determine which stages are eligible and load their scheduling ──
  type EligibleStage = {
    stageDef: (typeof config.finalPhase.stages)[number];
    computed: (typeof computedStages)[number];
    scheduling: ReturnType<typeof generateIndividualScheduling>;
    existingRounds: Set<number>;
    perStageSaved: number;
  };
  const eligibleStages: EligibleStage[] = [];

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
      skippedStages.push({
        stageId: stageDef.id,
        reason: "participants_not_resolved",
      });
      continue;
    }
    if (computed.isComplete) {
      skippedStages.push({
        stageId: stageDef.id,
        reason: "stage_complete",
      });
      continue;
    }

    const scheduling = isTeamMode
      ? generateTeamBracketSeating(
          stageDef.gameCount,
          resolveTeamSizes(computed.teams, teamSizeMap)
        )
      : generateIndividualScheduling(stageDef.gameCount);

    const existingMessages = await SchedulingMessageModel.find({
      league: id,
      stageId: stageDef.id,
    })
      .select("roundIndex")
      .lean();
    const existingRounds = new Set(
      existingMessages.map((m) => m.roundIndex as number)
    );

    eligibleStages.push({
      stageDef,
      computed,
      scheduling,
      existingRounds,
      perStageSaved: 0,
    });
  }

  // ── 2. Iterate by round, batching all stages' tables into one RC call ──
  const substituteMap = await loadSubstituteMap(
    id,
    league.officialSubstitutes ?? []
  );

  const maxRounds = eligibleStages.reduce(
    (acc, s) => Math.max(acc, s.scheduling.length),
    0
  );

  // RC caps tournaments at 5 saved table configs. Clear existing configs
  // up-front so the per-round saves below never hit the limit.
  if (maxRounds > 0) {
    await RiichiCityLeagueConnector.instance.clearTablePairings(tournamentId);
  }

  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex++) {
    const tablesForRound: Array<{ userID: number; nickname: string }[]> = [];
    const stagesInThisRound: EligibleStage[] = [];

    for (const stage of eligibleStages) {
      if (roundIndex >= stage.scheduling.length) {
        continue;
      }
      if (stage.existingRounds.has(roundIndex)) {
        continue;
      }

      const participants = await loadStageParticipantsByIds(
        id,
        stage.computed.teams.map((tid) => new mongoose.Types.ObjectId(tid)),
        isTeamMode,
        stage.stageDef.id,
        roundIndex
      );
      const userMap = await buildUserMap(
        participants,
        league.platformConfig.platformName
      );

      const resolved = resolveRound(
        stage.stageDef,
        stage.scheduling,
        roundIndex,
        participants,
        userMap,
        substituteMap
      );

      const tables = resolvedToRcTables(resolved);
      if (tables.length === 0) {
        continue;
      }
      tablesForRound.push(...tables);
      stagesInThisRound.push(stage);
    }

    if (tablesForRound.length === 0) {
      continue;
    }

    const name = `${today} R${roundIndex + 1}`;
    await RiichiCityLeagueConnector.instance.saveTablePairings(
      tournamentId,
      name,
      tablesForRound
    );

    totalRoundsSaved += 1;
    totalTablesSaved += tablesForRound.length;
    for (const stage of stagesInThisRound) {
      stage.perStageSaved += 1;
    }
  }

  for (const stage of eligibleStages) {
    stagesProcessed.push({
      stageId: stage.stageDef.id,
      roundsSaved: stage.perStageSaved,
    });
  }

  return {
    stagesProcessed,
    totalRoundsSaved,
    totalTablesSaved,
    skippedStages,
  };
}

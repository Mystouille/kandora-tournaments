import { connectToDatabase } from "../../utils/dbConnection.server";
import { getLeagueUserPictureMap } from "../../services/leagueUserPictures.server";
import type { Route } from "./+types/bracket-scores";
import type { PicturePair } from "../../types/pictures";
import mongoose from "mongoose";
import { Ruleset, LeagueModel, type League } from "../../db/League";
import { GameModel, type Game } from "../../db/Game";
import { TeamModel, type Team } from "../../db/Team";
import { UserModel, type User } from "../../db/User";
import { GameRecordModel, type GameRecord } from "../../db/GameRecord";
import {
  BracketModel,
  type Bracket,
  getSeedingParticipantId,
} from "../../db/Bracket";
import { SubstitutionModel } from "../../db/Substitution";
import { SchedulingMessageModel } from "../../db/SchedulingMessage";
import {
  computeBracket,
  computeBracketStageMetadata,
  classifyGamesByStage,
  GAMES_PER_STAGE,
  type BracketContext,
} from "../../services/bracketUtils";
import { computePlayerDeltas } from "../../services/leagueUtils";
import {
  buildFinalsGameMatch,
  buildRegularGameMatch,
  computeScoreCarryOverOffsets,
  resolveConfiguredBracketStages,
  resolveFinalPhaseGameCutoff,
  resolveLeagueTypeConfig,
} from "../../services/league-configs";
import { resolveFinalDeltaComputer } from "../../services/league-strategies/finalPhaseStrategies";
import {
  computeNonTeamRankingData,
  computeTeamBasedRankingData,
} from "../../services/league-strategies/regularRankingStrategies";
import {
  generateTeamBracketSeating,
  generateIndividualScheduling,
} from "../../services/league-configs/teamBracketSeating";
import {
  matchGamesToTables,
  type MatchGame,
  type MatchTable,
} from "../../services/scheduleMatching";
import { buildOfficialSubstituteTeamMap } from "../../services/schedulingMessageService.server";

import { getLeagueApiCache } from "~/services/leagueApiCache.server";

// ---------- In-memory cache (survives across requests in the same process) ----------
function getCached(key: string): any | null {
  return getLeagueApiCache<any>("bracket-scores").get(key);
}

function setCache(key: string, data: any): void {
  getLeagueApiCache<any>("bracket-scores").set(key, data);
}

function resolvePrimaryDisplayName(user: User): string {
  if (user.firstName) {
    const lastInitial = user.lastName ? ` ${user.lastName.charAt(0)}.` : "";
    return `${user.firstName}${lastInitial}`;
  }

  return (
    user.discordIdentity?.displayName ??
    user.name ??
    user.riichiCityIdentity?.name ??
    user.majsoulIdentity?.name ??
    user.tenhouIdentity?.name ??
    "Unknown"
  );
}

function resolvePlatformIdentityName(user: User): string | null {
  return (
    user.riichiCityIdentity?.name ??
    user.majsoulIdentity?.name ??
    user.tenhouIdentity?.name ??
    null
  );
}

/**
 * GET /api/bracket-scores?leagueId=...
 *
 * Returns per-phase team scores and game counts for the elimination bracket.
 * Phases are determined using the shared sequential bracket resolution logic
 * from bracketUtils (same algorithm used by the Discord bot).
 */
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const leagueId = url.searchParams.get("leagueId");

    if (!leagueId) {
      return Response.json({ error: "leagueId is required" }, { status: 400 });
    }

    const cacheKey = `bracket-scores:${leagueId}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return Response.json(cached);
    }

    await connectToDatabase();
    const Game = GameModel;
    const Team = TeamModel;
    const User = UserModel;
    const GameRecord = GameRecordModel;
    const Bracket = BracketModel;
    const League = LeagueModel;

    // Fetch league to get ruleset and finals cutoff
    const league = await League.findById(leagueId)
      .select(
        "rulesConfig phaseCutoffTimes leagueTypeConfig officialSubstitutes endTime"
      )
      .populate("leagueTypeConfig")
      .lean<League | null>();
    const rules: Ruleset = league?.rulesConfig?.gameRules ?? Ruleset.MLEAGUE;
    const leagueType = resolveLeagueTypeConfig(league?.leagueTypeConfig);
    // A finished league has no upcoming games: once it's over, planned tables
    // that never linked to a played game are dropped below so the bracket popup
    // shows only games that actually happened.
    const leagueIsOver = league?.endTime
      ? new Date(league.endTime).getTime() < Date.now()
      : false;

    const configuredStages = resolveConfiguredBracketStages(
      league?.leagueTypeConfig
    );
    if (!configuredStages) {
      const emptyResult = { phases: {} };
      setCache(cacheKey, emptyResult);
      return Response.json(emptyResult);
    }

    // Fetch all games for this league, respecting score-reset cutoff if configured
    const finalsCutoff = resolveFinalPhaseGameCutoff(
      leagueType,
      league ?? ({} as League)
    );
    // Finals-window games that count toward the bracket. Filtering on `isValid`
    // matches the Discord bracket path; the scheduling linker marks any game it
    // links to a scheduled table valid (including official-substitute games),
    // so this still includes legitimately-played sub games.
    const gamesQuery: Record<string, unknown> = {
      league: new mongoose.Types.ObjectId(leagueId),
      isValid: true,
    };
    // Prefer the per-game phase tag over the time cutoff (per-phase leagues),
    // falling back to `startTime >= cutoff` for untagged (legacy) games.
    const finalsMatch = buildFinalsGameMatch(
      leagueType,
      league ?? ({} as League)
    );
    if (finalsMatch) {
      Object.assign(gamesQuery, finalsMatch);
    }
    const games = await Game.find(gamesQuery)
      .select("gameId context results startTime platform log")
      .sort({ startTime: 1 })
      .lean<Game[]>();

    // Fetch all teams for this league (including substitutes)
    const teams = await Team.find({
      leagueId: new mongoose.Types.ObjectId(leagueId),
    })
      .select("_id displayName roster")
      .lean<Team[]>();

    // Fetch bracket seedings
    const bracket = await Bracket.findOne({
      league: new mongoose.Types.ObjectId(leagueId),
    })
      .select("seedings")
      .lean<Bracket | null>();

    // Build seed → participantId map
    const isTeamMode =
      league?.rulesConfig?.isTeamMode ?? leagueType?.isTeamMode ?? true;

    const seedings = new Map<number, string>();
    if (bracket) {
      for (const s of bracket.seedings ?? []) {
        seedings.set(s.seed, getSeedingParticipantId(s, isTeamMode).toString());
      }
    }

    // Fallback: when no Bracket document exists yet, auto-seed by team
    // creation order so the bracket UI can show participants in place even
    // before any games are played. Only fills seeds present in the stage
    // definitions.
    if (seedings.size === 0) {
      const requiredSeeds = new Set<number>();
      for (const stage of configuredStages) {
        for (const seed of stage.seeds) {
          requiredSeeds.add(seed);
        }
      }
      const maxSeed = requiredSeeds.size > 0 ? Math.max(...requiredSeeds) : 0;
      const orderedTeams = [...teams].sort((a, b) =>
        a._id.toString().localeCompare(b._id.toString())
      );
      if (isTeamMode) {
        for (let i = 0; i < Math.min(maxSeed, orderedTeams.length); i++) {
          if (requiredSeeds.has(i + 1)) {
            seedings.set(i + 1, orderedTeams[i]._id.toString());
          }
        }
      } else {
        const orderedUserIds: string[] = [];
        for (const team of orderedTeams) {
          for (const memberId of team.roster.members ?? []) {
            orderedUserIds.push(memberId.toString());
          }
        }
        for (let i = 0; i < Math.min(maxSeed, orderedUserIds.length); i++) {
          if (requiredSeeds.has(i + 1)) {
            seedings.set(i + 1, orderedUserIds[i]);
          }
        }
      }
    }

    // Build userId → participantId map and participantId → displayName map.
    const userTeamMap = new Map<string, string>();
    const participantToFactionMap = new Map<string, string>();
    const substituteSet = new Set<string>();
    const officialSubSet = new Set<string>(
      (league?.officialSubstitutes ?? []).map((id: any) => id.toString())
    );
    const teamNameMap = new Map<string, string>();
    // teamId → that team's substitute pool (user IDs). Used by the game→table
    // matcher to validate undeclared substitutions. Empty in individual mode.
    const teamSubPoolByTeamId = new Map<string, Set<string>>();

    if (!isTeamMode) {
      for (const team of teams) {
        const factionId = team._id.toString();
        for (const memberId of team.roster.members ?? []) {
          participantToFactionMap.set(memberId.toString(), factionId);
        }
        for (const subId of team.roster.substitutes ?? []) {
          participantToFactionMap.set(subId.toString(), factionId);
        }
      }

      const participantIds = new Set<string>();
      for (const seededId of seedings.values()) {
        participantIds.add(seededId);
      }
      for (const game of games) {
        for (const r of game.results ?? []) {
          participantIds.add(r.userId.toString());
        }
      }

      const users = await User.find({
        _id: {
          $in: Array.from(participantIds).map(
            (id) => new mongoose.Types.ObjectId(id)
          ),
        },
      })
        .select(
          "_id name firstName lastName discordIdentity majsoulIdentity riichiCityIdentity tenhouIdentity"
        )
        .lean<User[]>();

      for (const user of users) {
        const userId = user._id.toString();
        userTeamMap.set(userId, userId);
        teamNameMap.set(userId, resolvePrimaryDisplayName(user));
      }
    } else {
      for (const team of teams) {
        const teamId = team._id.toString();
        teamNameMap.set(teamId, team.displayName);
        for (const memberId of team.roster.members ?? []) {
          userTeamMap.set(memberId.toString(), teamId);
          participantToFactionMap.set(memberId.toString(), teamId);
        }
        const subPool = new Set<string>();
        for (const subId of team.roster.substitutes ?? []) {
          const sid = subId.toString();
          userTeamMap.set(sid, teamId);
          participantToFactionMap.set(sid, teamId);
          substituteSet.add(sid);
          subPool.add(sid);
        }
        teamSubPoolByTeamId.set(teamId, subPool);
      }
    }

    const resolvedSeedings = seedings;

    let initialScoreOffsets: Map<string, number> | undefined;
    if (
      leagueType?.finalPhase?.scoreCarryOver &&
      leagueType.finalPhase.scoreCarryOver.num > 0 &&
      finalsCutoff
    ) {
      const regularMatch = buildRegularGameMatch(
        leagueType,
        league ?? ({} as League)
      );
      const regularPhaseGames = await Game.find({
        league: new mongoose.Types.ObjectId(leagueId),
        isValid: true,
        ...(regularMatch ?? { startTime: { $lt: finalsCutoff } }),
      })
        .select("results startTime")
        .lean<Game[]>();

      const regularRankingInput = regularPhaseGames.map((g) => ({
        startTime: g.startTime,
        results: (g.results ?? []).map((r) => ({
          userId: r.userId.toString(),
          score: r.score,
        })),
      }));

      const regularPhaseScores = new Map<string, number>();
      if (!isTeamMode) {
        const { sortedPlayers } = computeNonTeamRankingData(
          regularRankingInput,
          rules,
          leagueType.regularPhase?.scoring,
          userTeamMap
        );
        for (const player of sortedPlayers) {
          regularPhaseScores.set(player.userId, player.rankingScore);
        }
      } else {
        const { sortedTeams } = computeTeamBasedRankingData(
          regularRankingInput,
          rules,
          userTeamMap
        );
        for (const team of sortedTeams) {
          regularPhaseScores.set(team.teamId, team.totalScore);
        }
      }

      initialScoreOffsets = computeScoreCarryOverOffsets(
        leagueType,
        regularPhaseScores
      );
    }

    // Prepare games in the shape expected by bracketUtils
    const bracketGames = games.map((g) => ({
      results: (g.results ?? []).map((r) => ({
        userId: r.userId.toString(),
        score: r.score,
      })),
    }));

    // Compute bracket stages using the shared sequential resolution logic
    const officialSubTeamMap = await buildOfficialSubstituteTeamMap(leagueId);
    const bracketCtx: BracketContext = {
      seedings: resolvedSeedings,
      userToTeamMap: userTeamMap,
      teamNameMap,
      games: bracketGames,
      initialScoreOffsets,
      rules,
      deltaComputer: leagueType
        ? resolveFinalDeltaComputer(leagueType, rules)
        : undefined,
      officialSubIds: officialSubSet,
      officialSubTeamMap,
    };
    const computedStages = computeBracket(configuredStages, bracketCtx);

    // Classify each original game into its stage
    const gamesByStage = classifyGamesByStage(
      computedStages,
      bracketGames,
      userTeamMap
    );

    // Build a lookup: bracketGame index → stage name
    const gameIndexToStage = new Map<number, string>();
    for (const [stageName, stageGames] of gamesByStage) {
      for (const sg of stageGames) {
        const idx = bracketGames.indexOf(sg);
        if (idx >= 0) {
          gameIndexToStage.set(idx, stageName);
        }
      }
    }

    // Fetch user names — include both played-game players and all team
    // roster members so the planned-schedule popup can show participants
    // even for stages that haven't started yet.
    const allUserIds = new Set<string>();
    for (const game of games) {
      for (const r of game.results ?? []) {
        allUserIds.add(r.userId.toString());
      }
    }
    for (const team of teams) {
      for (const memberId of team.roster.members ?? []) {
        allUserIds.add(memberId.toString());
      }
      for (const subId of team.roster.substitutes ?? []) {
        allUserIds.add(subId.toString());
      }
    }
    if (!isTeamMode) {
      for (const id of seedings.values()) {
        allUserIds.add(id);
      }
    }
    for (const officialSubId of league?.officialSubstitutes ?? []) {
      allUserIds.add(officialSubId.toString());
    }

    // Load active substitutions for this league. Each substitution is scoped
    // to a specific stage and an explicit set of 1-based rounds, so we key
    // the lookup maps by stage + 0-based round index and only apply a sub to
    // the exact rounds it targets.
    const substitutions = await SubstitutionModel.find({
      league: new mongoose.Types.ObjectId(leagueId),
    })
      .select("team replacedPlayer substitutePlayer stageId rounds")
      .lean();

    /** key = `${stageKey}|${roundIndex0}|${teamId}-${replacedPlayerId}` */
    const teamSubMap = new Map<string, string>();
    /** key = `${stageKey}|${roundIndex0}|${replacedPlayerId}` (individual) */
    const individualSubMap = new Map<string, string>();
    for (const sub of substitutions) {
      const substituteId = sub.substitutePlayer.toString();
      allUserIds.add(substituteId);
      const replacedId = sub.replacedPlayer.toString();
      const stageKey = (sub.stageId ?? "").toLowerCase();
      for (const round1Based of sub.rounds ?? []) {
        const roundIndex0 = round1Based - 1;
        if (sub.team) {
          teamSubMap.set(
            `${stageKey}|${roundIndex0}|${sub.team.toString()}-${replacedId}`,
            substituteId
          );
        } else {
          individualSubMap.set(
            `${stageKey}|${roundIndex0}|${replacedId}`,
            substituteId
          );
        }
      }
    }

    // Load persisted scheduling seating (SchedulingMessage.tables[]). For
    // launched rounds this is the authoritative record of who is seated where
    // and which game was played at each table, so the bracket popup renders
    // exactly what was scheduled regardless of finish order. Rounds without a
    // persisted message fall back to on-the-fly generation below.
    const schedulingMessages = await SchedulingMessageModel.find({
      league: new mongoose.Types.ObjectId(leagueId),
      tables: { $exists: true, $ne: [] },
    })
      .select("stageId roundIndex tables")
      .lean();

    type PersistedSeatLean = {
      seatIndex: number;
      teamId: mongoose.Types.ObjectId | null;
      userId: mongoose.Types.ObjectId;
      isSub: boolean;
      subType: "team" | "official" | null;
    };
    type PersistedTableLean = {
      tableIndex: number;
      seats: PersistedSeatLean[];
      gameId: string | null;
      wasInGame: boolean;
    };
    const persistedByStage = new Map<
      string,
      Map<number, PersistedTableLean[]>
    >();
    for (const message of schedulingMessages) {
      const tables = (message.tables ?? []) as PersistedTableLean[];
      if (tables.length === 0) {
        continue;
      }
      const stageKey = message.stageId.toLowerCase();
      let byRound = persistedByStage.get(stageKey);
      if (!byRound) {
        byRound = new Map();
        persistedByStage.set(stageKey, byRound);
      }
      byRound.set(message.roundIndex, tables);
      for (const table of tables) {
        for (const seat of table.seats ?? []) {
          allUserIds.add(seat.userId.toString());
        }
      }
    }

    const usersData = await User.find({
      _id: {
        $in: [...allUserIds].map((id) => new mongoose.Types.ObjectId(id)),
      },
    })
      .select(
        "_id name firstName lastName discordIdentity avatarUrl majsoulIdentity riichiCityIdentity tenhouIdentity"
      )
      .lean<User[]>();
    const userNameMap = new Map<string, string>();
    const userAvatarMap = new Map<string, string | null>();
    const userPlatformNameMap = new Map<string, string | null>();
    for (const u of usersData) {
      userNameMap.set(u._id.toString(), resolvePrimaryDisplayName(u));
      userAvatarMap.set(u._id.toString(), u.avatarUrl ?? null);
      userPlatformNameMap.set(u._id.toString(), resolvePlatformIdentityName(u));
    }

    const leagueUserPictures = await getLeagueUserPictureMap(leagueId);

    const leaguePictureFor = (
      userId: string | null | undefined
    ): PicturePair | null => {
      if (!userId) {
        return null;
      }
      return leagueUserPictures.get(userId) ?? null;
    };

    // Fetch GameRecords for deltaPoints (if available)
    const gameIds = games
      .map((g) => g.gameId)
      .filter((id): id is string => !!id);
    const gameRecords = await GameRecord.find({
      gameId: { $in: gameIds },
    })
      .select("gameId byUserData.userDbId byUserData.deltaPoints")
      .lean<GameRecord[]>();

    const recordMap = new Map<string, Map<string, number>>();
    for (const rec of gameRecords) {
      const userDeltas = new Map<string, number>();
      for (const ud of rec.byUserData ?? []) {
        userDeltas.set(ud.userDbId.toString(), ud.deltaPoints);
      }
      recordMap.set(rec.gameId, userDeltas);
    }

    // Build response phases using computed stage data + enriched game details
    type PlannedPlayer = {
      teamId: string | null;
      /** Resolved seat occupant (declared subs applied); null for TBD seats. */
      memberId: string | null;
      teamName: string;
      playerName: string;
      platformName: string | null;
      avatarUrl: string | null;
      leaguePicture: PicturePair | null;
      isSub: boolean;
      isOfficialSub: boolean;
    };
    type PlannedGame = {
      roundIndex: number;
      players: PlannedPlayer[];
      /** Linked finished game, set by the identity matcher below. */
      gameId: string | null;
      /** True once any seat was observed in-game (persisted tables only). */
      wasInGame: boolean;
      /** Derived table status for the UI; finalised after game linking. */
      status: "scheduled" | "ongoing" | "finished";
    };
    const phases: Record<
      string,
      {
        groupIndex: number;
        stageOrder: number;
        advancingCount: number;
        sources: string[];
        gamesPlayed: number;
        totalGames: number;
        teamScores: Record<string, number>;
        slots: {
          teamId: string | null;
          description: string;
          score: number | null;
        }[];
        games: {
          gameId: string | null;
          startTime: string;
          replayUrl: string | null;
          players: {
            teamId: string;
            teamName: string;
            playerName: string;
            platformName: string | null;
            avatarUrl: string | null;
            leaguePicture: PicturePair | null;
            score: number;
            delta: number;
            place: number;
            isSub: boolean;
            isOfficialSub: boolean;
          }[];
        }[];
        plannedGames: PlannedGame[];
      }
    > = {};

    const stageMetadata = computeBracketStageMetadata(
      computedStages.map((stage) => stage.definition)
    );

    // Build a planned player from a persisted seat (launched rounds). Mirrors
    // the on-the-fly resolution below but reads the stored occupant directly.
    const plannedPlayerFromSeat = (seat: PersistedSeatLean): PlannedPlayer => {
      const teamId = seat.teamId ? seat.teamId.toString() : null;
      const memberId = seat.userId ? seat.userId.toString() : null;
      const teamName = teamId ? (teamNameMap.get(teamId) ?? "?") : "TBD";
      const playerName = memberId
        ? (userNameMap.get(memberId) ?? teamName)
        : teamName;
      return {
        teamId,
        memberId,
        teamName,
        playerName,
        platformName: memberId
          ? (userPlatformNameMap.get(memberId) ?? null)
          : null,
        avatarUrl: memberId ? (userAvatarMap.get(memberId) ?? null) : null,
        leaguePicture: leaguePictureFor(memberId),
        isSub: seat.isSub ?? false,
        isOfficialSub: seat.subType === "official",
      };
    };

    // Initialize phases from computed stages (includes correct team scores)
    for (const stage of computedStages) {
      const name = stage.definition.name;
      const teamScores: Record<string, number> = {};
      for (const r of stage.results) {
        teamScores[r.teamId] = r.totalScore;
      }

      const slotDefinitions: {
        teamId: string | null;
        description: string;
        score: number | null;
      }[] = [];

      for (const seed of stage.definition.seeds) {
        const teamId = resolvedSeedings.get(seed) ?? null;
        slotDefinitions.push({
          teamId,
          description: teamId
            ? (teamNameMap.get(teamId) ?? `Seed ${seed}`)
            : `Seed ${seed}`,
          score:
            teamId && teamScores[teamId] != null ? teamScores[teamId] : null,
        });
      }

      for (const source of stage.definition.fromStages) {
        let teamId: string | null = null;
        const sourceStage = computedStages.find(
          (computed) => computed.definition.name === source.stage
        );
        if (
          sourceStage?.isComplete &&
          sourceStage.results.length >= source.place
        ) {
          teamId = sourceStage.results[source.place - 1].teamId;
        }

        slotDefinitions.push({
          teamId,
          description: `${source.stage} #${source.place}`,
          score:
            teamId && teamScores[teamId] != null ? teamScores[teamId] : null,
        });
      }

      const metadata = stageMetadata.get(name);
      const totalGames = stage.definition.gamesToComplete ?? GAMES_PER_STAGE;
      phases[name] = {
        groupIndex: metadata?.groupIndex ?? 0,
        stageOrder: metadata?.stageOrder ?? stage.definition.order,
        advancingCount: metadata?.advancingCount ?? 0,
        sources: stage.definition.fromStages.map((f) => f.stage),
        gamesPlayed: stage.gamesPlayed,
        totalGames,
        teamScores,
        slots: slotDefinitions,
        games: [],
        plannedGames: [],
      };

      // Generate planned matchups using the same scheduling logic used for
      // tournament scheduling messages. Build the participant list from
      // resolved slots; unresolved slots fall back to slot descriptions.
      if (totalGames > 0) {
        const teamMembers = new Map<string, string[]>();
        for (const team of teams) {
          const finalsMembers = team.finalsRoster?.members;
          const members =
            finalsMembers && finalsMembers.length > 0
              ? finalsMembers
              : (team.roster.members ?? []);
          teamMembers.set(
            team._id.toString(),
            members.map((id) => id.toString())
          );
        }
        const slotParticipants = slotDefinitions.map((slot) => {
          if (!slot.teamId) {
            return {
              teamId: null as string | null,
              teamName: slot.description,
              memberIds: [] as string[],
            };
          }
          const memberIds = isTeamMode
            ? (teamMembers.get(slot.teamId) ?? [])
            : [slot.teamId];
          return {
            teamId: slot.teamId,
            teamName: teamNameMap.get(slot.teamId) ?? slot.description,
            memberIds,
          };
        });

        const teamSizes: [number, number, number, number] = isTeamMode
          ? [
              slotParticipants[0]?.memberIds.length || 4,
              slotParticipants[1]?.memberIds.length || 4,
              slotParticipants[2]?.memberIds.length || 4,
              slotParticipants[3]?.memberIds.length || 4,
            ]
          : [4, 4, 4, 4];
        const scheduling = isTeamMode
          ? generateTeamBracketSeating(totalGames, teamSizes)
          : generateIndividualScheduling(totalGames);

        const planned: PlannedGame[] = [];
        const stageKey = name.toLowerCase();
        const persistedRounds = persistedByStage.get(stageKey);
        for (let r = 0; r < scheduling.length; r++) {
          // Prefer authoritative persisted seating for launched rounds.
          const persistedTables = persistedRounds?.get(r);
          if (persistedTables && persistedTables.length > 0) {
            const ordered = [...persistedTables].sort(
              (a, b) => a.tableIndex - b.tableIndex
            );
            for (const table of ordered) {
              const players = table.seats.map((seat) =>
                plannedPlayerFromSeat(seat)
              );
              planned.push({
                roundIndex: r,
                players,
                gameId: table.gameId ?? null,
                wasInGame: table.wasInGame ?? false,
                status: "scheduled",
              });
              if (planned.length >= totalGames) {
                break;
              }
            }
            if (planned.length >= totalGames) {
              break;
            }
            continue;
          }
          const round = scheduling[r];
          for (const table of round) {
            const players: PlannedPlayer[] = table.map((seat) => {
              const participant = slotParticipants[seat.team - 1];
              if (!participant || !participant.teamId) {
                return {
                  teamId: null,
                  memberId: null,
                  teamName: participant?.teamName ?? "TBD",
                  playerName: participant?.teamName ?? "TBD",
                  platformName: null,
                  avatarUrl: null,
                  leaguePicture: null,
                  isSub: false,
                  isOfficialSub: false,
                };
              }
              const rosterMemberId = participant.memberIds[seat.player - 1];
              let memberId = rosterMemberId;
              let isSub = false;
              let isOfficialSub = false;
              if (rosterMemberId) {
                const substituteId = isTeamMode
                  ? teamSubMap.get(
                      `${stageKey}|${r}|${participant.teamId}-${rosterMemberId}`
                    )
                  : individualSubMap.get(`${stageKey}|${r}|${rosterMemberId}`);
                if (substituteId) {
                  memberId = substituteId;
                  isSub = true;
                  isOfficialSub = officialSubSet.has(substituteId);
                }
              }
              const playerName = memberId
                ? (userNameMap.get(memberId) ?? participant.teamName)
                : participant.teamName;
              return {
                teamId: participant.teamId,
                memberId: memberId ?? null,
                teamName: participant.teamName,
                playerName,
                platformName: memberId
                  ? (userPlatformNameMap.get(memberId) ?? null)
                  : null,
                avatarUrl: memberId
                  ? (userAvatarMap.get(memberId) ?? null)
                  : null,
                leaguePicture: leaguePictureFor(memberId),
                isSub,
                isOfficialSub,
              };
            });
            planned.push({
              roundIndex: r,
              players,
              gameId: null,
              wasInGame: false,
              status: "scheduled",
            });
            if (planned.length >= totalGames) {
              break;
            }
          }
          if (planned.length >= totalGames) {
            break;
          }
        }
        phases[name].plannedGames = planned;
      }
    }

    // Enrich each game with player-level details for the UI
    for (let gameIdx = 0; gameIdx < games.length; gameIdx++) {
      const game = games[gameIdx];
      const phaseKey = gameIndexToStage.get(gameIdx);
      if (!phaseKey || !phases[phaseKey]) {
        continue;
      }

      const phase = phases[phaseKey];

      // Try to use GameRecord deltaPoints first, fall back to computation
      const record = game.gameId ? recordMap.get(game.gameId) : null;

      // Build replay URL
      let replayUrl: string | null = null;
      if (game.log) {
        replayUrl = game.log;
      } else if (game.gameId && game.platform === "majsoul") {
        replayUrl = `https://game.mahjongsoul.com/?paipu=${game.gameId}`;
      }

      // Compute deltas for this game using the shared function
      const gameResults = (game.results ?? []).map((r) => ({
        userId: r.userId.toString(),
        score: r.score,
        place: r.place,
      }));
      const sharedDeltas = computePlayerDeltas(gameResults, rules);

      const gamePlayers: {
        teamId: string;
        teamName: string;
        playerName: string;
        platformName: string | null;
        avatarUrl: string | null;
        leaguePicture: PicturePair | null;
        score: number;
        delta: number;
        place: number;
        isSub: boolean;
        isOfficialSub: boolean;
      }[] = [];

      for (let i = 0; i < gameResults.length; i++) {
        const userId = gameResults[i].userId;
        let teamId = userTeamMap.get(userId);

        // Official substitutes may not be in userTeamMap;
        // try to infer their team from the other players in this game
        const isOfficialSub = officialSubSet.has(userId);
        if (!teamId && isOfficialSub) {
          // Find the most common team among other players in this game
          const otherTeamIds = gameResults
            .filter((_, j) => j !== i)
            .map((r) => userTeamMap.get(r.userId))
            .filter((id): id is string => !!id);
          // If there's a team with fewer players in the game, the sub likely belongs there
          const teamCount = new Map<string, number>();
          for (const tid of otherTeamIds) {
            teamCount.set(tid, (teamCount.get(tid) ?? 0) + 1);
          }
          // Pick the team with the fewest players (the one that needs a sub)
          let minCount = Infinity;
          for (const [tid, count] of teamCount) {
            if (count < minCount) {
              minCount = count;
              teamId = tid;
            }
          }
        }

        if (!teamId) {
          continue;
        }

        // Prefer stored GameRecord delta, fall back to shared computation
        let delta: number;
        if (record && record.has(userId)) {
          delta = record.get(userId)!;
        } else {
          delta = sharedDeltas[i];
        }

        gamePlayers.push({
          teamId,
          teamName: teamNameMap.get(teamId) ?? "?",
          playerName: userNameMap.get(userId) ?? "?",
          platformName: userPlatformNameMap.get(userId) ?? null,
          avatarUrl: userAvatarMap.get(userId) ?? null,
          leaguePicture: leaguePictureFor(userId),
          score: gameResults[i].score,
          delta: Math.round(delta * 10) / 10,
          place: gameResults[i].place,
          isSub: substituteSet.has(userId) || isOfficialSub,
          isOfficialSub,
        });
      }

      phase.games.push({
        gameId: game.gameId ?? null,
        startTime: game.startTime.toISOString(),
        replayUrl,
        players: gamePlayers.sort((a, b) => a.place - b.place),
      });
    }

    // Link each finished game to its planned table by player identity (tolerant
    // of undeclared substitutions). This lets the UI render a finished game
    // against its correct scheduled slot regardless of the order games finish
    // in — fixing the "upcoming game A replaced by finished game B" display bug.
    const gameUserIdsById = new Map<string, string[]>();
    for (const g of games) {
      if (g.gameId) {
        gameUserIdsById.set(
          g.gameId,
          (g.results ?? []).map((r) => r.userId.toString())
        );
      }
    }
    for (const phaseKey of Object.keys(phases)) {
      const phase = phases[phaseKey];
      if (phase.plannedGames.length === 0 || phase.games.length === 0) {
        continue;
      }

      // Planned rows already linked via persisted tables are authoritative;
      // keep those links and exclude their games from re-matching.
      const alreadyLinked = new Set<string>();
      for (const pg of phase.plannedGames) {
        if (pg.gameId) {
          alreadyLinked.add(pg.gameId);
        }
      }

      const tables: MatchTable[] = [];
      for (let ti = 0; ti < phase.plannedGames.length; ti++) {
        const pg = phase.plannedGames[ti];
        if (pg.gameId) {
          continue;
        }
        const seats = pg.players
          .filter((p) => p.memberId)
          .map((p) => ({ userId: p.memberId as string, teamId: p.teamId }));
        // Skip tables with unresolved (TBD) seats — they cannot match a game.
        if (seats.length !== pg.players.length) {
          continue;
        }
        tables.push({ tableIndex: ti, seats });
      }

      const phaseGames: MatchGame[] = [];
      for (const g of phase.games) {
        if (!g.gameId || alreadyLinked.has(g.gameId)) {
          continue;
        }
        const userIds = gameUserIdsById.get(g.gameId);
        if (!userIds) {
          continue;
        }
        phaseGames.push({
          gameId: g.gameId,
          userIds,
          startTime: g.startTime,
        });
      }

      if (tables.length === 0 || phaseGames.length === 0) {
        continue;
      }

      const { matches } = matchGamesToTables(tables, phaseGames, {
        officialSubs: officialSubSet,
        teamSubPoolByTeamId,
      });
      for (const [tableIndex, match] of matches) {
        phase.plannedGames[tableIndex].gameId = match.gameId;
      }
    }

    // Derive each planned table's status now that game links are final:
    // finished (linked to a scored game), ongoing (a seat was observed
    // in-game but the game isn't scored yet), or scheduled.
    for (const phaseKey of Object.keys(phases)) {
      const phase = phases[phaseKey];
      const scoredIds = new Set<string>();
      for (const g of phase.games) {
        if (g.gameId) {
          scoredIds.add(g.gameId);
        }
      }
      for (const pg of phase.plannedGames) {
        if (pg.gameId && scoredIds.has(pg.gameId)) {
          pg.status = "finished";
        } else if (pg.wasInGame) {
          pg.status = "ongoing";
        } else {
          pg.status = "scheduled";
        }
      }
    }

    // A completed stage (or a finished league) has no upcoming games. Drop any
    // planned table that never linked to a played game so the popup doesn't
    // render phantom "upcoming" rows once a stage has reached its game quota —
    // e.g. a stage whose real games diverged from the on-the-fly generated
    // schedule (legacy scheduling messages without persisted tables, ad-hoc
    // re-scheduling, or undeclared substitutions). The unlinked finished games
    // still render via the BracketCard "overflow" path, and linked planned rows
    // are preserved. Incomplete stages keep their planned rows so genuinely
    // upcoming games stay visible.
    for (const phaseKey of Object.keys(phases)) {
      const phase = phases[phaseKey];
      const stageComplete =
        phase.totalGames > 0 && phase.gamesPlayed >= phase.totalGames;
      if (leagueIsOver || stageComplete) {
        phase.plannedGames = phase.plannedGames.filter((pg) => pg.gameId);
      }
    }

    const result = { phases };
    setCache(cacheKey, result);
    return Response.json(result);
  } catch (error) {
    console.error("Error fetching bracket scores:", error);
    return Response.json(
      { error: "Failed to fetch bracket scores" },
      { status: 500 }
    );
  }
}

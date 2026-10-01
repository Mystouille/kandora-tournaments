import { connectToDatabase } from "../../utils/dbConnection.server";
import type { Route } from "./+types/score-evolution";
import mongoose from "mongoose";
import {
  Ruleset,
  LeagueModel,
  type League,
} from "../../core/models/tournament/League";
import { computePlayerDeltas } from "../../services/leagueUtils";
import { GameModel, type Game } from "../../core/models/tournament/Game";
import { TeamModel, type Team } from "../../core/models/tournament/Team";
import { UserModel, type User } from "../../core/models/shared/User";
import {
  BracketModel,
  getSeedingParticipantId,
  type Bracket,
} from "../../core/models/tournament/Bracket";
import {
  resolveOrderedPhases,
  type LeagueTypeConfig,
  type OrderedPhase,
} from "../../services/league-configs";
import { computeMultiPhaseStandings } from "../../services/league-strategies/multiPhaseStrategies";

function getTeamMemberIds(team: Team, phase?: OrderedPhase): string[] {
  const roster =
    phase?.kind === "final" ? (team.finalsRoster ?? team.roster) : team.roster;
  return [...(roster.members ?? []), ...(roster.substitutes ?? [])].map((id) =>
    id.toString()
  );
}

interface RankingGame {
  startTime: Date;
  phaseId?: string | null;
  results: { userId: string; score: number }[];
}

async function loadRankingGames(league: League): Promise<RankingGame[]> {
  const games = await GameModel.find({ league: league._id, isValid: true })
    .select("startTime phaseId results")
    .sort({ startTime: 1 })
    .lean<Game[]>();
  return games.map((game) => ({
    startTime: game.startTime,
    phaseId: game.phaseId,
    results: (game.results ?? []).map((result) => ({
      userId: result.userId.toString(),
      score: result.score,
    })),
  }));
}

function computeQualifiedRegularPhaseIds(
  league: League,
  leagueType: LeagueTypeConfig,
  phase: OrderedPhase,
  teams: Team[],
  rankingGames: RankingGame[]
): Set<string> {
  const participants = leagueType.isTeamMode
    ? teams
    : [
        ...new Set(
          rankingGames.flatMap((game) => game.results.map((r) => r.userId))
        ),
      ].map((userId) => ({
        _id: userId,
        roster: { members: [userId], substitutes: [] },
      }));
  const result = computeMultiPhaseStandings(
    leagueType,
    rankingGames,
    league.rulesConfig.gameRules,
    participants,
    league.phaseCutoffTimes,
    phase.index
  );
  return new Set(result.standings.map((standing) => standing.teamId));
}

async function loadFinalQualifiedPhaseIds(
  league: League,
  leagueType: LeagueTypeConfig
): Promise<Set<string> | null> {
  const bracket = await BracketModel.findOne({ league: league._id })
    .select("seedings")
    .lean<Bracket | null>();
  if (!bracket) {
    return null;
  }
  return new Set(
    (bracket.seedings ?? []).map((seeding) =>
      getSeedingParticipantId(seeding, leagueType.isTeamMode).toString()
    )
  );
}

async function loadQualifiedPhaseIds(
  league: League,
  leagueType: LeagueTypeConfig,
  phase: OrderedPhase,
  teams: Team[]
): Promise<Set<string>> {
  if (phase.kind === "final") {
    return (
      (await loadFinalQualifiedPhaseIds(league, leagueType)) ??
      new Set<string>()
    );
  }

  // Qualification must use complete league results, not the graph's date or
  // participant filters, and includes qualifiers with no games in this phase.
  const rankingGames = await loadRankingGames(league);
  return computeQualifiedRegularPhaseIds(
    league,
    leagueType,
    phase,
    teams,
    rankingGames
  );
}

async function loadTeamEliminationDates(
  league: League,
  leagueType: LeagueTypeConfig,
  teams: Team[]
): Promise<Map<string, string>> {
  const phases = resolveOrderedPhases(leagueType);
  const remainingTeamIds = new Set(teams.map((team) => team._id.toString()));
  const eliminationDates = new Map<string, string>();
  let rankingGames: RankingGame[] | null = null;

  for (let phaseIndex = 1; phaseIndex < phases.length; phaseIndex++) {
    const cutoff = league.phaseCutoffTimes?.[phaseIndex - 1];
    if (!cutoff) {
      continue;
    }

    const phase = phases[phaseIndex];
    let qualifiedIds: Set<string>;
    if (phase.kind === "final") {
      const finalQualifiedIds = await loadFinalQualifiedPhaseIds(
        league,
        leagueType
      );
      if (!finalQualifiedIds) {
        continue;
      }
      qualifiedIds = finalQualifiedIds;
    } else {
      rankingGames ??= await loadRankingGames(league);
      qualifiedIds = computeQualifiedRegularPhaseIds(
        league,
        leagueType,
        phase,
        teams,
        rankingGames
      );
    }

    const cutoffDay = new Date(cutoff).toISOString().slice(0, 10);
    for (const teamId of [...remainingTeamIds]) {
      if (!qualifiedIds.has(teamId)) {
        eliminationDates.set(teamId, cutoffDay);
        remainingTeamIds.delete(teamId);
      }
    }
  }

  return eliminationDates;
}

/**
 * GET /api/score-evolution
 *
 * Query params:
 *   leagueIds   – comma-separated league ObjectId strings (required)
 *   playerIds   – comma-separated player ObjectId strings (optional)
 *   teamIds     – comma-separated team ObjectId strings (optional)
 *   entityType  – "player" or "team"; controls the default with no IDs selected
 *   phaseFilter – "both" (default) or "phaseN" (0-based, single league only);
 *                 restricts series to participants qualified for that phase
 *   startDate   – ISO date string (optional)
 *   endDate     – ISO date string (optional)
 *
 * Returns an array of series:
 * { id, label, eliminatedAt?, data: [{ x: "YYYY-MM-DD", y: number }] }
 * where y is the cumulative score at the end of each day and eliminatedAt is
 * the first day after the team's last qualified phase. The caller supplies the
 * selected phase's date boundaries via startDate/endDate.
 */
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const leagueIds =
      url.searchParams.get("leagueIds")?.split(",").filter(Boolean) ?? [];
    const playerIds =
      url.searchParams.get("playerIds")?.split(",").filter(Boolean) ?? [];
    const teamIds =
      url.searchParams.get("teamIds")?.split(",").filter(Boolean) ?? [];
    const entityType = url.searchParams.get("entityType");
    const phaseFilter = url.searchParams.get("phaseFilter") ?? "both";
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    if (leagueIds.length === 0) {
      return Response.json({ error: "leagueIds is required" }, { status: 400 });
    }

    if (
      entityType !== null &&
      entityType !== "player" &&
      entityType !== "team"
    ) {
      return Response.json({ error: "Invalid entityType" }, { status: 400 });
    }
    if (phaseFilter !== "both" && !/^phase(0|[1-9]\d*)$/.test(phaseFilter)) {
      return Response.json({ error: "Invalid phaseFilter" }, { status: 400 });
    }
    const phaseIndex =
      phaseFilter === "both" ? null : Number(phaseFilter.slice(5));
    if (
      phaseIndex !== null &&
      (!Number.isSafeInteger(phaseIndex) || leagueIds.length !== 1)
    ) {
      return Response.json(
        { error: "A phase filter requires one league and a valid phase index" },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const Game = GameModel;
    const Team = TeamModel;
    const User = UserModel;
    const League = LeagueModel;

    // Fetch rulesets for all requested leagues
    const leaguesDocs = await League.find({
      _id: { $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("_id rulesConfig phaseCutoffTimes leagueTypeConfig")
      .populate("leagueTypeConfig")
      .lean<League[]>();
    const leagueRulesMap = new Map<string, Ruleset>();
    for (const l of leaguesDocs) {
      leagueRulesMap.set(l._id.toString(), l.rulesConfig?.gameRules as Ruleset);
    }

    let selectedPhase: OrderedPhase | undefined;
    let qualifiedTeamIds: Set<string> | null = null;
    let qualifiedPlayerIds: Set<string> | null = null;
    if (phaseIndex !== null) {
      const league = leaguesDocs.find((l) => l._id.toString() === leagueIds[0]);
      if (!league) {
        return Response.json({ error: "League not found" }, { status: 404 });
      }
      const leagueType = league.leagueTypeConfig;
      selectedPhase = resolveOrderedPhases(leagueType)[phaseIndex];
      if (!leagueType || !selectedPhase) {
        return Response.json(
          { error: "The selected phase is not configured for this league" },
          { status: 400 }
        );
      }
      if (phaseIndex > 0) {
        const teams = await Team.find({ leagueId: league._id })
          .select("_id roster finalsRoster")
          .lean<Team[]>();
        const qualifiedIds = await loadQualifiedPhaseIds(
          league,
          leagueType,
          selectedPhase,
          teams
        );
        if (leagueType.isTeamMode) {
          qualifiedTeamIds = qualifiedIds;
          qualifiedPlayerIds = new Set(
            teams
              .filter((team) => qualifiedIds.has(team._id.toString()))
              .flatMap((team) => getTeamMemberIds(team, selectedPhase))
          );
        } else {
          qualifiedPlayerIds = qualifiedIds;
        }
      }
    }

    // Resolve which player IDs to fetch data for
    let resolvedPlayerIds: string[] = [];
    // Map: teamId -> list of member IDs (for team aggregation)
    const teamMemberMap = new Map<string, string[]>();
    let resolvedTeamsData: Team[] = [];

    // When nothing is selected, default to all teams in the selected leagues
    let effectiveTeamIds = teamIds;
    let useTeamMode = teamIds.length > 0;

    if (
      teamIds.length === 0 &&
      playerIds.length === 0 &&
      entityType !== "player"
    ) {
      // Default: load all teams for these leagues
      const allTeams = await Team.find({
        leagueId: {
          $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id")
        .lean<Team[]>();
      // Individual (non-team) leagues have no teams — leave team mode off so we
      // fall through to the player-participant default below.
      if (allTeams.length > 0) {
        effectiveTeamIds = allTeams.map((t) => t._id.toString());
        useTeamMode = true;
      }
    }

    if (qualifiedTeamIds) {
      effectiveTeamIds = effectiveTeamIds.filter((id) =>
        qualifiedTeamIds.has(id)
      );
    }

    if (useTeamMode) {
      // Fetch teams and get their member lists
      resolvedTeamsData = await Team.find({
        _id: {
          $in: effectiveTeamIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id displayName leagueId roster finalsRoster")
        .lean<Team[]>();

      for (const team of resolvedTeamsData) {
        const memberIds = getTeamMemberIds(team, selectedPhase);
        teamMemberMap.set(team._id.toString(), memberIds);
        resolvedPlayerIds.push(...memberIds);
      }
      // Deduplicate
      resolvedPlayerIds = [...new Set(resolvedPlayerIds)];
    } else if (playerIds.length > 0) {
      resolvedPlayerIds = playerIds;
    } else if (qualifiedPlayerIds) {
      resolvedPlayerIds = [...qualifiedPlayerIds];
    } else {
      // Individual-league default: no teams and no explicit selection. Include
      // everyone who has actually played games so their series are not dropped.
      const gamePlayerRows = await Game.aggregate([
        {
          $match: {
            league: {
              $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
            },
          },
        },
        { $unwind: "$results" },
        { $group: { _id: null, userIds: { $addToSet: "$results.userId" } } },
      ]);
      const playerIdSet = new Set<string>();
      for (const uid of gamePlayerRows[0]?.userIds ?? []) {
        playerIdSet.add(uid.toString());
      }
      resolvedPlayerIds = [...playerIdSet];
      if (resolvedPlayerIds.length === 0) {
        return Response.json({ series: [] });
      }
    }

    if (qualifiedPlayerIds) {
      resolvedPlayerIds = resolvedPlayerIds.filter((id) =>
        qualifiedPlayerIds.has(id)
      );
      if (resolvedPlayerIds.length === 0) {
        return Response.json({ series: [] });
      }
    }

    const teamEliminationDates = new Map<string, string>();
    if (useTeamMode && phaseFilter === "both" && resolvedTeamsData.length > 0) {
      const allLeagueTeams = await Team.find({
        leagueId: {
          $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id leagueId roster finalsRoster")
        .lean<Team[]>();

      for (const league of leaguesDocs) {
        const leagueType = league.leagueTypeConfig;
        if (!leagueType?.isTeamMode) {
          continue;
        }
        const leagueId = league._id.toString();
        const leagueTeams = allLeagueTeams.filter(
          (team) => team.leagueId.toString() === leagueId
        );
        const leagueEliminationDates = await loadTeamEliminationDates(
          league,
          leagueType,
          leagueTeams
        );
        for (const [teamId, eliminatedAt] of leagueEliminationDates) {
          teamEliminationDates.set(teamId, eliminatedAt);
        }
      }
    }

    // Build game match filter
    const matchFilter: any = {
      league: { $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)) },
      "results.userId": {
        $in: resolvedPlayerIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    };
    if (startDate) {
      matchFilter.startTime = {
        ...(matchFilter.startTime ?? {}),
        $gte: new Date(startDate),
      };
    }
    if (endDate) {
      matchFilter.startTime = {
        ...(matchFilter.startTime ?? {}),
        $lte: new Date(endDate),
      };
    }

    // Fetch full games with all results
    const games = await Game.find(matchFilter)
      .select("results startTime league")
      .sort({ startTime: 1 })
      .lean<Game[]>();

    // Organise: userId -> sorted array of { day, score }
    const playerDailyMap = new Map<string, { day: string; score: number }[]>();
    const resolvedSet = new Set(resolvedPlayerIds);

    for (const game of games) {
      const day = (game.startTime as Date).toISOString().slice(0, 10);
      const results: { userId: string; score: number; place: number }[] = (
        game.results ?? []
      ).map((r) => ({
        userId: r.userId.toString(),
        score: r.score,
        place: r.place,
      }));

      // Determine the ruleset for this game's league
      const gameLeagueId = game.league?.toString();
      const rules = leagueRulesMap.get(gameLeagueId ?? "") ?? Ruleset.MLEAGUE;

      const points = computePlayerDeltas(
        results.map((r) => ({ score: r.score })),
        rules
      );

      for (let i = 0; i < results.length; i++) {
        const pid = results[i].userId;
        if (!resolvedSet.has(pid)) {
          continue;
        }

        if (!playerDailyMap.has(pid)) {
          playerDailyMap.set(pid, []);
        }
        const entries = playerDailyMap.get(pid)!;
        const existing = entries.find((e) => e.day === day);
        if (existing) {
          existing.score += points[i];
        } else {
          entries.push({ day, score: points[i] });
        }
      }
    }

    // Ensure each player's days are sorted
    for (const entries of playerDailyMap.values()) {
      entries.sort((a, b) => a.day.localeCompare(b.day));
    }

    // Collect all unique days across all players/teams
    const allDays = new Set<string>();
    for (const entries of playerDailyMap.values()) {
      for (const e of entries) {
        allDays.add(e.day);
      }
    }
    if (allDays.size > 0 && teamEliminationDates.size > 0) {
      const actualDays = [...allDays].sort();
      const latestActualDay = actualDays[actualDays.length - 1];
      const startDay = startDate?.slice(0, 10) ?? null;
      const endDay = endDate?.slice(0, 10) ?? null;
      for (const eliminatedAt of teamEliminationDates.values()) {
        if (
          eliminatedAt <= latestActualDay &&
          (!startDay || eliminatedAt >= startDay) &&
          (!endDay || eliminatedAt <= endDay)
        ) {
          allDays.add(eliminatedAt);
        }
      }
    }
    const sortedDays = [...allDays].sort();

    // Build cumulative series
    if (useTeamMode) {
      // One series per team: sum of all members' cumulative scores
      const series = resolvedTeamsData.map((team) => {
        const memberIds = getTeamMemberIds(team, selectedPhase);

        // For each day, compute cumulative score of all members combined
        const memberCumulatives = new Map<string, number>();
        const dataPoints: { x: string; y: number }[] = [];

        for (const day of sortedDays) {
          let teamDayTotal = 0;
          for (const memberId of memberIds) {
            const dayEntry = playerDailyMap
              .get(memberId)
              ?.find((e) => e.day === day);
            if (dayEntry) {
              memberCumulatives.set(
                memberId,
                (memberCumulatives.get(memberId) ?? 0) + dayEntry.score
              );
            }
            teamDayTotal += memberCumulatives.get(memberId) ?? 0;
          }
          dataPoints.push({ x: day, y: Math.round(teamDayTotal * 10) / 10 });
        }

        const eliminatedAt = teamEliminationDates.get(team._id.toString());
        return {
          id: team._id.toString(),
          label: team.displayName,
          data: dataPoints,
          ...(eliminatedAt ? { eliminatedAt } : {}),
        };
      });

      return Response.json({ series });
    } else {
      // One series per player
      // Fetch user names
      const usersData = await User.find({
        _id: {
          $in: resolvedPlayerIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id name discordIdentity majsoulIdentity")
        .lean<User[]>();

      const userNameMap = new Map<string, string>();
      for (const u of usersData) {
        userNameMap.set(
          u._id.toString(),
          u.discordIdentity?.displayName ?? u.name ?? "Unknown"
        );
      }

      const series = resolvedPlayerIds.map((pid) => {
        const entries = playerDailyMap.get(pid) ?? [];
        const dayScoreMap = new Map<string, number>();
        for (const e of entries) {
          dayScoreMap.set(e.day, e.score);
        }

        let cumulative = 0;
        const data: { x: string; y: number }[] = [];
        for (const day of sortedDays) {
          const dayScore = dayScoreMap.get(day);
          if (dayScore !== undefined) {
            cumulative += dayScore;
          }
          data.push({ x: day, y: Math.round(cumulative * 10) / 10 });
        }

        return {
          id: pid,
          label: userNameMap.get(pid) ?? pid,
          data,
        };
      });

      return Response.json({ series });
    }
  } catch (error) {
    console.error("Error in score-evolution API:", error);
    return Response.json(
      { error: "Failed to compute score evolution" },
      { status: 500 }
    );
  }
}

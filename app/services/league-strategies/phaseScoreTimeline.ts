import type { Ruleset } from "~/core/models/tournament/League";
import {
  resolveGamePhaseId,
  resolveOrderedPhases,
  type LeagueTypeConfig,
} from "~/services/league-configs";
import { rationalToNumber } from "~/services/league-configs/types";
import { computePlayerDeltas } from "~/services/leagueUtils";
import { computeMultiPhaseStandings } from "./multiPhaseStrategies";
import {
  buildUserToTeamMap,
  computeNonTeamRankingData,
  computeTeamBasedRankingData,
  type RegularGameInput,
  type TeamLike,
} from "./regularRankingStrategies";

export interface PhaseScoreGame extends RegularGameInput {
  startTime: Date;
  phaseId?: string | null;
}

export interface PhaseScoreTeam extends TeamLike {
  finalsRoster?: TeamLike["roster"] | null;
}

/** Daily changes, including carry-over adjustments, rather than raw game sums. */
export type DailyScoreChanges = Map<string, Map<string, number>>;

export interface PhaseScoreTimeline {
  players: DailyScoreChanges;
  teams: DailyScoreChanges;
  eliminatedTeams: Map<string, string>;
  hasTransitions: boolean;
}

const roundScore = (value: number): number => Math.round(value * 10) / 10;

export function getPhaseTeamMemberIds(
  team: PhaseScoreTeam,
  phase?: "regular" | "final"
): string[] {
  const roster =
    phase === "final" ? (team.finalsRoster ?? team.roster) : team.roster;
  return [
    ...new Set(
      [
        ...roster.members,
        ...(roster.substitutes ?? []),
        ...(!phase ? (team.finalsRoster?.members ?? []) : []),
        ...(!phase ? (team.finalsRoster?.substitutes ?? []) : []),
      ].map(String)
    ),
  ];
}

export function computePhaseScoreTimeline({
  leagueType,
  games,
  teams,
  rules,
  cutoffs,
  finalParticipantIds = null,
  startDate = null,
  endDate = null,
  now = new Date(),
  excludedPlayerIds = new Set<string>(),
}: {
  leagueType: LeagueTypeConfig | null;
  games: PhaseScoreGame[];
  teams: PhaseScoreTeam[];
  rules: Ruleset;
  cutoffs: Date[];
  finalParticipantIds?: Set<string> | null;
  startDate?: string | null;
  endDate?: string | null;
  now?: Date;
  excludedPlayerIds?: ReadonlySet<string>;
}): PhaseScoreTimeline {
  const phases = resolveOrderedPhases(leagueType);
  const isTeamMode = leagueType?.isTeamMode ?? teams.length > 0;
  const phaseIndexes = new Map(phases.map((phase) => [phase.id, phase.index]));
  const taggedGames = games.map((game) => ({
    game,
    phase:
      phaseIndexes.get(
        resolveGamePhaseId(game, leagueType, { phaseCutoffTimes: cutoffs }) ??
          ""
      ) ?? 0,
  }));
  const playerIds = new Set(
    games
      .flatMap((game) => game.results.map((result) => result.userId))
      .filter((id) => !excludedPlayerIds.has(id))
  );
  teams = teams.map((team) => ({
    ...team,
    roster: {
      members: team.roster.members.filter(
        (id) => !excludedPlayerIds.has(String(id))
      ),
      substitutes: (team.roster.substitutes ?? []).filter(
        (id) => !excludedPlayerIds.has(String(id))
      ),
    },
    finalsRoster: team.finalsRoster
      ? {
          members: team.finalsRoster.members.filter(
            (id) => !excludedPlayerIds.has(String(id))
          ),
          substitutes: (team.finalsRoster.substitutes ?? []).filter(
            (id) => !excludedPlayerIds.has(String(id))
          ),
        }
      : null,
  }));
  const participants = isTeamMode
    ? teams
    : [...playerIds].map((id) => ({
        _id: id,
        roster: { members: [id], substitutes: [] },
      }));
  const participantIds = new Set(
    participants.map((participant) => participant._id.toString())
  );
  const qualified: Set<string>[] = [participantIds];
  const retention = [1];
  const teamMaps = [buildUserToTeamMap(teams)];
  const transitions: { time: number; phase: number }[] = [];
  const eliminatedTeams = new Map<string, string>();
  const start = startDate ? new Date(startDate).getTime() : -Infinity;
  const end = Math.min(
    endDate ? new Date(endDate).getTime() : Infinity,
    now.getTime()
  );

  for (const phase of phases.slice(1)) {
    const index = phase.index;
    const previous = qualified[index - 1];
    const progression = leagueType?.regularPhases?.[index - 1]?.progression;
    if (phase.kind === "regular" && progression && leagueType) {
      qualified.push(
        new Set(
          computeMultiPhaseStandings(
            leagueType,
            games,
            rules,
            participants,
            cutoffs,
            index
          ).standings.map((standing) => standing.teamId)
        )
      );
      retention.push(rationalToNumber(progression.scoreRetention));
    } else if (phase.kind === "final") {
      qualified.push(finalParticipantIds ?? previous);
      retention.push(rationalToNumber(leagueType!.finalPhase!.scoreCarryOver));
    } else {
      qualified.push(previous);
      retention.push(1);
    }
    teamMaps.push(
      buildUserToTeamMap(
        teams.map((team) => ({
          ...team,
          roster:
            phase.kind === "final"
              ? (team.finalsRoster ?? team.roster)
              : team.roster,
        }))
      )
    );
    const taggedStart = taggedGames
      .filter(
        ({ game, phase: gamePhase }) => game.phaseId && gamePhase >= index
      )
      .reduce(
        (earliest, { game }) => Math.min(earliest, game.startTime.getTime()),
        Infinity
      );
    const time = Math.min(
      cutoffs[index - 1]?.getTime() ?? Infinity,
      taggedStart
    );
    if (!Number.isFinite(time) || time > end) {
      continue;
    }
    transitions.push({ time, phase: index });
    if (isTeamMode) {
      for (const id of previous) {
        if (!qualified[index].has(id) && !eliminatedTeams.has(id)) {
          eliminatedTeams.set(id, new Date(time).toISOString().slice(0, 10));
        }
      }
    }
  }

  const playerBuckets = new Map<string, number[]>();
  const teamBuckets = new Map<string, number[]>();
  const playerTotals = new Map<string, number>();
  const teamTotals = new Map<string, number>();
  const players: DailyScoreChanges = new Map();
  const teamChanges: DailyScoreChanges = new Map();
  let activePhase = 0;
  const regularGames: RegularGameInput[] = [];
  let rankedRegularPlayers: Map<string, number> | null = null;
  let rankedRegularTeams: Map<string, number> | null = null;

  const refreshFinalsCarryOver = (): void => {
    if (
      !leagueType?.regularPhase ||
      !leagueType.finalPhase ||
      activePhase === 0
    ) {
      return;
    }
    if (isTeamMode) {
      const scoring = leagueType.regularPhase.scoring;
      const { sortedTeams } = computeTeamBasedRankingData(
        regularGames,
        rules,
        teamMaps[0],
        scoring.type === "team-delta-cap"
          ? {
              enableCap: true,
              capPercent: scoring.capPercent,
              minGamesForCap: scoring.minGamesForCap,
            }
          : { enableCap: false }
      );
      rankedRegularTeams = new Map(
        sortedTeams.map((team) => [team.teamId, team.totalScore])
      );
    } else {
      const { sortedPlayers } = computeNonTeamRankingData(
        regularGames,
        rules,
        leagueType.regularPhase.scoring,
        teamMaps[0]
      );
      rankedRegularPlayers = new Map(
        sortedPlayers.map((player) => [player.userId, player.rankingScore])
      );
    }
  };

  const isQualified = (id: string, phase: number, team: boolean): boolean => {
    const participant = isTeamMode && !team ? teamMaps[phase]?.get(id) : id;
    return (
      participant !== undefined && (qualified[phase]?.has(participant) ?? true)
    );
  };
  const updateScore = (id: string, day: string, team: boolean): void => {
    const buckets = (team ? teamBuckets : playerBuckets).get(id)!;
    const totals = team ? teamTotals : playerTotals;
    const changes = team ? teamChanges : players;
    const ranked = team ? rankedRegularTeams : rankedRegularPlayers;
    let score =
      activePhase > 0 && isQualified(id, 1, team) && ranked
        ? (ranked.get(id) ?? 0)
        : (buckets[0] ?? 0);
    for (let phase = 1; phase <= activePhase; phase++) {
      if (!isQualified(id, phase, team)) {
        break;
      }
      score = roundScore(score * retention[phase]) + (buckets[phase] ?? 0);
    }
    if (team && !isTeamMode) {
      const faction = teams.find(
        (candidate) => candidate._id.toString() === id
      );
      score = faction
        ? getPhaseTeamMemberIds(faction).reduce(
            (sum, playerId) => sum + (playerTotals.get(playerId) ?? 0),
            0
          )
        : score;
    }
    score = roundScore(score);
    const delta = score - (totals.get(id) ?? 0);
    totals.set(id, score);
    if (day < (startDate?.slice(0, 10) ?? "")) {
      return;
    }
    let daily = changes.get(id);
    if (!daily) {
      daily = new Map();
      changes.set(id, daily);
    }
    daily.set(day, roundScore((daily.get(day) ?? 0) + delta));
  };
  const advance = (phase: number, day: string): void => {
    if (phase <= activePhase) {
      return;
    }
    activePhase = phase;
    refreshFinalsCarryOver();
    for (const id of playerBuckets.keys()) {
      updateScore(id, day, false);
    }
    for (const id of teamBuckets.keys()) {
      updateScore(id, day, true);
    }
  };

  const events = [
    ...transitions.map((transition) => ({ ...transition, game: null })),
    ...taggedGames
      .filter(
        ({ game }) =>
          game.startTime.getTime() >= start && game.startTime.getTime() <= end
      )
      .map(({ game, phase }) => ({
        game,
        phase,
        time: game.startTime.getTime(),
      })),
  ].sort(
    (a, b) =>
      a.time - b.time || Number(a.game !== null) - Number(b.game !== null)
  );
  for (const event of events) {
    const day = new Date(event.time).toISOString().slice(0, 10);
    advance(event.phase, day);
    if (!event.game) {
      continue;
    }
    // Keep the full table when computing placement bonuses, even for eliminated opponents.
    const deltas = computePlayerDeltas(event.game.results, rules);
    const changedTeams = new Set<string>();
    if (event.phase === 0) {
      regularGames.push(event.game);
      refreshFinalsCarryOver();
    }
    event.game.results.forEach((result, index) => {
      if (excludedPlayerIds.has(result.userId)) {
        return;
      }
      if (event.phase > 0 && !isQualified(result.userId, event.phase, false)) {
        return;
      }
      const buckets = playerBuckets.get(result.userId) ?? [];
      buckets[event.phase] = (buckets[event.phase] ?? 0) + deltas[index];
      playerBuckets.set(result.userId, buckets);
      updateScore(result.userId, day, false);
      const teamId = teamMaps[event.phase]?.get(result.userId);
      if (teamId) {
        const teamScores = teamBuckets.get(teamId) ?? [];
        teamScores[event.phase] =
          (teamScores[event.phase] ?? 0) + deltas[index];
        teamBuckets.set(teamId, teamScores);
        changedTeams.add(teamId);
      }
    });
    for (const id of changedTeams) {
      updateScore(id, day, true);
    }
  }
  return {
    players,
    teams: teamChanges,
    eliminatedTeams,
    hasTransitions: activePhase > 0,
  };
}

export function totalTimelineScore(
  changes: Map<string, number> | undefined
): number {
  return roundScore(
    [...(changes?.values() ?? [])].reduce((sum, value) => sum + value, 0)
  );
}

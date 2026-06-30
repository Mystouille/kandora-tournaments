import { Ruleset } from "~/db/League";
import { computePlayerDeltas } from "~/services/leagueUtils";
import type { RegularScoringConfig } from "~/services/league-configs/types";

/** Minimal team shape needed by ranking helpers. */
export interface TeamLike {
  _id: { toString(): string };
  roster: {
    members: { toString(): string }[];
    substitutes?: { toString(): string }[] | null;
  };
}

export interface RegularGameInput {
  startTime?: Date | string | number;
  results: { userId: string; score: number }[];
}

export interface TeamRankingScore {
  teamId: string;
  totalScore: number;
  gamesPlayed: number;
}

export interface PlayerRankingScore {
  userId: string;
  rankingScore: number;
  gamesCounted: number;
  totalGamesPlayed?: number;
  factionTeamId?: string;
  /** Cumulative score of the last (windowSize-1) games (best-consecutive-window only). */
  trailingNMinus1Score?: number;
  /** Cumulative score of the last (windowSize-2) games (best-consecutive-window only). */
  trailingNMinus2Score?: number;
}

export function buildUserToTeamMap(teams: TeamLike[]): Map<string, string> {
  const userToTeamMap = new Map<string, string>();
  for (const team of teams) {
    for (const memberId of team.roster.members) {
      userToTeamMap.set(memberId.toString(), team._id.toString());
    }
    for (const subId of team.roster.substitutes ?? []) {
      userToTeamMap.set(subId.toString(), team._id.toString());
    }
  }
  return userToTeamMap;
}

export function computeTeamBasedRankingData(
  games: RegularGameInput[],
  rules: Ruleset,
  userToTeamMap: Map<string, string>,
  options?: {
    enableCap?: boolean;
    capPercent?: number;
    minGamesForCap?: number;
  }
): {
  sortedTeams: TeamRankingScore[];
  userPendingScores: Map<string, { teamId: string; scores: number[] }>;
} {
  const teamPlayerScores = new Map<
    string,
    Map<string, { userId: string; scores: number[] }>
  >();

  for (const game of games) {
    const deltas = computePlayerDeltas(game.results, rules);

    for (let i = 0; i < game.results.length; i++) {
      const userId = game.results[i].userId;
      const teamId = userToTeamMap.get(userId);
      if (!teamId) {
        continue;
      }

      if (!teamPlayerScores.has(teamId)) {
        teamPlayerScores.set(teamId, new Map());
      }
      const teamPlayers = teamPlayerScores.get(teamId)!;
      const existing = teamPlayers.get(userId) || {
        userId,
        scores: [] as number[],
      };
      existing.scores.push(deltas[i]);
      teamPlayers.set(userId, existing);
    }
  }

  const teamScores = new Map<string, TeamRankingScore>();
  const userPendingScores = new Map<
    string,
    { teamId: string; scores: number[] }
  >();

  for (const [teamId, players] of teamPlayerScores) {
    let totalTeamGames = 0;
    for (const player of players.values()) {
      totalTeamGames += player.scores.length;
    }

    let teamTotalScore = 0;
    let teamGamesCountedTotal = 0;
    const capEnabled = options?.enableCap !== false;
    const capPct = options?.capPercent ?? 0.35;
    const minForCap = options?.minGamesForCap ?? 6;

    for (const player of players.values()) {
      const playerGameCount = player.scores.length;

      if (capEnabled && playerGameCount > minForCap) {
        const maxGames = Math.floor(totalTeamGames * capPct);
        const gamesToCount = Math.min(playerGameCount, maxGames);
        const sortedScores = [...player.scores].sort((a, b) => a - b);
        const countedScores = sortedScores.slice(0, gamesToCount);
        const notCountedScores = sortedScores.slice(gamesToCount);
        if (notCountedScores.length > 0) {
          userPendingScores.set(player.userId, {
            teamId,
            scores: notCountedScores,
          });
        }
        teamTotalScore += countedScores.reduce((sum, s) => sum + s, 0);
        teamGamesCountedTotal += countedScores.length;
      } else {
        teamTotalScore += player.scores.reduce((sum, s) => sum + s, 0);
        teamGamesCountedTotal += player.scores.length;
      }
    }

    teamScores.set(teamId, {
      teamId,
      totalScore: Math.round(teamTotalScore * 10) / 10,
      gamesPlayed: teamGamesCountedTotal,
    });
  }

  const sortedTeams = Array.from(teamScores.values()).sort(
    (a, b) => b.totalScore - a.totalScore
  );

  return { sortedTeams, userPendingScores };
}

function bestWindowScore(values: number[], windowSize: number) {
  if (values.length === 0) {
    return { score: 0, gamesCounted: 0 };
  }
  if (values.length <= windowSize) {
    return {
      score: Math.round(values.reduce((sum, v) => sum + v, 0) * 10) / 10,
      gamesCounted: values.length,
    };
  }

  let windowSum = 0;
  for (let i = 0; i < windowSize; i++) {
    windowSum += values[i];
  }
  let best = windowSum;
  for (let i = windowSize; i < values.length; i++) {
    windowSum += values[i] - values[i - windowSize];
    if (windowSum > best) {
      best = windowSum;
    }
  }
  return { score: Math.round(best * 10) / 10, gamesCounted: windowSize };
}

interface AggregatedPlayerScore {
  userId: string;
  totalScore: number;
  gamesPlayed: number;
  deltas: number[];
}

type NonTeamRankingComputation = (
  players: AggregatedPlayerScore[],
  userToTeamMap: Map<string, string>,
  scoring: RegularScoringConfig
) => {
  scoredPlayers: PlayerRankingScore[];
  qualifiedByFaction: Set<string>;
};

const bestConsecutiveWindowWithFactionCut: NonTeamRankingComputation = (
  players,
  userToTeamMap,
  scoring
) => {
  const windowSize =
    scoring.type === "best-consecutive-window" ? scoring.windowSize : 5;
  const qualCount =
    scoring.type === "best-consecutive-window"
      ? (scoring.qualificationCount ?? 2)
      : 2;

  const scoredPlayers: PlayerRankingScore[] = players.map((player) => {
    const best = bestWindowScore(player.deltas, windowSize);
    const d = player.deltas;
    const trailingNMinus1Score =
      d.length >= windowSize - 1
        ? Math.round(
            d.slice(-(windowSize - 1)).reduce((s, v) => s + v, 0) * 10
          ) / 10
        : undefined;
    const trailingNMinus2Score =
      d.length >= windowSize - 2 && windowSize - 2 > 0
        ? Math.round(
            d.slice(-(windowSize - 2)).reduce((s, v) => s + v, 0) * 10
          ) / 10
        : undefined;
    return {
      userId: player.userId,
      rankingScore: best.score,
      gamesCounted: best.gamesCounted,
      totalGamesPlayed: player.gamesPlayed,
      factionTeamId: userToTeamMap.get(player.userId),
      trailingNMinus1Score,
      trailingNMinus2Score,
    };
  });

  const qualifiedByFaction = new Set<string>();

  if (
    scoring.type === "best-consecutive-window" &&
    scoring.qualificationMode === "faction-top-n"
  ) {
    const byFaction = new Map<string, PlayerRankingScore[]>();
    for (const player of scoredPlayers) {
      if (!player.factionTeamId) {
        continue;
      }
      const factionPlayers = byFaction.get(player.factionTeamId) ?? [];
      factionPlayers.push(player);
      byFaction.set(player.factionTeamId, factionPlayers);
    }

    for (const factionPlayers of byFaction.values()) {
      factionPlayers.sort((a, b) => b.rankingScore - a.rankingScore);
      for (const qualified of factionPlayers.slice(0, qualCount)) {
        qualifiedByFaction.add(qualified.userId);
      }
    }
  }

  return { scoredPlayers, qualifiedByFaction };
};

const cumulativeNonTeam: NonTeamRankingComputation = (
  players,
  userToTeamMap,
  _scoring
) => {
  return {
    scoredPlayers: players.map((player) => ({
      userId: player.userId,
      rankingScore: Math.round(player.totalScore * 10) / 10,
      gamesCounted: player.gamesPlayed,
      totalGamesPlayed: player.gamesPlayed,
      factionTeamId: userToTeamMap.get(player.userId),
    })),
    qualifiedByFaction: new Set<string>(),
  };
};

function resolveNonTeamStrategy(
  scoring?: RegularScoringConfig
): NonTeamRankingComputation {
  if (scoring?.type === "best-consecutive-window") {
    return bestConsecutiveWindowWithFactionCut;
  }
  return cumulativeNonTeam;
}

export function computeNonTeamRankingData(
  games: RegularGameInput[],
  rules: Ruleset,
  scoring: RegularScoringConfig | undefined,
  userToTeamMap: Map<string, string>
): {
  sortedPlayers: PlayerRankingScore[];
  qualifiedByFaction: Set<string>;
} {
  const playerScores = new Map<
    string,
    {
      userId: string;
      totalScore: number;
      gamesPlayed: number;
      deltas: number[];
    }
  >();

  const chronologicalGames = [...games].sort(
    (a, b) =>
      new Date(a.startTime ?? 0).getTime() -
      new Date(b.startTime ?? 0).getTime()
  );

  for (const game of chronologicalGames) {
    const deltas = computePlayerDeltas(game.results, rules);
    for (let i = 0; i < game.results.length; i++) {
      const userId = game.results[i].userId;
      const existing = playerScores.get(userId) ?? {
        userId,
        totalScore: 0,
        gamesPlayed: 0,
        deltas: [] as number[],
      };
      existing.totalScore += deltas[i];
      existing.gamesPlayed += 1;
      existing.deltas.push(deltas[i]);
      playerScores.set(userId, existing);
    }
  }

  const strategy = resolveNonTeamStrategy(scoring);
  const { scoredPlayers, qualifiedByFaction } = strategy(
    Array.from(playerScores.values()),
    userToTeamMap,
    scoring ?? { type: "cumulative" }
  );

  const sortedPlayers = scoredPlayers.sort(
    (a, b) => b.rankingScore - a.rankingScore
  );
  return { sortedPlayers, qualifiedByFaction };
}

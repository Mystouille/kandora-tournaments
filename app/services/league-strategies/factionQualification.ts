import type { Team } from "~/core/models/tournament/Team";
import type { PlayerRankingScore } from "./regularRankingStrategies";

export function buildFactionGroupedSeedOrder(
  sortedPlayers: PlayerRankingScore[],
  qualifiedByFaction: Set<string>
): PlayerRankingScore[] {
  const grouped = new Map<string, PlayerRankingScore[]>();
  const noFactionQualified: PlayerRankingScore[] = [];
  for (const player of sortedPlayers) {
    if (!qualifiedByFaction.has(player.userId)) {
      continue;
    }
    if (!player.factionTeamId) {
      noFactionQualified.push(player);
      continue;
    }
    const players = grouped.get(player.factionTeamId) ?? [];
    players.push(player);
    grouped.set(player.factionTeamId, players);
  }
  for (const players of grouped.values()) {
    players.sort((a, b) => {
      if (b.rankingScore !== a.rankingScore) {
        return b.rankingScore - a.rankingScore;
      }
      return a.userId.localeCompare(b.userId);
    });
  }
  const sortedFactions = Array.from(grouped.entries()).sort((a, b) => {
    const bestA = a[1][0]?.rankingScore ?? -Infinity;
    const bestB = b[1][0]?.rankingScore ?? -Infinity;
    if (bestB !== bestA) {
      return bestB - bestA;
    }
    return a[0].localeCompare(b[0]);
  });
  const ordered: PlayerRankingScore[] = [];
  for (const [, players] of sortedFactions) {
    ordered.push(...players);
  }
  ordered.push(...noFactionQualified);
  if (ordered.length < qualifiedByFaction.size) {
    const seen = new Set(ordered.map((player) => player.userId));
    for (const player of sortedPlayers) {
      if (qualifiedByFaction.has(player.userId) && !seen.has(player.userId)) {
        ordered.push(player);
        seen.add(player.userId);
      }
    }
  }
  return ordered;
}

export function includeMissingFactionMembers(
  players: PlayerRankingScore[],
  teams: Pick<Team, "_id" | "roster">[]
): PlayerRankingScore[] {
  const augmented = [...players];
  const seen = new Set(players.map((player) => player.userId));
  for (const team of teams) {
    const factionTeamId = team._id.toString();
    const rosterIds = [
      ...(team.roster.members ?? []),
      ...(team.roster.substitutes ?? []),
    ];
    for (const memberId of rosterIds) {
      const userId = memberId.toString();
      if (seen.has(userId)) {
        continue;
      }
      augmented.push({
        userId,
        rankingScore: 0,
        gamesCounted: 0,
        totalGamesPlayed: 0,
        factionTeamId,
      });
      seen.add(userId);
    }
  }
  return augmented;
}

export function computeFactionQualifiedUsers(
  players: PlayerRankingScore[],
  qualificationCount: number,
  minGames = 0
): Set<string> {
  const qualified = new Set<string>();
  const byFaction = new Map<string, PlayerRankingScore[]>();
  for (const player of players) {
    if (!player.factionTeamId) {
      continue;
    }
    if (minGames > 0 && (player.totalGamesPlayed ?? 0) < minGames) {
      continue;
    }
    const factionPlayers = byFaction.get(player.factionTeamId) ?? [];
    factionPlayers.push(player);
    byFaction.set(player.factionTeamId, factionPlayers);
  }
  for (const factionPlayers of byFaction.values()) {
    factionPlayers.sort((a, b) => {
      if (b.rankingScore !== a.rankingScore) {
        return b.rankingScore - a.rankingScore;
      }
      const gamesA = a.totalGamesPlayed ?? a.gamesCounted;
      const gamesB = b.totalGamesPlayed ?? b.gamesCounted;
      if (gamesB !== gamesA) {
        return gamesB - gamesA;
      }
      return a.userId.localeCompare(b.userId);
    });
    for (const player of factionPlayers.slice(0, qualificationCount)) {
      qualified.add(player.userId);
    }
  }
  return qualified;
}

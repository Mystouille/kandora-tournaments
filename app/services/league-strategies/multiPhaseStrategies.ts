import { Ruleset } from "~/db/League";
import {
  computeTeamBasedRankingData,
  buildUserToTeamMap,
  type RegularGameInput,
  type TeamLike,
} from "~/services/league-strategies/regularRankingStrategies";
import type { LeagueTypeConfig } from "~/services/league-configs/types";
import { rationalToNumber } from "~/services/league-configs/types";

export interface MultiPhaseTeamStanding {
  teamId: string;
  /** Cumulative score visible in the current phase (retention-adjusted + new games). */
  totalScore: number;
  /** Number of games played in the current phase. */
  gamesPlayed: number;
  /** Score carried over from the previous phase (after retention). */
  retainedScore: number;
}

export interface MultiPhaseResult {
  /** 0-based index of the phase these standings represent. */
  phaseIndex: number;
  /** Display label derived from the phase definition id. */
  phaseId: string;
  standings: MultiPhaseTeamStanding[];
}

/**
 * Computes standings for a multi-phase league by partitioning games into
 * date-delimited phases, applying score retention and team narrowing at each
 * phase boundary.
 *
 * @param leagueType   The league type definition (must have `regularPhases`).
 * @param allGames     Every valid game in the league, with a `startTime` field.
 * @param rules        The ruleset (for delta computation).
 * @param teams        Raw team documents (with `_id` and `members`/`substitutes`).
 * @param cutoffs      Sorted `phaseCutoffTimes` dates (length = phases - 1).
 * @param targetPhase  Which phase to compute up to (0-based). Defaults to the last phase.
 */
export function computeMultiPhaseStandings(
  leagueType: LeagueTypeConfig,
  allGames: (RegularGameInput & {
    startTime?: Date | string | number;
    phaseId?: string | null;
  })[],
  rules: Ruleset,
  teams: TeamLike[],
  cutoffs: Date[],
  targetPhase?: number
): MultiPhaseResult {
  const phases = leagueType.regularPhases ?? [];
  if (phases.length === 0) {
    return { phaseIndex: 0, phaseId: "unknown", standings: [] };
  }

  const userToTeamMap = buildUserToTeamMap(teams);
  const maxPhase = Math.min(
    targetPhase ?? phases.length - 1,
    phases.length - 1
  );

  // Map each regular-phase id to its index so games tagged at ingestion
  // (per-phase leagues — see `Game.phaseId`) are bucketed by their tag,
  // preferring it over the time-based cutoff fallback used for untagged games.
  const phaseIdToIndex = new Map<string, number>();
  phases.forEach((phase, index) => phaseIdToIndex.set(phase.id, index));

  // Partition games into per-phase buckets, preferring the phaseId tag and
  // falling back to cutoff dates for untagged games.
  const phaseBuckets: RegularGameInput[][] = phases.map(() => []);
  for (const game of allGames) {
    let bucket: number;
    if (game.phaseId != null && phaseIdToIndex.has(game.phaseId)) {
      bucket = phaseIdToIndex.get(game.phaseId)!;
    } else {
      const t = new Date(game.startTime ?? 0).getTime();
      bucket = 0;
      for (let c = 0; c < cutoffs.length; c++) {
        if (t >= cutoffs[c].getTime()) {
          bucket = c + 1;
        } else {
          break;
        }
      }
    }
    if (bucket < phaseBuckets.length) {
      phaseBuckets[bucket].push(game);
    }
  }

  // Walk through phases, accumulating retained scores and narrowing teams.
  let advancingTeamIds: Set<string> | null = null;
  let retainedScores = new Map<string, number>();

  for (let p = 0; p <= maxPhase; p++) {
    const phaseDef = phases[p];
    const phaseGames = phaseBuckets[p];

    // Filter games to only include advancing teams (if narrowed).
    const filteredGames: RegularGameInput[] =
      advancingTeamIds != null
        ? phaseGames.map((g) => ({
            ...g,
            results: g.results.filter((r) => {
              const teamId = userToTeamMap.get(r.userId);
              return teamId != null && advancingTeamIds!.has(teamId);
            }),
          }))
        : phaseGames;

    const { sortedTeams } = computeTeamBasedRankingData(
      filteredGames,
      rules,
      userToTeamMap,
      { enableCap: false }
    );

    // Build standings with retention offset.
    const standings: MultiPhaseTeamStanding[] = sortedTeams
      .filter((t) => advancingTeamIds == null || advancingTeamIds.has(t.teamId))
      .map((t) => {
        const retained = retainedScores.get(t.teamId) ?? 0;
        return {
          teamId: t.teamId,
          totalScore: Math.round((t.totalScore + retained) * 10) / 10,
          gamesPlayed: t.gamesPlayed,
          retainedScore: Math.round(retained * 10) / 10,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore);

    // If this is the target phase, return the result.
    if (p === maxPhase) {
      return { phaseIndex: p, phaseId: phaseDef.id, standings };
    }

    // Prepare for next phase: apply retention and narrow teams.
    const progression = phaseDef.progression;
    if (!progression) {
      return { phaseIndex: p, phaseId: phaseDef.id, standings };
    }

    const advancing = standings.slice(0, progression.advancingCount);
    advancingTeamIds = new Set(advancing.map((s) => s.teamId));
    retainedScores = new Map<string, number>();
    for (const s of advancing) {
      retainedScores.set(
        s.teamId,
        Math.round(
          s.totalScore * rationalToNumber(progression.scoreRetention) * 10
        ) / 10
      );
    }
  }

  // Fallback (shouldn't reach here).
  return { phaseIndex: 0, phaseId: phases[0].id, standings: [] };
}

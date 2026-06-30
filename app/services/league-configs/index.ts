import { type BracketStageDefinition } from "~/services/bracketUtils";
import { resolveBracketStagesForLeagueType } from "~/services/league-strategies/finalPhaseStrategies";
import type { LeagueTypeConfig } from "~/services/league-configs/types";
import { rationalToNumber } from "~/services/league-configs/types";

export type { LeagueTypeConfig };

/**
 * Returns the `LeagueTypeConfig` from the league document, or null.
 * This is the single resolution point for all league type configuration.
 */
export function resolveLeagueTypeConfig(
  config?: LeagueTypeConfig | null
): LeagueTypeConfig | null {
  return config ?? null;
}

export function resolveConfiguredBracketStages(
  config?: LeagueTypeConfig | null
): BracketStageDefinition[] | null {
  const leagueType = resolveLeagueTypeConfig(config);
  if (!leagueType) {
    return null;
  }
  return resolveBracketStagesForLeagueType(leagueType);
}

/**
 * Returns the earliest Date that finals-phase games must have started on or
 * after. Applies whenever `scoreCarryOver` is explicitly configured —
 * the intent being that regular and finals games are always kept separate
 * when a phase boundary is declared.
 *
 * Returns `null` when no cutoff applies (include all games).
 */
export function resolveFinalPhaseGameCutoff(
  leagueType: LeagueTypeConfig | null,
  league: { phaseCutoffTimes?: Date[] | null }
): Date | null {
  if (!leagueType?.finalPhase) {
    return null;
  }
  const first = league.phaseCutoffTimes?.[0];
  return first ? new Date(first) : null;
}

/**
 * Given pre-computed regular-phase scores (participantId → score), returns
 * an `initialScoreOffsets` map for the BracketContext applying the configured
 * carry-over fraction. Returns `undefined` when carry-over is 0 or unset.
 */
export function computeScoreCarryOverOffsets(
  leagueType: LeagueTypeConfig | null,
  regularPhaseScores: Map<string, number>
): Map<string, number> | undefined {
  const carryOver = leagueType?.finalPhase?.scoreCarryOver;
  if (!carryOver || carryOver.num <= 0) {
    return undefined;
  }
  const fraction = rationalToNumber(carryOver);
  const offsets = new Map<string, number>();
  for (const [participantId, score] of regularPhaseScores) {
    offsets.set(participantId, Math.round(score * fraction * 10) / 10);
  }
  return offsets;
}

/**
 * Returns true when the league type uses `regularPhases` (multi-phase, no bracket).
 */
export function isMultiPhaseLeague(
  leagueType: LeagueTypeConfig | null
): boolean {
  return (
    leagueType?.regularPhases != null && leagueType.regularPhases.length > 1
  );
}

/**
 * Returns true when the league type has a real regular phase configured —
 * either a single `regularPhase` object or a non-empty `regularPhases` array.
 * An empty `regularPhases: []` array counts as no regular phase, so callers
 * must not rely on plain truthiness (an empty array is truthy in JS).
 */
export function leagueTypeHasRegularPhase(
  leagueType: LeagueTypeConfig | null
): boolean {
  return (
    leagueType?.regularPhase != null ||
    (leagueType?.regularPhases?.length ?? 0) > 0
  );
}

/**
 * Returns the `phaseCutoffTimes` dates stored on the league document,
 * only for multi-phase league types. Returns an empty array otherwise.
 */
export function resolveMultiPhaseCutoffs(
  leagueType: LeagueTypeConfig | null,
  league: { phaseCutoffTimes?: Date[] | null }
): Date[] {
  if (!isMultiPhaseLeague(leagueType)) {
    return [];
  }
  return (league.phaseCutoffTimes ?? []).map((d) => new Date(d));
}

/**
 * Determines the current phase index (0-based) by comparing the current date
 * against the phase cutoff boundaries.
 *
 * Example with 3 phases and 2 cutoff dates [c1, c2]:
 *   now < c1           → phase 0
 *   c1 <= now < c2     → phase 1
 *   now >= c2          → phase 2
 */
export function resolveCurrentPhaseIndex(
  leagueType: LeagueTypeConfig | null,
  league: { phaseCutoffTimes?: Date[] | null },
  now: Date = new Date()
): number {
  const cutoffs = resolveMultiPhaseCutoffs(leagueType, league);
  let phase = 0;
  for (const cutoff of cutoffs) {
    if (now >= cutoff) {
      phase++;
    } else {
      break;
    }
  }
  const maxPhase = (leagueType?.regularPhases?.length ?? 1) - 1;
  return Math.min(phase, maxPhase);
}

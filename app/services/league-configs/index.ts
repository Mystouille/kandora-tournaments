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

/** A single phase in the league's ordered phase sequence. */
export type OrderedPhaseKind = "regular" | "final";

export interface OrderedPhase {
  /** Phase id from the config (`regularPhase.id`, `regularPhases[].id`, or
   *  `finalPhase.id`). Unique within a league type config. */
  id: string;
  kind: OrderedPhaseKind;
  /** 0-based position in the ordered phase sequence (regular phases first,
   *  finals last). */
  index: number;
}

/**
 * Returns the league type's phases in play order: the single `regularPhase`
 * (or every entry of `regularPhases`, whichever is configured) followed by the
 * `finalPhase` when present. Each entry carries the phase `id` used to bind a
 * tournament lobby (`League.platformConfig.phaseTournaments`) and to tag games
 * (`Game.phaseId`). Returns an empty array when no config or no phases exist.
 */
export function resolveOrderedPhases(
  leagueType: LeagueTypeConfig | null
): OrderedPhase[] {
  if (!leagueType) {
    return [];
  }
  const phases: OrderedPhase[] = [];
  if (leagueType.regularPhases && leagueType.regularPhases.length > 0) {
    for (const phase of leagueType.regularPhases) {
      phases.push({ id: phase.id, kind: "regular", index: phases.length });
    }
  } else if (leagueType.regularPhase) {
    phases.push({
      id: leagueType.regularPhase.id,
      kind: "regular",
      index: phases.length,
    });
  }
  if (leagueType.finalPhase) {
    phases.push({
      id: leagueType.finalPhase.id,
      kind: "final",
      index: phases.length,
    });
  }
  return phases;
}

/**
 * Resolves the phase id a game belongs to, preferring the game's stored
 * `phaseId` tag (set at ingestion from its tournament lobby in per-phase
 * leagues) and falling back to time-based attribution via `phaseCutoffTimes`
 * for untagged games (single-lobby leagues, or games ingested before per-phase
 * mode was enabled). Returns `null` when the phase cannot be determined.
 */
export function resolveGamePhaseId(
  game: { phaseId?: string | null; startTime?: Date | string | null },
  leagueType: LeagueTypeConfig | null,
  league: { phaseCutoffTimes?: Date[] | null }
): string | null {
  if (game.phaseId) {
    return game.phaseId;
  }
  const orderedPhases = resolveOrderedPhases(leagueType);
  if (orderedPhases.length === 0) {
    return null;
  }
  const time = game.startTime ? new Date(game.startTime).getTime() : NaN;
  if (Number.isNaN(time)) {
    return orderedPhases[0].id;
  }
  const cutoffs = (league.phaseCutoffTimes ?? []).map((d) => new Date(d));
  let bucket = 0;
  for (const cutoff of cutoffs) {
    if (time >= cutoff.getTime()) {
      bucket++;
    } else {
      break;
    }
  }
  const index = Math.min(bucket, orderedPhases.length - 1);
  return orderedPhases[index].id;
}

/**
 * In-memory predicate: does this game belong to the finals phase? Prefers the
 * game's `phaseId` tag (`=== finalPhase.id`) and falls back to the time-based
 * finals cutoff for untagged games. Returns false when no finals phase exists.
 */
export function isFinalsPhaseGame(
  game: { phaseId?: string | null; startTime?: Date | string | null },
  leagueType: LeagueTypeConfig | null,
  league: { phaseCutoffTimes?: Date[] | null }
): boolean {
  const finalPhaseId = leagueType?.finalPhase?.id;
  if (!finalPhaseId) {
    return false;
  }
  if (game.phaseId != null) {
    return game.phaseId === finalPhaseId;
  }
  const cutoff = resolveFinalPhaseGameCutoff(leagueType, league);
  if (!cutoff || !game.startTime) {
    return false;
  }
  return new Date(game.startTime) >= cutoff;
}

/**
 * Mongo query fragment matching finals-phase games, preferring the game's
 * `phaseId` tag over the time cutoff. Merge into a `GameModel` filter via
 * `Object.assign` / spread. Returns `null` when the league has no finals phase
 * (no split applies → callers should include all games).
 *
 * For legacy (untagged) leagues this reduces exactly to the previous
 * `startTime >= cutoff` behavior, since untagged games match `{ phaseId: null }`.
 */
export function buildFinalsGameMatch(
  leagueType: LeagueTypeConfig | null,
  league: { phaseCutoffTimes?: Date[] | null }
): Record<string, unknown> | null {
  const finalPhaseId = leagueType?.finalPhase?.id;
  if (!finalPhaseId) {
    return null;
  }
  const cutoff = resolveFinalPhaseGameCutoff(leagueType, league);
  const untaggedMatch: Record<string, unknown> = cutoff
    ? { phaseId: null, startTime: { $gte: cutoff } }
    : { phaseId: null };
  return { $or: [{ phaseId: finalPhaseId }, untaggedMatch] };
}

/**
 * Mongo query fragment matching regular-phase (pre-finals) games, preferring
 * the `phaseId` tag over the time cutoff. Complement of
 * {@link buildFinalsGameMatch}. Returns `null` when the league has no finals
 * phase (no split → every game is "regular").
 *
 * For legacy (untagged) leagues this reduces exactly to `startTime < cutoff`.
 */
export function buildRegularGameMatch(
  leagueType: LeagueTypeConfig | null,
  league: { phaseCutoffTimes?: Date[] | null }
): Record<string, unknown> | null {
  const finalPhaseId = leagueType?.finalPhase?.id;
  if (!finalPhaseId) {
    return null;
  }
  const cutoff = resolveFinalPhaseGameCutoff(leagueType, league);
  const untaggedMatch: Record<string, unknown> = cutoff
    ? { phaseId: null, startTime: { $lt: cutoff } }
    : { phaseId: null };
  return {
    $or: [{ phaseId: { $nin: [null, finalPhaseId] } }, untaggedMatch],
  };
}

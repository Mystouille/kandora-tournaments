import {
  type BracketStageDefinition,
  type StageSource,
} from "~/services/bracketUtils";
import type {
  LeagueTypeConfig,
  FinalPhaseDefinition,
  Rational,
} from "~/services/league-configs/types";
import { rationalToNumber } from "~/services/league-configs/types";
import type { Ruleset } from "~/db/League";
import { computePlayerDeltas } from "~/services/leagueUtils";

// ---------------------------------------------------------------------------
// Bracket stage resolution — generic, reads topology from config JSON
// ---------------------------------------------------------------------------

/**
 * Expand `fromStages` edges from the config into individual `StageSource`
 * entries.
 *
 * - When `places` is set, each entry produces one `StageSource` per listed
 *   place (e.g. `places: [2]` advances only the 2nd-place finisher).
 * - Otherwise each edge `{ stageId, topN }` produces `topN` entries with
 *   `place: 1, 2, … topN`.
 */
function expandFromStages(
  edges: { stageId: string; topN: number; places?: number[] }[]
): StageSource[] {
  const sources: StageSource[] = [];
  for (const edge of edges) {
    if (edge.places && edge.places.length > 0) {
      for (const p of edge.places) {
        sources.push({ stage: edge.stageId.toUpperCase(), place: p });
      }
      continue;
    }
    for (let p = 1; p <= edge.topN; p++) {
      sources.push({ stage: edge.stageId.toUpperCase(), place: p });
    }
  }
  return sources;
}

function rationalToFloat(r: Rational | undefined): number | undefined {
  if (!r) {
    return undefined;
  }
  return rationalToNumber(r);
}

export function resolveBracketStagesForConfig(
  finalPhase: FinalPhaseDefinition
): BracketStageDefinition[] {
  return finalPhase.stages.map((stage, index) => ({
    name: stage.id.toUpperCase(),
    order: index,
    seeds: stage.seeds,
    fromStages: expandFromStages(stage.fromStages),
    advancementLabelKey: stage.id.toUpperCase(),
    gamesToComplete: stage.gameCount,
    scoreCarryOver: rationalToFloat(stage.scoreCarryOver),
    slice: stage.slice,
  }));
}

export function resolveBracketStagesForLeagueType(
  leagueType: LeagueTypeConfig
): BracketStageDefinition[] | null {
  if (!leagueType.finalPhase) {
    return null;
  }
  return resolveBracketStagesForConfig(leagueType.finalPhase);
}

// ---------------------------------------------------------------------------
// Delta computer — currently just computePlayerDeltas for all scoring types
// ---------------------------------------------------------------------------

type FinalDeltaComputer = (
  players: { userId: string; score: number }[]
) => number[];

export function resolveFinalDeltaComputer(
  _leagueType: LeagueTypeConfig,
  rules: Ruleset
): FinalDeltaComputer {
  return (players) => computePlayerDeltas(players, rules);
}

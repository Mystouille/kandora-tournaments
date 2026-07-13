import { Ruleset } from "../db/League";

/**
 * Whether a game's results represent a fully scored (hydrated) game rather than
 * a placeholder created from listing metadata before the log was fetched.
 *
 * Some platforms (notably Riichi City) first create a Game document from the
 * tournament listing with every score and place zeroed, then fill in the real
 * values on a later hydration pass. A finishing place is always 1-based, so a
 * placeholder — where every `place` is 0 — must not be treated as a played
 * result (doing so would compute bogus deltas and prematurely complete a round).
 */
export function isGameScored(
  results: ReadonlyArray<{ place: number }> | undefined | null
): boolean {
  if (!results || results.length === 0) {
    return false;
  }
  return results.every((r) => r.place > 0);
}

/**
 * Computes placements for players based on their scores.
 * Players with the same score share the same (highest) placement.
 * @param players Array of objects containing at least a score property
 * @returns Array of placements in the same order as the input array
 */
export function computePlacements<T extends { score: number }>(
  players: T[]
): number[] {
  // Create indexed array to track original positions
  const indexed = players.map((p, i) => ({ index: i, score: p.score }));

  // Sort by score descending
  const sorted = [...indexed].sort((a, b) => b.score - a.score);

  // Assign placements (tied scores get the same placement)
  const placements = new Array<number>(players.length);
  for (let i = 0; i < sorted.length; i++) {
    // If same score as previous player, use same placement
    if (i > 0 && sorted[i].score === sorted[i - 1].score) {
      placements[sorted[i].index] = placements[sorted[i - 1].index];
    } else {
      placements[sorted[i].index] = i + 1;
    }
  }

  return placements;
}

/**
 * Computes deltas for all players, averaging placement bonuses for tied scores.
 * @param players Array of objects containing score property
 * @param ruleSet The ruleset to use for computing deltas
 * @returns Array of deltas in the same order as the input array
 */
export function computePlayerDeltas<T extends { score: number }>(
  players: T[],
  ruleSet: Ruleset
): number[] {
  // Create indexed array to track original positions
  const indexed = players.map((p, i) => ({ index: i, score: p.score }));

  // Sort by score descending
  const sorted = [...indexed].sort((a, b) => b.score - a.score);

  // Get place modifiers based on ruleset
  const startingScore = getStartingScore(ruleSet);
  const placeModifiers =
    ruleSet === Ruleset.INDONESIAN
      ? getFloatingUmaModifiers(
          sorted.map((s) => s.score),
          startingScore
        )
      : getPlaceModifiers(ruleSet);

  // Group tied players and compute averaged deltas
  const deltas = new Array<number>(players.length);
  let i = 0;
  while (i < sorted.length) {
    // Find all players with the same score
    const tiedPlayers = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && sorted[j].score === sorted[i].score) {
      tiedPlayers.push(sorted[j]);
      j++;
    }

    // Calculate averaged place modifier for tied players
    let totalPlaceModifier = 0;
    for (let k = 0; k < tiedPlayers.length; k++) {
      const place = i + k; // 0-indexed place
      totalPlaceModifier += placeModifiers[place] ?? 0;
    }
    const averagedPlaceModifier = totalPlaceModifier / tiedPlayers.length;

    // Assign delta to each tied player
    for (const player of tiedPlayers) {
      const baseDelta = parseFloat(
        ((player.score - startingScore) / 1000).toFixed(1)
      );
      deltas[player.index] = parseFloat(
        (baseDelta + averagedPlaceModifier).toFixed(1)
      );
    }

    i = j;
  }

  return deltas;
}

function getPlaceModifiers(ruleSet: Ruleset): number[] {
  switch (ruleSet) {
    case Ruleset.EMA:
    case Ruleset.WRC:
    case Ruleset.INDONESIAN:
      return [15, 5, -5, -15];
    case Ruleset.MLEAGUE:
      return [45, 5, -15, -35];
    default:
      return [0, 0, 0, 0];
  }
}

/**
 * Returns floating UMA modifiers for the INDONESIAN ruleset.
 * The UMA distribution shifts based on how many players finished
 * at-or-above starting points (30000):
 *   2 above: [+15, +5, -5, -15] (standard)
 *   1 above: [+20, +0, -5, -15]
 *   3 above: [+15, +5, +0, -20]
 *   0 or 4 above: fallback to standard [+15, +5, -5, -15]
 * Scores are expected to be sorted descending.
 */
function getFloatingUmaModifiers(
  sortedScores: number[],
  startingScore: number
): number[] {
  const aboveCount = sortedScores.filter((s) => s >= startingScore).length;
  switch (aboveCount) {
    case 1:
      return [20, 0, -5, -15];
    case 3:
      return [15, 5, 0, -20];
    default:
      return [15, 5, -5, -15];
  }
}

export function getStartingScore(ruleSet: Ruleset): number {
  switch (ruleSet) {
    case Ruleset.EMA:
    case Ruleset.WRC:
    case Ruleset.INDONESIAN:
      return 30000;
    case Ruleset.MLEAGUE:
      return 25000;
    default:
      return 25000;
  }
}

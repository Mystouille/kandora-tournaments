import syanten from "syanten";

/**
 * Riichi City tile encoding (empirically reverse-engineered against
 * the live RC viewer):
 *
 *   tile = block * 16 + slot
 *
 *   block 0       → pin suit  (slot 1..9 = 1p..9p)
 *   block 1       → sou suit  (slot 1..9 = 1s..9s)
 *   block 2       → man suit  (slot 1..9 = 1m..9m)   ← block 2 is
 *                                                     man, *not*
 *                                                     pin.
 *   blocks 3..9   → honors at slot 1 only
 *                   block 3 = 1z, block 4 = 2z, … block 9 = 7z.
 *   block 16/17/18, slot 5 (codes 261 / 277 / 293)
 *                 → aka 5p / aka 5s / aka 5m (same suit ordering as
 *                   the non-aka blocks).
 *
 * Codes are tile *types*, not unique physical-tile instances —
 * `paiShan` and the event stream both reuse the same code for every
 * copy of the same tile (the wall can show e.g. code `36` four
 * times because all four copies of 4p ended up there).
 *
 * `decodeTile` returns the *canonical* suit index (0=m, 1=p, 2=s,
 * 3=z) so downstream consumers (`tilesToSyantenFormat`, the protocol
 * `Tile` strings, etc.) don't need to know about RC's swapped block
 * ordering.
 */

const SUIT_LABEL = ["m", "p", "s", "z"] as const;

/** RC block index → canonical suit (0=m, 1=p, 2=s, 3=z). */
const RC_SUIT_BLOCK_TO_CANONICAL: Record<number, number> = {
  0: 1, // p
  1: 2, // s
  2: 0, // m
};

/** RC aka block index → canonical suit (block 16=p, 17=s, 18=m). */
const RC_AKA_BLOCK_TO_CANONICAL: Record<number, number> = {
  16: 1, // aka 5p
  17: 2, // aka 5s
  18: 0, // aka 5m
};

export function decodeTile(tile: number): {
  suit: number;
  value: number;
  isAka: boolean;
} {
  const block = Math.floor(tile / 16);
  const slot = tile % 16;
  if (block >= 16) {
    const akaSuit = RC_AKA_BLOCK_TO_CANONICAL[block];
    if (akaSuit !== undefined && slot === 5) {
      return { suit: akaSuit, value: 5, isAka: true };
    }
    // Fall through to a defensive default for unknown high-block codes.
    return { suit: 0, value: 0, isAka: false };
  }
  if (block <= 2) {
    const suit = RC_SUIT_BLOCK_TO_CANONICAL[block];
    return { suit, value: slot, isAka: false };
  }
  // Honors live one per block at slot 1: block 3=1z … block 9=7z.
  return { suit: 3, value: block - 2, isAka: false };
}

/** Convert a tile ID to human-readable notation (e.g. "5m", "0p", "1z"). */
export function tileToString(tile: number): string {
  const { suit, value, isAka } = decodeTile(tile);
  const displayValue = isAka ? 0 : value;
  return `${displayValue}${SUIT_LABEL[suit]}`;
}

/**
 * Convert an array of Riichi City tile IDs to the HaiArr format expected
 * by the `syanten` library.  Uses only the first 13 tiles.
 */
export function tilesToSyantenFormat(tiles: number[]): syanten.HaiArr {
  const hai: syanten.HaiArr = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ];

  const hand = tiles.slice(0, 13);
  for (const tile of hand) {
    const { suit, value, isAka } = decodeTile(tile);
    // Normalize aka to value 5
    const v = isAka ? 5 : value;
    const maxLen = suit === 3 ? 7 : 9;
    if (suit < 0 || suit > 3 || v < 1 || v > maxLen) {
      continue;
    }
    hai[suit][v - 1]++;
  }

  return hai;
}

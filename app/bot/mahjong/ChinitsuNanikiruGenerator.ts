import { fromTile9997ToStr } from "./handConverter";
import * as shantenCalc from "syanten";
import { makeNewTile997, type Suit997 } from "./handTypes";
import { SuitOption } from "./ChinitsuGenerator";

export { SuitOption };

export type ChinitsuNanikiruMode = "iishanten" | "tenpai";

const suitMap = ["m", "p", "s"];
const allSuits: SuitOption[] = [
  SuitOption.Manzu,
  SuitOption.Pinzu,
  SuitOption.Souzu,
];

export interface DiscardResult {
  /** Tile code to discard, e.g. "3m" */
  tile: string;
  /** Number of distinct tile types that bring hand to tenpai */
  types: number;
  /** Total count of individual tiles that bring hand to tenpai */
  total: number;
  /** The tile codes that bring the hand to tenpai, one per type */
  acceptingTiles: string[];
}

export interface ChinitsuNanikiruProblem {
  /** The 14-tile hand string */
  hand: string;
  /** The suit letter */
  suit: string;
  /** Best discard(s) — all discards tied for highest total acceptance */
  bestDiscards: DiscardResult[];
  /** All discard options sorted by total acceptance descending */
  allDiscards: DiscardResult[];
}

/**
 * Generate a random chinitsu iishanten hand (14 tiles, single suit)
 * and compute acceptance for every possible discard.
 */
export function getNewChinitsuNanikiruProblem(
  suitParam: SuitOption,
  mode: ChinitsuNanikiruMode = "iishanten"
): ChinitsuNanikiruProblem {
  let suit: SuitOption = suitParam;
  if (suitParam === SuitOption.Random) {
    suit = allSuits[Math.floor(Math.random() * 3)];
  }

  const { handStr, suitLetter, allDiscards } =
    mode === "tenpai"
      ? generateTenpaiChinitsu(suit)
      : generateIishantenChinitsu(suit);

  const bestTotal = allDiscards[0].total;
  const bestDiscards = allDiscards.filter((d) => d.total === bestTotal);

  // Pick a random tile as the "drawn tile" and move it to the end
  const tiles: string[] = [];
  for (let i = 0; i < handStr.length; i += 2) {
    tiles.push(handStr.substring(i, i + 2));
  }
  const drawnIndex = Math.floor(Math.random() * tiles.length);
  const drawnTile = tiles.splice(drawnIndex, 1)[0];
  tiles.push(drawnTile);

  return {
    hand: tiles.join(""),
    suit: suitLetter,
    bestDiscards,
    allDiscards,
  };
}

function generateIishantenChinitsu(suit: SuitOption): {
  handStr: string;
  suitLetter: string;
  allDiscards: DiscardResult[];
} {
  const suitLetter = suitMap[suit];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hand: Suit997 = Array(9).fill(0) as Suit997;
    const pool: number[] = [];
    for (let i = 0; i < 9; i++) {
      pool.push(i, i, i, i);
    }

    // Draw 14 tiles randomly
    for (let drawn = 0; drawn < 14; ) {
      const idx = Math.floor(Math.random() * pool.length);
      const tileValue = pool[idx];
      if (hand[tileValue] < 4) {
        hand[tileValue]++;
        pool.splice(idx, 1);
        drawn++;
      }
    }

    const fullHand = makeNewTile997();
    fullHand[suit.valueOf()] = hand;
    const shanten = shantenCalc.syantenAll(fullHand);

    if (shanten !== 1) {
      continue;
    } // Must be iishanten

    // Compute acceptance for every possible discard
    const discards: DiscardResult[] = [];
    for (let d = 0; d < 9; d++) {
      if (hand[d] === 0) {
        continue;
      }

      // Discard tile d
      hand[d]--;
      fullHand[suit.valueOf()] = hand;

      // Now we have 13 tiles — check which draws bring us to tenpai
      let types = 0;
      let total = 0;
      const accepting: string[] = [];
      for (let draw = 0; draw < 9; draw++) {
        if (hand[draw] >= 4) {
          continue;
        }
        hand[draw]++;
        fullHand[suit.valueOf()] = hand;
        const newShanten = shantenCalc.syantenAll(fullHand);
        if (newShanten === 0) {
          types++;
          total += 4 - (hand[draw] - 1); // tiles remaining in the wall (excluding those in hand before draw)
          accepting.push(`${draw + 1}${suitLetter}`);
        }
        hand[draw]--;
      }
      fullHand[suit.valueOf()] = hand;

      // Restore
      hand[d]++;
      fullHand[suit.valueOf()] = hand;

      if (total > 0) {
        discards.push({
          tile: `${d + 1}${suitLetter}`,
          types,
          total,
          acceptingTiles: accepting,
        });
      }
    }

    if (discards.length === 0) {
      continue;
    }

    // Deduplicate: merge discards with identical types & total
    // (different tiles that lead to same acceptance — keep all as separate entries)
    discards.sort((a, b) => b.total - a.total || b.types - a.types);

    const handStr = fromTile9997ToStr(fullHand);
    return { handStr, suitLetter, allDiscards: discards };
  }
}

function generateTenpaiChinitsu(suit: SuitOption): {
  handStr: string;
  suitLetter: string;
  allDiscards: DiscardResult[];
} {
  const suitLetter = suitMap[suit];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hand: Suit997 = Array(9).fill(0) as Suit997;
    const pool: number[] = [];
    for (let i = 0; i < 9; i++) {
      pool.push(i, i, i, i);
    }

    // Draw 14 tiles randomly
    for (let drawn = 0; drawn < 14; ) {
      const idx = Math.floor(Math.random() * pool.length);
      const tileValue = pool[idx];
      if (hand[tileValue] < 4) {
        hand[tileValue]++;
        pool.splice(idx, 1);
        drawn++;
      }
    }

    const fullHand = makeNewTile997();
    fullHand[suit.valueOf()] = hand;
    const shanten = shantenCalc.syantenAll(fullHand);

    if (shanten !== 0) {
      continue;
    } // Must be tenpai (14 tiles)

    // For each discard, check if 13-tile hand stays tenpai and count waits
    const discards: DiscardResult[] = [];
    for (let d = 0; d < 9; d++) {
      if (hand[d] === 0) {
        continue;
      }

      hand[d]--;
      fullHand[suit.valueOf()] = hand;

      const shantenAfterDiscard = shantenCalc.syantenAll(fullHand);
      if (shantenAfterDiscard !== 0) {
        // Discard breaks tenpai — skip
        hand[d]++;
        fullHand[suit.valueOf()] = hand;
        continue;
      }

      // Count waits (tiles that complete the hand)
      let types = 0;
      let total = 0;
      const accepting: string[] = [];
      for (let draw = 0; draw < 9; draw++) {
        if (hand[draw] >= 4) {
          continue;
        }
        hand[draw]++;
        fullHand[suit.valueOf()] = hand;
        const newShanten = shantenCalc.syantenAll(fullHand);
        if (newShanten === -1) {
          types++;
          total += 4 - (hand[draw] - 1);
          accepting.push(`${draw + 1}${suitLetter}`);
        }
        hand[draw]--;
      }
      fullHand[suit.valueOf()] = hand;

      hand[d]++;
      fullHand[suit.valueOf()] = hand;

      if (total > 0) {
        discards.push({
          tile: `${d + 1}${suitLetter}`,
          types,
          total,
          acceptingTiles: accepting,
        });
      }
    }

    // Require at least 3 discards that keep tenpai for interesting problems
    if (discards.length < 3) {
      continue;
    }

    discards.sort((a, b) => b.total - a.total || b.types - a.types);

    const handStr = fromTile9997ToStr(fullHand);
    return { handStr, suitLetter, allDiscards: discards };
  }
}

import {
  type Tile997 as Tile9997,
  makeNewTile997 as makeNewTile9997,
} from "~/bot/mahjong/handTypes";
import { type HandCounts, shanten, emptyCounts } from "~/game/rules/shanten";

export const SUIT_NAMES = ["p", "m", "s", "z"];
function fromStringToSuitIndex(suit: string): number {
  switch (suit) {
    case "m":
      return 0;
    case "p":
      return 1;
    case "s":
      return 2;
    case "z":
      return 3;
    default:
      return -1;
  }
}

/**
 * Returns a Tile9997 representation of the hand
 * @param hand - A strict natural representation of the hand (and no aka)
 */
export function fromStrToTile9997(hand: string): Tile9997 {
  const toReturn: Tile9997 = makeNewTile9997();

  const tileList = splitTiles(hand);
  tileList.forEach((tile) => {
    let tileIndex = parseInt(tile[0]);
    if (tileIndex == 0) {
      tileIndex = 5;
    }
    const suitIndex = fromStringToSuitIndex(tile[tile.length - 1]);
    toReturn[suitIndex][tileIndex - 1]++;
  });
  return toReturn;
}

export function addTileStrTo9997(
  tile: string,
  hand: Tile9997,
  delta: number = 1
) {
  const tileIndex = parseInt(tile[0]);
  const suitIndex = fromStringToSuitIndex(tile[tile.length - 1]);
  hand[suitIndex][tileIndex - 1] += delta;
}

function isDigit(str: string): boolean {
  return str >= "0" && str <= "9";
}

function isCalled(str: string): boolean {
  return str === "'";
}

export function splitTiles(hand: string) {
  const tiles: string[] = [];
  let i = 0;
  let k = 0;
  while (i < hand.length) {
    if (SUIT_NAMES.includes(hand[i])) {
      const tileSuit = hand[i];
      for (let j = k; j < i; j++) {
        const tileNumber = hand[j];
        if (!isDigit(tileNumber)) {
          continue;
        }
        let called = "";
        if (isCalled(hand[j + 1])) {
          if (isCalled(hand[j + 2])) {
            called += "''";
            j++;
          } else {
            called += "'";
          }
          j++;
        }
        const tileToAdd = `${tileNumber}${called}${tileSuit}`;
        tiles.push(tileToAdd);
      }
      k = i + 1;
    } else if (!isDigit(hand[i]) && !isCalled(hand[i])) {
      k = i + 1;
    }
    i++;
  }
  return tiles;
}

/* ------------------------------------------------------------------ */
/*  getWaits                                                           */
/* ------------------------------------------------------------------ */

const ALL_TILES: string[] = [
  ...["m", "p", "s"].flatMap((suit) =>
    ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => `${n}${suit}`)
  ),
  ...["1", "2", "3", "4", "5", "6", "7"].map((n) => `${n}z`),
];

const SUIT_INDEX: Record<string, number> = { m: 0, p: 1, s: 2, z: 3 };

function tileCountIn9997(
  tile: string,
  hand: ReturnType<typeof fromStrToTile9997>
): number {
  const num = parseInt(tile[0], 10);
  const suit = SUIT_INDEX[tile[tile.length - 1]];
  return hand[suit][num - 1];
}

/**
 * Picks a tile suitable for a "dummy isolated pair": an honor tile not
 * already in the hand, or — if all 7 honors are present — a number tile
 * at least 3 ranks away from any other tile of the same suit.
 *
 * Returns null only for pathological hands where no isolated tile exists.
 */
function findIsolatedDummyTile(handStr: string): string | null {
  const hand = fromStrToTile9997(handStr);
  // Prefer honor tiles entirely absent from the hand: each honor is
  // "infinitely far" from any number tile and from any other distinct honor
  // (no chii on honors), so a pair of an unused honor is fully isolated.
  for (let i = 1; i <= 7; i++) {
    const tile = `${i}z`;
    if (tileCountIn9997(tile, hand) === 0) {
      return tile;
    }
  }
  // Fall back: pick a number tile entirely absent from its suit AND at least
  // 3 ranks away from any other tile of the same suit (so it can't form a
  // pair/protorun with the rest).
  for (const suit of ["m", "p", "s"]) {
    const suitIdx = SUIT_INDEX[suit];
    for (let n = 1; n <= 9; n++) {
      if (hand[suitIdx][n - 1] !== 0) {
        continue;
      }
      let isolated = true;
      for (let other = 1; other <= 9; other++) {
        if (other === n) {
          continue;
        }
        if (hand[suitIdx][other - 1] > 0 && Math.abs(other - n) < 3) {
          isolated = false;
          break;
        }
      }
      if (isolated) {
        return `${n}${suit}`;
      }
    }
  }
  return null;
}

/**
 * Returns the agari (winning) waits for a closed hand shape.
 *
 * - If the hand has 3N+1 tiles (1, 4, 7, 10, 13), the waits are computed
 *   directly.
 * - If the hand has 3N-1 tiles (2, 5, 8, 11, 14), a dummy isolated pair is
 *   appended (one that can't form any partial set with the rest of the hand)
 *   and waits are computed on the resulting 3N+1 shape.
 *
 * Tiles already present 4 times are excluded from the result.
 *
 * @param handStr - Strict natural representation of the closed hand (no aka,
 *                  no melds, no called-tile markers).
 * @returns The list of winning tile strings (e.g. ["3m", "6m"]) sorted in
 *          standard order, or an empty array if the shape is not tenpai
 *          (after the dummy pair, when applicable) or has an unsupported
 *          tile count.
 */
export function getWaits(handStr: string): string[] {
  const tiles = splitTiles(handStr);
  const n = tiles.length;
  const mod3 = ((n % 3) + 3) % 3;

  let workingHand = handStr;
  let workingTileCount = n;
  let dummyTile: string | null = null;
  if (mod3 === 1) {
    // 3N+1: use as-is.
  } else if (mod3 === 2) {
    // 3N-1 (= 3N+2 with N shifted): append an isolated dummy pair.
    dummyTile = findIsolatedDummyTile(handStr);
    if (!dummyTile) {
      return [];
    }
    workingHand = handStr + dummyTile + dummyTile;
    workingTileCount = n + 2;
  } else {
    // 3N or empty hand — not a meaningful "waiting" shape.
    return [];
  }

  // Restrict to canonical closed-hand sizes after the optional
  // dummy pair. Valid shapes are 1 (4 called melds, pair-wait
  // tanki), 4, 7, 10, 13 — anything else is a malformed hand for
  // shanten purposes and the engine would return spurious values.
  if (
    workingTileCount !== 1 &&
    workingTileCount !== 4 &&
    workingTileCount !== 7 &&
    workingTileCount !== 10 &&
    workingTileCount !== 13
  ) {
    return [];
  }

  const hand9997 = fromStrToTile9997(workingHand);

  // Build a `HandCounts` mirror so we can drive the fast in-house
  // shanten calculator (lookup-table backed; see
  // `app/game/rules/shanten.ts`). Suit order in `Tile9997` is
  // [m, p, s, z], matching the `HandCounts` keys.
  const counts: HandCounts = emptyCounts();
  counts.m = [...hand9997[0]];
  counts.p = [...hand9997[1]];
  counts.s = [...hand9997[2]];
  counts.z = [...hand9997[3]];

  // Pad with virtual called-meld triplets so partial closed hands
  // (post-call shapes of 4/7/10 tiles, or 4-meld degenerate 1-tile
  // tanki) reach the 13-tile total that `shanten()` expects. The
  // shanten engine returns `8 - 2*melds - partials - pair` assuming
  // a 4-meld + pair target; without padding, a 7-tile tenpai shape
  // (1 meld + 1 partial + 1 pair) scores `8 - 2 - 1 - 1 = 4` and
  // is wrongly rejected as non-tenpai. Each virtual meld is a
  // triplet of a tile not present in the hand, chosen so it cannot
  // appear in the wait set (the loop below excludes those tiles
  // explicitly).
  const virtualSet = new Set<string>();
  let needVirtualMelds = (13 - workingTileCount) / 3;
  if (needVirtualMelds > 0) {
    const suitOrder: Array<"z" | "m" | "p" | "s"> = ["z", "m", "p", "s"];
    outer: for (const suit of suitOrder) {
      const limit = suit === "z" ? 7 : 9;
      for (let i = 0; i < limit; i++) {
        if (counts[suit][i] === 0) {
          counts[suit][i] = 3;
          virtualSet.add(`${i + 1}${suit}`);
          needVirtualMelds--;
          if (needVirtualMelds === 0) {
            break outer;
          }
        }
      }
    }
    if (needVirtualMelds > 0) {
      // Unreachable: 34 tile kinds, at most 4 virtual melds needed.
      return [];
    }
  }

  // shanten === 0 ⇔ tenpai (one tile away from a complete hand).
  // shanten === -1 ⇔ already a winning shape.
  if (shanten(counts) !== 0) {
    return [];
  }

  const waits: string[] = [];
  for (const tile of ALL_TILES) {
    if (tile === dummyTile || virtualSet.has(tile)) {
      // Dummy / virtual-meld tiles only exist for shanten padding;
      // never report them as waits.
      continue;
    }
    const suitChar = tile[tile.length - 1] as "m" | "p" | "s" | "z";
    const idx = parseInt(tile[0], 10) - 1;
    if (counts[suitChar][idx] >= 4) {
      continue;
    }
    counts[suitChar][idx]++;
    if (shanten(counts) === -1) {
      waits.push(tile);
    }
    counts[suitChar][idx]--;
  }
  return waits;
}

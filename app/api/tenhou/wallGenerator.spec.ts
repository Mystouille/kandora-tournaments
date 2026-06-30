/**
 * Tests for the Tenhou wall regeneration algorithm
 * (`generateTenhouWalls`).
 *
 * Validation strategy:
 *   - Stage-by-stage against the official validation vector
 *     published at https://tenhou.net/stat/rand/validation.txt
 *     (the `yama` line is the source of truth for kyoku 0 of a
 *     known replay).
 *   - End-to-end: the regenerated wall's dealt hands (read from
 *     `yama[135..84]` in reverse 4-4-4-1 order) must match the
 *     `hai0..hai3` fields of each `<INIT>` in that same replay.
 *   - The first 70 entries of `liveWall` (yama[83..14] reversed)
 *     are drawn in order — verifying liveWall[0] equals the first
 *     `<T../U../V../W../>` element's tile id seals correctness of
 *     the draw-order convention.
 */

import { describe, expect, it } from "vitest";

import { dealHandsFromYama, generateTenhouWalls } from "./wallGenerator";
import type { Tile } from "~/game/protocol/messages";

// Official validation vector kyoku-0 yama (136 tile ids) for
// http://tenhou.net/0/?log=2016022509gm-0009-0000-b327da61
// (source: https://tenhou.net/stat/rand/validation.txt).
const VALIDATION_SEED =
  "mt19937ar-sha512-n288-base64," +
  "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" +
  "1syVdQkEy2Rus1Csuf0uts";

// Expected yama for kyoku 0 of the validation game.
// prettier-ignore
const VALIDATION_YAMA_IDS = [
  22, 91, 36, 115, 56, 19, 60, 16, 124, 35, 59, 43, 107, 9, 5, 11, 57,
  73, 18, 41, 42, 20, 25, 30, 103, 100, 126, 130, 77, 109, 17, 15, 67,
  46, 72, 65, 131, 118, 102, 61, 113, 123, 89, 122, 92, 3, 129, 81, 97,
  28, 24, 76, 37, 69, 31, 26, 66, 78, 51, 54, 112, 64, 94, 38, 88, 128,
  13, 133, 87, 21, 27, 114, 105, 50, 10, 29, 1, 4, 48, 70, 32, 14, 86,
  33, 23, 84, 93, 12, 117, 47, 75, 96, 44, 111, 95, 62, 74, 39, 116, 63,
  53, 6, 2, 58, 79, 71, 108, 68, 121, 8, 49, 55, 34, 135, 82, 125, 90,
  98, 83, 45, 132, 106, 0, 101, 134, 40,
];

const SUITS = ["m", "p", "s"];
function tileFromId(id: number): Tile {
  if (id === 16) {
    return "0m" as Tile;
  }
  if (id === 52) {
    return "0p" as Tile;
  }
  if (id === 88) {
    return "0s" as Tile;
  }
  const type = Math.floor(id / 4);
  if (type < 27) {
    return `${(type % 9) + 1}${SUITS[Math.floor(type / 9)]}` as Tile;
  }
  return `${type - 26}z` as Tile;
}

describe("generateTenhouWalls", () => {
  it("reproduces the official validation yama for kyoku 0", () => {
    const walls = generateTenhouWalls(VALIDATION_SEED, 1);
    expect(walls).toHaveLength(1);
    const expectedTiles = VALIDATION_YAMA_IDS.slice(0, 122).map(tileFromId);
    // The validation file is truncated at 122 tiles, hence the slice.
    // We still check it tile-for-tile.
    for (let i = 0; i < expectedTiles.length; i++) {
      expect(walls[0].yama[i]).toBe(expectedTiles[i]);
    }
  });

  it("derives the correct dice values for the validation game", () => {
    const walls = generateTenhouWalls(VALIDATION_SEED, 1);
    // <INIT seed="0,0,0,5,1,..."/> => dice 5+1, 1+1 = 6, 2
    expect(walls[0].dice).toEqual([6, 2]);
  });

  it("deals hands matching INIT hai0..hai3 (oya=0) via reverse 4-4-4-1", () => {
    const walls = generateTenhouWalls(VALIDATION_SEED, 1);
    const dealt = dealHandsFromYama(walls[0].yama, 0);
    // <INIT seed="..." oya="0" hai0="127,119,104,120,45,83,98,90,58,2,6,53,12" .../>
    const expectedHai0 = [127, 119, 104, 120, 45, 83, 98, 90, 58, 2, 6, 53, 12]
      .map(tileFromId)
      .sort();
    expect([...dealt[0]].sort()).toEqual(expectedHai0);
  });

  it("places the first draw at liveWall[0] (= yama[83])", () => {
    const walls = generateTenhouWalls(VALIDATION_SEED, 1);
    // Validation game's first <T../> is T33 (seat 0 draws tile id 33).
    expect(walls[0].liveWall[0]).toBe(tileFromId(33));
    // Subsequent draws: U86, V14, W32
    expect(walls[0].liveWall[1]).toBe(tileFromId(86));
    expect(walls[0].liveWall[2]).toBe(tileFromId(14));
    expect(walls[0].liveWall[3]).toBe(tileFromId(32));
  });

  it("returns 70-tile liveWall and 14-tile deadWall", () => {
    const walls = generateTenhouWalls(VALIDATION_SEED, 1);
    expect(walls[0].liveWall).toHaveLength(70);
    expect(walls[0].deadWall).toHaveLength(14);
    expect(walls[0].yama).toHaveLength(136);
  });

  it("places the first dora indicator at yama[5] (validation game)", () => {
    const walls = generateTenhouWalls(VALIDATION_SEED, 1);
    // <INIT seed="0,0,0,5,1,19"/> => first dora indicator is tile id 19
    expect(walls[0].yama[5]).toBe(tileFromId(19));
  });

  it("is deterministic for the same seed + same kyoku count", () => {
    const a = generateTenhouWalls(VALIDATION_SEED, 3);
    const b = generateTenhouWalls(VALIDATION_SEED, 3);
    expect(a).toEqual(b);
  });

  it("strips the `mt19937ar-sha512-n288-base64,` prefix transparently", () => {
    const stripped = VALIDATION_SEED.replace(/^[^,]*,/, "");
    const a = generateTenhouWalls(VALIDATION_SEED, 1);
    const b = generateTenhouWalls(stripped, 1);
    expect(a[0].yama).toEqual(b[0].yama);
  });

  it("throws on a seed payload shorter than 624 uint32s", () => {
    // A 4-character base64 payload (3 bytes) is far too short.
    expect(() =>
      generateTenhouWalls("mt19937ar-sha512-n288-base64,QUJD", 1)
    ).toThrow(/too short/);
  });
});

describe("dealHandsFromYama", () => {
  it("rotates correctly when dealer !== 0", () => {
    // Synthetic yama: tile ids 0..135 in order.
    const yama: Tile[] = Array.from({ length: 136 }, (_, i) => tileFromId(i));
    // With dealer=2, the dealer takes the first 4 (yama[135..132] = 135,134,133,132)
    // then seat 3, then seat 0, then seat 1.
    const dealt = dealHandsFromYama(yama, 2);
    expect(dealt[2].slice(0, 4)).toEqual([135, 134, 133, 132].map(tileFromId));
    expect(dealt[3].slice(0, 4)).toEqual([131, 130, 129, 128].map(tileFromId));
    expect(dealt[0].slice(0, 4)).toEqual([127, 126, 125, 124].map(tileFromId));
    expect(dealt[1].slice(0, 4)).toEqual([123, 122, 121, 120].map(tileFromId));
  });

  it("returns 13 tiles per seat", () => {
    const yama: Tile[] = Array.from({ length: 136 }, (_, i) => tileFromId(i));
    const dealt = dealHandsFromYama(yama, 0);
    for (const hand of dealt) {
      expect(hand).toHaveLength(13);
    }
  });
});

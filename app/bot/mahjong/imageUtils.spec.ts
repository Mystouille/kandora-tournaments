import { describe, expect, test } from "vitest";
import { HandToDisplay, MeldSource, MeldType } from "./handTypes";
import { handToFileName } from "./imageUtils";

const simplestHand: HandToDisplay = {
  closedTiles: "123p456m789s12345z",
  melds: [],
  lastTileSeparated: false,
};
const handLastTile: HandToDisplay = {
  closedTiles: "123p456m789s12345z",
  melds: [],
  lastTileSeparated: true,
};
const handWithMeld: HandToDisplay = {
  closedTiles: "123p456m789s12z",
  melds: [{ tiles: "333z", type: MeldType.Pon, source: MeldSource.Toimen }],
  lastTileSeparated: false,
};
const handWithMeldLastTile: HandToDisplay = {
  closedTiles: "123p456m789s12z",
  melds: [{ tiles: "333z", type: MeldType.Pon, source: MeldSource.Toimen }],
  lastTileSeparated: true,
};
const handWithMelds: HandToDisplay = {
  closedTiles: "123p456m12z",
  melds: [
    { tiles: "789s", type: MeldType.Chii, source: MeldSource.Kamicha },
    { tiles: "333z", type: MeldType.Pon, source: MeldSource.Toimen },
  ],
  lastTileSeparated: false,
};

describe("imageUtils", () => {
  describe("handToFileName", () => {
    test.each`
      input                   | expected
      ${simplestHand}         | ${"123p456m789s12345z.png"}
      ${handLastTile}         | ${"123p456m789s12345z_x.png"}
      ${handWithMeld}         | ${"123p456m789s12z_2p333z.png"}
      ${handWithMeldLastTile} | ${"123p456m789s12z_2p333z_x.png"}
      ${handWithMelds}        | ${"123p456m12z_3c789s_2p333z.png"}
    `("return expected fileName", ({ input, expected }) => {
      expect(handToFileName(input)).toBe(expected);
    });
  });
});

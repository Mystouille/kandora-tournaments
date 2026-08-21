import { Locale } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  getShantenInfo,
  getSimpleUkeire,
  getWaitInfo,
  UkeireChoice,
} from "./shantenUtils";

describe("bot shanten utilities", () => {
  it("preserves simple and full wait data", () => {
    const hand = "123m123p123s11223z";

    expect(getSimpleUkeire(hand)).toEqual([
      { tile: "3z", nbTotalWaits: 4 },
    ]);
    expect(getWaitInfo(hand)).toEqual({
      shanten: 0,
      ukeire: [
        {
          tile: "3z",
          waits: [
            { tile: "1z", goodTenpai: false, nbTile: 2 },
            { tile: "2z", goodTenpai: false, nbTile: 2 },
          ],
          nbGoodTenpaiWaits: 0,
          nbTotalWaits: 4,
          waitsStr: "{\"1z\":2,\"2z\":2}0'4",
        },
      ],
    });
  });

  it("preserves good-tenpai classification", () => {
    const info = getWaitInfo("1m2m2m3m3m3m5m6m6m8m8m9m9m2m");

    expect(info.shanten).toBe(1);
    expect(
      info.ukeire.map((discard) => ({
        tile: discard.tile,
        total: discard.nbTotalWaits,
        good: discard.nbGoodTenpaiWaits,
        draws: discard.waits.map((wait) => [
          wait.tile,
          wait.nbTile,
          wait.goodTenpai,
        ]),
      }))
    ).toEqual([
      {
        tile: "1m",
        total: 14,
        good: 8,
        draws: [
          ["4m", 4, false],
          ["6m", 2, false],
          ["7m", 4, true],
          ["8m", 2, true],
          ["9m", 2, true],
        ],
      },
      {
        tile: "6m",
        total: 12,
        good: 4,
        draws: [
          ["4m", 4, false],
          ["7m", 4, false],
          ["8m", 2, true],
          ["9m", 2, true],
        ],
      },
      {
        tile: "5m",
        total: 10,
        good: 0,
        draws: [
          ["6m", 2, false],
          ["7m", 4, false],
          ["8m", 2, false],
          ["9m", 2, false],
        ],
      },
      {
        tile: "8m",
        total: 8,
        good: 4,
        draws: [
          ["4m", 4, false],
          ["7m", 4, true],
        ],
      },
    ]);
  });

  it("labels plain shanten states correctly", () => {
    expect(
      getShantenInfo(
        "123m456p789s111z2z",
        UkeireChoice.No,
        Locale.EnglishUS
      )
    ).toBe("Tenpai");
    expect(
      getShantenInfo(
        "123m456p789s111z22z",
        UkeireChoice.No,
        Locale.EnglishUS
      )
    ).toBe("Agari!");
    expect(
      getShantenInfo(
        "1234m456p789s11z2z",
        UkeireChoice.No,
        Locale.EnglishUS
      )
    ).toBe("1-shanten");
  });
});
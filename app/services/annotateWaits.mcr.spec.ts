import { describe, expect, it } from "vitest";
import type { GameEvent } from "~/game/protocol/messages";
import { annotateWaits } from "./annotateWaits";

describe("annotateWaits MCR support", () => {
  it("uses the MCR knitted-hand analyzer", () => {
    const knittedReady = [
      "1z",
      "2z",
      "3z",
      "4z",
      "5z",
      "6z",
      "7z",
      "1m",
      "4m",
      "7m",
      "2p",
      "5p",
      "8p",
    ];
    const orphans = [
      "1m",
      "9m",
      "1p",
      "9p",
      "1s",
      "9s",
      "1z",
      "2z",
      "3z",
      "4z",
      "5z",
      "6z",
      "7z",
    ];
    const events: GameEvent[] = [
      {
        type: "match_start",
        rulesFamily: "mcr",
        seats: [],
        ruleSet: "mcr-ema",
      },
      {
        type: "hand_start",
        rulesFamily: "mcr",
        round: 0,
        dealer: 1,
        startingHands: [
          knittedReady,
          [...orphans, "1m"],
          orphans,
          orphans,
        ],
        flowerTiles: [[], [], [], []],
        doraIndicators: [],
      },
    ];

    expect(annotateWaits(events).at(-1)?.[0]).toEqual(["3s", "6s", "9s"]);
  });
});

import { describe, expect, it } from "vitest";
import syanten from "syanten";
import type { GameEvent } from "~/game/protocol/messages";
import { handToSyantenFormat } from "~/api/majsoul/handToSyantenFormat";
import { buildGameRecordFromReplay } from "./replayToGameRecord";

const seatToUserId = ["uA", "uB", "uC", "uD"];
const seatToNickname = ["A", "B", "C", "D"];

function build(events: GameEvent[]) {
  return buildGameRecordFromReplay({
    gameId: "g1",
    startTime: new Date(0),
    events,
    seatToUserId,
    seatToNickname,
  });
}

/** roundEvents for a given seat across the produced record. */
function rounds(rec: ReturnType<typeof build>, seat: number) {
  return rec.byUserData[seat].roundEvents;
}

const handStart = (dealer: 0 | 1 | 2 | 3): GameEvent => ({
  type: "hand_start",
  round: 0,
  dealer,
  doraIndicators: ["1z"],
});

describe("buildGameRecordFromReplay", () => {
  it("never marks a winner on an exhaustive draw (regression for the tenpai-reveal bug)", () => {
    const rec = build([
      handStart(0),
      {
        type: "hand_end",
        reason: "exhaustive_draw",
        tenpai: [true, false, true, false],
        delta: [1500, -1500, 1500, -1500],
      },
    ]);

    for (let s = 0; s < 4; s++) {
      const r = rounds(rec, s)[0];
      expect(r.isWinner).toBe(false);
      expect(r.ryuukyoku).toBe(true);
      expect(r.pointsDiff).toBe([1500, -1500, 1500, -1500][s]);
      expect(r.ryuukyokuValue).toBe([1500, -1500, 1500, -1500][s]);
    }
    // finishedTenpai mirrors the hand_end tenpai array, NOT a phantom win.
    expect(rounds(rec, 0)[0].finishedTenpai).toBe(true);
    expect(rounds(rec, 1)[0].finishedTenpai).toBe(false);
    expect(rounds(rec, 2)[0].finishedTenpai).toBe(true);
    expect(rounds(rec, 3)[0].finishedTenpai).toBe(false);
  });

  it("projects a tsumo win with dora/aka/ura split per the unified definition", () => {
    const rec = build([
      handStart(0),
      {
        type: "win",
        seat: 2,
        loser: null,
        winTile: "5p",
        han: 5,
        fu: 40,
        doraCount: 2,
        akaDoraCount: 1,
        uraDoraCount: 3,
        yakuHan: [1, 2],
      },
      {
        type: "hand_end",
        reason: "tsumo",
        delta: [-2000, -2000, 6000, -2000],
      },
    ]);

    const w = rounds(rec, 2)[0];
    expect(w.isWinner).toBe(true);
    expect(w.isTsumo).toBe(true);
    expect(w.winningTile).toBe("5p");
    expect(w.hanValue).toBe(5);
    expect(w.fuValue).toBe(40);
    // totalDoraValue = dora + aka (red fives); ura is separate.
    expect(w.totalDoraValue).toBe(3);
    expect(w.uraDoraValue).toBe(3);
    expect(w.yakus).toEqual([1, 2]);
    expect(w.pointsDiff).toBe(6000);
    // No one is flagged as ronned on a tsumo.
    for (let s = 0; s < 4; s++) {
      expect(rounds(rec, s)[0].gotRonned).toBe(false);
    }
  });

  it("marks the discarder as ronned and the winner correctly on a ron", () => {
    const rec = build([
      handStart(0),
      {
        type: "win",
        seat: 1,
        loser: 3,
        winTile: "7s",
        han: 3,
        fu: 30,
        doraCount: 1,
      },
      {
        type: "hand_end",
        reason: "ron",
        delta: [0, 3900, 0, -3900],
      },
    ]);

    expect(rounds(rec, 1)[0].isWinner).toBe(true);
    expect(rounds(rec, 1)[0].isTsumo).toBe(false);
    expect(rounds(rec, 1)[0].totalDoraValue).toBe(1);
    expect(rounds(rec, 3)[0].gotRonned).toBe(true);
    expect(rounds(rec, 3)[0].pointsDiff).toBe(-3900);
    expect(rounds(rec, 1)[0].pointsDiff).toBe(3900);
  });

  it("counts open calls and kans, and captures the riichi declaration turn", () => {
    const meld = (type: "chi" | "pon" | "daiminkan" | "ankan") => ({
      type,
      tiles: ["1m", "2m", "3m"] as ("1m" | "2m" | "3m")[],
      claimedTile: null,
      from: null,
    });
    const rec = build([
      handStart(1),
      { type: "discard", seat: 0, tile: "1p", tsumogiri: false },
      { type: "call", seat: 0, meld: meld("chi") },
      { type: "call", seat: 0, meld: meld("pon") },
      { type: "call", seat: 0, meld: meld("daiminkan") },
      { type: "call", seat: 2, meld: meld("ankan") },
      { type: "discard", seat: 0, tile: "9p", tsumogiri: false, riichi: true },
      {
        type: "hand_end",
        reason: "exhaustive_draw",
        tenpai: [true, false, false, false],
        delta: [3000, -1000, -1000, -1000],
      },
    ]);

    const seat0 = rounds(rec, 0)[0];
    // chi + pon + daiminkan = 3 open calls; daiminkan also bumps kanNumber.
    expect(seat0.numberOfCalls).toBe(3);
    expect(seat0.kanNumber).toBe(1);
    expect(seat0.wasOpened).toBe(true);
    expect(seat0.hasRiichi).toBe(true);
    // Two discards by seat 0; riichi declared on the second.
    expect(seat0.firstTenpaiTurn).toBe(2);

    const seat2 = rounds(rec, 2)[0];
    // Ankan is concealed: a kan but not an open call.
    expect(seat2.numberOfCalls).toBe(0);
    expect(seat2.kanNumber).toBe(1);
    expect(seat2.wasOpened).toBe(false);

    // Dealer flag tracks hand_start.dealer.
    expect(rounds(rec, 1)[0].wasDealer).toBe(true);
    expect(rounds(rec, 0)[0].wasDealer).toBe(false);
  });

  it("emits one round per seat per hand across multiple hands", () => {
    const rec = build([
      handStart(0),
      { type: "hand_end", reason: "exhaustive_draw", delta: [0, 0, 0, 0] },
      handStart(1),
      {
        type: "win",
        seat: 0,
        loser: 2,
        han: 2,
        fu: 30,
        doraCount: 0,
      },
      { type: "hand_end", reason: "ron", delta: [2000, 0, -2000, 0] },
    ]);

    for (let s = 0; s < 4; s++) {
      expect(rounds(rec, s)).toHaveLength(2);
    }
    expect(rounds(rec, 0)[1].isWinner).toBe(true);
    expect(rounds(rec, 2)[1].gotRonned).toBe(true);
  });

  it("computes haipaiShanten from the dealer's 13-tile hand, excluding the first-draw 14th tile", () => {
    // A 13-tile hand that is tenpai (shanpon wait on 1p / 9s); adding the
    // dealer's first-draw tile (1p) would COMPLETE it, so the 13- and
    // 14-tile shanten differ and the test can prove which one is used.
    const haipai13 = [
      "1m",
      "2m",
      "3m",
      "4m",
      "5m",
      "6m",
      "7m",
      "8m",
      "9m",
      "1p",
      "1p",
      "9s",
      "9s",
    ];
    const firstDraw = "1p";
    const dealerHand14 = [...haipai13, firstDraw];
    const other13 = [
      "1m",
      "1m",
      "1m",
      "2m",
      "2m",
      "2m",
      "3m",
      "3m",
      "3m",
      "4m",
      "4m",
      "4m",
      "5m",
    ];

    const rec = build([
      {
        type: "hand_start",
        round: 0,
        dealer: 0,
        doraIndicators: ["1z"],
        startingHands: [dealerHand14, other13, other13, other13],
      },
      { type: "hand_end", reason: "exhaustive_draw", delta: [0, 0, 0, 0] },
    ]);

    const expected13 = syanten(handToSyantenFormat(haipai13));
    const expected14 = syanten(handToSyantenFormat(dealerHand14));
    // Sanity: including the first draw really would change the shanten.
    expect(expected13).not.toBe(expected14);
    // The projector must report the 13-tile haipai shanten (draw excluded).
    expect(rounds(rec, 0)[0].haipaiShanten).toBe(expected13);
  });
});

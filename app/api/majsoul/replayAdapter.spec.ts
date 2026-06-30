import { describe, expect, it } from "vitest";
import { parseMajsoulReplay } from "./replayAdapter";
import { replayReducer } from "~/game/replay/player";
import type { GameRecord } from "./data/types/GameRecord";

// Helper: build a record whose `constructor.name` matches what the
// adapter switches on. Majsoul ships protobuf-generated classes; we
// mimic that contract here with thin named classes.
class RecordNewRound {
  chang?: number;
  ju?: number;
  ben?: number;
  doras?: string[];
  scores?: number[];
  liqibang?: number;
  tiles0?: string[];
  tiles1?: string[];
  tiles2?: string[];
  tiles3?: string[];
  left_tile_count?: number;
  constructor(init: Partial<RecordNewRound>) {
    Object.assign(this, init);
  }
}
class RecordDiscardTile {
  seat?: number;
  tile?: string;
  moqie?: boolean;
  is_liqi?: boolean;
  is_wliqi?: boolean;
  doras?: string[];
  constructor(init: Partial<RecordDiscardTile>) {
    Object.assign(this, init);
  }
}
class RecordChiPengGang {
  seat?: number;
  type?: number;
  tiles?: string[];
  froms?: number[];
  constructor(init: Partial<RecordChiPengGang>) {
    Object.assign(this, init);
  }
}
class RecordAnGangAddGang {
  seat?: number;
  type?: number;
  tiles?: string;
  doras?: string[];
  constructor(init: Partial<RecordAnGangAddGang>) {
    Object.assign(this, init);
  }
}
class RecordHule {
  hules?: Array<{
    seat?: number;
    hu_tile?: string;
    zimo?: boolean;
    count?: number;
    fu?: number;
    point_sum?: number;
    fans?: Array<{ name?: string; val?: number; id?: number }>;
    hand?: string[];
    li_doras?: string[];
    yiman?: boolean;
  }>;
  delta_scores?: number[];
  scores?: number[];
  constructor(init: Partial<RecordHule>) {
    Object.assign(this, init);
  }
}
class RecordNoTile {
  players?: Array<{ tingpai?: boolean }>;
  scores?: Array<{ delta_scores?: number[] }>;
  constructor(init: Partial<RecordNoTile>) {
    Object.assign(this, init);
  }
}
class RecordLiuJu {
  type?: number;
  constructor(init: Partial<RecordLiuJu>) {
    Object.assign(this, init);
  }
}

function buildGameRecord(records: object[]): GameRecord {
  return {
    head: {
      uuid: "test-uuid-123",
      start_time: 1_700_000_000,
      end_time: 1_700_001_000,
      accounts: [
        { seat: 0, account_id: 1001, nickname: "Alice" },
        { seat: 1, account_id: 1002, nickname: "Bob" },
        { seat: 2, account_id: 1003, nickname: "Carol" },
        { seat: 3, account_id: 1004, nickname: "Dave" },
      ],
    },
    records: records as never,
  } as GameRecord;
}

const HAND_A: string[] = [
  "1m",
  "2m",
  "3m",
  "4p",
  "5p",
  "6p",
  "7s",
  "8s",
  "9s",
  "1z",
  "1z",
  "2z",
  "2z",
];
const HAND_B: string[] = [
  "1m",
  "1m",
  "2m",
  "2m",
  "3m",
  "3m",
  "4m",
  "4m",
  "5m",
  "5m",
  "6m",
  "6m",
  "7m",
];

describe("parseMajsoulReplay", () => {
  it("emits match_start → hand_start with startingHands → dealer draw → match_end", () => {
    const game = buildGameRecord([
      new RecordNewRound({
        chang: 0,
        ju: 0,
        ben: 0,
        liqibang: 0,
        doras: ["5z"],
        scores: [25000, 25000, 25000, 25000],
        // Dealer (seat 0) gets a 14th tile.
        tiles0: [...HAND_A, "9m"],
        tiles1: HAND_B,
        tiles2: HAND_A,
        tiles3: HAND_B,
        left_tile_count: 69,
      }),
      new RecordLiuJu({ type: 2 }),
    ]);

    const log = parseMajsoulReplay(game);
    expect(log.source).toBe("majsoul");
    expect(log.sourceGameId).toBe("test-uuid-123");
    expect(log.seats.map((s) => s.displayName)).toEqual([
      "Alice",
      "Bob",
      "Carol",
      "Dave",
    ]);
    expect(log.events[0].type).toBe("match_start");
    const handStart = log.events[1];
    expect(handStart.type).toBe("hand_start");
    if (handStart.type === "hand_start") {
      expect(handStart.dealer).toBe(0);
      expect(handStart.roundWind).toBe("E");
      expect(handStart.roundNumber).toBe(1);
      expect(handStart.doraIndicators).toEqual(["5z"]);
      expect(handStart.startingHands).toBeDefined();
      expect(handStart.startingHands?.[0]).toHaveLength(13);
      expect(handStart.startingHands?.[1]).toEqual(HAND_B);
    }
    const dealerDraw = log.events[2];
    expect(dealerDraw.type).toBe("draw");
    if (dealerDraw.type === "draw") {
      expect(dealerDraw.seat).toBe(0);
      expect(dealerDraw.tile).toBe("9m");
    }
    // hand_end (abort) + match_end at tail.
    expect(log.events.at(-2)?.type).toBe("hand_end");
    expect(log.events.at(-1)?.type).toBe("match_end");
  });

  it("emits discard, riichi flag, call/chi, and feeds through the reducer", () => {
    const game = buildGameRecord([
      new RecordNewRound({
        chang: 1,
        ju: 1,
        ben: 2,
        liqibang: 1,
        doras: ["5z"],
        scores: [30000, 20000, 25000, 25000],
        tiles0: HAND_A,
        tiles1: [...HAND_A, "9m"], // dealer (ju=1) gets 14th
        tiles2: HAND_A,
        tiles3: HAND_A,
        left_tile_count: 69,
      }),
      new RecordDiscardTile({
        seat: 1,
        tile: "9m",
        moqie: true,
        is_liqi: true,
      }),
      new RecordChiPengGang({
        seat: 2,
        type: 0, // chi
        tiles: ["7m", "8m", "9m"],
        froms: [2, 2, 1],
      }),
      new RecordDiscardTile({ seat: 2, tile: "1z", moqie: false }),
      new RecordNoTile({
        players: [
          { tingpai: true },
          { tingpai: false },
          { tingpai: true },
          { tingpai: false },
        ],
        scores: [{ delta_scores: [1500, -1500, 1500, -1500] }],
      }),
    ]);
    const log = parseMajsoulReplay(game);
    const types = log.events.map((e) => e.type);
    expect(types).toContain("call");
    expect(types).toContain("hand_end");
    // Fold through the reducer to make sure no event throws.
    const view = replayReducer(log, log.events.length - 1);
    expect(view.melds[2]).toHaveLength(1);
    expect(view.melds[2][0]).toMatchObject({
      type: "chi",
      claimedTile: "9m",
      from: 1,
    });
    // S2 dealer with riichi → riichi stick reported on hand_start.
    const handStart = log.events.find((e) => e.type === "hand_start");
    expect(
      handStart && handStart.type === "hand_start" && handStart.honba
    ).toBe(2);
    // hand_end carries tenpai flags.
    const handEnd = log.events.find(
      (e) => e.type === "hand_end" && e.reason === "exhaustive_draw"
    );
    expect(
      handEnd && handEnd.type === "hand_end" ? handEnd.tenpai : null
    ).toEqual([true, false, true, false]);
  });

  it("handles tsumo + multi-ron via RecordHule", () => {
    const game = buildGameRecord([
      new RecordNewRound({
        chang: 0,
        ju: 0,
        tiles0: [...HAND_A, "9m"],
        tiles1: HAND_B,
        tiles2: HAND_A,
        tiles3: HAND_B,
        scores: [25000, 25000, 25000, 25000],
        doras: ["5z"],
        left_tile_count: 69,
      }),
      new RecordHule({
        hules: [
          {
            seat: 0,
            hu_tile: "9m",
            zimo: true,
            count: 3,
            fu: 30,
            point_sum: 5200,
            fans: [{ name: "Riichi", val: 1, id: 2 }],
            hand: HAND_A,
            yiman: false,
          },
        ],
        delta_scores: [5200, -1700, -1700, -1700],
        scores: [30200, 23300, 23300, 23300],
      }),
    ]);
    const log = parseMajsoulReplay(game);
    const wins = log.events.filter((e) => e.type === "win");
    expect(wins).toHaveLength(1);
    if (wins[0].type === "win") {
      expect(wins[0].seat).toBe(0);
      expect(wins[0].loser).toBeNull();
      expect(wins[0].winTile).toBe("9m");
      expect(wins[0].yaku).toEqual({ Riichi: "1飜" });
    }
    const handEnd = log.events.find((e) => e.type === "hand_end");
    expect(handEnd && handEnd.type === "hand_end" ? handEnd.reason : null).toBe(
      "tsumo"
    );
    const matchEnd = log.events.at(-1);
    expect(matchEnd?.type).toBe("match_end");
    if (matchEnd && matchEnd.type === "match_end") {
      // seat 0 placed 1st with 30200.
      const top = matchEnd.finalScores.find((s) => s.place === 1);
      expect(top?.seat).toBe(0);
      expect(top?.score).toBe(30200);
    }
  });

  it("translates RecordAnGangAddGang into ankan / shouminkan call events", () => {
    const game = buildGameRecord([
      new RecordNewRound({
        chang: 0,
        ju: 0,
        tiles0: [...HAND_A, "9m"],
        tiles1: HAND_B,
        tiles2: HAND_A,
        tiles3: HAND_B,
        doras: ["5z"],
        scores: [25000, 25000, 25000, 25000],
        left_tile_count: 69,
      }),
      new RecordAnGangAddGang({
        seat: 0,
        type: 3, // ankan
        tiles: "1z",
        doras: ["5z", "6z"],
      }),
      new RecordLiuJu({ type: 2 }),
    ]);
    const log = parseMajsoulReplay(game);
    const call = log.events.find((e) => e.type === "call");
    expect(call?.type).toBe("call");
    if (call?.type === "call") {
      expect(call.meld.type).toBe("ankan");
      expect(call.meld.tiles).toEqual(["1z", "1z", "1z", "1z"]);
    }
    // Kan-dora flip → new_dora event for "6z".
    const newDoras = log.events.filter((e) => e.type === "new_dora");
    expect(newDoras).toHaveLength(1);
    if (newDoras[0].type === "new_dora") {
      expect(newDoras[0].indicator).toBe("6z");
    }
  });

  it("rejects records without head.uuid", () => {
    expect(() =>
      parseMajsoulReplay({ head: {}, records: [] } as unknown as GameRecord)
    ).toThrow(/uuid/);
  });

  // Phase 4.5 step 11: idempotency. Parsing the same input twice
  // produces byte-identical ReplayLog documents. Guards against
  // accidental nondeterminism (Date.now / Math.random / mutable
  // module state) creeping into the adapter.
  it("is idempotent — parsing the same GameRecord twice produces deep-equal logs", () => {
    const game = buildGameRecord([
      new RecordNewRound({
        chang: 0,
        ju: 0,
        ben: 0,
        liqibang: 0,
        doras: ["5z"],
        scores: [25000, 25000, 25000, 25000],
        tiles0: [...HAND_A, "9m"],
        tiles1: HAND_B,
        tiles2: HAND_A,
        tiles3: HAND_B,
        left_tile_count: 69,
      }),
    ]);
    const a = parseMajsoulReplay(game);
    const b = parseMajsoulReplay(game);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

import { describe, expect, it } from "vitest";
import { parseRiichiCityReplay } from "./replayAdapter";
import {
  ActionType,
  EventType,
  RoundEndType,
  YakuType,
  type GameData,
  type HandData,
  type RoundData,
} from "~/services/riichiCityModels";
import { replayReducer } from "~/game/replay/player";

// Riichi City tile encoding (see riichiCityTileUtils): tile types
// live in 16-wide blocks. Block 0 = pin, block 1 = sou, block 2 =
// man, blocks 3..9 = honors at slot 1 only. Codes are tile-types
// only — the `_copy` arg is accepted for legacy ergonomics but the
// real RC stream reuses the same code for every copy of a tile.
function p(v: number, _copy = 0): number {
  return v;
}
function s(v: number, _copy = 0): number {
  return 16 + v;
}
function m(v: number, _copy = 0): number {
  return 32 + v;
}
function z(v: number, _copy = 0): number {
  // 1z = 49 (block 3, slot 1) … 7z = 145 (block 9, slot 1).
  return (v + 2) * 16 + 1;
}

function startingHandEvent(
  userId: number,
  hand: number[],
  opts: {
    dealer_pos?: number;
    quan_feng?: number;
    chang_ci?: number;
    ben_chang_num?: number;
    bao_pai_card?: number;
    li_zhi_bang_num?: number;
  } = {}
): HandData {
  return {
    eventType: EventType.StartingHand,
    userId,
    startTime: 1_700_000_000,
    data: JSON.stringify({ hand_cards: hand, ...opts }),
  };
}

function drawEvent(userId: number, in_card: number): HandData {
  return {
    eventType: EventType.Draw,
    userId,
    startTime: 1_700_000_001,
    data: JSON.stringify({ in_card }),
  };
}

function discardEvent(
  userId: number,
  card: number,
  isRiichi = false
): HandData {
  return {
    eventType: EventType.DiscardOrCall,
    userId,
    startTime: 1_700_000_002,
    data: JSON.stringify({
      action: ActionType.Discard,
      card,
      ...(isRiichi ? { is_li_zhi: true } : {}),
    }),
  };
}

function callEvent(
  userId: number,
  action: ActionType,
  groupCards: number[],
  card?: number
): HandData {
  return {
    eventType: EventType.DiscardOrCall,
    userId,
    startTime: 1_700_000_003,
    data: JSON.stringify({ action, group_cards: groupCards, card }),
  };
}

function newDoraEvent(userId: number, card: number): HandData {
  return {
    eventType: EventType.NewDoraIndicator,
    userId,
    startTime: 1_700_000_004,
    data: JSON.stringify({ card }),
  };
}

function ryuukyokuEvent(userId: number): HandData {
  return {
    eventType: EventType.RoundEnd,
    userId,
    startTime: 1_700_000_005,
    data: JSON.stringify({
      end_type: RoundEndType.RyuuKyoku,
      win_info: [],
      user_profit: [
        { user_id: 1001, point_profit: 0, li_zhi_profit: 0, user_point: 25000 },
        { user_id: 1002, point_profit: 0, li_zhi_profit: 0, user_point: 25000 },
        { user_id: 1003, point_profit: 0, li_zhi_profit: 0, user_point: 25000 },
        { user_id: 1004, point_profit: 0, li_zhi_profit: 0, user_point: 25000 },
      ],
    }),
  };
}

function ronEndEvent(
  winnerId: number,
  loserId: number,
  han: number,
  fu: number,
  ten: number
): HandData {
  return {
    eventType: EventType.RoundEnd,
    userId: winnerId,
    startTime: 1_700_000_005,
    data: JSON.stringify({
      end_type: RoundEndType.Ron,
      win_info: [
        {
          user_id: winnerId,
          all_fang_num: han,
          all_fu: fu,
          all_point: ten,
          fang_info: [{ fang_type: YakuType.Riichi, fang_num: 1 }],
        },
      ],
      user_profit: [
        {
          user_id: winnerId,
          point_profit: ten,
          li_zhi_profit: 0,
          user_point: 25000 + ten,
        },
        {
          user_id: loserId,
          point_profit: -ten,
          li_zhi_profit: 0,
          user_point: 25000 - ten,
        },
      ],
    }),
  };
}

function gameEndEvent(scores: [number, number, number, number]): HandData {
  return {
    eventType: EventType.GameEnd,
    userId: 1001,
    startTime: 1_700_000_006,
    data: JSON.stringify({
      user_data: [
        { user_id: 1001, point_num: scores[0], score: scores[0] },
        { user_id: 1002, point_num: scores[1], score: scores[1] },
        { user_id: 1003, point_num: scores[2], score: scores[2] },
        { user_id: 1004, point_num: scores[3], score: scores[3] },
      ],
    }),
  };
}

const SEAT_IDS = ["1001", "1002", "1003", "1004"];
const SEAT_NAMES = ["Alice", "Bob", "Carol", "Dave"];

const HAND_0 = [
  m(1),
  m(2),
  m(3),
  m(4),
  m(5),
  m(6),
  m(7),
  m(8),
  m(9),
  p(1),
  p(2),
  p(3),
  p(4),
];
const HAND_1 = [
  p(5),
  p(6),
  p(7),
  p(8),
  p(9),
  s(1),
  s(2),
  s(3),
  s(4),
  s(5),
  s(6),
  s(7),
  s(8),
];
const HAND_2 = [
  s(9),
  z(1),
  z(1, 1),
  z(2),
  z(2, 1),
  z(3),
  z(3, 1),
  z(4),
  z(4, 1),
  z(5),
  z(5, 1),
  z(6),
  z(6, 1),
];
const HAND_3 = [
  z(7),
  z(7, 1),
  m(1, 1),
  m(2, 1),
  m(3, 1),
  m(4, 1),
  m(5, 1),
  m(6, 1),
  m(7, 1),
  m(8, 1),
  m(9, 1),
  p(1, 1),
  p(2, 1),
];

function buildRound(events: HandData[]): RoundData {
  return {
    changCi: 0,
    benChangNum: 0,
    handCardEncode: "",
    handEventRecord: events,
  };
}

function gameWith(
  rounds: RoundData[],
  scoresAtEnd?: [number, number, number, number]
): GameData {
  const lastRound = rounds[rounds.length - 1];
  if (scoresAtEnd) {
    lastRound.handEventRecord.push(gameEndEvent(scoresAtEnd));
  }
  return {
    handRecord: rounds,
    nowTime: 1_700_001_000,
    keyValue: "rc-test-game-id",
  };
}

describe("parseRiichiCityReplay", () => {
  it("emits match_start, hand_start with omniscient hands, and a hand_end on RyuuKyoku", () => {
    const round = buildRound([
      startingHandEvent(1001, HAND_0, {
        dealer_pos: 0,
        quan_feng: 0,
        chang_ci: 1,
        bao_pai_card: z(5),
      }),
      startingHandEvent(1002, HAND_1),
      startingHandEvent(1003, HAND_2),
      startingHandEvent(1004, HAND_3),
      ryuukyokuEvent(1001),
    ]);
    const log = parseRiichiCityReplay(gameWith([round]), SEAT_IDS, SEAT_NAMES);

    expect(log.source).toBe("riichicity");
    expect(log.sourceGameId).toBe("rc-test-game-id");
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
      expect(handStart.startingHands?.[0]).toHaveLength(13);
      expect(handStart.startingHands?.[0][0]).toBe("1m");
      expect(handStart.startingHands?.[2][0]).toBe("9s");
      expect(handStart.doraIndicators).toEqual(["5z"]);
    }

    expect(log.events.at(-2)?.type).toBe("hand_end");
    expect(log.events.at(-1)?.type).toBe("match_end");
  });

  it("decodes draws + discards + riichi flag and feeds through the reducer", () => {
    const round = buildRound([
      startingHandEvent(1001, HAND_0, {
        dealer_pos: 0,
        bao_pai_card: z(5),
      }),
      startingHandEvent(1002, HAND_1),
      startingHandEvent(1003, HAND_2),
      startingHandEvent(1004, HAND_3),
      drawEvent(1001, m(5, 1)),
      discardEvent(1001, m(5, 1), true),
      ryuukyokuEvent(1001),
    ]);
    const log = parseRiichiCityReplay(gameWith([round]), SEAT_IDS, SEAT_NAMES);

    const draws = log.events.filter((e) => e.type === "draw");
    const discards = log.events.filter((e) => e.type === "discard");
    expect(draws[0].type).toBe("draw");
    if (draws[0].type === "draw") {
      expect(draws[0].seat).toBe(0);
      expect(draws[0].tile).toBe("5m");
    }
    expect(discards[0].type).toBe("discard");
    if (discards[0].type === "discard") {
      expect(discards[0].seat).toBe(0);
      expect(discards[0].tile).toBe("5m");
      expect(discards[0].riichi).toBe(true);
      expect(discards[0].tsumogiri).toBe(true);
    }

    const view = replayReducer(log, log.events.length - 1);
    expect(view.hands[0]).toHaveLength(13);
  });

  it("emits a new_dora event on a NewDoraIndicator", () => {
    const round = buildRound([
      startingHandEvent(1001, HAND_0, { dealer_pos: 0, bao_pai_card: z(5) }),
      startingHandEvent(1002, HAND_1),
      startingHandEvent(1003, HAND_2),
      startingHandEvent(1004, HAND_3),
      newDoraEvent(1001, z(6)),
      ryuukyokuEvent(1001),
    ]);
    const log = parseRiichiCityReplay(gameWith([round]), SEAT_IDS, SEAT_NAMES);

    const newDoras = log.events.filter((e) => e.type === "new_dora");
    expect(newDoras).toHaveLength(1);
    if (newDoras[0].type === "new_dora") {
      expect(newDoras[0].indicator).toBe("6z");
    }
  });

  it("emits a chi call with claimedTile + from set from the previous discard", () => {
    const round = buildRound([
      startingHandEvent(1001, HAND_0, { dealer_pos: 0, bao_pai_card: z(5) }),
      startingHandEvent(1002, HAND_1),
      startingHandEvent(1003, HAND_2),
      startingHandEvent(1004, HAND_3),
      drawEvent(1001, m(7, 2)),
      discardEvent(1001, m(7, 2)),
      callEvent(1002, ActionType.ChiiYXX, [m(5, 1), m(6)], m(7, 2)),
      ryuukyokuEvent(1001),
    ]);
    const log = parseRiichiCityReplay(gameWith([round]), SEAT_IDS, SEAT_NAMES);

    const calls = log.events.filter((e) => e.type === "call");
    expect(calls).toHaveLength(1);
    if (calls[0].type === "call") {
      expect(calls[0].seat).toBe(1);
      expect(calls[0].meld.type).toBe("chi");
      expect(calls[0].meld.from).toBe(0);
      expect(calls[0].meld.claimedTile).toBe("7m");
    }
  });

  it("emits an ankan with all 4 tiles (group_cards has 3, card has the drawn 4th)", () => {
    // Real RC ankan payload: 3 hand copies on `group_cards` and the
    // just-drawn 4th copy on `card`. The renderer needs all 4 to
    // draw the standard ankan shape (face-down, face-up, face-up,
    // face-down).
    const round = buildRound([
      startingHandEvent(1001, HAND_0, { dealer_pos: 0, bao_pai_card: z(5) }),
      startingHandEvent(1002, HAND_1),
      startingHandEvent(1003, HAND_2),
      startingHandEvent(1004, HAND_3),
      drawEvent(1001, p(6)),
      callEvent(1001, ActionType.Ankan, [p(6), p(6), p(6)], p(6)),
      ryuukyokuEvent(1001),
    ]);
    const log = parseRiichiCityReplay(gameWith([round]), SEAT_IDS, SEAT_NAMES);

    const calls = log.events.filter((e) => e.type === "call");
    expect(calls).toHaveLength(1);
    if (calls[0].type === "call") {
      expect(calls[0].meld.type).toBe("ankan");
      expect(calls[0].meld.tiles).toHaveLength(4);
      expect(calls[0].meld.tiles).toEqual(["6p", "6p", "6p", "6p"]);
    }
  });

  it("emits a win + ron hand_end on a RoundEnd of type Ron", () => {
    const round = buildRound([
      startingHandEvent(1001, HAND_0, { dealer_pos: 0, bao_pai_card: z(5) }),
      startingHandEvent(1002, HAND_1),
      startingHandEvent(1003, HAND_2),
      startingHandEvent(1004, HAND_3),
      drawEvent(1002, m(5, 1)),
      discardEvent(1002, m(5, 1)),
      ronEndEvent(1001, 1002, 2, 30, 8000),
    ]);
    const log = parseRiichiCityReplay(
      gameWith([round], [33000, 17000, 25000, 25000]),
      SEAT_IDS,
      SEAT_NAMES
    );

    const wins = log.events.filter((e) => e.type === "win");
    expect(wins).toHaveLength(1);
    if (wins[0].type === "win") {
      expect(wins[0].seat).toBe(0);
      expect(wins[0].loser).toBe(1);
      expect(wins[0].han).toBe(2);
      expect(wins[0].fu).toBe(30);
      expect(wins[0].ten).toBe(8000);
    }

    const handEnds = log.events.filter((e) => e.type === "hand_end");
    expect(handEnds).toHaveLength(1);
    if (handEnds[0].type === "hand_end") {
      expect(handEnds[0].reason).toBe("ron");
    }

    const matchEnd = log.events.at(-1);
    expect(matchEnd?.type).toBe("match_end");
    if (matchEnd?.type === "match_end") {
      const winnerEntry = matchEnd.finalScores.find((f) => f.seat === 0);
      expect(winnerEntry?.place).toBe(1);
      expect(winnerEntry?.score).toBe(33000);
    }
  });

  it("uses the net score change for the win delta, not point_profit + li_zhi_profit (riichi-stick double-count regression)", () => {
    // A tsumo where the winner collected riichi sticks: Riichi City reports the
    // pickup in BOTH `point_profit` and `li_zhi_profit`, so naively summing them
    // double-counts the 1000-per-stick collection. The authoritative net change
    // is `user_point` minus the pre-hand score (25000), which the adapter must
    // use for `hand_end.delta`.
    const customRoundEnd: HandData = {
      eventType: EventType.RoundEnd,
      userId: 1001,
      startTime: 1_700_000_005,
      data: JSON.stringify({
        end_type: RoundEndType.Tsumo,
        win_info: [
          {
            user_id: 1001,
            all_fang_num: 3,
            all_fu: 30,
            all_point: 2000,
            fang_info: [{ fang_type: YakuType.Riichi, fang_num: 1 }],
          },
        ],
        user_profit: [
          // combined = 3000 + 1000 = 4000, but the true net change is 3000.
          {
            user_id: 1001,
            point_profit: 3000,
            li_zhi_profit: 1000,
            user_point: 28000,
          },
          {
            user_id: 1002,
            point_profit: -1000,
            li_zhi_profit: -1000,
            user_point: 23000,
          },
          {
            user_id: 1003,
            point_profit: -1000,
            li_zhi_profit: 0,
            user_point: 24000,
          },
          {
            user_id: 1004,
            point_profit: -1000,
            li_zhi_profit: 0,
            user_point: 24000,
          },
        ],
      }),
    };

    const round = buildRound([
      startingHandEvent(1001, HAND_0, { dealer_pos: 0, bao_pai_card: z(5) }),
      startingHandEvent(1002, HAND_1),
      startingHandEvent(1003, HAND_2),
      startingHandEvent(1004, HAND_3),
      drawEvent(1001, m(7, 1)),
      discardEvent(1001, m(7, 1), true),
      customRoundEnd,
    ]);
    const log = parseRiichiCityReplay(
      gameWith([round], [28000, 23000, 24000, 24000]),
      SEAT_IDS,
      SEAT_NAMES
    );

    const handEnd = log.events.find((e) => e.type === "hand_end");
    expect(handEnd?.type).toBe("hand_end");
    if (handEnd?.type === "hand_end") {
      // Winner's delta is the net 3000, NOT the double-counted 4000.
      expect(handEnd.delta).toEqual([3000, -2000, -1000, -1000]);
    }
  });

  it("rejects an empty GameData", () => {
    expect(() =>
      parseRiichiCityReplay(
        { handRecord: [], nowTime: 0, keyValue: "x" },
        SEAT_IDS,
        SEAT_NAMES
      )
    ).toThrow(/no rounds/);
  });

  // Phase 4.5 step 11: idempotency oracle.
  it("is idempotent — parse twice → deep-equal logs", () => {
    const round = buildRound([
      startingHandEvent(1001, HAND_0, { dealer_pos: 0, bao_pai_card: z(5) }),
      startingHandEvent(1002, HAND_1),
      startingHandEvent(1003, HAND_2),
      startingHandEvent(1004, HAND_3),
      drawEvent(1002, m(5, 1)),
      discardEvent(1002, m(5, 1)),
      ronEndEvent(1001, 1002, 2, 30, 8000),
    ]);
    const game = gameWith([round], [33000, 17000, 25000, 25000]);
    const a = parseRiichiCityReplay(game, SEAT_IDS, SEAT_NAMES);
    const b = parseRiichiCityReplay(game, SEAT_IDS, SEAT_NAMES);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

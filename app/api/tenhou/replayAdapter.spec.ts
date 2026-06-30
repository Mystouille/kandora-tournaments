import { describe, expect, it } from "vitest";
import {
  parseTenhouJsonReplay,
  parseTenhouXmlReplay,
  type TenhouJsonLog,
} from "./replayAdapter";
import { replayReducer } from "~/game/replay/player";

// Tile id helpers — Tenhou XML uses 0..135 with type = id/4.
// 1m..9m → 0..35 (in steps of 4); 1p..9p → 36..71; 1s..9s → 72..107;
// 1z..7z → 108..135.
function man(n: number, copy = 0): number {
  return (n - 1) * 4 + copy;
}
function pin(n: number, copy = 0): number {
  return (n + 8) * 4 + copy;
}
function sou(n: number, copy = 0): number {
  return (n + 17) * 4 + copy;
}
function honor(n: number, copy = 0): number {
  return (n + 26) * 4 + copy;
}

const HAND_0 = [
  man(1),
  man(2),
  man(3),
  man(4),
  man(5),
  man(6),
  man(7),
  man(8),
  man(9),
  pin(1),
  pin(2),
  pin(3),
  pin(4),
];
const HAND_1 = [
  pin(5),
  pin(6),
  pin(7),
  pin(8),
  pin(9),
  sou(1),
  sou(2),
  sou(3),
  sou(4),
  sou(5),
  sou(6),
  sou(7),
  sou(8),
];
const HAND_2 = [
  sou(9),
  honor(1),
  honor(1, 1),
  honor(2),
  honor(2, 1),
  honor(3),
  honor(3, 1),
  honor(4),
  honor(4, 1),
  honor(5),
  honor(5, 1),
  honor(6),
  honor(6, 1),
];
const HAND_3 = [
  honor(7),
  honor(7, 1),
  man(1, 1),
  man(2, 1),
  man(3, 1),
  man(4, 1),
  man(5, 1),
  man(6, 1),
  man(7, 1),
  man(8, 1),
  man(9, 1),
  pin(1, 1),
  pin(2, 1),
];

function buildXmlLog(opts: {
  oya?: number;
  drawTile?: number;
  discardTile?: number;
  riichi?: boolean;
  ryuukyokuType?: string;
  agariAttrs?: Record<string, string>;
  doraFlip?: number;
}): string {
  const oya = opts.oya ?? 0;
  const seed = `0,0,0,0,0,${honor(5)}`; // E1, 0 honba, 0 sticks, dora = 5z
  const ten = "250,250,250,250"; // 25000 each
  let body = `<UN n0="${encodeURIComponent("Alice")}" n1="${encodeURIComponent(
    "Bob"
  )}" n2="${encodeURIComponent("Carol")}" n3="${encodeURIComponent("Dave")}"/>`;
  body += `<INIT seed="${seed}" ten="${ten}" oya="${oya}" hai0="${HAND_0.join(
    ","
  )}" hai1="${HAND_1.join(",")}" hai2="${HAND_2.join(",")}" hai3="${HAND_3.join(
    ","
  )}"/>`;
  if (opts.riichi) {
    body += `<REACH who="${oya}" step="1"/>`;
  }
  if (opts.drawTile !== undefined) {
    const seatLetter = ["T", "U", "V", "W"][oya];
    body += `<${seatLetter}${opts.drawTile}/>`;
  }
  if (opts.discardTile !== undefined) {
    const seatLetter = ["D", "E", "F", "G"][oya];
    body += `<${seatLetter}${opts.discardTile}/>`;
  }
  if (opts.riichi) {
    body += `<REACH who="${oya}" step="2"/>`;
  }
  if (opts.doraFlip !== undefined) {
    body += `<DORA hai="${opts.doraFlip}"/>`;
  }
  if (opts.agariAttrs) {
    const attrs = Object.entries(opts.agariAttrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    body += `<AGARI ${attrs}/>`;
  } else if (opts.ryuukyokuType) {
    body += `<RYUUKYOKU type="${opts.ryuukyokuType}" sc="250,0,250,0,250,0,250,0"/>`;
  } else {
    body += `<RYUUKYOKU sc="250,0,250,0,250,0,250,0"/>`;
  }
  return `<mjloggm>${body}</mjloggm>`;
}

describe("parseTenhouXmlReplay", () => {
  it("emits match_start, hand_start with omniscient hands, and a hand_end on RYUUKYOKU", () => {
    const xml = buildXmlLog({});
    const log = parseTenhouXmlReplay(xml, "2026041906gm-test-uuid");
    expect(log.source).toBe("tenhou");
    expect(log.sourceGameId).toBe("2026041906gm-test-uuid");
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
    const xml = buildXmlLog({
      drawTile: man(5, 1), // dealer draws 5m (non-red copy)
      discardTile: man(5, 1), // discards it (riichi)
      riichi: true,
      ryuukyokuType: "yao9",
    });
    const log = parseTenhouXmlReplay(xml, "2026041906gm-test");
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
    }
    // RYUUKYOKU type=yao9 → kyuushuu abort.
    const handEnd = log.events.find((e) => e.type === "hand_end");
    if (handEnd && handEnd.type === "hand_end") {
      expect(handEnd.reason).toBe("abort");
      expect(handEnd.abortKind).toBe("kyuushuu");
    }

    // End-to-end fold: no event throws, dealer hand has 13 tiles
    // after draw + discard.
    const view = replayReducer(log, log.events.length - 1);
    expect(view.hands[0]).toHaveLength(13);
  });

  it("decodes red five tile id 16 (5m) as '0m'", () => {
    const xml = buildXmlLog({ drawTile: 16 }); // 5m red
    const log = parseTenhouXmlReplay(xml, "2026041906gm-test");
    const draw = log.events.find((e) => e.type === "draw");
    if (draw && draw.type === "draw") {
      expect(draw.tile).toBe("0m");
    } else {
      throw new Error("expected draw event");
    }
  });

  it("emits a new_dora event on <DORA> mid-hand", () => {
    const xml = buildXmlLog({ doraFlip: honor(6) });
    const log = parseTenhouXmlReplay(xml, "2026041906gm-test");
    const newDoras = log.events.filter((e) => e.type === "new_dora");
    expect(newDoras).toHaveLength(1);
    if (newDoras[0].type === "new_dora") {
      expect(newDoras[0].indicator).toBe("6z");
    }
  });

  it("AGARI emits a win + hand_end; multi-AGARI emits a single hand_end", () => {
    const xml = buildXmlLog({
      agariAttrs: {
        who: "0",
        fromWho: "1",
        machi: String(man(5, 1)),
        ten: "30,8000,0",
        yaku: "1,1,7,1", // riichi(1=1), pinfu(7=1)
        sc: "250,80,250,-80,250,0,250,0",
        hai: HAND_0.join(","),
      },
    });
    const log = parseTenhouXmlReplay(xml, "2026041906gm-test");
    const wins = log.events.filter((e) => e.type === "win");
    expect(wins).toHaveLength(1);
    if (wins[0].type === "win") {
      expect(wins[0].seat).toBe(0);
      expect(wins[0].loser).toBe(1);
      expect(wins[0].winTile).toBe("5m");
      expect(wins[0].han).toBe(2);
      expect(wins[0].fu).toBe(30);
    }
    const handEnds = log.events.filter((e) => e.type === "hand_end");
    expect(handEnds).toHaveLength(1);
    if (handEnds[0].type === "hand_end") {
      expect(handEnds[0].reason).toBe("ron");
    }
  });

  it("rejects an empty XML log", () => {
    expect(() => parseTenhouXmlReplay("", "test")).toThrow(/empty/);
  });
});

describe("parseTenhouJsonReplay", () => {
  // Tenhou JSON tile codes: 11..19 = 1m..9m, 21..29 = 1p..9p,
  // 31..39 = 1s..9s, 41..47 = 1z..7z; 51/52/53 = red fives.
  function jsonHand(start: number, count = 13): number[] {
    return Array.from({ length: count }, (_, i) => start + i);
  }

  it("emits match_start + hand_start with omniscient starting hands and feeds the reducer", () => {
    const log: TenhouJsonLog = {
      title: ["Test", ""],
      name: ["Alice", "Bob", "Carol", "Dave"],
      rule: { disp: "test", aka: 1 },
      log: [
        [
          [0, 0, 0],
          [25000, 25000, 25000, 25000],
          [45], // dora indicator: 5z
          [], // ura
          jsonHand(11), // hand0: 1m..9m + 1p..2p (length 11; pad to 13)
          [12, 13], // draws0: drew 2m, then 3m
          ["60", 18], // discards0: tsumogiri then 8m
          jsonHand(21),
          [],
          [],
          jsonHand(31),
          [],
          [],
          jsonHand(41, 7).concat([11, 12, 13, 14, 15, 16]),
          [],
          [],
          ["流局", [0, 0, 0, 0]],
        ],
      ],
    };
    // Ensure all hands are length 13.
    log.log[0][4] = jsonHand(11).slice(0, 13);
    log.log[0][7] = jsonHand(21).slice(0, 13);
    log.log[0][10] = jsonHand(31).slice(0, 13);
    log.log[0][13] = jsonHand(41, 7)
      .concat([11, 12, 13, 14, 15, 16])
      .slice(0, 13);
    const r = parseTenhouJsonReplay(log, "2026041906gm-test");
    expect(r.source).toBe("tenhou");
    expect(r.events[0].type).toBe("match_start");
    const hs = r.events[1];
    if (hs.type === "hand_start") {
      expect(hs.startingHands?.[0]).toHaveLength(13);
      expect(hs.startingHands?.[0][0]).toBe("1m");
      expect(hs.doraIndicators).toEqual(["5z"]);
    }
    // Reducer should fold without throwing.
    const view = replayReducer(r, r.events.length - 1);
    expect(view).toBeDefined();
  });

  it("decodes a riichi discard ('r12' on the discard side)", () => {
    const log: TenhouJsonLog = {
      name: ["A", "B", "C", "D"],
      log: [
        [
          [0, 0, 0],
          [25000, 25000, 25000, 25000],
          [45],
          [],
          jsonHand(11).slice(0, 13),
          [12], // drew 2m
          ["r12"], // riichi discard of 2m
          jsonHand(21).slice(0, 13),
          [],
          [],
          jsonHand(31).slice(0, 13),
          [],
          [],
          jsonHand(41, 7).concat([11, 12, 13, 14, 15, 16]).slice(0, 13),
          [],
          [],
          ["流局", [0, 0, 0, 0]],
        ],
      ],
    };
    const r = parseTenhouJsonReplay(log, "2026041906gm-test");
    const discards = r.events.filter((e) => e.type === "discard");
    expect(discards[0].type).toBe("discard");
    if (discards[0].type === "discard") {
      expect(discards[0].riichi).toBe(true);
      expect(discards[0].tile).toBe("2m");
    }
  });

  it("rejects an empty JSON log", () => {
    expect(() =>
      parseTenhouJsonReplay({ log: [] } as TenhouJsonLog, "test")
    ).toThrow(/no rounds/);
  });
});

// Phase 4.5 step 11: idempotency oracle. Parsing the same raw log
// twice must produce byte-identical ReplayLog documents.
describe("Tenhou replay adapter — idempotency", () => {
  it("XML: parse twice → deep-equal logs", () => {
    const xml = buildXmlLog({
      drawTile: man(5, 1),
      discardTile: man(5, 1),
      riichi: true,
      ryuukyokuType: "yao9",
    });
    const a = parseTenhouXmlReplay(xml, "2026041906gm-test");
    const b = parseTenhouXmlReplay(xml, "2026041906gm-test");
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

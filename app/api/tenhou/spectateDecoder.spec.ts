import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GameEventSchema, type GameEvent } from "~/game/protocol/messages";
import { replayReducer } from "~/game/replay/player";
import {
  parseTenhouReplayElements,
  type TenhouReplayElement,
} from "./replayAdapter";
import {
  normalizeElement,
  parseTenhouSpectateHar,
  websocketMessagesFromHar,
} from "./spectateHarAdapter";
import { TenhouSpectateDecoder } from "./spectateDecoder";

const HAR_PATH = resolve(process.cwd(), "extract.har");

/** Received JSON frames from the capture, in wire order. */
function receiveFrames(rawHar: string): Record<string, unknown>[] {
  return websocketMessagesFromHar(rawHar)
    .filter((message) => message.type === "receive")
    .map((message) => {
      try {
        return JSON.parse(String(message.data)) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
}

/**
 * Independent oracle: merge every frame's child elements seed-keyed
 * (longest catch-up wins), then batch-parse once. The streaming decoder
 * must reproduce this exactly.
 */
function oracleEvents(frames: Record<string, unknown>[]): GameEvent[] {
  const handOrder: string[] = [];
  const hands = new Map<string, TenhouReplayElement[]>();
  let un: TenhouReplayElement | null = null;
  let current: string | null = null;

  for (const frame of frames) {
    if (frame.tag === "UN" && !un) {
      un = normalizeElement(frame);
      continue;
    }
    if (frame.tag !== "INITBYLOG" && frame.tag !== "WGC") {
      continue;
    }
    const childNodes = frame.childNodes;
    if (!Array.isArray(childNodes)) {
      continue;
    }
    for (const child of childNodes) {
      if (typeof child === "number") {
        continue;
      }
      const element = normalizeElement(child);
      if (!element) {
        continue;
      }
      if (element.tag === "INIT") {
        const seed = element.attrs.seed ?? `hand-${handOrder.length}`;
        current = seed;
        if (!hands.has(seed)) {
          handOrder.push(seed);
        }
        hands.set(seed, [element]);
      } else if (current !== null) {
        hands.get(current)?.push(element);
      }
    }
  }

  const elements: TenhouReplayElement[] = un ? [un] : [];
  for (const seed of handOrder) {
    const bucket = hands.get(seed);
    if (bucket) {
      elements.push(...bucket);
    }
  }
  let events = parseTenhouReplayElements(elements, "tenhou-live").events.map(
    (event) => {
      if (event.type !== "hand_start") {
        return event;
      }
      const handStart = { ...event };
      delete handStart.liveDrawSchedule;
      return handStart;
    }
  );
  const owari = elements.some(
    (element) =>
      (element.tag === "AGARI" || element.tag === "RYUUKYOKU") &&
      element.attrs.owari !== undefined
  );
  if (events.at(-1)?.type === "match_end" && !owari) {
    events = events.slice(0, -1);
  }
  return events;
}

describe("TenhouSpectateDecoder", () => {
  const rawHar = readFileSync(HAR_PATH, "utf8");
  const frames = receiveFrames(rawHar);

  it("streams the same events a batch parse of the merged capture would", () => {
    const decoder = new TenhouSpectateDecoder("tenhou-live");
    const streamed: GameEvent[] = [];
    for (const frame of frames) {
      streamed.push(...decoder.ingest(frame));
    }
    expect(streamed).toEqual(oracleEvents(frames));
  });

  it("emits schema-valid events that fold through the replay reducer", () => {
    const decoder = new TenhouSpectateDecoder("tenhou-live");
    const streamed: GameEvent[] = [];
    for (const frame of frames) {
      streamed.push(...decoder.ingest(frame));
    }

    expect(streamed.length).toBeGreaterThan(0);
    for (const event of streamed) {
      expect(GameEventSchema.safeParse(event).success).toBe(true);
    }
    expect(streamed.filter((e) => e.type === "match_start")).toHaveLength(1);
    expect(streamed.some((e) => e.type === "call")).toBe(true);
    expect(streamed.some((e) => e.type === "win")).toBe(true);
    expect(streamed.some((e) => e.type === "draw")).toBe(true);

    const log = {
      source: "tenhou" as const,
      sourceGameId: "tenhou-live",
      ruleSet: "tenhou",
      startedAt: 0,
      endedAt: 0,
      seats: [],
      events: streamed,
      schemaVersion: 2,
    };
    expect(() => replayReducer(log, streamed.length - 1)).not.toThrow();
  });

  it("marks the live draw after a kan as a dead-wall replacement", () => {
    const decoder = new TenhouSpectateDecoder("tenhou-live");
    const streamed: GameEvent[] = [];
    streamed.push(
      ...decoder.ingest({
        tag: "UN",
        n0: "East",
        n1: "South",
        n2: "West",
        n3: "North",
      })
    );
    streamed.push(
      ...decoder.ingest({
        tag: "INITBYLOG",
        childNodes: [
          {
            tag: "INIT",
            seed: "0,0,0,0,0,1",
            ten: "250,250,250,250",
            oya: 0,
            hai0: "0,4,8,12,16,20,24,28,32,36,40,44,48",
            hai1: "52,56,60,64,68,72,76,80,84,92,93,94,95",
            hai2: "1,5,9,13,17,21,25,29,33,37,41,45,49",
            hai3: "2,6,10,14,18,22,26,30,34,38,42,46,50",
          },
        ],
      })
    );
    streamed.push(
      ...decoder.ingest({
        tag: "WGC",
        childNodes: [
          { tag: "N", who: 1, m: 23552 },
          { tag: "DORA", hai: 65 },
        ],
      })
    );
    streamed.push(
      ...decoder.ingest({
        tag: "WGC",
        childNodes: [{ tag: "U108" }],
      })
    );

    expect(streamed.at(-1)).toMatchObject({
      type: "draw",
      seat: 1,
      fromDeadWall: true,
    });

    const log = {
      source: "tenhou" as const,
      sourceGameId: "tenhou-live",
      ruleSet: "tenhou",
      startedAt: 0,
      endedAt: 0,
      seats: [],
      events: streamed,
      schemaVersion: 2,
    };
    const view = replayReducer(log, streamed.length - 1);
    expect(view.drawsTaken).toBe(1);
    expect(view.liveDrawsTaken).toBe(0);
  });

  it("dedupes reconnect catch-ups (one hand_start per INIT seed)", () => {
    const distinctSeeds = new Set<string>();
    for (const frame of frames) {
      if (frame.tag !== "INITBYLOG" && frame.tag !== "WGC") {
        continue;
      }
      const childNodes = frame.childNodes;
      if (!Array.isArray(childNodes)) {
        continue;
      }
      for (const child of childNodes) {
        const element = normalizeElement(child);
        if (element?.tag === "INIT" && element.attrs.seed) {
          distinctSeeds.add(element.attrs.seed);
        }
      }
    }

    const decoder = new TenhouSpectateDecoder("tenhou-live");
    const streamed: GameEvent[] = [];
    for (const frame of frames) {
      streamed.push(...decoder.ingest(frame));
    }

    const handStarts = streamed.filter((e) => e.type === "hand_start");
    expect(handStarts).toHaveLength(distinctSeeds.size);

    // The three overlapping reconnect sessions decoded independently would
    // double-count shared hands; the merged stream must be strictly smaller.
    const sessionTotal = parseTenhouSpectateHar(rawHar).reduce(
      (sum, session) => sum + session.events.length,
      0
    );
    expect(streamed.length).toBeLessThan(sessionTotal);
  });
});

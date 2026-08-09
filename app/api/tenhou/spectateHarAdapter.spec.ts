import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GameEventSchema } from "~/game/protocol/messages";
import { replayReducer } from "~/game/replay/player";
import {
  parseTenhouSpectateHar,
  websocketMessagesFromHar,
} from "./spectateHarAdapter";

const HAR_PATH = resolve(process.cwd(), "extract.har");

describe("parseTenhouSpectateHar", () => {
  const rawHar = readFileSync(HAR_PATH, "utf8");

  it("recognizes every received protocol and game-event tag", () => {
    const knownFrameTags = new Set([
      "HELO",
      "LN",
      "GO",
      "UN",
      "KANSEN",
      "INITBYLOG",
      "WGC",
    ]);
    const unknownFrameTags = new Set<string>();
    const unknownGameTags = new Set<string>();

    for (const message of websocketMessagesFromHar(rawHar)) {
      if (message.type !== "receive" || typeof message.data !== "string") {
        continue;
      }
      const frame = JSON.parse(message.data) as {
        tag?: unknown;
        childNodes?: unknown[];
      };
      if (typeof frame.tag === "string" && !knownFrameTags.has(frame.tag)) {
        unknownFrameTags.add(frame.tag);
      }
      for (const child of frame.childNodes ?? []) {
        if (
          typeof child === "object" &&
          child !== null &&
          "tag" in child &&
          typeof child.tag === "string" &&
          !/^(?:INIT|N|REACH|DORA|AGARI|RYUUKYOKU|[TUVWDEFG]\d+)$/.test(
            child.tag
          )
        ) {
          unknownGameTags.add(child.tag);
        }
      }
    }

    expect([...unknownFrameTags]).toEqual([]);
    expect([...unknownGameTags]).toEqual([]);
  });

  it("preserves the initial delayed-spectator waiting phase", () => {
    const sessions = parseTenhouSpectateHar(rawHar);

    expect(sessions).toHaveLength(5);
    expect(sessions[0].initialFeedDelayMs).toBeGreaterThan(120_000);
    expect(sessions[0].initialFeedDelayMs).toBeLessThan(5 * 60_000);
    expect(
      sessions.slice(1).every((session) => session.initialFeedDelayMs < 1_000)
    ).toBe(true);

    const firstHandStart = sessions[0].events.findIndex(
      (event) => event.type === "hand_start"
    );
    expect(firstHandStart).toBeGreaterThan(0);
    expect(sessions[0].eventDelaysMs[firstHandStart]).toBeGreaterThanOrEqual(
      sessions[0].initialFeedDelayMs
    );
  });

  it("validates and folds every enriched HAR catch-up session", () => {
    const sessions = parseTenhouSpectateHar(rawHar);

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => Boolean(session.watchId))).toBe(true);
    expect(sessions.some((session) => session.complete)).toBe(true);

    for (const session of sessions) {
      expect(session.events.length).toBeGreaterThan(0);
      expect(session.timings.length).toBeGreaterThan(0);
      expect(session.eventDelaysMs).toHaveLength(session.events.length);
      expect(session.eventDelaysMs.some((delay) => delay > 0)).toBe(true);
      expect(session.events.at(-1)?.type === "match_end").toBe(
        session.complete
      );
      for (const event of session.events) {
        expect(GameEventSchema.safeParse(event).success).toBe(true);
      }
      expect(() =>
        replayReducer(session.replay, session.events.length - 1)
      ).not.toThrow();
      for (const handStart of session.events.filter(
        (event) => event.type === "hand_start"
      )) {
        expect(handStart.startingHands).toHaveLength(4);
        expect(
          handStart.startingHands?.every((hand) => hand.length === 13)
        ).toBe(true);
      }
    }

    // Feature coverage across the whole capture (order-independent).
    const all = sessions.flatMap((session) => session.events);
    expect(
      all.filter((event) => event.type === "hand_start").length
    ).toBeGreaterThanOrEqual(2);
    expect(all.some((event) => event.type === "call")).toBe(true);
    expect(all.some((event) => event.type === "win")).toBe(true);
    expect(
      all.some(
        (event) =>
          event.type === "hand_end" && event.reason === "exhaustive_draw"
      )
    ).toBe(true);
    expect(
      all.some((event) => event.type === "discard" && event.riichi === true)
    ).toBe(true);
  });
});
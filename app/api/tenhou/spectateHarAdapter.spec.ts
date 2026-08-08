import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GameEventSchema } from "~/game/protocol/messages";
import { replayReducer } from "~/game/replay/player";
import { parseTenhouSpectateHar } from "./spectateHarAdapter";

const HAR_PATH = resolve(process.cwd(), "extract.har");

describe("parseTenhouSpectateHar", () => {
  it("validates and folds every enriched HAR catch-up session", () => {
    const sessions = parseTenhouSpectateHar(readFileSync(HAR_PATH, "utf8"));

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
import { describe, expect, it } from "vitest";
import {
  clearPendingMobileContentUrl,
  loadPendingMobileContentIntent,
  mobileContentIntentKey,
  parseMobileContentIntent,
  savePendingMobileContentUrl,
} from "./deepLinks";

const baseUrl = "https://tournaments.tnt-sessions.com";

describe("mobile content deep links", () => {
  it("parses every supported viewer route", () => {
    expect(
      parseMobileContentIntent(`${baseUrl}/game/match-1`, baseUrl)
    ).toEqual({ kind: "join-game", matchId: "match-1" });
    expect(
      parseMobileContentIntent(`${baseUrl}/spectate/match-2`, baseUrl)
    ).toEqual({ kind: "spectate-match", matchId: "match-2" });
    expect(
      parseMobileContentIntent(`${baseUrl}/watch/live/AB12CD34`, baseUrl)
    ).toEqual({ kind: "watch-live", watchId: "AB12CD34" });
    expect(
      parseMobileContentIntent(
        `${baseUrl}/watch/replay/game%20id?seat=2&round=4&event=72&review=AbCd1234Ef`,
        baseUrl
      )
    ).toEqual({
      kind: "watch-replay",
      gameId: "game id",
      state: { seat: 2, round: 4, event: 72, review: "AbCd1234Ef" },
    });
  });

  it("accepts only the configured origin and base path", () => {
    expect(
      parseMobileContentIntent(
        "https://example.com/watch/replay/game-1",
        baseUrl
      )
    ).toBeNull();
    expect(
      parseMobileContentIntent("kandora://watch/replay/game-1", baseUrl)
    ).toBeNull();
    expect(
      parseMobileContentIntent(
        `${baseUrl}/watch/replay/game-1`,
        `${baseUrl}/kandora`
      )
    ).toBeNull();
    expect(
      parseMobileContentIntent(
        `${baseUrl}/kandora/watch/replay/game-1`,
        `${baseUrl}/kandora`
      )
    ).toEqual({ kind: "watch-replay", gameId: "game-1", state: {} });
  });

  it("rejects unsupported and malformed paths", () => {
    expect(
      parseMobileContentIntent(`${baseUrl}/watch/replay/tenhou-har`, baseUrl)
    ).toBeNull();
    expect(
      parseMobileContentIntent(`${baseUrl}/review?gameId=game-1`, baseUrl)
    ).toBeNull();
    expect(
      parseMobileContentIntent(`${baseUrl}/watch/replay/a%2Fb`, baseUrl)
    ).toBeNull();
    expect(
      parseMobileContentIntent(`${baseUrl}/game/%E0%A4%A`, baseUrl)
    ).toBeNull();
  });

  it("keeps only valid replay cursor parameters", () => {
    const longReview = "x".repeat(129);
    expect(
      parseMobileContentIntent(
        `${baseUrl}/watch/replay/game-1?seat=8&round=0&event=1.5&review=${longReview}&from=%2Fadmin#ignored`,
        baseUrl
      )
    ).toEqual({ kind: "watch-replay", gameId: "game-1", state: {} });
    expect(
      parseMobileContentIntent(
        `${baseUrl}/watch/replay/game-1?event=-20`,
        baseUrl
      )
    ).toEqual({
      kind: "watch-replay",
      gameId: "game-1",
      state: { event: -20 },
    });
  });

  it("persists, reparses, and clears a pending intent", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const url = `${baseUrl}/watch/replay/game-1?seat=2&event=7`;
    savePendingMobileContentUrl(storage, url, 1_000);

    const pending = loadPendingMobileContentIntent(storage, baseUrl, 2_000);

    expect(pending).toMatchObject({
      url,
      receivedAt: 1_000,
      intent: {
        kind: "watch-replay",
        gameId: "game-1",
        state: { seat: 2, event: 7 },
      },
    });
    expect(mobileContentIntentKey(pending!.intent)).toBe(
      "watch-replay:game-1:2::7:"
    );
    clearPendingMobileContentUrl(storage);
    expect(loadPendingMobileContentIntent(storage, baseUrl, 2_000)).toBeNull();
  });

  it("drops expired, future, malformed, and no-longer-trusted records", () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
      removeItem: () => {
        value = null;
      },
    };
    savePendingMobileContentUrl(storage, `${baseUrl}/game/match-1`, 1_000);
    expect(
      loadPendingMobileContentIntent(storage, baseUrl, 31 * 60_000 + 1_001)
    ).toBeNull();

    savePendingMobileContentUrl(storage, `${baseUrl}/game/match-1`, 100_000);
    expect(loadPendingMobileContentIntent(storage, baseUrl, 1_000)).toBeNull();

    value = "not-json";
    expect(loadPendingMobileContentIntent(storage, baseUrl, 1_000)).toBeNull();

    savePendingMobileContentUrl(storage, `${baseUrl}/game/match-1`, 1_000);
    expect(
      loadPendingMobileContentIntent(
        storage,
        "https://other.example.com",
        1_500
      )
    ).toBeNull();
  });
});

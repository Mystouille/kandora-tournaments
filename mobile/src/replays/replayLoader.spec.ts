import { describe, expect, it, vi } from "vitest";
import type { MobileAuthSession } from "../auth/mobileAuth";
import { loadReplayForRow, ReplayLoadError } from "./replayLoader";
import type { ReplayLibraryRow } from "./replayLibrary";

const log = {
  source: "ingame" as const,
  sourceGameId: "game-1",
  ruleSet: "m-league",
  startedAt: 1_000,
  endedAt: 2_000,
  seats: [0, 1, 2, 3].map((seat) => ({
    seat: seat as 0 | 1 | 2 | 3,
    displayName: `Player ${seat}`,
    finalScore: 40_000 - seat * 10_000,
    place: (seat + 1) as 1 | 2 | 3 | 4,
  })),
  events: [],
  schemaVersion: 6,
};

const row: ReplayLibraryRow = {
  key: "offline:ingame:game-1",
  mode: "offline",
  source: "ingame",
  sourceGameId: "game-1",
  replayUrl: null,
  gameDate: 1_000,
  seats: log.seats,
  context: { kind: "friendly" },
  ruleset: { id: "m-league", label: "M-League" },
  reasons: [],
};

const session: MobileAuthSession = {
  token: "game-token",
  username: "Alice",
  expiresAt: Date.now() + 60_000,
};

describe("mobile replay row loading", () => {
  it("loads offline rows from the device store", async () => {
    const getReplayLog = vi.fn().mockResolvedValue(log);

    await expect(
      loadReplayForRow(row, {
        replayStore: { listReplaySummaries: vi.fn(), getReplayLog },
        webAppBaseUrl: null,
        authSession: null,
      })
    ).resolves.toEqual(log);
    expect(getReplayLog).toHaveBeenCalledWith("ingame", "game-1");
  });

  it("requires the platform session used by an online row", async () => {
    const request = loadReplayForRow(
      { ...row, mode: "online", replayUrl: "/watch/replay/game-1" },
      {
        replayStore: null,
        webAppBaseUrl: "https://play.example.com",
        authSession: null,
      }
    );

    await expect(request).rejects.toBeInstanceOf(ReplayLoadError);
    await expect(request).rejects.toMatchObject({
      code: "authentication_required",
    });
  });

  it("reports a missing local replay", async () => {
    const request = loadReplayForRow(row, {
      replayStore: {
        listReplaySummaries: vi.fn(),
        getReplayLog: vi.fn().mockResolvedValue(null),
      },
      webAppBaseUrl: null,
      authSession: session,
    });

    await expect(request).rejects.toMatchObject({ code: "not_found" });
  });

  it("distinguishes an undeployed online detail route", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      })
    );

    const request = loadReplayForRow(
      { ...row, mode: "online", replayUrl: "/watch/replay/game-1" },
      {
        replayStore: null,
        webAppBaseUrl: "https://play.example.com",
        authSession: session,
      }
    );

    await expect(request).rejects.toMatchObject({
      code: "server_update_required",
    });
    fetcher.mockRestore();
  });
});

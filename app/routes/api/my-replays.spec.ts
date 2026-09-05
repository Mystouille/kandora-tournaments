import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrincipal: vi.fn(),
  getMyReplaysApiResponse: vi.fn(),
}));

vi.mock("~/utils/requestAuth.server", () => ({
  getAuthenticatedPrincipal: mocks.getAuthenticatedPrincipal,
}));
vi.mock("~/services/myReplaysApi.server", () => ({
  getMyReplaysApiResponse: mocks.getMyReplaysApiResponse,
}));

import { action, loader } from "./my-replays";

const replayResponse = {
  replays: [
    {
      key: "tenhou:game-1",
      source: "tenhou",
      sourceGameId: "game-1",
      reasons: ["played"],
      gameDate: 1_700_000_000_000,
      seats: [
        {
          seat: 1,
          displayName: "Alice",
          finalScore: 41_200,
          place: 1,
        },
      ],
      context: { kind: "tournament", tournamentName: "Summer Cup" },
      ruleset: { id: "wrc", label: "WRC" },
      replayUrl: "/watch/replay/game-1",
      commentCount: 2,
      reviews: [
        {
          key: "review:one",
          shortId: "one",
          reviewedPlayerName: "Alice",
          reasons: ["commented", "reviewed"],
          lastModified: 1_700_000_000_100,
          commentCount: 2,
          reviewUrl: "/watch/replay/game-1?review=one",
        },
      ],
    },
  ],
};

describe("common My Replays API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMyReplaysApiResponse.mockResolvedValue(replayResponse);
  });

  it("returns the same replay contract for web and mobile sessions", async () => {
    mocks.getAuthenticatedPrincipal
      .mockResolvedValueOnce({ userId: "user-1", transport: "web-cookie" })
      .mockResolvedValueOnce({ userId: "user-1", transport: "game-token" });

    const web = await loader({
      request: new Request("https://app.test/api/my-replays"),
    });
    const mobile = await action({
      request: new Request("https://app.test/api/my-replays", {
        method: "POST",
        body: new URLSearchParams({ token: "game-token" }),
      }),
    });

    expect(web.status).toBe(200);
    expect(mobile.status).toBe(200);
    await expect(web.json()).resolves.toEqual(replayResponse);
    await expect(mobile.json()).resolves.toEqual(replayResponse);
    expect(mocks.getAuthenticatedPrincipal).toHaveBeenNthCalledWith(
      1,
      expect.any(Request),
      { transport: "web-cookie" }
    );
    expect(mocks.getAuthenticatedPrincipal).toHaveBeenNthCalledWith(
      2,
      expect.any(Request),
      { transport: "game-token", token: "game-token" }
    );
    expect(mocks.getMyReplaysApiResponse).toHaveBeenCalledTimes(2);
  });

  it("returns stable authentication and missing-user failures", async () => {
    mocks.getAuthenticatedPrincipal.mockResolvedValueOnce(null);
    const missing = await loader({
      request: new Request("https://app.test/api/my-replays"),
    });
    expect(missing.status).toBe(401);

    mocks.getAuthenticatedPrincipal.mockResolvedValueOnce({
      userId: "deleted-user",
      transport: "game-token",
    });
    mocks.getMyReplaysApiResponse.mockResolvedValueOnce(null);
    const deleted = await action({
      request: new Request("https://app.test/api/my-replays", {
        method: "POST",
        body: new URLSearchParams({ token: "game-token" }),
      }),
    });
    expect(deleted.status).toBe(401);
  });

  it("contains service failures and handles OPTIONS", async () => {
    mocks.getAuthenticatedPrincipal.mockResolvedValue({
      userId: "user-1",
      transport: "game-token",
    });
    const error = new Error("database offline");
    mocks.getMyReplaysApiResponse.mockRejectedValueOnce(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const failed = await action({
      request: new Request("https://app.test/api/my-replays", {
        method: "POST",
        body: new URLSearchParams({ token: "game-token" }),
      }),
    });
    expect(failed.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to load My Replays:",
      error
    );
    consoleError.mockRestore();

    const options = await action({
      request: new Request("https://app.test/api/my-replays", {
        method: "OPTIONS",
      }),
    });
    expect(options.status).toBe(204);
  });
});

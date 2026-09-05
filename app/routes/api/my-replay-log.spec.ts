import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrincipal: vi.fn(),
  getMyReplayLogApiResponse: vi.fn(),
}));

vi.mock("~/utils/requestAuth.server", () => ({
  getAuthenticatedPrincipal: mocks.getAuthenticatedPrincipal,
}));
vi.mock("~/services/myReplaysApi.server", () => ({
  getMyReplayLogApiResponse: mocks.getMyReplayLogApiResponse,
}));

import { action, loader } from "./my-replay-log";

const logResponse = {
  log: {
    source: "ingame",
    sourceGameId: "game-1",
    ruleSet: "m-league",
    startedAt: 1_000,
    endedAt: 2_000,
    seats: [],
    events: [],
    schemaVersion: 6,
  },
  seatEnrichment: [
    {
      teamName: "East Club",
      teamLogoUrl: "/api/uploads/east.webp",
    },
    null,
    null,
    null,
  ],
  review: null,
};

describe("common My Replay log API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMyReplayLogApiResponse.mockResolvedValue({
      status: "found",
      response: logResponse,
    });
  });

  it("uses web-cookie auth for GET and game-token auth for POST", async () => {
    mocks.getAuthenticatedPrincipal
      .mockResolvedValueOnce({ userId: "user-1", transport: "web-cookie" })
      .mockResolvedValueOnce({ userId: "user-1", transport: "game-token" });

    const web = await loader({
      request: new Request(
        "https://app.test/api/my-replays/log?source=ingame&sourceGameId=game-1"
      ),
    });
    const mobile = await action({
      request: new Request("https://app.test/api/my-replays/log", {
        method: "POST",
        body: new URLSearchParams({
          token: "game-token",
          source: "ingame",
          sourceGameId: "game-1",
          reviewShortId: "review-1",
        }),
      }),
    });

    expect(web.status).toBe(200);
    expect(mobile.status).toBe(200);
    await expect(web.json()).resolves.toEqual(logResponse);
    await expect(mobile.json()).resolves.toEqual(logResponse);
    expect(mocks.getMyReplayLogApiResponse).toHaveBeenNthCalledWith(
      1,
      "user-1",
      "ingame",
      "game-1",
      null
    );
    expect(mocks.getMyReplayLogApiResponse).toHaveBeenNthCalledWith(
      2,
      "user-1",
      "ingame",
      "game-1",
      "review-1"
    );
  });

  it("validates identity and maps an unrelated replay to not found", async () => {
    mocks.getAuthenticatedPrincipal.mockResolvedValue({
      userId: "user-1",
      transport: "game-token",
    });
    const invalid = await action({
      request: new Request("https://app.test/api/my-replays/log", {
        method: "POST",
        body: new URLSearchParams({ token: "game-token", source: "bad" }),
      }),
    });
    expect(invalid.status).toBe(400);

    mocks.getMyReplayLogApiResponse.mockResolvedValueOnce({
      status: "not_found",
    });
    const missing = await action({
      request: new Request("https://app.test/api/my-replays/log", {
        method: "POST",
        body: new URLSearchParams({
          token: "game-token",
          source: "tenhou",
          sourceGameId: "private-game",
        }),
      }),
    });
    expect(missing.status).toBe(404);

    mocks.getMyReplayLogApiResponse.mockResolvedValueOnce({
      status: "review_not_found",
    });
    const missingReview = await action({
      request: new Request("https://app.test/api/my-replays/log", {
        method: "POST",
        body: new URLSearchParams({
          token: "game-token",
          source: "tenhou",
          sourceGameId: "private-game",
          reviewShortId: "missing-review",
        }),
      }),
    });
    expect(missingReview.status).toBe(404);
    await expect(missingReview.json()).resolves.toEqual({
      error: "review_not_found",
    });
  });

  it("rejects missing auth and handles OPTIONS", async () => {
    mocks.getAuthenticatedPrincipal.mockResolvedValueOnce(null);
    const unauthorized = await loader({
      request: new Request(
        "https://app.test/api/my-replays/log?source=ingame&sourceGameId=game-1"
      ),
    });
    expect(unauthorized.status).toBe(401);

    const options = await action({
      request: new Request("https://app.test/api/my-replays/log", {
        method: "OPTIONS",
      }),
    });
    expect(options.status).toBe(204);
  });
});

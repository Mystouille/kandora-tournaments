import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrincipal: vi.fn(),
  resolveReplayViewerData: vi.fn(),
}));

vi.mock("~/utils/requestAuth.server", () => ({
  getAuthenticatedPrincipal: mocks.getAuthenticatedPrincipal,
}));
vi.mock("~/services/replayViewerData.server", () => ({
  resolveReplayViewerData: mocks.resolveReplayViewerData,
}));

import { action, loader } from "./replay-log";

const found = {
  status: "found",
  canonicalGameId: "game-1",
  resolvedSeat: 2,
  log: {
    source: "tenhou",
    sourceGameId: "game-1",
    ruleSet: "tenhou",
    startedAt: 1,
    endedAt: 2,
    seats: [],
    events: [],
    schemaVersion: 6,
  },
  seatEnrichment: [
    { teamName: "East", teamLogoUrl: "/api/uploads/east.webp" },
    null,
    null,
    null,
  ],
  review: null,
};

describe("direct replay log API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedPrincipal.mockResolvedValue(null);
    mocks.resolveReplayViewerData.mockResolvedValue(found);
  });

  it("allows an anonymous cached replay", async () => {
    const response = await loader({
      request: new Request(
        "https://app.test/api/replays/log?gameId=game-1&reviewShortId=review-1"
      ),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toMatchObject({
      canonicalGameId: "game-1",
      resolvedSeat: 2,
      review: null,
    });
    expect(mocks.resolveReplayViewerData).toHaveBeenCalledWith({
      gameId: "game-1",
      reviewShortId: "review-1",
      userId: null,
    });
  });

  it("returns public review annotations without internal identities", async () => {
    mocks.resolveReplayViewerData.mockResolvedValue({
      ...found,
      review: {
        shortId: "review-1",
        source: "tenhou",
        sourceGameId: "game-1",
        createdBy: "private-owner-id",
        seat: 2,
        target: { name: "South" },
        reviewers: [{ user: "private-reviewer-id", name: "Alice" }],
        edits: [
          {
            eventIndex: 12,
            author: "private-reviewer-id",
            authorName: "Alice",
            colorIndex: 0,
            text: "Call here",
            drawingBase64: null,
            updatedAt: "2026-09-08T00:00:00.000Z",
          },
        ],
      },
    });

    const response = await loader({
      request: new Request(
        "https://app.test/api/replays/log?gameId=game-1&reviewShortId=review-1"
      ),
    });
    const body = await response.json();

    expect(body.review).toEqual({
      shortId: "review-1",
      seat: 2,
      targetName: "South",
      edits: [
        {
          eventIndex: 12,
          authorName: "Alice",
          colorIndex: 0,
          text: "Call here",
          drawingBase64: null,
          updatedAt: "2026-09-08T00:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("private-");
  });

  it("reports authentication required for an anonymous cache miss", async () => {
    mocks.resolveReplayViewerData.mockResolvedValue({
      status: "authentication_required",
      canonicalGameId: "game-1",
    });

    const response = await action({
      request: new Request("https://app.test/api/replays/log", {
        method: "POST",
        body: new URLSearchParams({ gameId: "game-1" }),
      }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "authentication_required",
    });
  });

  it("uses a valid game token to attribute a cache miss", async () => {
    mocks.getAuthenticatedPrincipal.mockResolvedValue({
      userId: "user-1",
      transport: "game-token",
    });

    const response = await action({
      request: new Request("https://app.test/api/replays/log", {
        method: "POST",
        body: new URLSearchParams({
          token: "game-token",
          gameId: "game-1",
        }),
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.resolveReplayViewerData).toHaveBeenCalledWith({
      gameId: "game-1",
      reviewShortId: null,
      userId: "user-1",
    });
  });

  it("rejects invalid tokens and handles OPTIONS", async () => {
    const invalid = await action({
      request: new Request("https://app.test/api/replays/log", {
        method: "POST",
        body: new URLSearchParams({ token: "expired", gameId: "game-1" }),
      }),
    });
    expect(invalid.status).toBe(401);

    const options = await action({
      request: new Request("https://app.test/api/replays/log", {
        method: "OPTIONS",
      }),
    });
    expect(options.status).toBe(204);
  });
});

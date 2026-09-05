import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  getMyReplays: vi.fn(),
  findReplay: vi.fn(),
  findReview: vi.fn(),
  resolveSeatEnrichmentForReplay: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("./myReplays.server", () => ({
  getMyReplays: mocks.getMyReplays,
}));
vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: { findOne: mocks.findReplay },
}));
vi.mock("~/core/models/game/ReplayReview", () => ({
  ReplayReviewModel: { findOne: mocks.findReview },
}));
vi.mock("./replayEnrichment.server", () => ({
  resolveSeatEnrichmentForReplay: mocks.resolveSeatEnrichmentForReplay,
}));

import {
  getMyReplayLogApiResponse,
  getMyReplaysApiResponse,
} from "./myReplaysApi.server";

function queryResult(value: unknown) {
  return {
    lean: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(value),
    }),
  };
}

describe("My Replays API service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.resolveSeatEnrichmentForReplay.mockResolvedValue([
      null,
      null,
      null,
      null,
    ]);
  });

  it("loads the canonical replay groups after connecting", async () => {
    const replays = [{ key: "tenhou:game-1", reviews: [] }];
    mocks.getMyReplays.mockResolvedValue(replays);

    await expect(getMyReplaysApiResponse("user-1")).resolves.toEqual({
      replays,
    });
    expect(mocks.connectToDatabase).toHaveBeenCalledOnce();
    expect(mocks.getMyReplays).toHaveBeenCalledWith("user-1");
  });

  it("preserves the missing-user result", async () => {
    mocks.getMyReplays.mockResolvedValue(null);

    await expect(getMyReplaysApiResponse("deleted-user")).resolves.toBeNull();
  });

  it("loads a related full replay without database-only seat ids", async () => {
    mocks.getMyReplays.mockResolvedValue([
      { source: "ingame", sourceGameId: "game-1" },
    ]);
    mocks.findReplay.mockReturnValue(
      queryResult({
        source: "ingame",
        sourceGameId: "game-1",
        ruleSet: "m-league",
        startedAt: 1_000,
        endedAt: 2_000,
        seats: [0, 1, 2, 3].map((seat) => ({
          seat,
          userDbId: `private-${seat}`,
          displayName: `Player ${seat}`,
          finalScore: 40_000 - seat * 10_000,
          place: seat + 1,
        })),
        events: [
          {
            type: "hand_start",
            round: 0,
            dealer: 0,
            hand: null,
            doraIndicators: ["1m"],
          },
          {
            type: "win",
            seat: 0,
            uraDoraIndicators: null,
          },
        ],
        schemaVersion: 6,
      })
    );
    mocks.resolveSeatEnrichmentForReplay.mockResolvedValue([
      {
        teamName: "East Club",
        teamLogoUrl: "/api/uploads/east.webp",
      },
      null,
      null,
      null,
    ]);

    const result = await getMyReplayLogApiResponse(
      "user-1",
      "ingame",
      "game-1"
    );

    expect(result).toMatchObject({
      status: "found",
      response: {
        log: { source: "ingame", sourceGameId: "game-1" },
        seatEnrichment: [
          {
            teamName: "East Club",
            teamLogoUrl: "/api/uploads/east.webp",
          },
          null,
          null,
          null,
        ],
      },
    });
    if (result.status === "found") {
      expect(result.response.log.seats[0]).not.toHaveProperty("userDbId");
      expect(result.response.log.events[0]).not.toHaveProperty("hand");
      expect(result.response.log.events[1]).not.toHaveProperty(
        "uraDoraIndicators"
      );
    }
    expect(mocks.resolveSeatEnrichmentForReplay).toHaveBeenCalledWith(
      "game-1",
      expect.arrayContaining([
        expect.objectContaining({ displayName: "Player 0" }),
      ])
    );
  });

  it("does not load replay payloads outside the user's library", async () => {
    mocks.getMyReplays.mockResolvedValue([
      { source: "tenhou", sourceGameId: "another-game" },
    ]);

    await expect(
      getMyReplayLogApiResponse("user-1", "tenhou", "private-game")
    ).resolves.toEqual({ status: "not_found" });
    expect(mocks.findReplay).not.toHaveBeenCalled();
  });

  it("loads only a review listed under the related replay", async () => {
    mocks.getMyReplays.mockResolvedValue([
      {
        source: "ingame",
        sourceGameId: "game-1",
        reviews: [{ shortId: "review-1" }],
      },
    ]);
    mocks.findReplay.mockReturnValue(
      queryResult({
        source: "ingame",
        sourceGameId: "game-1",
        ruleSet: "m-league",
        startedAt: 1_000,
        endedAt: 2_000,
        seats: [],
        events: [],
        schemaVersion: 6,
      })
    );
    mocks.findReview.mockReturnValue(
      queryResult({
        shortId: "review-1",
        source: "ingame",
        sourceGameId: "game-1",
        createdBy: "author-1",
        seat: 2,
        target: { name: "Player 2" },
        reviewers: [{ user: "author-1", name: "Reviewer" }],
        edits: [
          {
            eventIndex: 4,
            author: "author-1",
            text: "<p>Keep this shape.</p>",
            updatedAt: new Date("2026-01-02T03:04:05.000Z"),
          },
        ],
      })
    );

    const result = await getMyReplayLogApiResponse(
      "user-1",
      "ingame",
      "game-1",
      "review-1"
    );

    expect(result).toMatchObject({
      status: "found",
      response: {
        review: {
          shortId: "review-1",
          seat: 2,
          targetName: "Player 2",
          edits: [
            {
              eventIndex: 4,
              authorName: "Reviewer",
              colorIndex: 0,
              text: "<p>Keep this shape.</p>",
              drawingBase64: null,
              updatedAt: "2026-01-02T03:04:05.000Z",
            },
          ],
        },
      },
    });
    if (result.status === "found") {
      expect(result.response.review).not.toHaveProperty("createdBy");
      expect(result.response.review?.edits[0]).not.toHaveProperty("author");
    }
  });

  it("rejects a review that is not listed under the related replay", async () => {
    mocks.getMyReplays.mockResolvedValue([
      {
        source: "ingame",
        sourceGameId: "game-1",
        reviews: [{ shortId: "review-1" }],
      },
    ]);

    await expect(
      getMyReplayLogApiResponse("user-1", "ingame", "game-1", "another-review")
    ).resolves.toEqual({ status: "review_not_found" });
    expect(mocks.findReplay).not.toHaveBeenCalled();
    expect(mocks.findReview).not.toHaveBeenCalled();
  });
});

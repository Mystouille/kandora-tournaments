import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  fetchOrphanReplayLog: vi.fn(),
  findReplay: vi.fn(),
  findReview: vi.fn(),
  resolveSeatEnrichmentForReplay: vi.fn(),
  resolveReviewersForDoc: vi.fn(),
  serializeReview: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: { findOne: mocks.findReplay },
}));
vi.mock("~/core/models/game/ReplayReview", () => ({
  ReplayReviewModel: { findOne: mocks.findReview },
}));
vi.mock("./fetchOrphanReplayLog.server", () => ({
  fetchOrphanReplayLog: mocks.fetchOrphanReplayLog,
}));
vi.mock("./replayEnrichment.server", () => ({
  resolveSeatEnrichmentForReplay: mocks.resolveSeatEnrichmentForReplay,
}));
vi.mock("./replayReview.server", () => ({
  resolveReviewersForDoc: mocks.resolveReviewersForDoc,
  serializeReview: mocks.serializeReview,
}));

import { resolveReplayViewerData } from "./replayViewerData.server";

function queryResult(value: unknown) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  };
  query.lean.mockReturnValue(query);
  return query;
}

function replay(sourceGameId: string) {
  return {
    source: "riichicity",
    sourceGameId,
    ruleSet: "riichicity",
    startedAt: 100,
    endedAt: 200,
    seats: [0, 1, 2, 3].map((seat) => ({
      seat,
      userDbId: `private-${seat}`,
      displayName: `Player ${seat}`,
      finalScore: 25_000,
      place: seat + 1,
    })),
    events: [
      {
        type: "hand_start",
        roundWind: "E",
        roundNumber: 1,
        honba: 0,
        riichiSticks: 0,
        dealer: 2,
        doraIndicator: "1m",
        scores: [25_000, 25_000, 25_000, 25_000],
      },
    ],
    schemaVersion: 6,
  };
}

describe("replay viewer data resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.findReview.mockReturnValue(queryResult(null));
    mocks.resolveSeatEnrichmentForReplay.mockResolvedValue([
      null,
      null,
      null,
      null,
    ]);
  });

  it("returns a sanitized anonymous cache hit and resolves a Riichi City wind", async () => {
    const gameId = "cknnf9eai08auidimj2g";
    mocks.findReplay.mockReturnValue(queryResult(replay(gameId)));

    const result = await resolveReplayViewerData({ gameId: `${gameId}@3` });

    expect(result.status).toBe("found");
    if (result.status !== "found") {
      throw new Error("expected replay data");
    }
    expect(result.canonicalGameId).toBe(gameId);
    expect(result.resolvedSeat).toBe(1);
    expect(result.log.seats[0]).not.toHaveProperty("userDbId");
    expect(mocks.fetchOrphanReplayLog).not.toHaveBeenCalled();
  });

  it("returns the canonical id for an alias hit", async () => {
    const canonicalGameId = "2026082503gm-0009-19370-0e3a95d1";
    mocks.findReplay.mockReturnValue(
      queryResult({ ...replay(canonicalGameId), source: "tenhou" })
    );

    const result = await resolveReplayViewerData({ gameId: "66b555f2" });

    expect(result.status).toBe("found");
    expect(result.canonicalGameId).toBe(canonicalGameId);
    expect(mocks.findReplay).toHaveBeenCalledWith({
      $or: [
        { sourceGameId: "66b555f2" },
        { sourceGameIdAliases: { $in: ["66b555f2", "66B555F2"] } },
      ],
    });
  });

  it("requires authentication before fetching a cache miss", async () => {
    const gameId = "2026041906gm-0001-14853-b8890fb3";
    mocks.findReplay.mockReturnValue(queryResult(null));

    await expect(resolveReplayViewerData({ gameId })).resolves.toEqual({
      status: "authentication_required",
      canonicalGameId: gameId,
    });
    expect(mocks.fetchOrphanReplayLog).not.toHaveBeenCalled();
  });

  it("fetches and attributes an authenticated cache miss", async () => {
    const gameId = "2026041906gm-0001-14853-b8890fb3";
    mocks.findReplay.mockReturnValue(queryResult(null));
    mocks.fetchOrphanReplayLog.mockResolvedValue({
      ...replay(gameId),
      source: "tenhou",
    });

    const result = await resolveReplayViewerData({
      gameId,
      userId: "507f1f77bcf86cd799439011",
    });

    expect(result.status).toBe("found");
    expect(mocks.fetchOrphanReplayLog).toHaveBeenCalledWith(
      "tenhou",
      gameId,
      "507f1f77bcf86cd799439011"
    );
  });

  it("loads only a review bound to the canonical replay identity", async () => {
    const gameId = "2026041906gm-0001-14853-b8890fb3";
    const reviewDoc = {
      shortId: "review-1",
      source: "tenhou",
      sourceGameId: gameId,
      createdBy: "user-1",
      edits: [],
    };
    mocks.findReplay.mockReturnValue(
      queryResult({ ...replay(gameId), source: "tenhou" })
    );
    mocks.findReview.mockReturnValue(queryResult(reviewDoc));
    mocks.resolveReviewersForDoc.mockResolvedValue([]);
    mocks.serializeReview.mockReturnValue({
      ...reviewDoc,
      seat: 2,
      reviewers: [],
      edits: [],
    });

    const result = await resolveReplayViewerData({
      gameId,
      reviewShortId: "review-1",
    });

    expect(mocks.findReview).toHaveBeenCalledWith({
      shortId: "review-1",
      source: "tenhou",
      sourceGameId: gameId,
    });
    expect(result).toMatchObject({
      status: "found",
      review: { shortId: "review-1", seat: 2 },
    });
  });
});

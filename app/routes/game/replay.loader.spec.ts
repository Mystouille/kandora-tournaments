import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findReplay: vi.fn(),
  fetchOrphanReplayLog: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  resolveSeatEnrichmentForReplay: vi.fn(),
  annotateWaits: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: { findOne: mocks.findReplay },
}));
vi.mock("~/core/models/game/ReplayReview", () => ({
  ReplayReviewModel: { findOne: vi.fn() },
}));
vi.mock("~/services/fetchOrphanReplayLog.server", () => ({
  fetchOrphanReplayLog: mocks.fetchOrphanReplayLog,
}));
vi.mock("~/utils/jwt.server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("~/services/replayEnrichment.server", () => ({
  resolveSeatEnrichmentForReplay: mocks.resolveSeatEnrichmentForReplay,
}));
vi.mock("~/services/annotateWaits", () => ({
  annotateWaits: mocks.annotateWaits,
}));
vi.mock("~/services/replayReview.server", () => ({
  resolveReviewersForDoc: vi.fn(),
  serializeReview: vi.fn(),
}));

import { loader } from "./replay";

function findResult(value: unknown) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  };
  query.lean.mockReturnValue(query);
  return query;
}

const gameId = "2026041906gm-0001-14853-b8890fb3";

function loaderArgs() {
  return {
    request: new Request(`http://app.test/watch/replay/${gameId}`),
    params: { gameId },
    context: {},
    unstable_pattern: "/watch/replay/:gameId",
  };
}

describe("replay viewer cache authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    mocks.resolveSeatEnrichmentForReplay.mockResolvedValue([]);
    mocks.annotateWaits.mockReturnValue([]);
    mocks.fetchOrphanReplayLog.mockResolvedValue({
      source: "tenhou",
      sourceGameId: gameId,
      ruleSet: "tenhou",
      startedAt: 100,
      endedAt: 200,
      seats: [],
      events: [],
      schemaVersion: 5,
    });
  });

  it("allows an anonymous cache hit", async () => {
    mocks.findReplay.mockReturnValue(
      findResult({
        source: "tenhou",
        sourceGameId: gameId,
        ruleSet: "tenhou",
        startedAt: 100,
        endedAt: 200,
        seats: [
          {
            seat: 0,
            userDbId: "507f1f77bcf86cd799439011",
            displayName: "Alice",
            finalScore: 30_000,
            place: 1,
          },
        ],
        events: [],
        schemaVersion: 5,
      })
    );

    const result = await loader(loaderArgs());

    expect(result.log.sourceGameId).toBe(gameId);
    expect(result.log.seats[0]).not.toHaveProperty("userDbId");
    expect(mocks.fetchOrphanReplayLog).not.toHaveBeenCalled();
  });

  it("redirects an anonymous cache miss before fetch", async () => {
    mocks.findReplay.mockReturnValue(findResult(null));
    let thrown: unknown;

    try {
      await loader(loaderArgs());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe(
      `/sign-in?mode=auth&returnTo=%2Fwatch%2Freplay%2F${gameId}`
    );
    expect(mocks.fetchOrphanReplayLog).not.toHaveBeenCalled();
  });

  it("attributes an authenticated cache miss", async () => {
    mocks.findReplay.mockReturnValue(findResult(null));
    mocks.getAuthenticatedUser.mockResolvedValue({
      sub: "507f1f77bcf86cd799439011",
      username: "Alice",
    });

    const result = await loader(loaderArgs());

    expect(result.log.sourceGameId).toBe(gameId);
    expect(mocks.fetchOrphanReplayLog).toHaveBeenCalledWith(
      "tenhou",
      gameId,
      "507f1f77bcf86cd799439011"
    );
  });
});

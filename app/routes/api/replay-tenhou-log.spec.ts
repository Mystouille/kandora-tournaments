import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findReplay: vi.fn(),
  fetchOrphanReplayLog: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  replayLogToTenhou5Json: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: { findOne: mocks.findReplay },
}));
vi.mock("~/services/fetchOrphanReplayLog.server", () => ({
  fetchOrphanReplayLog: mocks.fetchOrphanReplayLog,
}));
vi.mock("~/utils/jwt.server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("~/game/replay/replayLogToTenhou5Json", () => ({
  replayLogToTenhou5Json: mocks.replayLogToTenhou5Json,
}));
vi.mock("~/services/telemetry.server", () => ({
  trackEvent: mocks.trackEvent,
}));

import { loader } from "./replay-tenhou-log";

function findResult(value: unknown) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  };
  query.lean.mockReturnValue(query);
  return query;
}

const gameId = "cknnf9eai08auidimj2g";

function exportRequest(): Request {
  return new Request(`http://app.test/api/replay-tenhou-log?gameId=${gameId}`);
}

describe("Riichi City export cache authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    mocks.fetchOrphanReplayLog.mockResolvedValue({
      source: "riichicity",
      sourceGameId: gameId,
    });
    mocks.replayLogToTenhou5Json.mockReturnValue({ log: [] });
  });

  it("allows an anonymous cached export", async () => {
    mocks.findReplay.mockReturnValue(
      findResult({ source: "riichicity", sourceGameId: gameId })
    );

    const response = await loader({
      request: exportRequest(),
      params: {},
      context: {},
      unstable_pattern: "/api/replay-tenhou-log",
    });

    expect(response.status).toBe(200);
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(mocks.fetchOrphanReplayLog).not.toHaveBeenCalled();
  });

  it("blocks an anonymous cache miss before fetch", async () => {
    mocks.findReplay.mockReturnValue(findResult(null));

    const response = await loader({
      request: exportRequest(),
      params: {},
      context: {},
      unstable_pattern: "/api/replay-tenhou-log",
    });

    expect(response.status).toBe(401);
    expect(mocks.fetchOrphanReplayLog).not.toHaveBeenCalled();
  });

  it("attributes an authenticated cache miss", async () => {
    mocks.findReplay.mockReturnValue(findResult(null));
    mocks.getAuthenticatedUser.mockResolvedValue({
      sub: "507f1f77bcf86cd799439011",
    });

    const response = await loader({
      request: exportRequest(),
      params: {},
      context: {},
      unstable_pattern: "/api/replay-tenhou-log",
    });

    expect(response.status).toBe(200);
    expect(mocks.fetchOrphanReplayLog).toHaveBeenCalledWith(
      "riichicity",
      gameId,
      "507f1f77bcf86cd799439011"
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findReplay: vi.fn(),
  fetchOrphanReplayLog: vi.fn(),
  getAuthenticatedUser: vi.fn(),
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
vi.mock("~/services/telemetry.server", () => ({
  trackEvent: mocks.trackEvent,
}));

import { action } from "./review";

function findResult(value: unknown) {
  const query = {
    select: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  };
  query.select.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return query;
}

function importRequest(): Request {
  const form = new FormData();
  form.set("gameId", "2026041906gm-0001-14853-b8890fb3");
  return new Request("http://app.test/review", {
    method: "POST",
    body: form,
  });
}

describe("review replay import authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    mocks.fetchOrphanReplayLog.mockResolvedValue({
      source: "tenhou",
      sourceGameId: "2026041906gm-0001-14853-b8890fb3",
    });
  });

  it("allows an anonymous cache hit", async () => {
    mocks.findReplay.mockReturnValue(findResult({ _id: "replay-1" }));

    const response = await action({ request: importRequest() });

    expect(response.status).toBe(200);
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(mocks.fetchOrphanReplayLog).not.toHaveBeenCalled();
  });

  it("blocks an anonymous cache miss before platform fetch", async () => {
    mocks.findReplay.mockReturnValue(findResult(null));

    const response = await action({ request: importRequest() });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "unauthorized",
    });
    expect(mocks.fetchOrphanReplayLog).not.toHaveBeenCalled();
  });

  it("attributes an authenticated cache miss", async () => {
    mocks.findReplay.mockReturnValue(findResult(null));
    mocks.getAuthenticatedUser.mockResolvedValue({
      sub: "507f1f77bcf86cd799439011",
    });

    const response = await action({ request: importRequest() });

    expect(response.status).toBe(200);
    expect(mocks.fetchOrphanReplayLog).toHaveBeenCalledWith(
      "tenhou",
      "2026041906gm-0001-14853-b8890fb3",
      "507f1f77bcf86cd799439011"
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";

const mocks = vi.hoisted(() => ({
  findOneAndUpdate: vi.fn(),
  getReplayLog: vi.fn(),
}));

vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: { findOneAndUpdate: mocks.findOneAndUpdate },
}));

vi.mock("~/services/connectors/MajsoulLeagueConnector.server", () => ({
  MajsoulLeagueConnector: { instance: { getReplayLog: mocks.getReplayLog } },
}));

vi.mock("~/services/connectors/TenhouLeagueConnector.server", () => ({
  TenhouLeagueConnector: { instance: { getReplayLog: mocks.getReplayLog } },
}));

vi.mock("~/services/connectors/RiichiCityLeagueConnector.server", () => ({
  RiichiCityLeagueConnector: {
    instance: { getReplayLog: mocks.getReplayLog },
  },
}));

import { fetchOrphanReplayLog } from "./fetchOrphanReplayLog.server";

describe("fetchOrphanReplayLog provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOneAndUpdate.mockResolvedValue({ _id: "replay-1" });
    mocks.getReplayLog.mockResolvedValue({
      source: "tenhou",
      sourceGameId: "game-1",
      ruleSet: "tenhou",
      startedAt: 100,
      endedAt: 200,
      seats: [],
      events: [],
      schemaVersion: 5,
    });
  });

  it("records the triggering user only on insert", async () => {
    await expect(
      fetchOrphanReplayLog("tenhou", "game-1", "507f1f77bcf86cd799439011")
    ).resolves.toMatchObject({ sourceGameId: "game-1" });

    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
      { source: "tenhou", sourceGameId: "game-1" },
      expect.objectContaining({
        $setOnInsert: {
          creationTriggeredBy: expect.any(mongoose.Types.ObjectId),
        },
        $set: expect.objectContaining({ sourceGameId: "game-1" }),
      }),
      { upsert: true, new: true }
    );
  });

  it("does not write when the platform has no replay", async () => {
    mocks.getReplayLog.mockResolvedValue(null);

    await expect(
      fetchOrphanReplayLog("tenhou", "missing", "507f1f77bcf86cd799439011")
    ).resolves.toBeNull();
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects invalid initiators before platform fetch", async () => {
    await expect(
      fetchOrphanReplayLog("tenhou", "game-1", "not-a-user-id")
    ).rejects.toThrow(/valid user id/);
    expect(mocks.getReplayLog).not.toHaveBeenCalled();
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

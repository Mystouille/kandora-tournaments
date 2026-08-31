import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findReplay: vi.fn(),
  findMatch: vi.fn(),
  findUser: vi.fn(),
  findUsers: vi.fn(),
}));

vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: { findOne: mocks.findReplay },
}));
vi.mock("~/core/models/game/Match", () => ({
  MatchModel: { findOne: mocks.findMatch },
}));
vi.mock("~/core/models/shared/User", () => ({
  UserModel: { findOne: mocks.findUser, find: mocks.findUsers },
}));

import { resolveReplayReviewTarget } from "./replayReviewTarget.server";

function queryResult(value: unknown) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  };
  query.lean.mockReturnValue(query);
  return query;
}

function limitedQueryResult(value: unknown) {
  const query = {
    limit: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  };
  query.limit.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return query;
}

describe("resolveReplayReviewTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findReplay.mockReturnValue(queryResult(null));
    mocks.findMatch.mockReturnValue(queryResult(null));
    mocks.findUser.mockReturnValue(queryResult(null));
    mocks.findUsers.mockReturnValue(limitedQueryResult([]));
  });

  it("stores the canonical user and current user name for a linked platform identity", async () => {
    const userId = new mongoose.Types.ObjectId();
    mocks.findReplay.mockReturnValue(
      queryResult({ seats: [{ seat: 2, displayName: "PlatformName" }] })
    );
    mocks.findUsers.mockReturnValue(
      limitedQueryResult([{ _id: userId, name: "Canonical Name" }])
    );

    await expect(
      resolveReplayReviewTarget({
        source: "tenhou",
        sourceGameId: "game-1",
        seat: 2,
      })
    ).resolves.toEqual({ user: userId, name: "Canonical Name" });
    expect(mocks.findUsers).toHaveBeenCalledWith(
      {
        "tenhouIdentity.name": "PlatformName",
        isDeleted: { $ne: true },
      },
      { _id: 1, name: 1 }
    );
  });

  it("stores the platform username when it is not linked", async () => {
    mocks.findReplay.mockReturnValue(
      queryResult({ seats: [{ seat: 1, displayName: "GuestName" }] })
    );

    await expect(
      resolveReplayReviewTarget({
        source: "majsoul",
        sourceGameId: "game-2",
        seat: 1,
      })
    ).resolves.toEqual({ name: "GuestName" });
  });

  it("does not link an ambiguous platform username", async () => {
    mocks.findReplay.mockReturnValue(
      queryResult({ seats: [{ seat: 1, displayName: "SharedName" }] })
    );
    mocks.findUsers.mockReturnValue(
      limitedQueryResult([
        { _id: new mongoose.Types.ObjectId(), name: "First" },
        { _id: new mongoose.Types.ObjectId(), name: "Second" },
      ])
    );

    await expect(
      resolveReplayReviewTarget({
        source: "riichicity",
        sourceGameId: "game-ambiguous",
        seat: 1,
      })
    ).resolves.toEqual({ name: "SharedName" });
  });

  it("prefers a replay seat user id over platform-name matching", async () => {
    const userId = new mongoose.Types.ObjectId();
    mocks.findReplay.mockReturnValue(
      queryResult({
        seats: [{ seat: 0, userDbId: userId, displayName: "Old Name" }],
      })
    );
    mocks.findUser.mockReturnValue(
      queryResult({ _id: userId, name: "Current Name" })
    );

    await expect(
      resolveReplayReviewTarget({
        source: "riichicity",
        sourceGameId: "game-3",
        seat: 0,
      })
    ).resolves.toEqual({ user: userId, name: "Current Name" });
    expect(mocks.findUser.mock.calls[0][0]).toMatchObject({ _id: userId });
  });

  it("uses the legacy native match seat when the replay has no user id", async () => {
    const userId = new mongoose.Types.ObjectId();
    mocks.findReplay.mockReturnValue(
      queryResult({ seats: [{ seat: 3, displayName: "Native Name" }] })
    );
    mocks.findMatch.mockReturnValue(
      queryResult({
        players: [
          { seat: 3, userId: userId.toString(), displayName: "Native Name" },
        ],
      })
    );
    mocks.findUser.mockReturnValue(
      queryResult({ _id: userId, name: "Current Native Name" })
    );

    await expect(
      resolveReplayReviewTarget({
        source: "ingame",
        sourceGameId: "native-1",
        seat: 3,
      })
    ).resolves.toEqual({ user: userId, name: "Current Native Name" });
  });
});

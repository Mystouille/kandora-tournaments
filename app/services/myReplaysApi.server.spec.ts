import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  getMyReplays: vi.fn(),
  findReplay: vi.fn(),
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
        events: [],
        schemaVersion: 6,
      })
    );

    const result = await getMyReplayLogApiResponse(
      "user-1",
      "ingame",
      "game-1"
    );

    expect(result).toMatchObject({
      status: "found",
      response: {
        log: { source: "ingame", sourceGameId: "game-1", events: [] },
      },
    });
    if (result.status === "found") {
      expect(result.response.log.seats[0]).not.toHaveProperty("userDbId");
    }
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  getMyReplays: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("./myReplays.server", () => ({
  getMyReplays: mocks.getMyReplays,
}));

import { getMyReplaysApiResponse } from "./myReplaysApi.server";

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
});

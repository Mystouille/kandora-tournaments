import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findReplayLogs: vi.fn(),
  requireGameEnabled: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: { find: mocks.findReplayLogs },
}));
vi.mock("~/game/feature-gate", () => ({
  requireGameEnabled: mocks.requireGameEnabled,
  getClientGameFlag: () => ({ gameEnabled: true }),
}));
vi.mock("~/game/rules/presets", () => ({
  listPresets: () => [
    {
      id: "buu-east",
      displayName: "Buu Mahjong - East",
      description: "Buu rules",
    },
  ],
}));

import { loader } from "./lobby";

describe("game lobby loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
  });

  it("loads the newest in-game replay logs for browsing", async () => {
    const exec = vi.fn().mockResolvedValue([
      {
        sourceGameId: "match-newest",
        ruleSet: "buu-east",
        startedAt: 1_777_000_000_000,
        endedAt: 1_777_000_900_000,
        seats: [
          {
            seat: 0,
            displayName: "East",
            finalScore: 41_200,
            place: 1,
          },
          {
            seat: 1,
            displayName: "South",
            finalScore: 28_800,
            place: 2,
          },
        ],
      },
    ]);
    const lean = vi.fn().mockReturnValue({ exec });
    const limit = vi.fn().mockReturnValue({ lean });
    const sort = vi.fn().mockReturnValue({ limit });
    mocks.findReplayLogs.mockReturnValue({ sort });

    const result = await loader();

    expect(mocks.requireGameEnabled).toHaveBeenCalledOnce();
    expect(mocks.connectToDatabase).toHaveBeenCalledOnce();
    expect(mocks.findReplayLogs).toHaveBeenCalledWith(
      { source: "ingame" },
      {
        sourceGameId: 1,
        ruleSet: 1,
        startedAt: 1,
        endedAt: 1,
        seats: 1,
      }
    );
    expect(sort).toHaveBeenCalledWith({ endedAt: -1 });
    expect(limit).toHaveBeenCalledWith(100);
    expect(result.gameLogs).toEqual([
      {
        gameId: "match-newest",
        ruleSet: "buu-east",
        startedAt: 1_777_000_000_000,
        endedAt: 1_777_000_900_000,
        seats: [
          {
            seat: 0,
            displayName: "East",
            finalScore: 41_200,
            place: 1,
          },
          {
            seat: 1,
            displayName: "South",
            finalScore: 28_800,
            place: 2,
          },
        ],
      },
    ]);
  });
});

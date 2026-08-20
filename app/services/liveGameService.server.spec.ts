import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  fetchLobbyWatchGames: vi.fn(),
  findUsers: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("~/core/models/tournament/LiveGame", () => ({
  LiveGameModel: {
    deleteMany: mocks.deleteMany,
    updateOne: mocks.updateOne,
  },
}));

vi.mock("~/core/models/shared/User", () => ({
  UserModel: { find: mocks.findUsers },
}));

vi.mock("~/api/tenhou/TenhouService.server", () => ({
  TenhouService: {
    instance: { fetchLobbyWatchGames: mocks.fetchLobbyWatchGames },
  },
}));

import { Platform, type League } from "~/core/models/tournament/League";
import { syncLiveGames } from "./liveGameService.server";

describe("syncLiveGames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchLobbyWatchGames.mockImplementation(async (lobbyId: string) => [
      {
        watchId: `watch-${lobbyId}`,
        players: ["east", "south", "west", "north"],
        ratings: [],
      },
    ]);
    mocks.findUsers.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    mocks.updateOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });
    mocks.deleteMany.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });
  });

  it("aggregates every phase lobby before upsert and cleanup", async () => {
    const league = {
      _id: "64b000000000000000000001",
      name: "Phased Cup",
      platformConfig: {
        platformName: Platform.TENHOU,
        tournamentId: "primary",
        phaseTournaments: [
          { phaseId: "regular", tournamentId: "regular" },
          { phaseId: "finals", tournamentId: "finals" },
        ],
      },
    } as unknown as League;

    await syncLiveGames(league, {} as never);

    expect(mocks.fetchLobbyWatchGames.mock.calls.map(([id]) => id)).toEqual([
      "regular",
      "finals",
    ]);
    expect(mocks.updateOne).toHaveBeenCalledTimes(2);
    expect(mocks.updateOne.mock.calls[0][1].$set.phaseId).toBe("regular");
    expect(mocks.updateOne.mock.calls[1][1].$set.phaseId).toBe("finals");
    expect(
      mocks.updateOne.mock.calls[0][1].$setOnInsert.startTime
    ).toBeInstanceOf(Date);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      league: league._id,
      gameId: { $nin: ["watch-regular", "watch-finals"] },
    });
  });
});
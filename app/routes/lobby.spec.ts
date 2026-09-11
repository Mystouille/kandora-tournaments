import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findLeagues: vi.fn(),
  findLiveGames: vi.fn(),
  findReplayLogs: vi.fn(),
  requireGameEnabled: vi.fn(),
  requireGameUser: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: { find: mocks.findReplayLogs },
}));
vi.mock("~/core/models/tournament/League", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/core/models/tournament/League")>();
  return { ...actual, LeagueModel: { find: mocks.findLeagues } };
});
vi.mock("~/core/models/tournament/LiveGame", () => ({
  LiveGameModel: { find: mocks.findLiveGames },
}));
vi.mock("~/game/feature-gate", () => ({
  requireGameEnabled: mocks.requireGameEnabled,
  getClientGameFlag: () => ({ gameEnabled: true }),
}));
vi.mock("~/game/rules/presets", () => ({
  listSelectablePresets: () => [
    {
      id: "buu-east",
      displayName: "Buu Mahjong - East",
      description: "Buu rules",
    },
  ],
}));
vi.mock("~/utils/gameAuth.server", () => ({
  requireGameUser: mocks.requireGameUser,
}));

import { loader } from "./lobby";

describe("game lobby loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.requireGameUser.mockResolvedValue({ sub: "user-1" });
    const replayExec = vi.fn().mockResolvedValue([]);
    mocks.findReplayLogs.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({ exec: replayExec }),
        }),
      }),
    });
    const leagueExec = vi.fn().mockResolvedValue([]);
    mocks.findLeagues.mockReturnValue({
      lean: vi.fn().mockReturnValue({ exec: leagueExec }),
    });
  });

  it("loads the newest in-game replay logs for browsing", async () => {
    const exec = vi.fn().mockResolvedValue([
      {
        sourceGameId: "match-newest",
        ruleSet: "buu-east",
        mode: {
          type: "duplicate",
          seed: "Board-A",
          generationVersion: 1,
        },
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

    const request = new Request("http://app.test/lobby");
    const result = await loader({ request });

    expect(mocks.requireGameEnabled).toHaveBeenCalledOnce();
    expect(mocks.requireGameUser).toHaveBeenCalledWith(request);
    expect(mocks.connectToDatabase).toHaveBeenCalledOnce();
    expect(mocks.findReplayLogs).toHaveBeenCalledWith(
      { source: "ingame" },
      {
        sourceGameId: 1,
        ruleSet: 1,
        mode: 1,
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
        mode: {
          type: "duplicate",
          seed: "Board-A",
          generationVersion: 1,
        },
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

  it("loads watchable Tenhou games from ongoing tournaments", async () => {
    const leagueId = { toString: () => "league-1" };
    const leagueExec = vi
      .fn()
      .mockResolvedValue([{ _id: leagueId, name: "TNT Open" }]);
    const leagueLean = vi.fn().mockReturnValue({ exec: leagueExec });
    mocks.findLeagues.mockReturnValue({ lean: leagueLean });

    const liveExec = vi.fn().mockResolvedValue([
      {
        league: leagueId,
        platform: "tenhou",
        status: "playing",
        gameId: "WATCH123",
        watchId: " WATCH123 ",
        startTime: new Date("2026-09-08T18:00:00.000Z"),
        lastSeenAt: new Date("2026-09-08T18:05:00.000Z"),
        players: [
          { seat: 1, nickname: "South" },
          { seat: 0, nickname: "East" },
        ],
      },
    ]);
    const liveLean = vi.fn().mockReturnValue({ exec: liveExec });
    const liveSort = vi.fn().mockReturnValue({ lean: liveLean });
    mocks.findLiveGames.mockReturnValue({ sort: liveSort });

    const result = await loader({
      request: new Request("http://app.test/lobby"),
    });

    expect(mocks.findLeagues).toHaveBeenCalledWith(
      expect.objectContaining({
        startTime: { $lte: expect.any(Date) },
        endTime: { $gt: expect.any(Date) },
        isIgnored: false,
        "platformConfig.platformName": "TENHOU",
      }),
      { name: 1 }
    );
    expect(mocks.findLiveGames).toHaveBeenCalledWith({
      league: { $in: [leagueId] },
      platform: "tenhou",
      status: "playing",
      watchId: { $exists: true, $ne: "" },
    });
    expect(liveSort).toHaveBeenCalledWith({
      startTime: -1,
      lastSeenAt: -1,
    });
    expect(result.tenhouLiveGames).toEqual([
      {
        watchId: "WATCH123",
        leagueName: "TNT Open",
        startTime: Date.parse("2026-09-08T18:00:00.000Z"),
        players: [
          { seat: 0, displayName: "East" },
          { seat: 1, displayName: "South" },
        ],
      },
    ]);
  });
});

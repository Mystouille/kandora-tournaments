import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  getLobbyTenhouLiveGames: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("~/services/lobbyLiveGames.server", () => ({
  getLobbyTenhouLiveGames: mocks.getLobbyTenhouLiveGames,
}));

vi.mock("~/game/feature-gate", () => ({ isGameEnabled: () => true }));
vi.mock("~/services/gameServer.server", () => ({
  getGameServerHttpUrl: () => "https://game.test",
}));
vi.mock("~/game/rules/presets", () => ({
  listSelectablePresets: () => [
    { id: "m-league", displayName: "M-League", description: "League rules" },
  ],
}));

import { action, loader } from "./lobby";

describe("mobile lobby API", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getLobbyTenhouLiveGames.mockResolvedValue([]);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns public presets and room summaries with CORS", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ rooms: [{ matchId: "room-1", status: "waiting" }] })
    );

    const response = await loader();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({
      presets: [
        {
          id: "m-league",
          displayName: "M-League",
          description: "League rules",
        },
      ],
      rooms: [{ matchId: "room-1", status: "waiting" }],
      tenhouLiveGames: [],
    });
    expect(fetchMock).toHaveBeenCalledWith("https://game.test/rooms", {
      headers: { accept: "application/json" },
    });
  });

  it("includes monitored Tenhou games before a spectator relay exists", async () => {
    const tenhouLiveGames = [
      {
        watchId: "WATCH123",
        leagueName: "TNT LEAGUE V",
        startTime: null,
        players: [{ seat: 0, displayName: "East" }],
      },
    ];
    mocks.getLobbyTenhouLiveGames.mockResolvedValue(tenhouLiveGames);
    fetchMock.mockResolvedValue(Response.json({ rooms: [] }));

    const response = await loader();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rooms: [], tenhouLiveGames });
    expect(mocks.connectToDatabase).toHaveBeenCalledOnce();
    expect(mocks.getLobbyTenhouLiveGames).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://game.test/rooms",
      {
        headers: { accept: "application/json" },
      }
    );
  });

  it.each(["online", "kansai"] as const)(
    "forwards %s sanma capacity and Duplicate metadata unchanged",
    async (sanmaType) => {
      const room = {
        matchId: "native-three",
        status: "waiting",
        presetId: "m-league",
        buuMode: false,
        playerCount: 3,
        sanmaType,
        mode: { type: "duplicate", seed: "Board", generationVersion: 1 },
        seats: [{ name: "Host", isBot: false }, null, null],
      };
      fetchMock.mockResolvedValue(Response.json({ rooms: [room] }));
      const response = await loader();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ rooms: [room] });
    }
  );

  it("reports a tournament query failure instead of silently hiding live games", async () => {
    const error = new Error("database unavailable");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getLobbyTenhouLiveGames.mockRejectedValue(error);
    fetchMock.mockResolvedValue(Response.json({ rooms: [] }));

    const response = await loader();

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({
      error: "tournament_games_unavailable",
    });
    expect(log).toHaveBeenCalledWith(
      "Failed to load mobile lobby tournament games:",
      error
    );
  });

  it("preserves room-server failures without querying tournament data", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "offline" }, { status: 503 })
    );

    const response = await loader();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "rooms_unavailable",
    });
    expect(mocks.getLobbyTenhouLiveGames).not.toHaveBeenCalled();
    expect(mocks.connectToDatabase).not.toHaveBeenCalled();
  });

  it("answers native CORS preflight without reaching the game server", async () => {
    const response = await action({
      request: new Request("https://app.test/api/mobile/lobby", {
        method: "OPTIONS",
      }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getLobbyTenhouLiveGames).not.toHaveBeenCalled();
    expect(mocks.connectToDatabase).not.toHaveBeenCalled();
  });

  it("returns a stable error when the game server cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const response = await loader();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "game_server_unreachable",
    });
  });
});

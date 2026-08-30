import { beforeEach, describe, expect, it, vi } from "vitest";

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
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
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
    });
    expect(fetchMock).toHaveBeenCalledWith("https://game.test/rooms", {
      headers: { accept: "application/json" },
    });
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

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyGameToken: vi.fn() }));

vi.mock("~/game/feature-gate", () => ({ isGameEnabled: () => true }));
vi.mock("~/game/rules/presets", () => ({
  listPresetIds: () => ["m-league", "tenhou-hanchan"],
}));
vi.mock("~/services/gameServer.server", () => ({
  getGameServerHttpUrl: () => "https://game.test",
}));
vi.mock("~/utils/jwt.server", () => ({
  verifyGameToken: mocks.verifyGameToken,
}));

import { action } from "./game.rooms";

describe("mobile game room API", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    mocks.verifyGameToken.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("creates a room with a verified native game token", async () => {
    mocks.verifyGameToken.mockResolvedValue({
      sub: "user-1",
      scope: "game",
      exp: 2_000_000_000,
    });
    fetchMock.mockResolvedValue(Response.json({ matchId: "room-1" }));

    const response = await action({
      request: new Request("https://app.test/api/mobile/game/rooms", {
        method: "POST",
        body: new URLSearchParams({
          token: "game-token",
          preset: "m-league",
        }),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ matchId: "room-1" });
    expect(fetchMock).toHaveBeenCalledWith("https://game.test/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset: "m-league", token: "game-token" }),
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects invalid tokens and presets before reaching the game server", async () => {
    mocks.verifyGameToken.mockResolvedValue(null);
    const invalidToken = await action({
      request: new Request("https://app.test/api/mobile/game/rooms", {
        method: "POST",
        body: new URLSearchParams({
          token: "bad-token",
          preset: "m-league",
        }),
      }),
    });
    expect(invalidToken.status).toBe(401);

    const invalidPreset = await action({
      request: new Request("https://app.test/api/mobile/game/rooms", {
        method: "POST",
        body: new URLSearchParams({
          token: "game-token",
          preset: "unknown",
        }),
      }),
    });
    expect(invalidPreset.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
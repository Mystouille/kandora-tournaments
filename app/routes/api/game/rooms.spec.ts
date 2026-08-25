import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/game/feature-gate", () => ({
  isGameEnabled: () => true,
}));

vi.mock("~/services/gameServer.server", () => ({
  getGameServerHttpUrl: () => "http://game.test",
}));

const mocks = vi.hoisted(() => ({
  requireGameApiAccess: vi.fn(),
  verifyGameToken: vi.fn(),
}));

vi.mock("~/utils/jwt.server", () => ({
  signGameToken: vi.fn().mockResolvedValue("game-token"),
  verifyGameToken: mocks.verifyGameToken,
}));

vi.mock("~/utils/gameAuth.server", () => ({
  requireGameApiAccess: mocks.requireGameApiAccess,
}));

import { action, loader } from "./rooms";

describe("game rooms API", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mocks.requireGameApiAccess.mockResolvedValue({
      authorized: true,
      user: { sub: "user-1", username: "Alice", loginMethod: "discord" },
    });
    mocks.verifyGameToken.mockResolvedValue({
      sub: "user-1",
      scope: "game",
      exp: 2_000_000_000,
    });
  });

  it("forwards room listings to the game server", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ rooms: [{ matchId: "room-1" }] })
    );
    const request = new Request("http://app.test/api/game/rooms", {
      headers: { "x-test-token": "signed-token" },
    });

    const response = await loader({ request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      rooms: [{ matchId: "room-1" }],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://game.test/rooms", {
      method: "GET",
      headers: { accept: "application/json" },
    });
  });

  it("rejects anonymous room listings without calling upstream", async () => {
    mocks.requireGameApiAccess.mockResolvedValue({
      authorized: false,
      response: Response.json(
        { error: "sign_in_required" },
        { status: 401 }
      ),
    });
    const request = new Request("http://app.test/api/game/rooms");

    const response = await loader({ request });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "sign_in_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("injects the authenticated token when creating a room", async () => {
    fetchMock.mockResolvedValue(Response.json({ matchId: "room-2" }));
    const request = new Request("http://app.test/api/game/rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-token": "signed-token",
      },
      body: JSON.stringify({ preset: "m-league" }),
    });

    const response = await action({ request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ matchId: "room-2" });
    expect(fetchMock).toHaveBeenCalledWith("http://game.test/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset: "m-league", token: "game-token" }),
    });
  });

  it("rejects unauthenticated room creation without calling upstream", async () => {
    mocks.requireGameApiAccess.mockResolvedValue({
      authorized: false,
      response: Response.json(
        { error: "sign_in_required" },
        { status: 401 }
      ),
    });
    const request = new Request("http://app.test/api/game/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset: "m-league" }),
    });

    const response = await action({ request });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "sign_in_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the same room contract for a native game token", async () => {
    fetchMock.mockResolvedValue(Response.json({ matchId: "room-mobile" }));
    const response = await action({
      request: new Request("http://app.test/api/game/rooms", {
        method: "POST",
        body: new URLSearchParams({
          token: "native-game-token",
          preset: "m-league",
        }),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      matchId: "room-mobile",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://game.test/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preset: "m-league",
        token: "native-game-token",
      }),
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

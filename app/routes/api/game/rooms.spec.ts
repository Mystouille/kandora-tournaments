import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/game/feature-gate", () => ({
  isGameEnabled: () => true,
}));

vi.mock("~/services/gameServer.server", () => ({
  getGameServerHttpUrl: () => "http://game.test",
}));

vi.mock("~/utils/jwt.server", () => ({
  getTokenFromRequest: (request: Request) =>
    request.headers.get("x-test-token"),
}));

import { action, loader } from "./rooms";

describe("game rooms API", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("forwards room listings to the game server", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ rooms: [{ matchId: "room-1" }] })
    );

    const response = await loader();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      rooms: [{ matchId: "room-1" }],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://game.test/rooms", {
      method: "GET",
      headers: { accept: "application/json" },
    });
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
      body: JSON.stringify({ preset: "m-league", token: "signed-token" }),
    });
  });

  it("rejects unauthenticated room creation without calling upstream", async () => {
    const request = new Request("http://app.test/api/game/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset: "m-league" }),
    });

    const response = await action({ request });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "missing_token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
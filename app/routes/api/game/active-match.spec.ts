import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireGameApiAccess: vi.fn(),
  verifyGameToken: vi.fn(),
}));

vi.mock("~/game/feature-gate", () => ({
  isGameEnabled: () => true,
}));
vi.mock("~/services/gameServer.server", () => ({
  getGameServerHttpUrl: () => "http://game.test",
}));
vi.mock("~/utils/gameAuth.server", () => ({
  requireGameApiAccess: mocks.requireGameApiAccess,
}));
vi.mock("~/utils/jwt.server", () => ({
  signGameToken: vi.fn().mockResolvedValue("web-game-token"),
  verifyGameToken: mocks.verifyGameToken,
}));

import { action, loader } from "./active-match";

describe("active game API", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("returns the authenticated web user's active match", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        activeMatch: {
          matchId: "match-1",
          status: "playing",
          connected: true,
        },
      })
    );

    const response = await loader({
      request: new Request("http://app.test/api/game/active-match"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      activeMatch: {
        matchId: "match-1",
        status: "playing",
        connected: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://game.test/active-match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "web-game-token" }),
    });
  });

  it("uses the native game token without exposing it in the URL", async () => {
    fetchMock.mockResolvedValue(Response.json({ activeMatch: null }));

    const response = await action({
      request: new Request("http://app.test/api/game/active-match", {
        method: "POST",
        body: new URLSearchParams({ token: "native-game-token" }),
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({ activeMatch: null });
    expect(fetchMock).toHaveBeenCalledWith("http://game.test/active-match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "native-game-token" }),
    });
  });

  it("answers native CORS preflight without forwarding", async () => {
    const response = await action({
      request: new Request("http://app.test/api/game/active-match", {
        method: "OPTIONS",
      }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid native token before forwarding", async () => {
    mocks.verifyGameToken.mockResolvedValue(null);

    const response = await action({
      request: new Request("http://app.test/api/game/active-match", {
        method: "POST",
        body: new URLSearchParams({ token: "expired" }),
      }),
    });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails explicitly when the upstream success body is invalid", async () => {
    fetchMock.mockResolvedValue(Response.json({ matchId: "missing-wrapper" }));

    const response = await loader({
      request: new Request("http://app.test/api/game/active-match"),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_upstream_response",
    });
  });
});

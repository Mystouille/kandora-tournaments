import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signGameToken: vi.fn(),
  verifyGameToken: vi.fn(),
  verifyMobileRefreshToken: vi.fn(),
}));
vi.mock("~/utils/jwt.server", () => ({
  GAME_JWT_EXPIRATION_SECONDS: 12 * 60 * 60,
  signGameToken: mocks.signGameToken,
  verifyGameToken: mocks.verifyGameToken,
  verifyMobileRefreshToken: mocks.verifyMobileRefreshToken,
}));

import { action, loader } from "./auth.session";

describe("mobile auth session API", () => {
  beforeEach(() => {
    mocks.signGameToken.mockReset();
    mocks.signGameToken.mockResolvedValue("renewed-game-token");
    mocks.verifyGameToken.mockReset();
    mocks.verifyMobileRefreshToken.mockReset();
  });

  it("verifies a game-scoped bearer token", async () => {
    mocks.verifyGameToken.mockResolvedValue({
      sub: "user-1",
      scope: "game",
      exp: 2_000_000_000,
    });

    const response = await loader({
      request: new Request("https://app.test/api/mobile/auth/session", {
        headers: { Authorization: "Bearer game-token" },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      expiresAt: 2_000_000_000_000,
      wsUrl: process.env.GAME_WS_URL?.trim() || null,
      wsPath: "/ws/game",
    });
    expect(mocks.verifyGameToken).toHaveBeenCalledWith("game-token");
  });

  it("renews an expired game token with a valid mobile refresh token", async () => {
    mocks.verifyGameToken.mockResolvedValue(null);
    mocks.verifyMobileRefreshToken.mockResolvedValue({
      sub: "user-1",
      scope: "mobile-refresh",
      exp: 2_000_000_000,
    });

    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/session", {
        method: "POST",
        body: new URLSearchParams({
          token: "expired-game-token",
          refreshToken: "refresh-token",
        }),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      token: "renewed-game-token",
      expiresAt: expect.any(Number),
      refreshToken: "refresh-token",
      refreshExpiresAt: 2_000_000_000_000,
      wsUrl: process.env.GAME_WS_URL?.trim() || null,
      wsPath: "/ws/game",
    });
    expect(mocks.signGameToken).toHaveBeenCalledWith("user-1");
  });

  it("rejects refresh credentials for a different user", async () => {
    mocks.verifyGameToken.mockResolvedValue({
      sub: "user-1",
      scope: "game",
      exp: 2_000_000_000,
    });
    mocks.verifyMobileRefreshToken.mockResolvedValue({
      sub: "user-2",
      scope: "mobile-refresh",
      exp: 2_000_000_000,
    });

    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/session", {
        method: "POST",
        body: new URLSearchParams({
          token: "game-token",
          refreshToken: "other-user-refresh-token",
        }),
      }),
    });

    expect(response.status).toBe(401);
    expect(mocks.signGameToken).not.toHaveBeenCalled();
  });

  it("rejects missing and invalid bearer tokens", async () => {
    const missing = await loader({
      request: new Request("https://app.test/api/mobile/auth/session"),
    });
    expect(missing.status).toBe(401);

    mocks.verifyGameToken.mockResolvedValue(null);
    const invalid = await loader({
      request: new Request("https://app.test/api/mobile/auth/session", {
        headers: { Authorization: "Bearer bad-token" },
      }),
    });
    expect(invalid.status).toBe(401);
  });

  it("verifies a token from a CORS-simple form POST", async () => {
    mocks.verifyGameToken.mockResolvedValue({
      sub: "user-1",
      scope: "game",
      exp: 2_000_000_000,
    });

    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/session", {
        method: "POST",
        body: new URLSearchParams({ token: "game-token" }),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      token: "game-token",
      expiresAt: 2_000_000_000_000,
      wsUrl: process.env.GAME_WS_URL?.trim() || null,
      wsPath: "/ws/game",
    });
    expect(mocks.verifyGameToken).toHaveBeenCalledWith("game-token");
  });

  it("answers native CORS preflight", async () => {
    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/session", {
        method: "OPTIONS",
      }),
    });

    expect(response.status).toBe(204);
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeMobileAuthCode: vi.fn(),
  signGameToken: vi.fn(),
  signMobileRefreshToken: vi.fn(),
}));

vi.mock("~/services/mobileAuthCode.server", () => ({
  consumeMobileAuthCode: mocks.consumeMobileAuthCode,
}));
vi.mock("~/utils/jwt.server", () => ({
  GAME_JWT_EXPIRATION_SECONDS: 12 * 60 * 60,
  MOBILE_REFRESH_JWT_EXPIRATION_SECONDS: 30 * 24 * 60 * 60,
  signGameToken: mocks.signGameToken,
  signMobileRefreshToken: mocks.signMobileRefreshToken,
}));

import { action } from "./auth.exchange";

describe("mobile auth exchange API", () => {
  beforeEach(() => {
    mocks.consumeMobileAuthCode.mockReset();
    mocks.signGameToken.mockReset();
    mocks.signMobileRefreshToken.mockReset();
  });

  it("exchanges a valid one-time code for a game token", async () => {
    mocks.consumeMobileAuthCode.mockResolvedValue({
      userId: "user-1",
      username: "Alice",
    });
    mocks.signGameToken.mockResolvedValue("game-token");
    mocks.signMobileRefreshToken.mockResolvedValue("refresh-token");

    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/exchange", {
        method: "POST",
        body: new URLSearchParams({ code: "code", verifier: "verifier" }),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      token: "game-token",
      refreshToken: "refresh-token",
      username: "Alice",
      expiresAt: expect.any(Number),
      refreshExpiresAt: expect.any(Number),
    });
    expect(mocks.signGameToken).toHaveBeenCalledWith("user-1");
    expect(mocks.signMobileRefreshToken).toHaveBeenCalledWith("user-1");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects a consumed or expired code", async () => {
    mocks.consumeMobileAuthCode.mockResolvedValue(null);

    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/exchange", {
        method: "POST",
        body: new URLSearchParams({ code: "code", verifier: "verifier" }),
      }),
    });

    expect(response.status).toBe(401);
    expect(mocks.signGameToken).not.toHaveBeenCalled();
    expect(mocks.signMobileRefreshToken).not.toHaveBeenCalled();
  });

  it("returns a stable transient error when code storage is unavailable", async () => {
    mocks.consumeMobileAuthCode.mockRejectedValue(new Error("redis offline"));

    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/exchange", {
        method: "POST",
        body: new URLSearchParams({ code: "code", verifier: "verifier" }),
      }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "temporarily_unavailable",
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers native CORS preflight", async () => {
    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/exchange", {
        method: "OPTIONS",
      }),
    });

    expect(response.status).toBe(204);
  });
});
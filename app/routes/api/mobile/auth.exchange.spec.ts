import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeMobileAuthCode: vi.fn(),
  signGameToken: vi.fn(),
}));

vi.mock("~/services/mobileAuthCode.server", () => ({
  consumeMobileAuthCode: mocks.consumeMobileAuthCode,
}));
vi.mock("~/utils/jwt.server", () => ({
  GAME_JWT_EXPIRATION_SECONDS: 12 * 60 * 60,
  signGameToken: mocks.signGameToken,
}));

import { action } from "./auth.exchange";

describe("mobile auth exchange API", () => {
  beforeEach(() => {
    mocks.consumeMobileAuthCode.mockReset();
    mocks.signGameToken.mockReset();
  });

  it("exchanges a valid one-time code for a game token", async () => {
    mocks.consumeMobileAuthCode.mockResolvedValue({
      userId: "user-1",
      username: "Alice",
    });
    mocks.signGameToken.mockResolvedValue("game-token");

    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "code", verifier: "verifier" }),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      token: "game-token",
      username: "Alice",
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects a consumed or expired code", async () => {
    mocks.consumeMobileAuthCode.mockResolvedValue(null);

    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "code", verifier: "verifier" }),
      }),
    });

    expect(response.status).toBe(401);
    expect(mocks.signGameToken).not.toHaveBeenCalled();
  });

  it("returns a stable transient error when code storage is unavailable", async () => {
    mocks.consumeMobileAuthCode.mockRejectedValue(new Error("redis offline"));

    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "code", verifier: "verifier" }),
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
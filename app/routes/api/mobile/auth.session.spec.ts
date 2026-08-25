import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyGameToken: vi.fn() }));
vi.mock("~/utils/jwt.server", () => ({
  verifyGameToken: mocks.verifyGameToken,
}));

import { action, loader } from "./auth.session";

describe("mobile auth session API", () => {
  beforeEach(() => {
    mocks.verifyGameToken.mockReset();
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
    });
    expect(mocks.verifyGameToken).toHaveBeenCalledWith("game-token");
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

  it("answers native CORS preflight", async () => {
    const response = await action({
      request: new Request("https://app.test/api/mobile/auth/session", {
        method: "OPTIONS",
      }),
    });

    expect(response.status).toBe(204);
  });
});
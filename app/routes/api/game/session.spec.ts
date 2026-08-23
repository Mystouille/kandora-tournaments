import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gameEnabled: true,
  requireGameApiAccess: vi.fn(),
}));

vi.mock("~/game/feature-gate", () => ({
  isGameEnabled: () => mocks.gameEnabled,
}));

vi.mock("~/utils/jwt.server", () => ({
  signGameToken: vi.fn().mockResolvedValue("game-token"),
}));

vi.mock("~/utils/gameAuth.server", () => ({
  requireGameApiAccess: mocks.requireGameApiAccess,
}));

import { loader } from "./session";

describe("game session API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.gameEnabled = true;
    mocks.requireGameApiAccess.mockResolvedValue({
      authorized: true,
      user: { sub: "user-1", username: "Alice", loginMethod: "discord" },
    });
    vi.stubEnv("GAME_WS_URL", "wss://game.test");
  });

  it("returns the authenticated token for a player session", async () => {
    const request = new Request("http://app.test/api/game/session", {
      headers: { "x-test-token": "signed-token" },
    });

    const response = await loader({ request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: "game-token",
      wsUrl: "wss://game.test",
      wsPath: "/ws/game",
    });
  });

  it("rejects anonymous game sessions", async () => {
    mocks.requireGameApiAccess.mockResolvedValue({
      authorized: false,
      response: Response.json(
        { error: "sign_in_required" },
        { status: 401 }
      ),
    });
    const request = new Request("http://app.test/api/game/session");

    const response = await loader({ request });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "sign_in_required",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gameEnabled: true,
}));

vi.mock("~/game/feature-gate", () => ({
  isGameEnabled: () => mocks.gameEnabled,
}));

vi.mock("~/utils/jwt.server", () => ({
  getTokenFromRequest: (request: Request) =>
    request.headers.get("x-test-token"),
}));

import { loader } from "./session";

describe("game session API", () => {
  beforeEach(() => {
    mocks.gameEnabled = true;
    vi.stubEnv("GAME_WS_URL", "wss://game.test");
  });

  it("returns the authenticated token for a player session", async () => {
    const request = new Request("http://app.test/api/game/session", {
      headers: { "x-test-token": "signed-token" },
    });

    const response = await loader({ request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: "signed-token",
      wsUrl: "wss://game.test",
      wsPath: "/ws/game",
    });
  });

  it("keeps anonymous spectator sessions tokenless", async () => {
    const request = new Request("http://app.test/api/game/session");

    const response = await loader({ request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ token: "" });
  });
});
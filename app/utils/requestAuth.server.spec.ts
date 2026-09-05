import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  verifyGameToken: vi.fn(),
}));

vi.mock("./jwt.server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  verifyGameToken: mocks.verifyGameToken,
}));

import { getAuthenticatedPrincipal } from "./requestAuth.server";

describe("shared request authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    mocks.verifyGameToken.mockResolvedValue(null);
  });

  it("resolves a web cookie session", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ sub: "web-user" });

    await expect(
      getAuthenticatedPrincipal(
        new Request("https://app.test/api/my-replays"),
        { transport: "web-cookie" }
      )
    ).resolves.toEqual({
      userId: "web-user",
      transport: "web-cookie",
    });
    expect(mocks.verifyGameToken).not.toHaveBeenCalled();
  });

  it("resolves a mobile game token when no web session exists", async () => {
    mocks.verifyGameToken.mockResolvedValue({
      sub: "mobile-user",
      scope: "game",
      exp: 2_000_000_000,
    });

    await expect(
      getAuthenticatedPrincipal(
        new Request("https://app.test/api/my-replays", { method: "POST" }),
        { transport: "game-token", token: "game-token" }
      )
    ).resolves.toEqual({
      userId: "mobile-user",
      transport: "game-token",
    });
    expect(mocks.verifyGameToken).toHaveBeenCalledWith("game-token");
  });

  it("rejects requests without a valid platform session", async () => {
    await expect(
      getAuthenticatedPrincipal(
        new Request("https://app.test/api/my-replays", { method: "POST" }),
        { transport: "game-token", token: "invalid-token" }
      )
    ).resolves.toBeNull();
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
  });
});

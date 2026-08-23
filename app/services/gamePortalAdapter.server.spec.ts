import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyGameToken: vi.fn(),
  verifySiteToken: vi.fn(),
}));

vi.mock("config", () => ({
  gameAllowLegacyAuthTokens: false,
}));

vi.mock("~/utils/jwt.server", () => ({
  verifyGameToken: mocks.verifyGameToken,
  verifyToken: mocks.verifySiteToken,
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: vi.fn(),
}));

vi.mock("~/core/models/shared/User", () => ({
  computeUserName: vi.fn(),
  UserModel: { findById: vi.fn() },
}));

import { portalAdapter } from "./gamePortalAdapter.server";

describe("game portal adapter token verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a scoped game token", async () => {
    mocks.verifyGameToken.mockResolvedValue({
      sub: "user-1",
      scope: "game",
    });

    await expect(portalAdapter.verifyToken("game-token")).resolves.toEqual({
      userId: "user-1",
    });
  });

  it("rejects a site token when legacy compatibility is disabled", async () => {
    mocks.verifyGameToken.mockResolvedValue(null);
    mocks.verifySiteToken.mockResolvedValue({
      sub: "user-1",
      username: "Alice",
      loginMethod: "discord",
    });

    await expect(portalAdapter.verifyToken("site-token")).resolves.toBeNull();
    expect(mocks.verifySiteToken).not.toHaveBeenCalled();
  });
});
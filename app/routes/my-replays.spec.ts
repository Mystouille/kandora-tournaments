import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  connectToDatabase: vi.fn(),
  getMyReplays: vi.fn(),
}));

vi.mock("~/utils/jwt.server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("~/services/myReplays.server", () => ({
  getMyReplays: mocks.getMyReplays,
}));

import { loader } from "./my-replays";

describe("My Replays route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getMyReplays.mockResolvedValue([]);
  });

  it("redirects signed-out users through the auth-only continuation", async () => {
    let thrown: unknown;
    try {
      await loader({ request: new Request("http://app.test/my-replays") });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe(
      "/sign-in?mode=auth&returnTo=%2Fmy-replays"
    );
    expect(mocks.connectToDatabase).not.toHaveBeenCalled();
  });

  it("loads only the authenticated user's related groups", async () => {
    const groups = [{ key: "tenhou:game-1" }];
    mocks.getAuthenticatedUser.mockResolvedValue({ sub: "user-1" });
    mocks.getMyReplays.mockResolvedValue(groups);

    await expect(
      loader({ request: new Request("http://app.test/my-replays") })
    ).resolves.toEqual({ groups });
    expect(mocks.getMyReplays).toHaveBeenCalledWith("user-1");
  });

  it("rejects a stale token whose user no longer exists", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ sub: "user-1" });
    mocks.getMyReplays.mockResolvedValue(null);

    await expect(
      loader({ request: new Request("http://app.test/my-replays") })
    ).rejects.toMatchObject({ status: 401 });
  });
});

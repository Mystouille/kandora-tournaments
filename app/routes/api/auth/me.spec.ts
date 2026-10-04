import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  getAuthenticatedUserWithRefresh: vi.fn(),
  signToken: vi.fn(),
  createAuthCookie: vi.fn(),
  findUser: vi.fn(),
  getTournamentAdminAccessForUser: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));

vi.mock("../../../utils/jwt.server", () => ({
  getAuthenticatedUserWithRefresh: mocks.getAuthenticatedUserWithRefresh,
  signToken: mocks.signToken,
  createAuthCookie: mocks.createAuthCookie,
}));

vi.mock("~/core/models/shared/User", () => ({
  UserModel: {
    findById: mocks.findUser,
  },
}));

vi.mock("../../../utils/league-permissions.server", () => ({
  getTournamentAdminAccessForUser: mocks.getTournamentAdminAccessForUser,
}));

import { loader } from "./me";

const databaseAvatarUrl = "https://cdn.example.com/current-avatar.png";
const staleJwtAvatarUrl = "https://cdn.example.com/old-avatar.png";

function mockUser() {
  const user = {
    _id: "user-1",
    name: "Alice",
    avatarUrl: databaseAvatarUrl,
    isAdmin: false,
    toJSON: vi.fn().mockReturnValue({
      _id: "user-1",
      name: "Alice",
      avatarUrl: databaseAvatarUrl,
      isAdmin: false,
    }),
  };
  mocks.findUser.mockReturnValue({
    select: vi.fn().mockResolvedValue(user),
  });
  return user;
}

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getTournamentAdminAccessForUser.mockResolvedValue({
      isGlobalAdmin: false,
      tournaments: [],
    });
    mocks.createAuthCookie.mockReturnValue("auth_token=refreshed");
    mocks.signToken.mockResolvedValue("refreshed-token");
  });

  it("returns the current database avatar instead of the JWT snapshot", async () => {
    mocks.getAuthenticatedUserWithRefresh.mockResolvedValue({
      payload: {
        sub: "user-1",
        username: "Alice",
        loginMethod: "discord",
        avatarUrl: staleJwtAvatarUrl,
      },
      needsRefresh: false,
    });
    mockUser();

    const response = await loader({
      request: new Request("https://example.com/api/auth/me"),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: true,
      user: {
        avatarUrl: databaseAvatarUrl,
      },
    });
  });

  it("uses the current database avatar when refreshing the JWT", async () => {
    mocks.getAuthenticatedUserWithRefresh.mockResolvedValue({
      payload: {
        sub: "user-1",
        username: "Alice",
        loginMethod: "discord",
        avatarUrl: staleJwtAvatarUrl,
      },
      needsRefresh: true,
    });
    mockUser();

    const response = await loader({
      request: new Request("https://example.com/api/auth/me"),
    });

    expect(mocks.signToken).toHaveBeenCalledWith({
      sub: "user-1",
      username: "Alice",
      loginMethod: "discord",
      avatarUrl: databaseAvatarUrl,
    });
    expect(response.headers.get("Set-Cookie")).toBe("auth_token=refreshed");
  });
});

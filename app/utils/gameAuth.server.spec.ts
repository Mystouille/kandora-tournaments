import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findUser: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getMainServer: vi.fn(),
  lookupGuildMember: vi.fn(),
}));

vi.mock("./dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("./jwt.server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("../core/models/shared/User", () => ({
  UserModel: { findById: mocks.findUser },
}));
vi.mock("~/config/servers", () => ({
  getMainServer: mocks.getMainServer,
}));
vi.mock("./discord-guilds.server", () => ({
  lookupGuildMember: mocks.lookupGuildMember,
}));

import {
  evaluateGameAccess,
  requireGameApiAccess,
  requireGameUser,
} from "./gameAuth.server";

const request = new Request(
  "http://app.test/spectate/match-1?delay=300000&returnTo=%2Fcup"
);
const authenticatedUser = {
  sub: "user-1",
  username: "Alice",
  loginMethod: "discord" as const,
};

function mockUser(user: Record<string, unknown> | null): void {
  mocks.findUser.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(user),
    }),
  });
}

describe("game access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
    mocks.getMainServer.mockReturnValue({
      id: "guild-1",
      name: "TNT",
      isMain: true,
    });
    mocks.lookupGuildMember.mockResolvedValue({
      status: "member",
      member: { user: { id: "discord-1" } },
    });
    mockUser({ discordIdentity: { id: "discord-1" } });
  });

  it("allows an authenticated member of the main guild", async () => {
    await expect(evaluateGameAccess(request)).resolves.toEqual({
      status: "allowed",
      user: authenticatedUser,
    });
    expect(mocks.lookupGuildMember).toHaveBeenCalledWith(
      "guild-1",
      "discord-1"
    );
  });

  it("does not query the database for a signed-out request", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    await expect(evaluateGameAccess(request)).resolves.toEqual({
      status: "signed_out",
    });
    expect(mocks.connectToDatabase).not.toHaveBeenCalled();
  });

  it("requires a linked Discord identity", async () => {
    mockUser({});

    await expect(evaluateGameAccess(request)).resolves.toEqual({
      status: "discord_unlinked",
    });
    expect(mocks.lookupGuildMember).not.toHaveBeenCalled();
  });

  it("distinguishes non-members from an unavailable membership service", async () => {
    mocks.lookupGuildMember.mockResolvedValueOnce({ status: "not_member" });
    await expect(evaluateGameAccess(request)).resolves.toEqual({
      status: "not_in_main_guild",
    });

    mocks.lookupGuildMember.mockResolvedValueOnce({ status: "unavailable" });
    await expect(evaluateGameAccess(request)).resolves.toEqual({
      status: "membership_unavailable",
    });
  });

  it("redirects denied pages while preserving the attempted URL", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    let thrown: unknown;

    try {
      await requireGameUser(request);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe(
      "/sign-in?returnTo=%2Fspectate%2Fmatch-1%3Fdelay%3D300000%26returnTo%3D%252Fcup"
    );
  });

  it.each([
    ["signed_out", 401, "sign_in_required"],
    ["discord_unlinked", 403, "discord_required"],
    ["not_in_main_guild", 403, "tnt_membership_required"],
    ["membership_unavailable", 503, "membership_unavailable"],
  ] as const)(
    "maps %s to a stable API response",
    async (accessStatus, responseStatus, errorCode) => {
      if (accessStatus === "signed_out") {
        mocks.getAuthenticatedUser.mockResolvedValue(null);
      } else if (accessStatus === "discord_unlinked") {
        mockUser({});
      } else {
        mocks.lookupGuildMember.mockResolvedValue({
          status:
            accessStatus === "not_in_main_guild"
              ? "not_member"
              : "unavailable",
        });
      }

      const result = await requireGameApiAccess(request);
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.response.status).toBe(responseStatus);
        await expect(result.response.json()).resolves.toEqual({
          error: errorCode,
        });
      }
    }
  );
});

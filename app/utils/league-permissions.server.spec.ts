import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findLeagues: vi.fn(),
  findUser: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  isDiscordGuildAdmin: vi.fn(),
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
vi.mock("../core/models/tournament/League", () => ({
  LeagueModel: { find: mocks.findLeagues },
}));
vi.mock("./discord-guilds.server", () => ({
  isDiscordGuildAdmin: mocks.isDiscordGuildAdmin,
}));

import { getTournamentAdminAccess } from "./league-permissions.server";

const request = new Request("http://localhost/admin");

function league(
  id: string,
  name: string,
  serverId?: string,
  options?: { isTeamMode?: boolean; platformName?: string }
) {
  return {
    _id: id,
    name,
    startTime: new Date("2026-08-01T00:00:00.000Z"),
    endTime: new Date("2026-09-01T00:00:00.000Z"),
    isDisplayed: true,
    rulesConfig: { isTeamMode: options?.isTeamMode ?? true },
    platformConfig: { platformName: options?.platformName ?? "MAJSOUL" },
    discordConfig: serverId ? { serverId } : undefined,
  };
}

function mockUser(user: Record<string, unknown> | null) {
  mocks.findUser.mockReturnValue({
    select: vi.fn().mockResolvedValue(user),
  });
}

function mockLeagues(leagues: ReturnType<typeof league>[]) {
  mocks.findLeagues.mockReturnValue({
    select: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(leagues),
      }),
    }),
  });
}

describe("getTournamentAdminAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getAuthenticatedUser.mockResolvedValue({
      sub: "user-1",
      username: "Admin",
      loginMethod: "discord",
    });
    mockLeagues([]);
  });

  it("returns null without an authenticated user", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    await expect(getTournamentAdminAccess(request)).resolves.toBeNull();
    expect(mocks.connectToDatabase).not.toHaveBeenCalled();
    expect(mocks.findLeagues).not.toHaveBeenCalled();
  });

  it("returns every tournament for a global admin without Discord checks", async () => {
    mockUser({ isAdmin: true });
    mockLeagues([
      league("league-1", "Été 2026", "guild-1"),
      league("league-2", "Open 2026", undefined, {
        isTeamMode: false,
        platformName: "RIICHICITY",
      }),
    ]);

    const access = await getTournamentAdminAccess(request);

    expect(access).toMatchObject({
      isGlobalAdmin: true,
      tournaments: [
        { id: "league-1", name: "Été 2026", slug: "ete-2026" },
        {
          id: "league-2",
          isTeamMode: false,
          platformName: "RIICHICITY",
        },
      ],
    });
    expect(mocks.isDiscordGuildAdmin).not.toHaveBeenCalled();
  });

  it("returns no tournaments when the user has no linked Discord account", async () => {
    mockUser({ isAdmin: false });

    await expect(getTournamentAdminAccess(request)).resolves.toEqual({
      isGlobalAdmin: false,
      tournaments: [],
    });
    expect(mocks.findLeagues).not.toHaveBeenCalled();
  });

  it("filters leagues by guild and checks each shared guild once", async () => {
    mockUser({
      isAdmin: false,
      discordIdentity: { id: "discord-1" },
    });
    mockLeagues([
      league("league-1", "First", "guild-1"),
      league("league-2", "Second", "guild-1"),
      league("league-3", "Third", "guild-2"),
      league("league-4", "Unlinked"),
    ]);
    mocks.isDiscordGuildAdmin.mockImplementation(
      async (serverId: string) => serverId === "guild-1"
    );

    const access = await getTournamentAdminAccess(request);

    expect(access?.tournaments.map((tournament) => tournament.id)).toEqual([
      "league-1",
      "league-2",
    ]);
    expect(mocks.isDiscordGuildAdmin).toHaveBeenCalledTimes(2);
    expect(mocks.isDiscordGuildAdmin).toHaveBeenCalledWith(
      "guild-1",
      "discord-1"
    );
    expect(mocks.isDiscordGuildAdmin).toHaveBeenCalledWith(
      "guild-2",
      "discord-1"
    );
  });

  it("treats a failed guild lookup as inaccessible", async () => {
    mockUser({
      isAdmin: false,
      discordIdentity: { id: "discord-1" },
    });
    mockLeagues([league("league-1", "First", "guild-1")]);
    mocks.isDiscordGuildAdmin.mockRejectedValue(new Error("Discord offline"));

    await expect(getTournamentAdminAccess(request)).resolves.toEqual({
      isGlobalAdmin: false,
      tournaments: [],
    });
  });
});

import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "~/core/types/league-enums";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  findLeague: vi.fn(),
  findTeams: vi.fn(),
  findUsers: vi.fn(),
  findUser: vi.fn(),
  findUserById: vi.fn(),
  updateLeague: vi.fn(),
  updateTeam: vi.fn(),
  createTeam: vi.fn(),
  deleteTeams: vi.fn(),
  createConnector: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({ connectToDatabase: vi.fn() }));
vi.mock("~/utils/league-permissions.server", () => ({
  requireLeagueAdmin: mocks.authorize,
}));
vi.mock("~/core/models/tournament/League", async () => ({
  Platform: (await import("~/core/types/league-enums")).Platform,
  LeagueModel: {
    findById: mocks.findLeague,
    findByIdAndUpdate: mocks.updateLeague,
  },
}));
vi.mock("~/core/models/tournament/Team", () => ({
  TeamModel: {
    find: mocks.findTeams,
    updateOne: mocks.updateTeam,
    create: mocks.createTeam,
    deleteMany: mocks.deleteTeams,
  },
}));
vi.mock("~/core/models/shared/User", () => ({
  UserModel: {
    find: mocks.findUsers,
    findOne: mocks.findUser,
    findById: mocks.findUserById,
  },
}));
vi.mock("~/core/models/tournament/LeagueUser", () => ({ LeagueUserModel: {} }));
vi.mock("~/core/models/tournament/ScheduledGame", () => ({
  ScheduledGameModel: {},
}));
vi.mock("~/services/connectors/createConnectorForLeague.server", () => ({
  createConnectorForLeague: mocks.createConnector,
}));
vi.mock("~/api/majsoul/data/MajsoulConnector", () => ({
  MahjongSoulConnector: {},
}));
vi.mock("~/services/connectors/RiichiCityLeagueConnector.server", () => ({
  RiichiCityLeagueConnector: {},
}));
vi.mock("~/utils/auth.server", () => ({ AuthService: {} }));
vi.mock("~/utils/discord-guilds.server", () => ({
  fetchGuildMembers: vi.fn(),
}));
vi.mock("~/core/services/identityLinking", () => ({
  linkPlatformIdentity: vi.fn(),
}));
vi.mock("~/services/identityLinkDeps.server", () => ({ identityLinkDeps: {} }));

import { action, loader } from "./league-roster";
import { action as importPlatform } from "./league-team-import";
import { action as importCsv } from "./league-csv-import";

const leagueId = new mongoose.Types.ObjectId();
const teamId = new mongoose.Types.ObjectId();
const playerId = new mongoose.Types.ObjectId();

interface StoredTeam {
  _id: mongoose.Types.ObjectId;
  simpleName: string;
  displayName: string;
  color?: string | null;
  roster: {
    captain: mongoose.Types.ObjectId;
    members: mongoose.Types.ObjectId[];
    substitutes: mongoose.Types.ObjectId[];
  };
}

let stored: StoredTeam[];

function query(value: () => unknown) {
  const result = {
    select: vi.fn(),
    lean: vi.fn(async () => value()),
  };
  result.select.mockReturnValue(result);
  return result;
}

function payload(color?: unknown) {
  return {
    teamId: teamId.toString(),
    simpleName: "Team One",
    displayName: "Team One",
    players: [
      { userId: playerId.toString(), isCaptain: true, isSubstitute: false },
    ],
    ...(color !== undefined ? { color } : {}),
  };
}

function save(teams = [payload()], syncToPlatform = true) {
  return action({
    request: new Request("http://localhost/api/admin/league-roster", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueId: leagueId.toString(),
        teams,
        syncToPlatform,
      }),
    }),
  });
}

async function readColor() {
  const response = await loader({
    request: new Request(
      `http://localhost/api/admin/league-roster?leagueId=${leagueId}`
    ),
  });
  expect(response.status).toBe(200);
  return (await response.json()).teams[0].color;
}

describe("roster color persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = [
      {
        _id: teamId,
        simpleName: "Team One",
        displayName: "Team One",
        roster: { captain: playerId, members: [playerId], substitutes: [] },
      },
    ];
    mocks.authorize.mockResolvedValue({ authorized: true });
    mocks.findLeague.mockReturnValue(
      query(() => ({
        _id: leagueId,
        name: "Test League",
        rulesConfig: { isTeamMode: true },
        platformConfig: {
          platformName: Platform.MAJSOUL,
          tournamentId: "test",
        },
      }))
    );
    mocks.findTeams.mockReturnValue(query(() => stored));
    mocks.findUsers.mockReturnValue(
      query(() => [{ _id: playerId, name: "Player" }])
    );
    mocks.updateTeam.mockImplementation(
      (_filter: unknown, update: { $set: Partial<StoredTeam> }) => ({
        exec: vi.fn(async () => Object.assign(stored[0], update.$set)),
      })
    );
  });

  it("writes and reloads a color-only change without platform synchronization", async () => {
    const response = await save([payload("#AABBCC")]);
    expect(response.status).toBe(200);
    expect(mocks.updateTeam).toHaveBeenCalledOnce();
    expect(await readColor()).toBe("#aabbcc");
    expect((await response.json()).platformSync).toEqual({
      attempted: false,
      reason: "no-platform-change",
    });
    expect(mocks.createConnector).not.toHaveBeenCalled();
  });

  it("persists clearing and does not refill it on another save", async () => {
    stored[0].color = "#abcdef";
    expect((await save([payload(null)])).status).toBe(200);
    expect(await readColor()).toBeNull();
    mocks.updateTeam.mockClear();
    expect((await save()).status).toBe(200);
    expect(await readColor()).toBeNull();
    expect(mocks.updateTeam).not.toHaveBeenCalled();
  });

  it("does not assign a color to legacy teams when the field is absent", async () => {
    expect(await readColor()).toBeNull();
    expect((await save()).status).toBe(200);
    expect(mocks.updateTeam).not.toHaveBeenCalled();
    expect(stored[0]).not.toHaveProperty("color");
  });

  it("preserves an existing color when an older client omits it", async () => {
    stored[0].color = "#123456";
    expect((await save()).status).toBe(200);
    expect(await readColor()).toBe("#123456");
    expect(mocks.updateTeam).not.toHaveBeenCalled();
  });

  it.each(["red", "#abc", "#abcdef80", 42, {}])(
    "rejects malformed color %j before any writes",
    async (color) => {
      const response = await save([payload(color)]);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/color/i);
      expect(mocks.updateTeam).not.toHaveBeenCalled();
      expect(mocks.createTeam).not.toHaveBeenCalled();
      expect(mocks.deleteTeams).not.toHaveBeenCalled();
      expect(mocks.createConnector).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, null])(
    "defaults only new teams, honoring explicit %s",
    async (color) => {
      const newPlayer = new mongoose.Types.ObjectId();
      const newTeam = {
        ...payload(color),
        teamId: "",
        simpleName: "New",
        displayName: "New",
        players: [
          {
            userId: newPlayer.toString(),
            isCaptain: true,
            isSubstitute: false,
          },
        ],
      };
      expect((await save([payload(), newTeam], false)).status).toBe(200);
      expect(mocks.createTeam).toHaveBeenCalledWith(
        expect.objectContaining({ color: color === null ? null : "#ff7f0e" })
      );
    }
  );

  it("keeps authorization on color writes", async () => {
    mocks.authorize.mockResolvedValue({
      authorized: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    expect((await save([payload("#123456")])).status).toBe(403);
    expect(mocks.findLeague).not.toHaveBeenCalled();
    expect(mocks.updateTeam).not.toHaveBeenCalled();
  });
});

describe("roster import color retention", () => {
  const names = ["Cleared", "New", "Configured", "Legacy"];

  beforeEach(() => {
    vi.clearAllMocks();
    stored = [
      { simpleName: "Configured", color: "#123456" },
      { simpleName: "Cleared", color: null },
      { simpleName: "Legacy" },
    ].map((team) => ({
      ...team,
      _id: new mongoose.Types.ObjectId(),
      displayName: team.simpleName,
      roster: { captain: playerId, members: [playerId], substitutes: [] },
    }));
    const users = names.map((name, index) => ({
      _id: new mongoose.Types.ObjectId(),
      name,
      tenhouIdentity: { name: `account-${index}` },
    }));
    mocks.authorize.mockResolvedValue({ authorized: true });
    mocks.findLeague.mockReturnValue(
      query(() => ({
        _id: leagueId,
        name: "Test",
        rulesConfig: { isTeamMode: true },
        platformConfig: { platformName: Platform.TENHOU, tournamentId: "test" },
      }))
    );
    mocks.findTeams.mockReturnValue(query(() => stored));
    mocks.findUsers.mockReturnValue(query(() => users));
    mocks.findUser.mockImplementation((filter: Record<string, string>) => ({
      exec: async () =>
        users.find(
          (user) => user.tenhouIdentity.name === filter["tenhouIdentity.name"]
        ),
    }));
    mocks.findUserById.mockImplementation((id: string) =>
      query(() => users.find((user) => user._id.toString() === id))
    );
    mocks.deleteTeams.mockReturnValue({
      exec: async () => {
        stored = [];
      },
    });
    mocks.updateLeague.mockReturnValue({ exec: async () => undefined });
    mocks.createConnector.mockReturnValue({
      getTeamsConfig: async () =>
        names.map((name, index) => ({
          name,
          members: [{ accountId: `account-${index}`, nickname: name }],
        })),
    });
  });

  it.each(["platform", "csv"])(
    "preserves colors and explicit absence through %s replacement",
    async (source) => {
      const handler = source === "platform" ? importPlatform : importCsv;
      const response = await handler({
        request: new Request(
          `http://localhost/api/admin/league-${source}-import`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              leagueId: leagueId.toString(),
              confirm: true,
              csv: names
                .map((name, index) => `${name},,account-${index},`)
                .join("\n"),
            }),
          }
        ),
      });
      expect(await response.json()).toMatchObject({ success: true });
      expect(response.status).toBe(200);
      expect(mocks.findTeams.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.deleteTeams.mock.invocationCallOrder[0]
      );
      expect(
        mocks.createTeam.mock.calls.map(([team]) => [
          team.simpleName,
          team.color,
        ])
      ).toEqual([
        ["Cleared", null],
        ["New", "#ff7f0e"],
        ["Configured", "#123456"],
        ["Legacy", null],
      ]);
    }
  );
});

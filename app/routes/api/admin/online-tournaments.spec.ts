import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ruleset } from "~/core/types/league-enums";
import { TenhouRuleConversionError } from "~/api/tenhou/ruleSetToTenhouConfig";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  findUser: vi.fn(),
  findLeague: vi.fn(),
  findConfig: vi.fn(),
  validate: vi.fn(),
  save: vi.fn(),
  configureLobbies: vi.fn(),
  initialize: vi.fn(),
  constructed: vi.fn(),
}));

vi.mock("../../../utils/dbConnection.server", () => ({
  connectToDatabase: vi.fn(),
}));
vi.mock("../../../utils/jwt.server", () => ({
  getAuthenticatedUser: mocks.authenticate,
}));
vi.mock("../../../core/models/shared/User", () => ({
  UserModel: { findById: mocks.findUser },
}));
vi.mock("../../../core/models/tournament/League", () => ({
  LeagueModel: Object.assign(
    vi.fn(function (data: Record<string, unknown>) {
      mocks.constructed(data);
      return {
        validate: mocks.validate,
        save: mocks.save,
        toObject: () => ({ _id: "new-league-id", ...data }),
      };
    }),
    { findOne: mocks.findLeague }
  ),
}));
vi.mock("../../../core/models/tournament/LeagueTypeConfig", () => ({
  LeagueTypeConfigModel: { findById: mocks.findConfig },
}));
vi.mock("../../../services/LeagueService.server", () => ({
  LeagueService: { instance: { InitLeague: mocks.initialize } },
}));
vi.mock("../../../api/tenhou/TenhouService.server", () => ({
  TenhouService: {
    instance: { configureTournamentLobbies: mocks.configureLobbies },
  },
}));

import { action } from "./online-tournaments";

const lobbyId = "C1000000000000000";
const phaseLobbyId = "C2000000000000000";

function body() {
  return {
    name: "New tournament",
    startTime: "2026-10-01T00:00:00Z",
    endTime: "2026-11-01T00:00:00Z",
    rulesConfig: {
      gameRulePresetId: "jpml-hanchan",
      isTeamMode: false,
    },
    platformConfig: {
      platformName: "TENHOU",
      tournamentId: lobbyId,
    },
  };
}

function request(value: unknown): Request {
  return new Request("http://localhost/api/admin/online-tournaments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

function leagueQuery(result: { name: string } | null) {
  return { select: () => ({ lean: async () => result }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ sub: "admin-id" });
  mocks.findUser.mockReturnValue({
    select: async () => ({ isAdmin: true }),
  });
  mocks.findLeague.mockReturnValue(leagueQuery(null));
  mocks.validate.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(undefined);
  mocks.configureLobbies.mockResolvedValue(undefined);
  mocks.initialize.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/online-tournaments", () => {
  it("requires authentication before configuring any lobby", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const response = await action({ request: request(body()) });
    expect(response.status).toBe(401);
    expect(mocks.configureLobbies).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("uses a shared gameplay/scoring preset and saves only after configuration", async () => {
    mocks.configureLobbies.mockImplementation(async () => {
      expect(mocks.validate).toHaveBeenCalledOnce();
      expect(mocks.save).not.toHaveBeenCalled();
    });
    const response = await action({ request: request(body()) });
    expect(response.status).toBe(201);
    expect(mocks.configureLobbies).toHaveBeenCalledWith(
      [lobbyId],
      expect.objectContaining({
        startingScore: 30000,
        ippatsu: false,
        kanDora: false,
        uraDora: false,
        returnScore: 30000,
        uma: [
          [0, 0, 0, 0],
          [8, 3, 1, -12],
          [8, 4, -4, -8],
          [12, -1, -3, -8],
          [0, 0, 0, 0],
        ],
      })
    );
    expect(mocks.constructed).toHaveBeenCalledWith(
      expect.objectContaining({
        rulesConfig: { ...body().rulesConfig, gameRules: Ruleset.JPML },
        platformConfig: expect.objectContaining({
          internalTournamentId: lobbyId,
        }),
      })
    );
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.initialize).toHaveBeenCalledOnce();
  });

  it.each([Ruleset.ONLINE, Ruleset.INDONESIAN, Ruleset.WRC])(
    "rejects legacy scoring %s for new tournaments",
    async (gameRules) => {
      const value = body();
      const response = await action({
        request: request({
          ...value,
          rulesConfig: { ...value.rulesConfig, gameRules },
        }),
      });
      expect(response.status).toBe(400);
      expect(mocks.configureLobbies).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
    }
  );

  it("rejects unsupported game presets before external writes", async () => {
    const value = body();
    value.rulesConfig.gameRulePresetId = "buu-east";
    const response = await action({ request: request(value) });
    expect(response.status).toBe(400);
    expect(mocks.configureLobbies).not.toHaveBeenCalled();
  });

  it("saves the preset for other platforms without pretending to configure them", async () => {
    const value = body();
    value.platformConfig.platformName = "MAJSOUL";
    value.platformConfig.tournamentId = "123456";
    const response = await action({ request: request(value) });
    expect(response.status).toBe(201);
    expect(mocks.configureLobbies).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it("does not save or start schedulers after a Tenhou failure", async () => {
    mocks.configureLobbies.mockRejectedValue(
      new Error("Tenhou rejected update")
    );
    const response = await action({ request: request(body()) });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Tenhou rejected update",
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("returns unsupported conversion errors as input errors", async () => {
    mocks.configureLobbies.mockRejectedValue(
      new TenhouRuleConversionError(["unsupported setting"])
    );
    const response = await action({ request: request(body()) });
    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("validates the league before changing external settings", async () => {
    mocks.validate.mockRejectedValue(new Error("Invalid date"));
    const response = await action({ request: request(body()) });
    expect(response.status).toBe(500);
    expect(mocks.configureLobbies).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("does not touch lobbies for an existing tournament name", async () => {
    mocks.findLeague.mockReturnValueOnce(
      leagueQuery({ name: "New tournament" })
    );
    const response = await action({ request: request(body()) });
    expect(response.status).toBe(409);
    expect(mocks.configureLobbies).not.toHaveBeenCalled();
  });

  it("checks both old and resolved lobby IDs before overwriting a linked lobby", async () => {
    mocks.findLeague
      .mockReturnValueOnce(leagueQuery(null))
      .mockReturnValueOnce(leagueQuery({ name: "Existing tournament" }));
    const response = await action({ request: request(body()) });
    expect(response.status).toBe(409);
    expect(mocks.findLeague).toHaveBeenCalledWith({
      "platformConfig.platformName": "TENHOU",
      $or: [
        { "platformConfig.tournamentId": { $in: [lobbyId] } },
        { "platformConfig.internalTournamentId": { $in: [lobbyId] } },
        { "platformConfig.phaseTournaments.tournamentId": { $in: [lobbyId] } },
        {
          "platformConfig.phaseTournaments.internalTournamentId": {
            $in: [lobbyId],
          },
        },
      ],
    });
    expect(mocks.configureLobbies).not.toHaveBeenCalled();
  });

  it("canonicalizes lobby IDs before duplicate checks and persistence", async () => {
    const value = body();
    value.platformConfig.tournamentId = ` ${lobbyId} `;
    const response = await action({ request: request(value) });
    expect(response.status).toBe(201);
    expect(mocks.configureLobbies).toHaveBeenCalledWith(
      [lobbyId],
      expect.any(Object)
    );
    expect(mocks.findLeague).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          { "platformConfig.tournamentId": { $in: [lobbyId] } },
        ]),
      })
    );
    expect(mocks.constructed).toHaveBeenCalledWith(
      expect.objectContaining({
        platformConfig: expect.objectContaining({ tournamentId: lobbyId }),
      })
    );
  });

  it("configures the primary and every phase lobby, deduplicating shared IDs", async () => {
    mocks.findConfig.mockResolvedValue({
      _id: "format-id",
      toObject: () => ({
        regularPhases: [
          { id: "one", scoring: { type: "cumulative" } },
          { id: "two", scoring: { type: "cumulative" } },
        ],
      }),
    });
    const value = body();
    const response = await action({
      request: request({
        ...value,
        leagueTypeConfigId: "format-id",
        platformConfig: {
          ...value.platformConfig,
          phaseTournaments: [
            { phaseId: "one", tournamentId: lobbyId },
            { phaseId: "two", tournamentId: phaseLobbyId },
          ],
        },
      }),
    });
    expect(response.status).toBe(201);
    expect(mocks.configureLobbies).toHaveBeenCalledWith(
      [lobbyId, phaseLobbyId],
      expect.any(Object)
    );
  });
});

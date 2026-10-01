import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findLeagues: vi.fn(),
  findGames: vi.fn(),
  aggregateGames: vi.fn(),
  findTeams: vi.fn(),
  findUsers: vi.fn(),
  computePlayerDeltas: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));

vi.mock("~/core/models/tournament/League", () => ({
  Ruleset: { MLEAGUE: "MLEAGUE" },
  LeagueModel: { find: mocks.findLeagues },
}));

vi.mock("~/core/models/tournament/Game", () => ({
  GameModel: {
    find: mocks.findGames,
    aggregate: mocks.aggregateGames,
  },
}));

vi.mock("~/core/models/tournament/Team", () => ({
  TeamModel: { find: mocks.findTeams },
}));

vi.mock("~/core/models/shared/User", () => ({
  UserModel: { find: mocks.findUsers },
}));

vi.mock("~/services/leagueUtils", () => ({
  computePlayerDeltas: mocks.computePlayerDeltas,
}));

import { loader } from "./score-evolution";

const leagueId = new mongoose.Types.ObjectId("68dd947b149082099405b7e1");
const playerId = new mongoose.Types.ObjectId("68dd947b149082099405b7e2");
const phaseTwoStart = "2026-09-01T00:00:00.000Z";
const phaseTwoGameTime = new Date("2026-09-15T20:00:00.000Z");

function selectedLean(value: unknown) {
  const query = {
    select: vi.fn(),
    lean: vi.fn().mockResolvedValue(value),
  };
  query.select.mockReturnValue(query);
  return query;
}

function selectedSortedLean(value: unknown) {
  const query = {
    select: vi.fn(),
    sort: vi.fn(),
    lean: vi.fn().mockResolvedValue(value),
  };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  return query;
}

function createRequest(overrides: Record<string, string> = {}) {
  const searchParams = new URLSearchParams({
    leagueIds: leagueId.toString(),
    playerIds: playerId.toString(),
    ...overrides,
  });
  return new Request(
    `http://localhost/api/score-evolution?${searchParams.toString()}`
  );
}

function loadScoreEvolution(overrides: Record<string, string> = {}) {
  return loader({
    request: createRequest(overrides),
    params: {},
    context: {},
    unstable_pattern: "/api/score-evolution",
  });
}

describe("score evolution API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.findLeagues.mockReturnValue(
      selectedLean([
        {
          _id: leagueId,
          rulesConfig: { gameRules: "MLEAGUE" },
          phaseCutoffTimes: [new Date(phaseTwoStart)],
        },
      ])
    );
    mocks.findGames.mockReturnValue(
      selectedSortedLean([
        {
          league: leagueId,
          startTime: phaseTwoGameTime,
          results: [{ userId: playerId, score: 35000, place: 1 }],
        },
      ])
    );
    mocks.findUsers.mockReturnValue(
      selectedLean([{ _id: playerId, name: "Phase Two Player" }])
    );
    mocks.computePlayerDeltas.mockReturnValue([10]);
  });

  it("does not truncate all-phases graphs at the first phase cutoff", async () => {
    const response = await loadScoreEvolution();

    expect(response.status).toBe(200);
    const matchFilter = mocks.findGames.mock.calls[0][0];
    expect(matchFilter).not.toHaveProperty("startTime");
  });

  it("keeps the phase 2 date window without adding a phase 1 cutoff", async () => {
    const phaseTwoEnd = "2026-10-01T23:59:59.999Z";
    const response = await loadScoreEvolution({
      startDate: phaseTwoStart,
      endDate: phaseTwoEnd,
    });

    expect(response.status).toBe(200);
    const matchFilter = mocks.findGames.mock.calls[0][0];
    expect(matchFilter.startTime).toEqual({
      $gte: new Date(phaseTwoStart),
      $lte: new Date(phaseTwoEnd),
    });
  });
});

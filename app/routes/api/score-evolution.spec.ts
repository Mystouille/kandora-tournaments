import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "~/core/models/tournament/Team";
import type { LeagueTypeConfig } from "~/services/league-configs/types";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findLeagues: vi.fn(),
  findGames: vi.fn(),
  aggregateGames: vi.fn(),
  findTeams: vi.fn(),
  findUsers: vi.fn(),
  findBracket: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));

vi.mock("~/core/models/tournament/League", async () => {
  const { Ruleset } = await import("~/core/types/league-enums");
  return { Ruleset, LeagueModel: { find: mocks.findLeagues } };
});

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

vi.mock("~/core/models/tournament/Bracket", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/core/models/tournament/Bracket")>();
  return { ...actual, BracketModel: { findOne: mocks.findBracket } };
});

import { loader } from "./score-evolution";

const leagueId = new mongoose.Types.ObjectId("68dd947b149082099405b7e1");
const playerId = new mongoose.Types.ObjectId("68dd947b149082099405b7e2");
const phaseTwoStart = "2026-09-01T00:00:00.000Z";
const phaseTwoGameTime = new Date("2026-09-15T20:00:00.000Z");

function selectedLean(value: unknown) {
  const query = {
    select: vi.fn(),
    populate: vi.fn(),
    lean: vi.fn().mockResolvedValue(value),
  };
  query.select.mockReturnValue(query);
  query.populate.mockReturnValue(query);
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

  describe("phase qualification", () => {
    const teamIds = [1, 2, 3, 4].map(
      (id) => new mongoose.Types.ObjectId(id.toString().padStart(24, "0"))
    );
    const members = [11, 12, 13, 14].map(
      (id) => new mongoose.Types.ObjectId(id.toString().padStart(24, "0"))
    );
    const substituteId = new mongoose.Types.ObjectId(
      "000000000000000000000020"
    );
    const guestId = new mongoose.Types.ObjectId("000000000000000000000021");
    type TeamFixture = Pick<
      Team,
      "_id" | "displayName" | "leagueId" | "roster" | "finalsRoster"
    >;
    interface GameFixture {
      league: mongoose.Types.ObjectId;
      startTime: Date;
      isValid: boolean;
      results: {
        userId: mongoose.Types.ObjectId;
        score: number;
        place: number;
      }[];
    }
    interface GameFilter {
      isValid?: boolean;
      "results.userId"?: { $in: mongoose.Types.ObjectId[] };
      startTime?: { $gte?: Date; $lte?: Date; $lt?: Date };
    }
    let config: LeagueTypeConfig;
    let teams: TeamFixture[];
    let games: GameFixture[];

    function makeGame(
      startTime: string,
      players = members,
      scores = [40000, 30000, 20000, 10000]
    ): GameFixture {
      return {
        league: leagueId,
        startTime: new Date(startTime),
        isValid: true,
        results: players.map((userId, index) => ({
          userId,
          score: scores[index],
          place: index + 1,
        })),
      };
    }

    function loadPhaseGraph(overrides: Record<string, string> = {}) {
      return loadScoreEvolution({
        playerIds: "",
        entityType: "team",
        phaseFilter: "phase1",
        startDate: phaseTwoStart,
        ...overrides,
      });
    }

    beforeEach(() => {
      config = {
        displayName: "Multi-phase league",
        isTeamMode: true,
        regularPhases: [
          {
            id: "regular",
            scoring: { type: "cumulative" },
            progression: {
              advancingCount: 2,
              scoreRetention: { num: 1, den: 2 },
            },
          },
          { id: "finals", scoring: { type: "cumulative" } },
        ],
      };
      teams = teamIds.map((_id, index) => ({
        _id,
        displayName: `Team ${index + 1}`,
        leagueId,
        roster: {
          captain: members[index],
          members: [members[index]],
          substitutes: index === 0 ? [substituteId] : [],
        },
        finalsRoster: null,
      }));
      games = [
        makeGame("2026-08-15T20:00:00.000Z"),
        makeGame(phaseTwoGameTime.toISOString(), [
          members[0],
          members[2],
          members[3],
          guestId,
        ]),
      ];
      mocks.findLeagues.mockImplementation(() =>
        selectedLean([
          {
            _id: leagueId,
            rulesConfig: {
              gameRules: "MLEAGUE",
              isTeamMode: config.isTeamMode,
            },
            phaseCutoffTimes: [
              new Date(phaseTwoStart),
              new Date("2026-10-01T00:00:00.000Z"),
            ],
            leagueTypeConfig: config,
          },
        ])
      );
      mocks.findTeams.mockImplementation(
        (filter: { _id?: { $in: mongoose.Types.ObjectId[] } }) =>
          selectedLean(
            teams.filter(
              (team) =>
                !filter._id || filter._id.$in.some((id) => id.equals(team._id))
            )
          )
      );
      mocks.findGames.mockImplementation((filter: GameFilter) =>
        selectedSortedLean(
          games.filter((game) => {
            const dateFilter = filter.startTime;
            const playerFilter = filter["results.userId"];
            return (
              (filter.isValid === undefined ||
                game.isValid === filter.isValid) &&
              (!dateFilter?.$gte || game.startTime >= dateFilter.$gte) &&
              (!dateFilter?.$lte || game.startTime <= dateFilter.$lte) &&
              (!dateFilter?.$lt || game.startTime < dateFilter.$lt) &&
              (!playerFilter ||
                game.results.some((result) =>
                  playerFilter.$in.some((id) => id.equals(result.userId))
                ))
            );
          })
        )
      );
      mocks.findUsers.mockReturnValue(
        selectedLean(
          [...members, substituteId, guestId].map((_id, index) => ({
            _id,
            name: `Player ${index + 1}`,
          }))
        )
      );
      mocks.aggregateGames.mockResolvedValue([{ userIds: members }]);
      mocks.findBracket.mockReturnValue(selectedLean(null));
    });

    it("shows only qualified teams, including one with no phase-2 games", async () => {
      const response = await loadPhaseGraph();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        series: [
          {
            id: teamIds[0].toString(),
            label: "Team 1",
            data: [{ x: "2026-09-15", y: 60 }],
          },
          {
            id: teamIds[1].toString(),
            label: "Team 2",
            data: [{ x: "2026-09-15", y: 0 }],
          },
        ],
      });
      expect(mocks.findGames).toHaveBeenNthCalledWith(1, {
        league: leagueId,
        isValid: true,
      });
    });

    it.each(["both", "phase0"])(
      "keeps all teams for %s",
      async (phaseFilter) => {
        const response = await loadPhaseGraph({
          phaseFilter,
          startDate: "",
          endDate: phaseFilter === "phase0" ? "2026-08-31T23:59:59.999Z" : "",
        });
        const { series } = await response.json();

        expect(series.map((s: { id: string }) => s.id)).toEqual(
          teamIds.map(String)
        );
        expect(mocks.findGames).toHaveBeenCalledTimes(1);
      }
    );

    it("intersects an explicit team selection with the qualifiers", async () => {
      const response = await loadPhaseGraph({
        teamIds: [teamIds[0], teamIds[2]].join(","),
      });
      const { series } = await response.json();

      expect(series.map((s: { id: string }) => s.id)).toEqual([
        String(teamIds[0]),
      ]);
    });

    it("does not fall back to all teams when only an eliminated team is selected", async () => {
      const response = await loadPhaseGraph({ teamIds: String(teamIds[2]) });

      await expect(response.json()).resolves.toEqual({ series: [] });
    });

    it("shows qualified team members and substitutes in default player mode", async () => {
      const response = await loadPhaseGraph({ entityType: "player" });
      const { series } = await response.json();

      expect(series.map((s: { id: string }) => s.id)).toEqual(
        [members[0], substituteId, members[1]].map(String)
      );
      expect(
        series.find((s: { id: string }) => s.id === String(members[1])).data
      ).toEqual([{ x: "2026-09-15", y: 0 }]);
    });

    it("does not show an explicitly selected eliminated player", async () => {
      const response = await loadPhaseGraph({
        entityType: "player",
        playerIds: String(members[2]),
      });

      await expect(response.json()).resolves.toEqual({ series: [] });
    });

    it("uses individual qualification for an individual multi-phase league", async () => {
      config.isTeamMode = false;
      teams = [];
      const response = await loadPhaseGraph({ entityType: "player" });
      const { series } = await response.json();

      expect(series.map((s: { id: string }) => s.id)).toEqual(
        members.slice(0, 2).map(String)
      );
    });

    it("respects the previous phase's minimum-games qualification gate", async () => {
      config.regularPhases![0].minGames = 2;
      games.push(
        makeGame("2026-08-16T20:00:00.000Z", [
          guestId,
          guestId,
          guestId,
          members[1],
        ])
      );
      const response = await loadPhaseGraph();
      const { series } = await response.json();

      expect(series.map((s: { id: string }) => s.id)).toEqual([
        String(teamIds[1]),
      ]);
    });

    it("uses the selected phase's qualifiers rather than the last phase's", async () => {
      config.regularPhases![1].progression = {
        advancingCount: 1,
        scoreRetention: { num: 1, den: 2 },
      };
      config.regularPhases!.push({
        id: "third-phase",
        scoring: { type: "cumulative" },
      });
      const phaseThreeResponse = await loadPhaseGraph({
        phaseFilter: "phase2",
      });
      const phaseTwoResponse = await loadPhaseGraph();
      const phaseThree = await phaseThreeResponse.json();
      const phaseTwo = await phaseTwoResponse.json();

      expect(phaseThree.series.map((s: { id: string }) => s.id)).toEqual([
        String(teamIds[0]),
      ]);
      expect(phaseTwo.series.map((s: { id: string }) => s.id)).toEqual(
        teamIds.slice(0, 2).map(String)
      );
    });

    it("uses bracket-qualified teams and their finals rosters for a final phase", async () => {
      config.regularPhase = config.regularPhases![0];
      delete config.regularPhases;
      config.finalPhase = {
        id: "finals",
        scoring: { type: "bracket-delta" },
        scoreCarryOver: { num: 0, den: 1 },
        stages: [],
      };
      teams[1].finalsRoster = {
        captain: substituteId,
        members: [substituteId],
        substitutes: [],
      };
      mocks.findBracket.mockReturnValue(
        selectedLean({ seedings: [{ seed: 1, teamId: teamIds[1] }] })
      );
      games[1].results[0].userId = substituteId;
      const response = await loadPhaseGraph();

      await expect(response.json()).resolves.toEqual({
        series: [
          {
            id: String(teamIds[1]),
            label: "Team 2",
            data: [{ x: "2026-09-15", y: 60 }],
          },
        ],
      });
    });

    it("uses bracket user seedings for an individual final phase", async () => {
      config.isTeamMode = false;
      config.regularPhase = config.regularPhases![0];
      delete config.regularPhases;
      config.finalPhase = {
        id: "finals",
        scoring: { type: "bracket-delta" },
        scoreCarryOver: { num: 0, den: 1 },
        stages: [],
      };
      mocks.findBracket.mockReturnValue(
        selectedLean({ seedings: [{ seed: 1, userId: members[0] }] })
      );
      const response = await loadPhaseGraph({ entityType: "player" });
      const { series } = await response.json();

      expect(series.map((s: { id: string }) => s.id)).toEqual([
        String(members[0]),
      ]);
    });

    it.each(["invalid", "phase-1", "phase99"])(
      "reports an invalid phase filter (%s)",
      async (phaseFilter) => {
        const response = await loadPhaseGraph({ phaseFilter });

        expect(response.status).toBe(400);
        expect(await response.json()).toHaveProperty("error");
      }
    );
  });
});

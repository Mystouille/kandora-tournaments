import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "~/core/models/tournament/Team";
import type { LeagueTypeConfig } from "~/services/league-configs/types";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findLeagues: vi.fn(),
  findTeams: vi.fn(),
  findGames: vi.fn(),
  findUsers: vi.fn(),
  findGameRecords: vi.fn(),
  setCache: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));

vi.mock("~/core/models/tournament/League", async () => {
  const { Ruleset } = await import("~/core/types/league-enums");
  return { Ruleset, LeagueModel: { find: mocks.findLeagues } };
});

vi.mock("~/core/models/tournament/Game", () => ({
  GameModel: { find: mocks.findGames },
}));

vi.mock("~/core/models/tournament/Team", () => ({
  TeamModel: { find: mocks.findTeams },
}));

vi.mock("~/core/models/shared/User", () => ({
  UserModel: { find: mocks.findUsers },
}));

vi.mock("~/core/models/tournament/GameRecord", () => ({
  GameRecordModel: { find: mocks.findGameRecords },
}));

vi.mock("~/services/leagueUserPictures.server", () => ({
  getLeagueUserPictureMapForLeagues: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("~/services/leagueApiCache.server", () => ({
  getLeagueApiCache: () => ({
    get: () => undefined,
    set: mocks.setCache,
  }),
}));

import { loader } from "./player-standings";

const leagueId = new mongoose.Types.ObjectId("68dd947b149082099405b7e1");
const phaseTwoStart = "2026-09-01T00:00:00.000Z";
const teamIds = [1, 2, 3, 4].map(
  (id) => new mongoose.Types.ObjectId(id.toString().padStart(24, "0"))
);
const memberIds = [11, 12, 13, 14].map(
  (id) => new mongoose.Types.ObjectId(id.toString().padStart(24, "0"))
);
const guestId = new mongoose.Types.ObjectId("000000000000000000000020");

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

describe("player standings API phase carry-over", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);

    const config: LeagueTypeConfig = {
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
    const teams: Pick<
      Team,
      "_id" | "displayName" | "leagueId" | "roster"
    >[] = teamIds.map((_id, index) => ({
      _id,
      displayName: `Team ${index + 1}`,
      leagueId,
      roster: {
        captain: memberIds[index],
        members: [memberIds[index]],
        substitutes: [],
      },
    }));
    const phaseOneGame = {
      _id: new mongoose.Types.ObjectId("000000000000000000000101"),
      gameId: "phase-one",
      league: leagueId,
      startTime: new Date("2026-08-15T20:00:00.000Z"),
      phaseId: "regular",
      isValid: true,
      results: memberIds.map((userId, index) => ({
        userId,
        score: [40000, 30000, 20000, 10000][index],
        place: index + 1,
      })),
    };
    const phaseTwoPlayers = [
      memberIds[0],
      memberIds[2],
      memberIds[3],
      guestId,
    ];
    const phaseTwoGame = {
      _id: new mongoose.Types.ObjectId("000000000000000000000102"),
      gameId: "phase-two",
      league: leagueId,
      startTime: new Date("2026-09-15T20:00:00.000Z"),
      phaseId: "finals",
      isValid: true,
      results: phaseTwoPlayers.map((userId, index) => ({
        userId,
        score: [40000, 30000, 20000, 10000][index],
        place: index + 1,
      })),
    };
    const games = [phaseOneGame, phaseTwoGame];

    mocks.findLeagues.mockReturnValue(
      selectedLean([
        {
          _id: leagueId,
          officialSubstitutes: [],
          rulesConfig: { gameRules: "MLEAGUE", isTeamMode: true },
          phaseCutoffTimes: [new Date(phaseTwoStart)],
          leagueTypeConfig: config,
        },
      ])
    );
    mocks.findTeams.mockImplementation(
      (filter: { _id?: { $in: mongoose.Types.ObjectId[] } }) =>
        selectedLean(
          filter._id
            ? teams.filter((team) =>
                filter._id!.$in.some((id) => id.equals(team._id))
              )
            : teams
        )
    );
    mocks.findGames.mockImplementation(
      (filter: {
        isValid?: boolean;
        "results.userId"?: { $in: mongoose.Types.ObjectId[] };
        startTime?: { $gte?: Date; $lte?: Date };
      }) =>
        selectedLean(
          games.filter((game) => {
            const playerFilter = filter["results.userId"];
            return (
              (filter.isValid === undefined ||
                filter.isValid === game.isValid) &&
              (!filter.startTime?.$gte ||
                game.startTime >= filter.startTime.$gte) &&
              (!filter.startTime?.$lte ||
                game.startTime <= filter.startTime.$lte) &&
              (!playerFilter ||
                game.results.some((result) =>
                  playerFilter.$in.some((id) => id.equals(result.userId))
                ))
            );
          })
        )
    );
    mocks.findGameRecords.mockImplementation(
      (filter: { gameId: { $in: string[] } }) =>
        selectedLean(
          filter.gameId.$in.includes(phaseTwoGame.gameId)
            ? [
                {
                  gameId: phaseTwoGame.gameId,
                  byUserData: phaseTwoGame.results.map((result, index) => ({
                    userDbId: result.userId,
                    teamDbId:
                      teams.find((team) =>
                        team.roster.members.some((id) =>
                          id.equals(result.userId)
                        )
                      )?._id ?? null,
                    teamName:
                      teams.find((team) =>
                        team.roster.members.some((id) =>
                          id.equals(result.userId)
                        )
                      )?.displayName ?? null,
                    score: result.score,
                    place: index + 1,
                    roundEvents: [],
                  })),
                },
              ]
            : []
        )
    );
    mocks.findUsers.mockReturnValue(
      selectedLean(
        [...memberIds, guestId].map((_id, index) => ({
          _id,
          name: `Player ${index + 1}`,
          avatarUrl: null,
        }))
      )
    );
  });

  it("adds retained scores and excludes teams that did not qualify", async () => {
    const searchParams = new URLSearchParams({
      leagueIds: leagueId.toString(),
      entityType: "team",
      phaseFilter: "phase1",
      startDate: phaseTwoStart,
    });
    const response = await loader({
      request: new Request(
        `http://localhost/api/player-standings?${searchParams.toString()}`
      ),
      params: {},
      context: {},
      unstable_pattern: "/api/player-standings",
    });

    expect(response.status).toBe(200);
    const { standings } = await response.json();
    expect(
      standings.map(
        (standing: {
          label: string;
          totalScore: number;
          gameCount: number;
        }) => ({
          label: standing.label,
          totalScore: standing.totalScore,
          gameCount: standing.gameCount,
        })
      )
    ).toEqual([
      { label: "Team 1", totalScore: 90, gameCount: 1 },
      { label: "Team 2", totalScore: 5, gameCount: 0 },
    ]);
  });
});

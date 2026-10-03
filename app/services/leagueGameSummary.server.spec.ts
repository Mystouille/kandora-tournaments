import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  game: { findById: vi.fn(), find: vi.fn() },
  league: { findOne: vi.fn() },
  team: { find: vi.fn() },
  user: { find: vi.fn() },
  leagueUser: { find: vi.fn() },
  record: { findOne: vi.fn(), find: vi.fn() },
  replay: { findOne: vi.fn(), find: vi.fn() },
  bracket: { findOne: vi.fn() },
  schedule: { find: vi.fn() },
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connect,
}));
vi.mock("~/core/models/tournament/Game", () => ({ GameModel: mocks.game }));
vi.mock("~/core/models/tournament/League", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/core/models/tournament/League")>()),
  LeagueModel: mocks.league,
}));
vi.mock("~/core/models/tournament/LeagueTypeConfig", () => ({
  LeagueTypeConfigModel: {},
  LeagueTypeConfigModelName: "LeagueTypeConfig",
}));
vi.mock("~/core/models/tournament/Team", () => ({ TeamModel: mocks.team }));
vi.mock("~/core/models/shared/User", () => ({ UserModel: mocks.user }));
vi.mock("~/core/models/tournament/LeagueUser", () => ({
  LeagueUserModel: mocks.leagueUser,
}));
vi.mock("~/core/models/tournament/GameRecord", () => ({
  GameRecordModel: mocks.record,
}));
vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: mocks.replay,
}));
vi.mock("~/core/models/tournament/Bracket", () => ({
  BracketModel: mocks.bracket,
}));
vi.mock("~/core/models/tournament/ScheduledGame", () => ({
  ScheduledGameModel: mocks.schedule,
}));

import { loadLeagueGameSummary } from "./leagueGameSummary.server";

const id = "100000000000000000000001";
const leagueId = new mongoose.Types.ObjectId("200000000000000000000001");
const playerIds = [1, 2, 3, 4].map(
  (i) => new mongoose.Types.ObjectId(`30000000000000000000000${i}`)
);

function query(value: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    populate: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

function game() {
  return {
    _id: new mongoose.Types.ObjectId(id),
    gameId: "native-id",
    league: leagueId,
    platform: "IRL",
    startTime: new Date("2026-08-01T12:00:00Z"),
    endTime: new Date("2026-08-01T13:00:00Z"),
    isValid: true,
    results: playerIds.map((userId, i) => ({
      userId,
      score: [40000, 30000, 20000, 10000][i],
      place: i + 1,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.game.findById.mockReturnValue(query(game()));
  mocks.game.find.mockReturnValue(query([game()]));
  mocks.league.findOne.mockReturnValue(
    query({
      _id: leagueId,
      name: "Summer League",
      isDisplayed: true,
      rulesConfig: { gameRules: "MLEAGUE", isTeamMode: false },
      leagueTypeConfig: null,
      phaseCutoffTimes: [],
      officialSubstitutes: [],
    })
  );
  mocks.team.find.mockReturnValue(query([]));
  mocks.user.find.mockReturnValue(
    query(
      playerIds.map((_id, i) => ({
        _id,
        name: `Player ${i + 1}`,
        avatarUrl: null,
        passwordHash: "must-not-be-serialized",
      }))
    )
  );
  mocks.leagueUser.find.mockReturnValue(
    query([
      {
        userId: playerIds[0],
        isParticipant: true,
        pictures: {
          fullPicture: "/api/uploads/portrait.webp",
          croppedPicture: "/api/uploads/avatar.webp",
        },
      },
    ])
  );
  mocks.record.findOne.mockReturnValue(query(null));
  mocks.record.find.mockReturnValue(query([]));
  mocks.replay.findOne.mockReturnValue(query(null));
  mocks.replay.find.mockReturnValue(query([]));
  mocks.bracket.findOne.mockReturnValue(query(null));
  mocks.schedule.find.mockReturnValue(query([]));
});

describe("league game summary loading", () => {
  it.each([true, false])(
    "provides the team's watermark logo separately from portraits (team mode: %s)",
    async (isTeamMode) => {
      mocks.league.findOne.mockReturnValue(
        query({
          _id: leagueId,
          name: "League with logos",
          rulesConfig: { gameRules: "MLEAGUE", isTeamMode },
          leagueTypeConfig: null,
          phaseCutoffTimes: [],
          officialSubstitutes: [],
        })
      );
      mocks.team.find.mockReturnValue(
        query([
          {
            _id: new mongoose.Types.ObjectId("400000000000000000000001"),
            displayName: "Team with a logo",
            color: "#1f77b4",
            roster: { members: playerIds, substitutes: [] },
            finalsRoster: null,
            pictures: {
              fullPicture: "/api/uploads/team-full.webp",
              croppedPicture: "/api/uploads/team-cropped.webp",
              summaryCenterY: 0.25,
            },
          },
        ])
      );
      const summary = await loadLeagueGameSummary(id);
      expect(
        summary.players.every(
          (player) => player.teamLogoUrl === "/api/uploads/team-full.webp"
        )
      ).toBe(true);
      expect(summary.players[0].imageUrl).toBe("/api/uploads/portrait.webp");
      expect(
        summary.players.every((player) => player.teamLogoCenterY === 0.25)
      ).toBe(true);
      if (summary.standings.status !== "available") {
        throw new Error("The logo fixture must have standings");
      }
      expect(
        summary.standings.data.every(
          (row) => row.teamLogoUrl === "/api/uploads/team-full.webp"
        )
      ).toBe(true);
      expect(
        summary.standings.data.every((row) => row.teamLogoCenterY === 0.25)
      ).toBe(true);
      expect(summary.standings.data[0].imageUrl).toBe(
        isTeamMode
          ? "/api/uploads/team-cropped.webp"
          : "/api/uploads/avatar.webp"
      );
    }
  );

  it.each([
    { isTeamMode: false, tagged: true },
    { isTeamMode: true, tagged: true },
    { isTeamMode: false, tagged: false },
    { isTeamMode: true, tagged: false },
  ])(
    "counts only the selected phase's schedule (team mode: $isTeamMode, phase tags: $tagged)",
    async ({ isTeamMode, tagged }) => {
      const teamIds = playerIds.map(
        (_, index) =>
          new mongoose.Types.ObjectId(`40000000000000000000000${index + 1}`)
      );
      const participantIds = isTeamMode ? teamIds : playerIds;
      const selected = { ...game(), phaseId: tagged ? "final" : null };
      const previous = {
        ...game(),
        _id: new mongoose.Types.ObjectId("100000000000000000000002"),
        gameId: "earlier-id",
        startTime: new Date("2026-07-31T12:00:00Z"),
        endTime: new Date("2026-07-31T13:00:00Z"),
        phaseId: tagged ? "regular" : null,
      };
      mocks.game.findById.mockReturnValue(query(selected));
      mocks.game.find.mockReturnValue(query([previous, selected]));
      mocks.league.findOne.mockReturnValue(
        query({
          _id: leagueId,
          name: "Scheduled league",
          hasSchedule: true,
          rulesConfig: { gameRules: "MLEAGUE", isTeamMode },
          leagueTypeConfig: {
            displayName: "Scheduled league",
            isTeamMode,
            regularPhases: [
              {
                id: "regular",
                scoring: { type: "cumulative" },
                progression: {
                  advancingCount: 4,
                  scoreRetention: { num: 1, den: 2 },
                },
              },
              { id: "final", scoring: { type: "cumulative" } },
            ],
          },
          phaseCutoffTimes: [new Date("2026-08-01T00:00:00Z")],
          officialSubstitutes: [],
        })
      );
      if (isTeamMode) {
        mocks.team.find.mockReturnValue(
          query(
            teamIds.map((_id, index) => ({
              _id,
              displayName: `Team ${index + 1}`,
              roster: { members: [playerIds[index]], substitutes: [] },
              finalsRoster: null,
            }))
          )
        );
      }
      mocks.schedule.find.mockReturnValue(
        query([
          {
            phaseId: tagged ? "regular" : null,
            scheduledAt: new Date("2026-07-30T12:00:00Z"),
            slots: participantIds.map((participantId) => ({ participantId })),
          },
          {
            phaseId: tagged ? "regular" : null,
            scheduledAt: new Date("2026-07-31T12:00:00Z"),
            slots: participantIds.map((participantId) => ({ participantId })),
          },
          {
            phaseId: tagged ? "final" : null,
            scheduledAt: selected.startTime,
            slots: [
              { participantId: participantIds[0] },
              { participantId: participantIds[1] },
              { participantId: null },
              { participantId: null },
            ],
          },
        ])
      );
      const summary = await loadLeagueGameSummary(id);
      if (summary.standings.status !== "available") {
        throw new Error("The scheduled summary must have standings");
      }
      expect(summary.standings.data.map((row) => row.totalGames)).toEqual([
        1,
        1,
        null,
        null,
      ]);
      expect(summary.standings.data.map((row) => row.gamesPlayed)).toEqual([
        1, 1, 1, 1,
      ]);
      expect(summary.standings.data[0].totalScore).toBe(90);
      expect(mocks.schedule.find).toHaveBeenCalledWith({ league: leagueId });
    }
  );

  it("normalizes hexadecimal game IDs before historical lookup", async () => {
    const canonicalId = "abcdef000000000000000001";
    const selected = {
      ...game(),
      _id: new mongoose.Types.ObjectId(canonicalId),
    };
    mocks.game.findById.mockReturnValue(query(selected));
    mocks.game.find.mockReturnValue(query([selected]));
    const summary = await loadLeagueGameSummary(canonicalId.toUpperCase());
    expect(summary.id).toBe(canonicalId);
    expect(summary.standings.status).toBe("available");
    if (summary.standings.status === "available") {
      expect(
        summary.standings.data.every((row) => row.totalGames === null)
      ).toBe(true);
    }
    expect(mocks.schedule.find).not.toHaveBeenCalled();
  });

  it("uses saved completion metadata without fetching platform data", async () => {
    const selected = { ...game(), endTime: undefined };
    mocks.game.findById.mockReturnValue(query(selected));
    mocks.game.find.mockReturnValue(query([selected]));
    mocks.record.findOne.mockReturnValue(
      query({
        gameId: selected.gameId,
        endTime: new Date("2026-08-01T13:00:00Z"),
        byUserData: [],
      })
    );
    const summary = await loadLeagueGameSummary(id);
    expect(summary.endTime).toBe("2026-08-01T13:00:00.000Z");
    expect(summary.standings.status).toBe("available");
  });

  it("reuses the neutral replay projection when only a saved replay exists", async () => {
    const selected = { ...game(), platform: "majsoul" };
    mocks.game.findById.mockReturnValue(query(selected));
    mocks.game.find.mockReturnValue(query([selected]));
    mocks.replay.findOne.mockReturnValue(
      query({
        source: "majsoul",
        sourceGameId: selected.gameId,
        endedAt: selected.endTime.getTime(),
        seats: selected.results.map((result, seat) => ({
          seat,
          userDbId: result.userId,
          displayName: `Native ${seat}`,
          finalScore: result.score,
          place: result.place,
        })),
        events: [
          {
            type: "hand_start",
            round: 0,
            dealer: 0,
            doraIndicators: ["1z"],
            scores: [25000, 25000, 25000, 25000],
          },
          { type: "win", seat: 0, loser: 3 },
          {
            type: "hand_end",
            reason: "ron",
            scores: [40000, 30000, 20000, 10000],
          },
          {
            type: "match_end",
            reason: "round_limit",
            finalScores: selected.results.map((result, seat) => ({
              seat,
              score: result.score,
              place: result.place,
            })),
          },
        ],
      })
    );
    const summary = await loadLeagueGameSummary(id);
    expect(summary.points.status).toBe("available");
    expect(summary.stats).toMatchObject({
      status: "available",
      data: {
        [playerIds[0].toString()]: { wins: 1, dealIns: 0 },
        [playerIds[3].toString()]: { wins: 0, dealIns: 1 },
      },
    });
  });

  it("returns scores and standings for a manual game without inventing details", async () => {
    const summary = await loadLeagueGameSummary(id);
    expect(summary.id).toBe(id);
    expect(summary.players.map((player) => player.gamePoints)).toEqual([
      60, 10, -20, -50,
    ]);
    expect(summary.stats).toEqual({
      status: "unavailable",
      reason: "missingRecord",
    });
    expect(summary.points).toEqual({
      status: "unavailable",
      reason: "missingRecord",
    });
    expect(summary.standings.status).toBe("available");
    expect(summary.players[0].imageUrl).toBe("/api/uploads/portrait.webp");
    expect(
      summary.players.every((player) => player.teamLogoCenterY === 0.5)
    ).toBe(true);
    expect(summary.players.every((player) => player.teamLogoUrl === null)).toBe(
      true
    );
    expect(JSON.stringify(summary)).not.toContain("must-not-be-serialized");
    expect(mocks.league.findOne).toHaveBeenCalledWith({
      _id: leagueId,
      isDisplayed: true,
    });
  });

  it("joins saved statistics by user ID, independently of result order", async () => {
    const selected = game();
    selected.results.reverse();
    mocks.game.findById.mockReturnValue(query(selected));
    mocks.record.findOne.mockReturnValue(
      query({
        gameId: "native-id",
        endTime: selected.endTime,
        byUserData: playerIds.map((userDbId, seat) => ({
          userDbId,
          seat,
          nickname: `Native ${seat}`,
          roundEvents: [
            {
              hasRiichi: seat === 0,
              isWinner: seat === 0,
              gotRonned: seat === 3,
              ryuukyoku: false,
            },
          ],
        })),
      })
    );
    const summary = await loadLeagueGameSummary(id);
    expect(summary.players.map((player) => player.seat)).toEqual([0, 1, 2, 3]);
    expect(summary.stats).toMatchObject({
      status: "available",
      data: {
        [playerIds[0].toString()]: { riichis: 1, wins: 1, dealIns: 0 },
        [playerIds[3].toString()]: { riichis: 0, wins: 0, dealIns: 1 },
      },
    });
    expect(summary.handCount).toBe(1);
    expect(summary.drawCount).toBe(0);
  });

  it("rejects malformed, missing and hidden-league games", async () => {
    await expect(loadLeagueGameSummary("not-an-id")).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.connect).not.toHaveBeenCalled();
    mocks.game.findById.mockReturnValueOnce(query(null));
    await expect(loadLeagueGameSummary(id)).rejects.toMatchObject({
      status: 404,
    });
    mocks.league.findOne.mockReturnValueOnce(query(null));
    await expect(loadLeagueGameSummary(id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("does not present listing placeholders as completed games", async () => {
    const selected = game();
    selected.results.forEach((result) => {
      result.place = 0;
    });
    mocks.game.findById.mockReturnValue(query(selected));
    await expect(loadLeagueGameSummary(id)).rejects.toMatchObject({
      status: 409,
    });
  });
});

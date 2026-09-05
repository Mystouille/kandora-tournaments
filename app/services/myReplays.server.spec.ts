import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findReplays: vi.fn(),
  findMatches: vi.fn(),
  aggregateReviews: vi.fn(),
  findGames: vi.fn(),
  findLeagues: vi.fn(),
}));

vi.mock("~/core/models/shared/User", () => ({
  UserModel: { findOne: mocks.findUser },
}));
vi.mock("~/core/models/game/ReplayLog", () => ({
  ReplayLogModel: { find: mocks.findReplays },
}));
vi.mock("~/core/models/game/Match", () => ({
  MatchModel: { find: mocks.findMatches },
}));
vi.mock("~/core/models/game/ReplayReview", () => ({
  ReplayReviewModel: { aggregate: mocks.aggregateReviews },
}));
vi.mock("~/core/models/tournament/Game", () => ({
  GameModel: { find: mocks.findGames },
}));
vi.mock("~/core/models/tournament/League", () => ({
  LeagueModel: { find: mocks.findLeagues },
}));

import { getMyReplays } from "./myReplays.server";

function queryResult(value: unknown) {
  const query = {
    select: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  };
  query.select.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return query;
}

describe("getMyReplays", () => {
  const userId = "507f1f77bcf86cd799439011";
  const replayId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439012");
  const nativeReplayId = new mongoose.Types.ObjectId(
    "507f1f77bcf86cd799439013"
  );
  const leagueId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439014");
  const riichiCityReplayId = new mongoose.Types.ObjectId(
    "507f1f77bcf86cd799439015"
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockReturnValue(
      queryResult({
        majsoulIdentity: { name: "Soul Name" },
        tenhouIdentity: { name: "TenhouName" },
        riichiCityIdentity: { name: "City Name" },
      })
    );
    mocks.findReplays
      .mockReturnValueOnce(
        queryResult([
          {
            _id: replayId,
            source: "tenhou",
            sourceGameId: "gm-tournament",
            ruleSet: "tenhou",
            startedAt: 1_700_000_002_000,
            endedAt: 1_700_000_003_000,
            creationTriggeredBy: new mongoose.Types.ObjectId(userId),
            seats: [
              {
                seat: 0,
                displayName: "TenhouName",
                finalScore: 31_200,
                place: 2,
                userDbId: new mongoose.Types.ObjectId(userId),
              },
              {
                seat: 2,
                displayName: "Reviewed Player",
                finalScore: 42_100,
                place: 1,
              },
            ],
          },
          {
            _id: riichiCityReplayId,
            source: "riichicity",
            sourceGameId: "bad-legacy-date",
            ruleSet: "riichicity",
            startedAt: 1_697_609_642_240_000,
            endedAt: 1_697_609_700_000_000,
            seats: [{ seat: 0, displayName: "City Name" }],
          },
        ])
      )
      .mockReturnValueOnce(
        queryResult([
          {
            _id: nativeReplayId,
            source: "ingame",
            sourceGameId: "native-1",
            ruleSet: "m-league",
            startedAt: 1_700_000_001_000,
            endedAt: 1_700_000_001_500,
            seats: [{ seat: 3, displayName: "Native Player" }],
          },
        ])
      );
    mocks.findMatches.mockReturnValue(
      queryResult([
        {
          _id: "native-1",
          ruleSet: "m-league",
          startedAt: new Date(1_700_000_001_000),
          endedAt: new Date(1_700_000_001_500),
          players: [{ userId, seat: 3 }],
        },
      ])
    );
    mocks.aggregateReviews.mockReturnValue(
      queryResult([
        {
          shortId: "review-1",
          source: "tenhou",
          sourceGameId: "gm-tournament",
          target: { name: "Reviewed Player" },
          commentedByUser: true,
          updatedAt: new Date(1_700_000_004_000),
          commentCount: 3,
        },
        {
          shortId: "review-target",
          source: "tenhou",
          sourceGameId: "gm-tournament",
          target: {
            user: new mongoose.Types.ObjectId(userId),
            name: "Canonical Target",
          },
          commentedByUser: false,
          updatedAt: new Date(1_700_000_006_000),
          commentCount: 1,
        },
        {
          shortId: "review-native-target",
          source: "ingame",
          sourceGameId: "native-1",
          target: {
            user: new mongoose.Types.ObjectId(userId),
            name: "Current Native Name",
          },
          commentedByUser: false,
          updatedAt: new Date(1_700_000_005_500),
          commentCount: 2,
        },
        {
          shortId: "review-2",
          source: "majsoul",
          sourceGameId: "review-only",
          commentedByUser: true,
          updatedAt: new Date(1_700_000_005_000),
          commentCount: 0,
        },
      ])
    );
    mocks.findGames.mockReturnValue(
      queryResult([
        {
          gameId: "gm-tournament",
          platform: "tenhou",
          rules: "MLEAGUE",
          league: leagueId,
          replayLogRef: replayId,
          startTime: new Date(1_700_000_002_100),
        },
        {
          gameId: "gm-tournament",
          platform: "tenhou",
          rules: "WRC",
          replayLogRef: replayId,
          startTime: new Date(1_700_000_002_200),
        },
      ])
    );
    mocks.findLeagues.mockReturnValue(
      queryResult([
        {
          _id: leagueId,
          name: "Summer Cup",
          isDisplayed: true,
        },
      ])
    );
  });

  it("merges replay, native-match, review, and tournament relationships", async () => {
    const result = await getMyReplays(userId);

    expect(result?.map((group) => group.sourceGameId)).toEqual([
      "gm-tournament",
      "native-1",
      "bad-legacy-date",
      "review-only",
    ]);
    expect(result?.[0]).toMatchObject({
      context: {
        kind: "tournament",
        tournamentName: "Summer Cup",
        tournamentUrl: "/online-tournaments/summer-cup/presentation",
      },
      ruleset: { id: "m-league", label: "M-League" },
      reasons: ["created", "played"],
      seats: [
        {
          seat: 2,
          displayName: "Reviewed Player",
          finalScore: 42_100,
          place: 1,
        },
        {
          seat: 0,
          displayName: "TenhouName",
          finalScore: 31_200,
          place: 2,
        },
      ],
      commentCount: 4,
      reviews: [
        {
          shortId: "review-target",
          reviewedPlayerName: "Canonical Target",
          reasons: ["reviewed"],
          commentCount: 1,
        },
        {
          shortId: "review-1",
          reviewedPlayerName: "Reviewed Player",
          reasons: ["commented"],
          commentCount: 3,
          reviewUrl: "/watch/replay/gm-tournament?review=review-1",
        },
      ],
    });
    expect(result?.[1]).toMatchObject({
      context: { kind: "friendly" },
      ruleset: { id: "m-league", label: "M-League" },
      reasons: ["played"],
      commentCount: 2,
      reviews: [
        {
          shortId: "review-native-target",
          reviewedPlayerName: "Current Native Name",
          reasons: ["reviewed"],
        },
      ],
    });
    expect(result?.[2]).toMatchObject({
      gameDate: 1_697_609_642_240,
      reasons: ["played"],
      context: { kind: "external" },
      ruleset: {
        id: "platform:riichicity",
        label: "Riichi City",
      },
    });
    expect(result?.[3]).toMatchObject({
      gameDate: null,
      context: { kind: "external" },
      ruleset: {
        id: "platform:majsoul",
        label: "Mahjong Soul",
      },
      reasons: [],
      reviews: [
        {
          shortId: "review-2",
          reviewedPlayerName: null,
          reasons: ["commented"],
          commentCount: 0,
        },
      ],
    });
  });

  it("deduplicates an external replay alias against its tournament game", async () => {
    const sourceGameId = "2026082104gm-0009-19370-7618936d";
    const externalReplayId = new mongoose.Types.ObjectId(
      "507f1f77bcf86cd799439016"
    );
    mocks.findReplays.mockReset();
    mocks.findReplays.mockReturnValue(
      queryResult([
        {
          _id: replayId,
          source: "tenhou",
          sourceGameId,
          ruleSet: "tenhou",
          startedAt: 1_700_000_002_000,
          endedAt: 1_700_000_003_000,
          seats: [{ seat: 0, displayName: "TenhouName" }],
        },
        {
          _id: externalReplayId,
          source: "tenhou",
          sourceGameId: `https://tenhou.net/0/?log=${sourceGameId}&tw=0`,
          ruleSet: "tenhou",
          startedAt: 1_700_000_002_000,
          endedAt: 1_700_000_003_000,
          seats: [{ seat: 0, displayName: "TenhouName" }],
        },
      ])
    );
    mocks.findMatches.mockReturnValue(queryResult([]));
    mocks.aggregateReviews.mockReturnValue(queryResult([]));
    mocks.findGames.mockReturnValue(
      queryResult([
        {
          gameId: sourceGameId,
          platform: "tenhou",
          rules: "MLEAGUE",
          league: leagueId,
          replayLogRef: replayId,
          startTime: new Date(1_700_000_002_100),
        },
      ])
    );

    const result = await getMyReplays(userId);

    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({
      source: "tenhou",
      sourceGameId,
      context: {
        kind: "tournament",
        tournamentName: "Summer Cup",
      },
      reasons: ["played"],
    });
  });

  it("merges a gameplay-matching external replay despite timestamp drift", async () => {
    const tournamentSourceGameId = "2026082503gm-0009-19370-0e3a95d1";
    const externalSourceGameId = "66B555F2";
    const rematchSourceGameId = "66B555F3";
    const externalReplayId = new mongoose.Types.ObjectId(
      "507f1f77bcf86cd799439016"
    );
    const rematchReplayId = new mongoose.Types.ObjectId(
      "507f1f77bcf86cd799439017"
    );
    const seats = [
      {
        seat: 0,
        displayName: "TenhouName",
        finalScore: 46_000,
        place: 1,
      },
      {
        seat: 1,
        displayName: "Player Two",
        finalScore: 19_400,
        place: 2,
      },
      {
        seat: 2,
        displayName: "Player Three",
        finalScore: 19_300,
        place: 3,
      },
      {
        seat: 3,
        displayName: "Player Four",
        finalScore: 15_300,
        place: 4,
      },
    ];
    const tournamentEvents = [
      { type: "match_start", scores: [25_000, 25_000, 25_000, 25_000] },
      {
        type: "hand_start",
        round: 0,
        liveWall: ["1m", "2m"],
        deadWall: ["3m", "4m"],
      },
      { type: "draw", seat: 0, tile: "1m" },
      { type: "discard", seat: 0, tile: "1m" },
      {
        type: "match_end",
        finalScores: seats.map(({ finalScore }) => finalScore),
      },
    ];
    const externalEvents = tournamentEvents.map((event) => {
      const {
        liveWall: _liveWall,
        deadWall: _deadWall,
        ...visibleEvent
      } = event;
      return visibleEvent;
    });
    mocks.findReplays.mockReset();
    mocks.findReplays
      .mockReturnValueOnce(
        queryResult([
          {
            _id: replayId,
            source: "tenhou",
            sourceGameId: tournamentSourceGameId,
            ruleSet: "tenhou",
            startedAt: 1_787_594_400_000,
            endedAt: 1_787_594_400_000,
            creationTriggeredBy: new mongoose.Types.ObjectId(userId),
            seats,
          },
          {
            _id: externalReplayId,
            source: "tenhou",
            sourceGameId: externalSourceGameId,
            ruleSet: "tenhou-default",
            startedAt: 1_787_598_017_784,
            endedAt: 1_787_600_597_636,
            seats: [...seats].reverse(),
          },
          {
            _id: rematchReplayId,
            source: "tenhou",
            sourceGameId: rematchSourceGameId,
            ruleSet: "tenhou-default",
            startedAt: 1_787_598_017_784,
            endedAt: 1_787_600_597_636,
            seats,
          },
        ])
      )
      .mockReturnValueOnce(
        queryResult([
          { _id: replayId, events: tournamentEvents },
          { _id: externalReplayId, events: externalEvents },
          {
            _id: rematchReplayId,
            events: externalEvents.map((event) =>
              event.type === "draw" ? { ...event, tile: "2m" } : event
            ),
          },
        ])
      );
    mocks.findMatches.mockReturnValue(queryResult([]));
    mocks.aggregateReviews.mockReturnValue(
      queryResult([
        {
          shortId: "external-review",
          source: "tenhou",
          sourceGameId: externalSourceGameId,
          target: { name: "TenhouName" },
          commentedByUser: true,
          updatedAt: new Date(1_700_000_001_000),
          commentCount: 2,
        },
      ])
    );
    mocks.findGames.mockReturnValue(
      queryResult([
        {
          gameId: tournamentSourceGameId,
          platform: "tenhou",
          rules: "MLEAGUE",
          league: leagueId,
          replayLogRef: replayId,
          startTime: new Date(1_787_594_400_000),
        },
      ])
    );

    const result = await getMyReplays(userId);
    const tournamentReplay = result?.find(
      (group) => group.context.kind === "tournament"
    );

    expect(result).toHaveLength(2);
    expect(tournamentReplay).toMatchObject({
      source: "tenhou",
      sourceGameId: tournamentSourceGameId,
      context: {
        kind: "tournament",
        tournamentName: "Summer Cup",
      },
      reasons: ["created", "played"],
      commentCount: 2,
      reviews: [
        expect.objectContaining({
          shortId: "external-review",
          reasons: ["commented"],
          commentCount: 2,
        }),
      ],
    });
    expect(
      result?.find((group) => group.context.kind === "external")
    ).toMatchObject({
      sourceGameId: rematchSourceGameId,
      reasons: ["played"],
    });
  });

  it("builds identity-scoped queries and excludes heavy payload fields", async () => {
    await getMyReplays(userId);

    const [replayFilter, replayProjection] = mocks.findReplays.mock.calls[0];
    expect(replayFilter.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ creationTriggeredBy: expect.anything() }),
        {
          source: "ingame",
          "seats.userDbId": expect.anything(),
        },
        { source: "majsoul", "seats.displayName": "Soul Name" },
        { source: "tenhou", "seats.displayName": "TenhouName" },
        { source: "riichicity", "seats.displayName": "City Name" },
      ])
    );
    expect(replayProjection).not.toHaveProperty("events");
    expect(replayProjection).toMatchObject({
      creationTriggeredBy: 1,
      "seats.seat": 1,
      "seats.userDbId": 1,
      "seats.displayName": 1,
      "seats.finalScore": 1,
      "seats.place": 1,
    });

    const pipeline = mocks.aggregateReviews.mock.calls[0][0];
    expect(pipeline[0].$match.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ "reviewers.user": expect.anything() }),
        expect.objectContaining({ "edits.author": expect.anything() }),
        expect.objectContaining({ "target.user": expect.anything() }),
      ])
    );
    expect(pipeline[1].$project).not.toHaveProperty("edits");
    expect(pipeline[1].$project).not.toHaveProperty("drawing");
    expect(pipeline[1].$project.target).toBe(1);
    expect(pipeline[1].$project.commentedByUser).toBeDefined();
    expect(mocks.findMatches).toHaveBeenCalledWith(
      { status: "finished", "players.userId": userId },
      { ruleSet: 1, startedAt: 1, endedAt: 1 }
    );
  });

  it("rejects invalid or deleted user identities before querying history", async () => {
    await expect(getMyReplays("not-an-object-id")).resolves.toBeNull();
    expect(mocks.findUser).not.toHaveBeenCalled();

    mocks.findUser.mockReturnValue(queryResult(null));
    await expect(getMyReplays(userId)).resolves.toBeNull();
    expect(mocks.findReplays).not.toHaveBeenCalled();
  });
});

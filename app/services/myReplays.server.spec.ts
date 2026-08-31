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
              { seat: 0, displayName: "TenhouName" },
              { seat: 2, displayName: "Reviewed Player" },
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
      "seats.userDbId": 1,
      "seats.displayName": 1,
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

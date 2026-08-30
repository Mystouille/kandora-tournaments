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
            startedAt: 2_000,
            endedAt: 3_000,
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
            startedAt: 1_000,
            endedAt: 1_500,
          },
        ])
      );
    mocks.findMatches.mockReturnValue(
      queryResult([
        {
          _id: "native-1",
          ruleSet: "m-league",
          startedAt: new Date(1_000),
          endedAt: new Date(1_500),
        },
      ])
    );
    mocks.aggregateReviews.mockReturnValue(
      queryResult([
        {
          shortId: "review-1",
          source: "tenhou",
          sourceGameId: "gm-tournament",
          updatedAt: new Date(4_000),
          commentCount: 3,
        },
        {
          shortId: "review-2",
          source: "majsoul",
          sourceGameId: "review-only",
          updatedAt: new Date(5_000),
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
          startTime: new Date(2_100),
        },
        {
          gameId: "gm-tournament",
          platform: "tenhou",
          rules: "WRC",
          replayLogRef: replayId,
          startTime: new Date(2_200),
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
      "review-only",
    ]);
    expect(result?.[0]).toMatchObject({
      context: {
        kind: "tournament",
        tournamentName: "Summer Cup",
        tournamentUrl: "/online-tournaments/summer-cup/presentation",
      },
      ruleset: { id: "m-league", label: "M-League" },
      commentCount: 3,
      reviews: [
        {
          shortId: "review-1",
          commentCount: 3,
          reviewUrl: "/watch/replay/gm-tournament?review=review-1",
        },
      ],
    });
    expect(result?.[1]).toMatchObject({
      context: { kind: "friendly" },
      ruleset: { id: "m-league", label: "M-League" },
    });
    expect(result?.[2]).toMatchObject({
      gameDate: null,
      context: { kind: "external" },
      ruleset: {
        id: "platform:majsoul",
        label: "Mahjong Soul",
      },
      reviews: [{ shortId: "review-2", commentCount: 0 }],
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

    const pipeline = mocks.aggregateReviews.mock.calls[0][0];
    expect(pipeline[0].$match.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ "reviewers.user": expect.anything() }),
        expect.objectContaining({ "edits.author": expect.anything() }),
      ])
    );
    expect(pipeline[1].$project).not.toHaveProperty("edits");
    expect(pipeline[1].$project).not.toHaveProperty("drawing");
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

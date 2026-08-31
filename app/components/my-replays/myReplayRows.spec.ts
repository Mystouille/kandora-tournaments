import { describe, expect, it } from "vitest";
import type { MyReplayGroup } from "~/types/myReplays";
import {
  DEFAULT_MY_REPLAY_SORT,
  EMPTY_MY_REPLAY_FILTERS,
  filterAndSortMyReplayGroups,
} from "./myReplayRows";

const groups: MyReplayGroup[] = [
  {
    key: "tenhou:newer",
    source: "tenhou",
    sourceGameId: "newer",
    reasons: ["created", "played"],
    gameDate: 2_000,
    context: { kind: "tournament", tournamentName: "Cup" },
    ruleset: { id: "wrc", label: "WRC" },
    replayUrl: "/watch/replay/newer",
    commentCount: 5,
    reviews: [
      {
        key: "review:older",
        shortId: "older",
        reviewedPlayerName: "Alice",
        reasons: ["commented", "reviewed"],
        lastModified: 2_500,
        commentCount: 2,
        reviewUrl: "/watch/replay/newer?review=older",
      },
      {
        key: "review:newest",
        shortId: "newest",
        reviewedPlayerName: "Alice",
        reasons: ["commented"],
        lastModified: 4_000,
        commentCount: 3,
        reviewUrl: "/watch/replay/newer?review=newest",
      },
    ],
  },
  {
    key: "ingame:older",
    source: "ingame",
    sourceGameId: "older",
    reasons: ["played"],
    gameDate: 1_000,
    context: { kind: "friendly" },
    ruleset: { id: "m-league", label: "M-League" },
    replayUrl: "/watch/replay/older",
    commentCount: 0,
    reviews: [],
  },
  {
    key: "majsoul:unknown-date",
    source: "majsoul",
    sourceGameId: "unknown-date",
    reasons: ["commented"],
    gameDate: null,
    context: { kind: "external" },
    ruleset: { id: "platform:majsoul", label: "Mahjong Soul" },
    replayUrl: "/watch/replay/unknown-date",
    commentCount: 1,
    reviews: [
      {
        key: "review:undated",
        shortId: "undated",
        reviewedPlayerName: null,
        reasons: ["commented"],
        lastModified: null,
        commentCount: 1,
        reviewUrl: "/watch/replay/unknown-date?review=undated",
      },
    ],
  },
];

describe("My Replays hierarchy filters", () => {
  it("retains replay parents and their review relationships", () => {
    const result = filterAndSortMyReplayGroups(
      groups,
      EMPTY_MY_REPLAY_FILTERS,
      DEFAULT_MY_REPLAY_SORT
    );

    expect(result.map((group) => group.sourceGameId)).toEqual([
      "newer",
      "older",
      "unknown-date",
    ]);
    expect(result[0].reviews).toHaveLength(2);
  });

  it("filters nested reviews and recomputes the visible parent count", () => {
    const result = filterAndSortMyReplayGroups(
      groups,
      {
        ...EMPTY_MY_REPLAY_FILTERS,
        lastModifiedRange: [3_000, 5_000],
      },
      DEFAULT_MY_REPLAY_SORT
    );

    expect(result).toHaveLength(1);
    expect(result[0].reviews.map((review) => review.shortId)).toEqual([
      "newest",
    ]);
    expect(result[0].commentCount).toBe(3);
  });

  it("combines group filters and keeps missing dates last", () => {
    const filtered = filterAndSortMyReplayGroups(
      groups,
      {
        ...EMPTY_MY_REPLAY_FILTERS,
        platforms: ["tenhou"],
        contexts: ["tournament"],
        rulesets: ["wrc"],
      },
      { field: "gameDate", order: "ascend" }
    );
    expect(filtered.map((group) => group.sourceGameId)).toEqual(["newer"]);

    const sorted = filterAndSortMyReplayGroups(
      groups,
      EMPTY_MY_REPLAY_FILTERS,
      { field: "gameDate", order: "ascend" }
    );
    expect(sorted.map((group) => group.sourceGameId)).toEqual([
      "older",
      "newer",
      "unknown-date",
    ]);
  });

  it("sorts groups and children by review activity", () => {
    const result = filterAndSortMyReplayGroups(
      groups,
      EMPTY_MY_REPLAY_FILTERS,
      { field: "lastModified", order: "descend" }
    );

    expect(result.map((group) => group.sourceGameId)).toEqual([
      "newer",
      "older",
      "unknown-date",
    ]);
    expect(result[0].reviews.map((review) => review.shortId)).toEqual([
      "newest",
      "older",
    ]);
  });

  it("filters multi-value parent reasons and matching review children", () => {
    const created = filterAndSortMyReplayGroups(
      groups,
      { ...EMPTY_MY_REPLAY_FILTERS, reasons: ["created"] },
      DEFAULT_MY_REPLAY_SORT
    );
    expect(created.map((group) => group.sourceGameId)).toEqual(["newer"]);
    expect(created[0].reviews).toEqual([]);

    const commented = filterAndSortMyReplayGroups(
      groups,
      { ...EMPTY_MY_REPLAY_FILTERS, reasons: ["commented"] },
      DEFAULT_MY_REPLAY_SORT
    );
    expect(commented.map((group) => group.sourceGameId)).toEqual([
      "newer",
      "unknown-date",
    ]);
    expect(commented[0].reviews).toHaveLength(2);

    const reviewed = filterAndSortMyReplayGroups(
      groups,
      { ...EMPTY_MY_REPLAY_FILTERS, reasons: ["reviewed"] },
      DEFAULT_MY_REPLAY_SORT
    );
    expect(reviewed.map((group) => group.sourceGameId)).toEqual(["newer"]);
    expect(reviewed[0].reviews.map((review) => review.shortId)).toEqual([
      "older",
    ]);
  });
});

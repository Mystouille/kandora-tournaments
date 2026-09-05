import { describe, expect, it } from "vitest";
import type { MyReplayApiGroup } from "./myReplaysApi";
import {
  activeReplayFilterCount,
  EMPTY_REPLAY_LIBRARY_FILTERS,
  filterReplayLibraryRows,
  offlineReplayRows,
  onlineReplayRows,
  replayLibraryFilterOptions,
} from "./replayLibrary";

const seats = [
  {
    seat: 0 as const,
    displayName: "Second",
    finalScore: 30_000,
    place: 2 as const,
  },
  {
    seat: 1 as const,
    displayName: "First",
    finalScore: 40_000,
    place: 1 as const,
  },
];

const onlineReplays: MyReplayApiGroup[] = [
  {
    key: "tenhou:newer",
    source: "tenhou",
    sourceGameId: "newer",
    reasons: ["played"],
    gameDate: 2_000,
    seats,
    context: { kind: "tournament", tournamentName: "Cup" },
    ruleset: { id: "wrc", label: "WRC" },
    replayUrl: "/watch/replay/newer",
    commentCount: 1,
    reviews: [
      {
        key: "review:newer",
        shortId: "newer",
        reviewedPlayerName: "First",
        reasons: ["commented"],
        lastModified: 2_500,
        commentCount: 1,
        reviewUrl: "/watch/replay/newer?review=newer",
      },
    ],
  },
  {
    key: "ingame:older",
    source: "ingame",
    sourceGameId: "older",
    reasons: ["played"],
    gameDate: 1_000,
    seats,
    context: { kind: "friendly" },
    ruleset: { id: "m-league", label: "M-League" },
    replayUrl: "/watch/replay/older",
    commentCount: 0,
    reviews: [],
  },
  {
    key: "majsoul:unknown",
    source: "majsoul",
    sourceGameId: "unknown",
    reasons: [],
    gameDate: null,
    seats: [],
    context: { kind: "external" },
    ruleset: { id: "platform:majsoul", label: "Mahjong Soul" },
    replayUrl: "/watch/replay/unknown",
    commentCount: 1,
    reviews: [
      {
        key: "review:unknown",
        shortId: "unknown",
        reviewedPlayerName: null,
        reasons: ["reviewed"],
        lastModified: null,
        commentCount: 1,
        reviewUrl: "/watch/replay/unknown?review=unknown",
      },
    ],
  },
];

describe("mobile replay library policy", () => {
  it("normalizes local summaries with canonical rules and placement order", () => {
    const rows = offlineReplayRows([
      {
        source: "ingame",
        sourceGameId: "local-1",
        ruleSet: "m-league",
        startedAt: 2_000,
        endedAt: 3_000,
        seats,
      },
    ]);

    expect(rows[0]).toMatchObject({
      key: "offline:ingame:local-1",
      mode: "offline",
      gameDate: 2_000,
      context: { kind: "friendly" },
      ruleset: { id: "m-league", label: "M-League" },
      replayUrl: null,
    });
    expect(rows[0].seats.map((seat) => seat.place)).toEqual([1, 2]);
  });

  it("applies inclusive shared and online-only filters", () => {
    const rows = onlineReplayRows(onlineReplays);
    const result = filterReplayLibraryRows(rows, "online", {
      ...EMPTY_REPLAY_LIBRARY_FILTERS,
      gameDateRange: [2_000, 2_000],
      rulesets: ["wrc"],
      sources: ["tenhou"],
      contexts: ["tournament"],
      reasons: ["commented"],
    });
    expect(result.map((row) => row.sourceGameId)).toEqual(["newer"]);

    const offline = offlineReplayRows([
      {
        source: "ingame",
        sourceGameId: "local-1",
        ruleSet: "m-league",
        startedAt: 2_000,
        endedAt: 3_000,
        seats,
      },
    ]);
    expect(
      filterReplayLibraryRows(offline, "offline", {
        ...EMPTY_REPLAY_LIBRARY_FILTERS,
        sources: ["tenhou"],
        contexts: ["tournament"],
        reasons: ["commented"],
      })
    ).toHaveLength(1);
  });

  it("keeps unknown dates last and resolves ties deterministically", () => {
    const rows = onlineReplayRows([
      ...onlineReplays,
      { ...onlineReplays[0], key: "tenhou:a-tie", sourceGameId: "a-tie" },
    ]);

    expect(
      filterReplayLibraryRows(rows, "online", EMPTY_REPLAY_LIBRARY_FILTERS).map(
        (row) => row.sourceGameId
      )
    ).toEqual(["a-tie", "newer", "older", "unknown"]);
    expect(
      filterReplayLibraryRows(rows, "online", {
        ...EMPTY_REPLAY_LIBRARY_FILTERS,
        sortOrder: "oldest",
      }).map((row) => row.sourceGameId)
    ).toEqual(["older", "a-tie", "newer", "unknown"]);
  });

  it("derives stable options and counts only active mode filters", () => {
    const options = replayLibraryFilterOptions(onlineReplayRows(onlineReplays));
    expect(options.sources).toEqual(["ingame", "majsoul", "tenhou"]);
    expect(options.contexts).toEqual(["tournament", "friendly", "external"]);
    expect(options.reasons).toEqual(["played", "commented", "reviewed"]);

    const filters = {
      ...EMPTY_REPLAY_LIBRARY_FILTERS,
      sources: ["tenhou" as const],
      reasons: ["commented" as const],
      sortOrder: "oldest" as const,
    };
    expect(activeReplayFilterCount("online", filters)).toBe(3);
    expect(activeReplayFilterCount("offline", filters)).toBe(1);
  });
});

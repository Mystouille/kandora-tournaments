import { describe, expect, it } from "vitest";
import {
  matchGamesToTables,
  type MatchGame,
  type MatchTable,
} from "./scheduleMatching";

const noSubs = {
  officialSubs: new Set<string>(),
  teamSubPoolByTeamId: new Map<string, ReadonlySet<string>>(),
};

describe("matchGamesToTables", () => {
  it("links each table to its own game regardless of finish order", () => {
    const tables: MatchTable[] = [
      {
        tableIndex: 0,
        seats: [
          { userId: "a", teamId: "T1" },
          { userId: "b", teamId: "T2" },
          { userId: "c", teamId: "T3" },
          { userId: "d", teamId: "T4" },
        ],
      },
      {
        tableIndex: 1,
        seats: [
          { userId: "e", teamId: "T1" },
          { userId: "f", teamId: "T2" },
          { userId: "g", teamId: "T3" },
          { userId: "h", teamId: "T4" },
        ],
      },
    ];
    // Table 1's game finished BEFORE table 0's game.
    const games: MatchGame[] = [
      { gameId: "G_efgh", userIds: ["e", "f", "g", "h"], startTime: 1000 },
      { gameId: "G_abcd", userIds: ["a", "b", "c", "d"], startTime: 2000 },
    ];

    const { matches, unmatchedGameIds } = matchGamesToTables(
      tables,
      games,
      noSubs
    );

    expect(matches.get(0)?.gameId).toBe("G_abcd");
    expect(matches.get(1)?.gameId).toBe("G_efgh");
    expect(unmatchedGameIds).toHaveLength(0);
  });

  it("forgivingly links a game with undeclared team and official subs", () => {
    const tables: MatchTable[] = [
      {
        tableIndex: 0,
        seats: [
          { userId: "a", teamId: "T1" },
          { userId: "b", teamId: "T2" },
          { userId: "c", teamId: "T3" },
          { userId: "d", teamId: "T4" },
        ],
      },
    ];
    // c replaced by team sub "c2" (T3 pool); d replaced by official sub "off".
    const games: MatchGame[] = [
      { gameId: "G", userIds: ["a", "b", "c2", "off"], startTime: 5 },
    ];

    const { matches, unmatchedGameIds } = matchGamesToTables(tables, games, {
      officialSubs: new Set(["off"]),
      teamSubPoolByTeamId: new Map([["T3", new Set(["c2"])]]),
    });

    const match = matches.get(0);
    expect(match?.gameId).toBe("G");
    expect(unmatchedGameIds).toHaveLength(0);

    const c2 = match?.replacements.find((r) => r.toUserId === "c2");
    const off = match?.replacements.find((r) => r.toUserId === "off");
    expect(c2).toMatchObject({ fromUserId: "c", subType: "team" });
    expect(off).toMatchObject({ fromUserId: "d", subType: "official" });
  });

  it("does not link a game containing an invalid substitute", () => {
    const tables: MatchTable[] = [
      {
        tableIndex: 0,
        seats: [
          { userId: "a", teamId: "T1" },
          { userId: "b", teamId: "T2" },
          { userId: "c", teamId: "T3" },
          { userId: "d", teamId: "T4" },
        ],
      },
    ];
    const games: MatchGame[] = [
      { gameId: "G", userIds: ["a", "b", "c", "stranger"], startTime: 5 },
    ];

    const { matches, unmatchedGameIds } = matchGamesToTables(tables, games, {
      officialSubs: new Set(),
      teamSubPoolByTeamId: new Map([["T4", new Set(["legitSub"])]]),
    });

    expect(matches.has(0)).toBe(false);
    expect(unmatchedGameIds).toContain("G");
  });

  it("zips games to identical individual-mode tables, earliest first", () => {
    const seats = [
      { userId: "p1", teamId: "p1" },
      { userId: "p2", teamId: "p2" },
      { userId: "p3", teamId: "p3" },
      { userId: "p4", teamId: "p4" },
    ];
    const tables: MatchTable[] = [
      { tableIndex: 0, seats },
      { tableIndex: 1, seats },
      { tableIndex: 2, seats },
    ];
    const games: MatchGame[] = [
      { gameId: "GB", userIds: ["p1", "p2", "p3", "p4"], startTime: 200 },
      { gameId: "GA", userIds: ["p1", "p2", "p3", "p4"], startTime: 100 },
    ];

    const { matches } = matchGamesToTables(tables, games, noSubs);

    expect(matches.get(0)?.gameId).toBe("GA");
    expect(matches.get(1)?.gameId).toBe("GB");
    expect(matches.has(2)).toBe(false);
  });

  it("prefers an exact match over a forgiving one for the same game", () => {
    // Two tables differ only in one seat; the game exactly matches table 1.
    const tables: MatchTable[] = [
      {
        tableIndex: 0,
        seats: [
          { userId: "a", teamId: "T1" },
          { userId: "b", teamId: "T2" },
          { userId: "c", teamId: "T3" },
          { userId: "sub", teamId: "T4" },
        ],
      },
      {
        tableIndex: 1,
        seats: [
          { userId: "a", teamId: "T1" },
          { userId: "b", teamId: "T2" },
          { userId: "c", teamId: "T3" },
          { userId: "d", teamId: "T4" },
        ],
      },
    ];
    const games: MatchGame[] = [
      { gameId: "G", userIds: ["a", "b", "c", "d"], startTime: 1 },
    ];

    const { matches } = matchGamesToTables(tables, games, {
      officialSubs: new Set(),
      teamSubPoolByTeamId: new Map([["T4", new Set(["sub"])]]),
    });

    // Exact match wins: table 1 is linked, table 0 is left upcoming.
    expect(matches.get(1)?.gameId).toBe("G");
    expect(matches.has(0)).toBe(false);
  });
});

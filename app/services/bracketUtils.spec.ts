import { describe, expect, it } from "vitest";
import {
  computeBracket,
  renderBracketAsciiParts,
  type BracketContext,
  type BracketStageDefinition,
  type ComputedStage,
} from "./bracketUtils";
import { Ruleset } from "../db/League";

/**
 * A single-game "FINALS" stage seeded with four teams. `gamesToComplete: 1`
 * keeps the completion threshold trivial for the test.
 */
const FINALS_STAGE: BracketStageDefinition[] = [
  {
    name: "FINALS",
    order: 1,
    seeds: [1, 2, 3, 4],
    fromStages: [],
    gamesToComplete: 1,
  },
];

const seedings = new Map<number, string>([
  [1, "teamA"],
  [2, "teamB"],
  [3, "teamC"],
  [4, "teamD"],
]);

const teamNameMap = new Map<string, string>([
  ["teamA", "Team A"],
  ["teamB", "Team B"],
  ["teamC", "Team C"],
  ["teamD", "Team D"],
]);

// Rostered players: one per team. Note teamD's rostered player (uD) does NOT
// play in the test game — an official substitute (uSub) takes the seat. The sub
// is themselves on another (eliminated) team's roster, so userToTeamMap maps
// them to "teamE" — the case that must NOT be treated as their game team.
const userToTeamMap = new Map<string, string>([
  ["uA", "teamA"],
  ["uB", "teamB"],
  ["uC", "teamC"],
  ["uD", "teamD"],
  ["uSub", "teamE"],
]);

// Deterministic delta = score / 10000, so attribution is easy to assert.
const deltaComputer = (players: { userId: string; score: number }[]) =>
  players.map((p) => p.score / 10000);

const gameWithOfficialSub = {
  results: [
    { userId: "uA", score: 40000 },
    { userId: "uB", score: 30000 },
    { userId: "uC", score: 20000 },
    { userId: "uSub", score: 10000 }, // official sub for teamD
  ],
};

describe("computeBracket official-substitute attribution", () => {
  it("drops a sub game when no official subs are declared (sub maps to a non-stage team)", () => {
    const ctx: BracketContext = {
      seedings,
      userToTeamMap,
      teamNameMap,
      games: [gameWithOfficialSub],
      rules: Ruleset.EMA,
      deltaComputer,
      // officialSubIds omitted — uSub resolves to teamE (not in the stage), so
      // the game's team set never matches and it is dropped.
    };

    const [finals] = computeBracket(FINALS_STAGE, ctx);

    expect(finals.gamesPlayed).toBe(0);
    for (const result of finals.results) {
      expect(result.gamesPlayed).toBe(0);
    }
  });

  it("attributes an official sub's result to the stage team missing from the game", () => {
    const ctx: BracketContext = {
      seedings,
      userToTeamMap,
      teamNameMap,
      games: [gameWithOfficialSub],
      rules: Ruleset.EMA,
      deltaComputer,
      officialSubIds: new Set(["uSub"]),
    };

    const [finals] = computeBracket(FINALS_STAGE, ctx);

    expect(finals.gamesPlayed).toBe(1);
    expect(finals.isComplete).toBe(true);

    const byTeam = new Map(finals.results.map((r) => [r.teamId, r]));
    // teamD (missing from the game) gets the substitute's delta — NOT teamE,
    // the sub's own roster team.
    expect(byTeam.get("teamD")?.gamesPlayed).toBe(1);
    expect(byTeam.get("teamD")?.totalScore).toBe(1);
    expect(byTeam.get("teamE")).toBeUndefined();
    expect(byTeam.get("teamA")?.totalScore).toBe(4);
    expect(byTeam.get("teamB")?.totalScore).toBe(3);
    expect(byTeam.get("teamC")?.totalScore).toBe(2);
  });

  it("still counts a game where every player is rostered (regression)", () => {
    const ctx: BracketContext = {
      seedings,
      userToTeamMap,
      teamNameMap,
      games: [
        {
          results: [
            { userId: "uA", score: 40000 },
            { userId: "uB", score: 30000 },
            { userId: "uC", score: 20000 },
            { userId: "uD", score: 10000 },
          ],
        },
      ],
      rules: Ruleset.EMA,
      deltaComputer,
      officialSubIds: new Set(["uSub"]),
    };

    const [finals] = computeBracket(FINALS_STAGE, ctx);

    expect(finals.gamesPlayed).toBe(1);
    const byTeam = new Map(finals.results.map((r) => [r.teamId, r]));
    expect(byTeam.get("teamD")?.gamesPlayed).toBe(1);
    expect(byTeam.get("teamD")?.totalScore).toBe(1);
  });

  it("prefers the recorded substitution mapping over deduction", () => {
    // Two official subs in the SAME game replacing players on teamC and teamD.
    // Deduction can't tell which sub belongs to which missing team; the recorded
    // substitution docs disambiguate. uSub → teamD, uSub2 → teamC.
    const ctx: BracketContext = {
      seedings,
      userToTeamMap,
      teamNameMap,
      games: [
        {
          results: [
            { userId: "uA", score: 40000 }, // teamA
            { userId: "uB", score: 30000 }, // teamB
            { userId: "uSub2", score: 25000 }, // official sub → teamC
            { userId: "uSub", score: 5000 }, // official sub → teamD
          ],
        },
      ],
      rules: Ruleset.EMA,
      deltaComputer,
      officialSubIds: new Set(["uSub", "uSub2"]),
      officialSubTeamMap: new Map([
        ["uSub", "teamD"],
        ["uSub2", "teamC"],
      ]),
    };

    const [finals] = computeBracket(FINALS_STAGE, ctx);

    expect(finals.gamesPlayed).toBe(1);
    const byTeam = new Map(finals.results.map((r) => [r.teamId, r]));
    // teamC gets uSub2's delta (25000 / 10000 = 2.5); teamD gets uSub's
    // (5000 / 10000 = 0.5) — exactly as recorded, not arbitrary.
    expect(byTeam.get("teamC")?.totalScore).toBe(2.5);
    expect(byTeam.get("teamD")?.totalScore).toBe(0.5);
  });

  it("falls back to deduction for a sub absent from the recorded map", () => {
    // uSub's substitution doc was cleaned up (not in officialSubTeamMap); it is
    // still attributed to the missing stage team (teamD) by deduction.
    const ctx: BracketContext = {
      seedings,
      userToTeamMap,
      teamNameMap,
      games: [gameWithOfficialSub],
      rules: Ruleset.EMA,
      deltaComputer,
      officialSubIds: new Set(["uSub"]),
      officialSubTeamMap: new Map(), // empty — round already cleaned up
    };

    const [finals] = computeBracket(FINALS_STAGE, ctx);

    expect(finals.gamesPlayed).toBe(1);
    const byTeam = new Map(finals.results.map((r) => [r.teamId, r]));
    expect(byTeam.get("teamD")?.gamesPlayed).toBe(1);
    expect(byTeam.get("teamD")?.totalScore).toBe(1);
  });
});

describe("renderBracketAsciiParts slice splitting", () => {
  const renderNames = new Map<string, string>([
    ["teamA", "Team A"],
    ["teamB", "Team B"],
    ["teamC", "Team C"],
    ["teamD", "Team D"],
  ]);
  const renderSeeds = new Map<number, string>([
    [1, "teamA"],
    [2, "teamB"],
    [3, "teamC"],
    [4, "teamD"],
  ]);

  const computedStage = (
    definition: BracketStageDefinition,
    teams: string[],
    results: ComputedStage["results"] = []
  ): ComputedStage => ({
    definition,
    teams,
    results,
    isComplete: false,
    gamesPlayed: 0,
  });

  it("never places stages from different slices in the same message", () => {
    const qf: BracketStageDefinition = {
      name: "QF",
      order: 0,
      seeds: [1, 2, 3, 4],
      fromStages: [],
    };
    // SF advances from QF, so its topological slice is QF's depth + 1.
    const sf: BracketStageDefinition = {
      name: "SF",
      order: 1,
      seeds: [],
      fromStages: [{ stage: "QF", place: 1 }],
    };

    const parts = renderBracketAsciiParts(
      "League",
      [
        computedStage(qf, ["teamA", "teamB", "teamC", "teamD"]),
        computedStage(sf, ["teamA"]),
      ],
      renderSeeds,
      renderNames
    );

    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("━━ QF ━━");
    expect(parts[0]).not.toContain("SF");
    expect(parts[1]).toContain("━━ SF ━━");
    expect(parts[1]).not.toContain("QF");
  });

  it("uses an explicit slice to override the topological depth", () => {
    // Neither stage has advancement edges, so topology puts both in slice 0;
    // the explicit slice values force them into separate messages.
    const a: BracketStageDefinition = {
      name: "A",
      order: 0,
      seeds: [1, 2],
      fromStages: [],
      slice: 0,
    };
    const b: BracketStageDefinition = {
      name: "B",
      order: 1,
      seeds: [3, 4],
      fromStages: [],
      slice: 1,
    };

    const parts = renderBracketAsciiParts(
      "League",
      [
        computedStage(a, ["teamA", "teamB"]),
        computedStage(b, ["teamC", "teamD"]),
      ],
      renderSeeds,
      renderNames
    );

    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("━━ A ━━");
    expect(parts[1]).toContain("━━ B ━━");
  });

  it("skips a slice whose stages are all unresolved", () => {
    const qf: BracketStageDefinition = {
      name: "QF",
      order: 0,
      seeds: [1, 2, 3, 4],
      fromStages: [],
    };
    const fin: BracketStageDefinition = {
      name: "FINAL",
      order: 1,
      seeds: [],
      fromStages: [{ stage: "QF", place: 1 }],
    };

    const parts = renderBracketAsciiParts(
      "League",
      [
        computedStage(qf, ["teamA", "teamB", "teamC", "teamD"]),
        // No teams and no results → the FINAL slice is not yet resolvable.
        computedStage(fin, []),
      ],
      renderSeeds,
      renderNames
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("━━ QF ━━");
    expect(parts.join("\n")).not.toContain("FINAL");
  });

  it("still splits within a slice when the character budget is exceeded", () => {
    const a: BracketStageDefinition = {
      name: "GROUPA",
      order: 0,
      seeds: [1, 2],
      fromStages: [],
      slice: 0,
    };
    const b: BracketStageDefinition = {
      name: "GROUPB",
      order: 1,
      seeds: [3, 4],
      fromStages: [],
      slice: 0,
    };

    const parts = renderBracketAsciiParts(
      "League",
      [
        computedStage(a, ["teamA", "teamB"]),
        computedStage(b, ["teamC", "teamD"]),
      ],
      renderSeeds,
      renderNames,
      { maxPartLength: 40 }
    );

    // Same slice, but the tiny budget forces each stage into its own part.
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("━━ GROUPA ━━");
    expect(parts[1]).toContain("━━ GROUPB ━━");
  });
});

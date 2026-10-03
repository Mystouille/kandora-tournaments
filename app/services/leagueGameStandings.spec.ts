import { describe, expect, it } from "vitest";
import { Ruleset } from "~/core/models/tournament/League";
import type { LeagueTypeConfig } from "~/core/types/league-config";
import {
  buildGameSummaryStandings,
  type SummaryStandingsGame,
  type SummaryStandingsInput,
} from "./leagueGameStandings";

const teams = [1, 2, 3, 4].map((i) => ({
  _id: `team-${i}`,
  roster: { members: [`player-${i}`], substitutes: [] },
}));
const participants = teams.map((team) => ({
  id: team._id,
  name: team._id,
  teamName: null,
  imageUrl: null,
  teamLogoUrl: null,
  teamLogoCenterY: 0.5,
  color: "#123456",
}));
const phaseConfig: LeagueTypeConfig = {
  displayName: "League",
  isTeamMode: true,
  regularPhases: [
    {
      id: "first",
      scoring: { type: "cumulative" },
      progression: {
        advancingCount: 2,
        scoreRetention: { num: 1, den: 2 },
      },
    },
    { id: "second", scoring: { type: "cumulative" } },
  ],
};

function game(
  id: string,
  date: string,
  phaseId = "first",
  scores = [40000, 30000, 20000, 10000]
): SummaryStandingsGame {
  return {
    id,
    startTime: new Date(date),
    endTime: new Date(new Date(date).getTime() + 3600000),
    phaseId,
    isValid: true,
    results: scores.map((score, i) => ({
      userId: `player-${i + 1}`,
      score,
      place: i + 1,
    })),
  };
}

function standings(
  games: SummaryStandingsGame[],
  overrides: Partial<SummaryStandingsInput> = {}
) {
  const result = buildGameSummaryStandings({
    selectedGameId: games.at(-1)!.id,
    games,
    teams,
    participants,
    isTeamMode: true,
    leagueType: null,
    rules: Ruleset.MLEAGUE,
    cutoffs: [],
    finalParticipantIds: null,
    excludedPlayerIds: new Set(),
    scheduledGameCounts: new Map(),
    ...overrides,
  });
  if (result.status !== "available") {
    throw new Error(`Unexpected unavailable standings: ${result.reason}`);
  }
  return result.data;
}

describe("historical league game standings", () => {
  it.each([
    { scoring: { type: "cumulative" as const }, expected: 300 },
    {
      scoring: {
        type: "team-delta-cap" as const,
        capPercent: 0.5,
        minGamesForCap: 2,
      },
      expected: 180,
    },
  ])(
    "uses configured $scoring.type rules for finals carry-over",
    ({ scoring, expected }) => {
      const rows = standings(
        [
          ...Array.from({ length: 8 }, (_, index) =>
            game(`regular-${index}`, `2026-08-0${index + 1}T12:00:00Z`)
          ),
          game("final", "2026-09-02T12:00:00Z", "final"),
        ],
        {
          leagueType: {
            displayName: "Configured carry-over",
            isTeamMode: true,
            regularPhase: { id: "first", scoring },
            finalPhase: {
              id: "final",
              scoring: { type: "bracket-delta" },
              scoreCarryOver: { num: 1, den: 2 },
              stages: [],
            },
          },
          finalParticipantIds: new Set(teams.map((team) => team._id)),
          cutoffs: [new Date("2026-09-01T00:00:00Z")],
        }
      );
      expect(rows[0].totalScore).toBe(expected);
      expect(rows[0].pointsDifference).toBeNull();
      expect(rows[0].rankHighlight).toBe("leader");
    }
  );

  it("computes gaps to the preceding row, excluding future and overlapping games", () => {
    const earlier = game("a", "2026-08-01T12:00:00Z");
    const selected = game("b", "2026-08-02T12:00:00Z");
    const future = game("c", "2026-08-03T12:00:00Z");
    const overlapping = game("d", "2026-08-02T11:00:00Z");
    overlapping.endTime = new Date("2026-08-02T14:00:00Z");
    const rows = standings([earlier, selected, future, overlapping], {
      selectedGameId: "b",
    });
    expect(rows.map((row) => row.totalScore)).toEqual([120, 20, -40, -100]);
    expect(rows.map((row) => row.pointsChange)).toEqual([60, 10, -20, -50]);
    expect(rows.map((row) => row.pointsDifference)).toEqual([
      null,
      100,
      60,
      60,
    ]);
    expect(rows.map((row) => row.gamesPlayed)).toEqual([2, 2, 2, 2]);
  });

  it("shows whole-league carry-over totals and no score for eliminated teams", () => {
    const rows = standings(
      [
        game("a", "2026-08-01T12:00:00Z"),
        game(
          "b",
          "2026-09-02T12:00:00Z",
          "second",
          [20000, 10000, 40000, 30000]
        ),
      ],
      {
        leagueType: phaseConfig,
        cutoffs: [new Date("2026-09-01T00:00:00Z")],
      }
    );
    expect(rows.map((row) => row.totalScore)).toEqual([10, -45, null, null]);
    expect(rows.map((row) => row.gamesPlayed)).toEqual([1, 1, 1, 1]);
    expect(rows.map((row) => row.pointsChange)).toEqual([-20, -50, null, null]);
    expect(rows.map((row) => row.pointsDifference)).toEqual([
      null,
      55,
      null,
      null,
    ]);
    expect(rows.map((row) => row.eliminated)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
    expect(rows.map((row) => row.rankHighlight)).toEqual([
      "leader",
      null,
      null,
      null,
    ]);
  });

  it.each([0, 1, 2])("applies %i/2 carry-over once", (num) => {
    const config: LeagueTypeConfig = {
      ...phaseConfig,
      regularPhases: [
        {
          ...phaseConfig.regularPhases![0],
          progression: { advancingCount: 4, scoreRetention: { num, den: 2 } },
        },
        phaseConfig.regularPhases![1],
      ],
    };
    const rows = standings(
      [
        game("a", "2026-08-01T12:00:00Z"),
        game("b", "2026-09-02T12:00:00Z", "second"),
      ],
      { leagueType: config, cutoffs: [new Date("2026-09-01T00:00:00Z")] }
    );
    expect(rows[0].totalScore).toBe(60 + 30 * num);
    expect(rows[0].pointsChange).toBe(60);
    expect(rows[0].rankHighlight).toBe("leader");
  });

  it("recognizes a tagged final league phase before its scheduled cutoff", () => {
    const rows = standings(
      [
        game("a", "2026-08-01T12:00:00Z"),
        game("b", "2026-08-30T12:00:00Z", "second"),
      ],
      {
        leagueType: phaseConfig,
        cutoffs: [new Date("2026-09-01T00:00:00Z")],
      }
    );
    expect(rows[0].totalScore).toBe(90);
    expect(rows[0].pointsChange).toBe(60);
    expect(rows[0].rankHighlight).toBe("leader");
    expect(rows[1].pointsDifference).toBe(75);
    expect(rows[0].gamesPlayed).toBe(1);
  });

  it("counts only the selected phase as of the game while preserving carried totals", () => {
    const rows = standings(
      [
        game("first-a", "2026-08-01T12:00:00Z"),
        game("first-b", "2026-08-02T12:00:00Z"),
        game("selected", "2026-09-02T12:00:00Z", "second"),
        game("later", "2026-09-03T12:00:00Z", "second"),
      ],
      {
        selectedGameId: "selected",
        leagueType: phaseConfig,
        cutoffs: [new Date("2026-09-01T00:00:00Z")],
        scheduledGameCounts: new Map([
          ["team-1", 12],
          ["team-2", 12],
        ]),
      }
    );
    expect(rows[0]).toMatchObject({
      totalScore: 120,
      pointsChange: 60,
      gamesPlayed: 1,
      totalGames: 12,
    });
    expect(rows[1]).toMatchObject({
      totalScore: 20,
      gamesPlayed: 1,
      totalGames: 12,
    });
  });

  it("uses the game's stored phase for a late result rather than the phase active at its finish", () => {
    const rows = standings(
      [
        game("first-a", "2026-08-01T12:00:00Z"),
        game("second-a", "2026-09-02T12:00:00Z", "second"),
        game("late-first", "2026-09-03T12:00:00Z", "first"),
      ],
      {
        leagueType: phaseConfig,
        cutoffs: [new Date("2026-09-01T00:00:00Z")],
      }
    );
    expect(rows.map((row) => row.gamesPlayed)).toEqual([2, 2, 2, 2]);
  });

  it("uses configured phase cutoffs to count untagged legacy results", () => {
    const previous = game("first-a", "2026-08-01T12:00:00Z");
    const selected = game("selected", "2026-09-02T12:00:00Z");
    previous.phaseId = null;
    selected.phaseId = null;
    const rows = standings([previous, selected], {
      leagueType: phaseConfig,
      cutoffs: [new Date("2026-09-01T00:00:00Z")],
    });
    expect(rows.map((row) => row.gamesPlayed)).toEqual([1, 1, 1, 1]);
  });

  it("does not apply future disqualification to an older game", () => {
    const rows = standings(
      [
        game("a", "2026-08-01T12:00:00Z"),
        game("b", "2026-09-02T12:00:00Z", "second"),
      ],
      {
        selectedGameId: "a",
        leagueType: phaseConfig,
        cutoffs: [new Date("2026-09-01T00:00:00Z")],
      }
    );
    expect(rows.every((row) => !row.eliminated)).toBe(true);
    expect(rows.map((row) => row.totalScore)).toEqual([60, 10, -20, -50]);
  });

  it("uses individual scoring windows rather than blindly adding game points", () => {
    const rows = standings(
      [
        game("a", "2026-08-01T12:00:00Z"),
        game(
          "b",
          "2026-08-02T12:00:00Z",
          "first",
          [10000, 20000, 30000, 40000]
        ),
      ],
      {
        isTeamMode: false,
        participants: participants.map((person, i) => ({
          ...person,
          id: `player-${i + 1}`,
        })),
        leagueType: {
          displayName: "Window",
          isTeamMode: false,
          regularPhase: {
            id: "first",
            scoring: { type: "best-consecutive-window", windowSize: 1 },
          },
        },
      }
    );
    const player = rows.find((row) => row.id === "player-1")!;
    expect(player.totalScore).toBe(60);
    expect(player.pointsChange).toBe(0);
    expect(player.pointsDifference).toBeNull();
    expect(rows.find((row) => row.id === "player-4")?.pointsDifference).toBe(0);
    expect(player.gamesPlayed).toBe(2);
  });

  it("keeps excluded games out of totals", () => {
    const selected = game("b", "2026-08-02T12:00:00Z");
    selected.isValid = false;
    const rows = standings([game("a", "2026-08-01T12:00:00Z"), selected]);
    expect(rows.map((row) => row.pointsDifference)).toEqual([null, 50, 30, 30]);
    expect(rows.map((row) => row.pointsChange)).toEqual([0, 0, 0, 0]);
    expect(rows[0].totalScore).toBe(60);
  });

  it("orders simultaneous finishes deterministically", () => {
    const rows = standings(
      [
        game("c", "2026-08-01T12:00:00Z"),
        game("a", "2026-08-01T12:00:00Z"),
        game("b", "2026-08-01T12:00:00Z"),
      ],
      { selectedGameId: "b" }
    );
    expect(rows[0].totalScore).toBe(120);
  });

  it("shows a zero gap for tied scores and a positive gap across negative scores", () => {
    const rows = standings([
      game("a", "2026-08-01T12:00:00Z", "first", [35000, 35000, 15000, 15000]),
    ]);
    expect(rows.map((row) => row.totalScore)).toEqual([35, 35, -35, -35]);
    expect(rows.map((row) => row.pointsDifference)).toEqual([null, 0, 70, 0]);
    expect(rows.every((row) => row.rankHighlight === null)).toBe(true);
  });

  it("highlights current qualifiers without looking at later results", () => {
    const rows = standings(
      [
        game("a", "2026-08-01T12:00:00Z"),
        game(
          "b",
          "2026-08-02T12:00:00Z",
          "first",
          [10000, 20000, 30000, 40000]
        ),
      ],
      { selectedGameId: "a", leagueType: phaseConfig }
    );
    expect(rows.map((row) => row.rankHighlight)).toEqual([
      "qualified",
      "qualified",
      null,
      null,
    ]);
  });

  it("applies the current phase's minimum-games gate when highlighting qualifiers", () => {
    const extraGame = game("b", "2026-08-02T12:00:00Z");
    extraGame.results[0].userId = "guest";
    const leagueType: LeagueTypeConfig = {
      ...phaseConfig,
      regularPhases: [
        { ...phaseConfig.regularPhases![0], minGames: 2 },
        phaseConfig.regularPhases![1],
      ],
    };
    const rows = standings([game("a", "2026-08-01T12:00:00Z"), extraGame], {
      leagueType,
    });
    expect(rows[0]).toMatchObject({ id: "team-1", rankHighlight: null });
    expect(
      rows
        .filter((row) => row.rankHighlight === "qualified")
        .map((row) => row.id)
    ).toEqual(["team-2", "team-3"]);
  });

  it("highlights the currently qualifying teams for a configured finals bracket", () => {
    const rows = standings([game("a", "2026-08-01T12:00:00Z")], {
      leagueType: {
        displayName: "Bracket league",
        isTeamMode: true,
        regularPhase: { id: "first", scoring: { type: "cumulative" } },
        finalPhase: {
          id: "final",
          scoring: { type: "bracket-delta" },
          scoreCarryOver: { num: 1, den: 2 },
          stages: [
            { id: "final", gameCount: 4, seeds: [1, 2], fromStages: [] },
          ],
        },
      },
    });
    expect(rows.map((row) => row.rankHighlight)).toEqual([
      "qualified",
      "qualified",
      null,
      null,
    ]);
  });

  it("uses faction qualification rather than a global top-N for individual leagues", () => {
    const rows = standings([game("a", "2026-08-01T12:00:00Z")], {
      isTeamMode: false,
      participants: participants.map((person, index) => ({
        ...person,
        id: `player-${index + 1}`,
      })),
      teams: [
        { _id: "faction-1", roster: { members: ["player-1", "player-2"] } },
        { _id: "faction-2", roster: { members: ["player-3", "player-4"] } },
      ],
      leagueType: {
        displayName: "Faction qualification",
        isTeamMode: false,
        regularPhase: {
          id: "first",
          scoring: {
            type: "best-consecutive-window",
            windowSize: 3,
            qualificationMode: "faction-top-n",
            qualificationCount: 1,
          },
        },
      },
    });
    expect(rows.map((row) => row.rankHighlight)).toEqual([
      "qualified",
      null,
      "qualified",
      null,
    ]);
  });

  it("highlights only the leader in finals-only competitions", () => {
    const rows = standings([game("a", "2026-08-01T12:00:00Z", "final")], {
      leagueType: {
        displayName: "Finals only",
        isTeamMode: true,
        finalPhase: {
          id: "final",
          scoring: { type: "bracket-delta" },
          scoreCarryOver: { num: 0, den: 1 },
          stages: [
            { id: "final", gameCount: 4, seeds: [1, 2, 3, 4], fromStages: [] },
          ],
        },
      },
      finalParticipantIds: new Set(teams.map((team) => team._id)),
    });
    expect(rows.map((row) => row.rankHighlight)).toEqual([
      "leader",
      null,
      null,
      null,
    ]);
  });

  it("includes each participant's scheduled total and leaves unknown totals null", () => {
    const rows = standings([game("a", "2026-08-01T12:00:00Z")], {
      scheduledGameCounts: new Map([
        ["team-1", 38],
        ["team-2", 36],
      ]),
    });
    expect(rows.map((row) => row.totalGames)).toEqual([38, 36, null, null]);
    expect(rows.map((row) => row.gamesPlayed)).toEqual([1, 1, 1, 1]);
  });

  it("reports missing chronology rather than substituting today's standings", () => {
    const selected = game("a", "2026-08-01T12:00:00Z");
    selected.endTime = null;
    expect(
      buildGameSummaryStandings({
        selectedGameId: selected.id,
        games: [selected],
        teams,
        participants,
        isTeamMode: true,
        leagueType: null,
        rules: Ruleset.MLEAGUE,
        cutoffs: [],
        finalParticipantIds: null,
        excludedPlayerIds: new Set(),
        scheduledGameCounts: new Map(),
      })
    ).toEqual({ status: "unavailable", reason: "unknownChronology" });
  });
});

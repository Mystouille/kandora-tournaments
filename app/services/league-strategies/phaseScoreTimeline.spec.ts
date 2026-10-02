import { describe, expect, it } from "vitest";
import { Ruleset } from "~/core/models/tournament/League";
import type { LeagueTypeConfig } from "~/services/league-configs/types";
import {
  computePhaseScoreTimeline,
  totalTimelineScore,
  type PhaseScoreGame,
  type PhaseScoreTeam,
} from "./phaseScoreTimeline";
import { computeMultiPhaseStandings } from "./multiPhaseStrategies";

const cutoffs = [
  new Date("2026-09-01T00:00:00Z"),
  new Date("2026-10-01T00:00:00Z"),
];
const teams: PhaseScoreTeam[] = [1, 2, 3, 4].map((index) => ({
  _id: `team-${index}`,
  roster: { members: [`player-${index}`], substitutes: [] },
}));
const now = new Date("2026-10-05T12:00:00Z");

function config(advance = 4, numerator = 1): LeagueTypeConfig {
  return {
    displayName: "Carry-over regression",
    isTeamMode: true,
    regularPhases: [
      {
        id: "first",
        scoring: { type: "cumulative" },
        progression: {
          advancingCount: advance,
          scoreRetention: { num: numerator, den: 2 },
        },
      },
      { id: "second", scoring: { type: "cumulative" } },
    ],
  };
}

function game(
  date: string,
  phaseId: string,
  scores = [40000, 30000, 20000, 10000]
): PhaseScoreGame {
  return {
    startTime: new Date(date),
    phaseId,
    results: scores.map((score, index) => ({
      userId: `player-${index + 1}`,
      score,
    })),
  };
}

function timeline(
  games: PhaseScoreGame[],
  overrides: Partial<Parameters<typeof computePhaseScoreTimeline>[0]> = {}
) {
  return computePhaseScoreTimeline({
    leagueType: config(),
    teams,
    games,
    rules: Ruleset.MLEAGUE,
    cutoffs,
    now,
    ...overrides,
  });
}

function values(changes: Map<string, number> | undefined) {
  let score = 0;
  return [...(changes ?? [])].map(([day, delta]) => ({
    day,
    score: Math.round((score += delta) * 10) / 10,
  }));
}

describe("all-phase score timelines", () => {
  it.each([0, 1, 2])(
    "applies %i/2 retention once to positive and negative totals",
    (numerator) => {
      const result = timeline(
        [
          game("2026-08-15T20:00:00Z", "first"),
          game("2026-09-15T20:00:00Z", "second"),
        ],
        { leagueType: config(4, numerator) }
      );
      expect(values(result.teams.get("team-1"))).toEqual([
        { day: "2026-08-15", score: 60 },
        { day: "2026-09-01", score: 30 * numerator },
        { day: "2026-09-15", score: 60 + 30 * numerator },
      ]);
      expect(totalTimelineScore(result.teams.get("team-4"))).toBe(
        -50 - 25 * numerator
      );
    }
  );

  it("applies sequential retention to the previous adjusted score, not the raw lifetime sum", () => {
    const leagueType = config();
    leagueType.regularPhases![1].progression = {
      advancingCount: 4,
      scoreRetention: { num: 2, den: 3 },
    };
    leagueType.regularPhases!.push({
      id: "third",
      scoring: { type: "cumulative" },
    });
    const games = [
      game("2026-08-15T20:00:00Z", "first"),
      game("2026-09-15T20:00:00Z", "second", [20000, 10000, 40000, 30000]),
      game("2026-10-02T20:00:00Z", "third"),
    ];
    const result = timeline(games, { leagueType });
    expect(totalTimelineScore(result.teams.get("team-1"))).toBe(66.7);
    expect(totalTimelineScore(result.teams.get("team-2"))).toBe(-20);
    expect(totalTimelineScore(result.teams.get("team-3"))).toBe(13.3);
    const official = computeMultiPhaseStandings(
      leagueType,
      games,
      Ruleset.MLEAGUE,
      teams,
      cutoffs,
      2
    );
    for (const standing of official.standings) {
      expect(totalTimelineScore(result.teams.get(standing.teamId))).toBe(
        standing.totalScore
      );
    }
  });

  it("freezes non-qualifiers and keeps their scores out of later carry-overs", () => {
    const result = timeline(
      [
        game("2026-08-15T20:00:00Z", "first"),
        game("2026-09-15T20:00:00Z", "second"),
      ],
      { leagueType: config(2) }
    );
    expect(totalTimelineScore(result.teams.get("team-3"))).toBe(-20);
    expect(totalTimelineScore(result.teams.get("team-4"))).toBe(-50);
    expect(result.eliminatedTeams).toEqual(
      new Map([
        ["team-3", "2026-09-01"],
        ["team-4", "2026-09-01"],
      ])
    );
  });

  it("keeps complete table placements when non-qualifiers are opponents", () => {
    const leagueType = config(2);
    const games = [
      game("2026-08-15T20:00:00Z", "first"),
      game("2026-09-15T20:00:00Z", "second", [20000, 10000, 40000, 30000]),
    ];
    const result = timeline(games, { leagueType });
    expect(totalTimelineScore(result.teams.get("team-1"))).toBe(10);
    expect(totalTimelineScore(result.teams.get("team-2"))).toBe(-45);
    const official = computeMultiPhaseStandings(
      leagueType,
      games,
      Ruleset.MLEAGUE,
      teams,
      cutoffs
    );
    expect(official.standings.map((standing) => standing.totalScore)).toEqual([
      10, -45,
    ]);
  });

  it("rounds carried team totals once, rather than summing rounded member carry-overs", () => {
    const groupedTeams = [
      { _id: "team-1", roster: { members: ["player-1", "player-2"] } },
      ...teams.slice(2),
    ];
    const result = timeline(
      [game("2026-08-15T20:00:00Z", "first", [27900, 27900, 26200, 18000])],
      { teams: groupedTeams }
    );
    expect(totalTimelineScore(result.teams.get("team-1"))).toBe(27.9);
    expect(totalTimelineScore(result.players.get("player-1"))).toBe(14);
    expect(totalTimelineScore(result.players.get("player-2"))).toBe(14);
  });

  it("uses full history to qualify while keeping date-filtered game contributions", () => {
    const games = [
      game("2026-08-15T20:00:00Z", "first"),
      game("2026-08-20T20:00:00Z", "first"),
      game("2026-09-15T20:00:00Z", "second"),
    ];
    const result = timeline(games, {
      leagueType: config(2),
      startDate: "2026-08-19T00:00:00Z",
    });
    expect(values(result.teams.get("team-1"))).toEqual([
      { day: "2026-08-20", score: 60 },
      { day: "2026-09-01", score: 30 },
      { day: "2026-09-15", score: 90 },
    ]);
    expect(totalTimelineScore(result.teams.get("team-3"))).toBe(-20);
  });

  it("does not apply future boundaries or ones beyond the selected end date", () => {
    const games = [game("2026-08-15T20:00:00Z", "first")];
    const beforeCutoff = new Date("2026-08-31T23:59:59Z");
    expect(
      totalTimelineScore(
        timeline(games, { now: beforeCutoff }).teams.get("team-1")
      )
    ).toBe(60);
    expect(
      totalTimelineScore(
        timeline(games, { endDate: beforeCutoff.toISOString() }).teams.get(
          "team-1"
        )
      )
    ).toBe(60);
    expect(totalTimelineScore(timeline(games).teams.get("team-1"))).toBe(30);
  });

  it("uses explicit phase attribution for late first-phase games", () => {
    const result = timeline([
      game("2026-08-15T20:00:00Z", "first"),
      game("2026-09-02T20:00:00Z", "first"),
      game("2026-09-15T20:00:00Z", "second"),
    ]);
    expect(totalTimelineScore(result.teams.get("team-1"))).toBe(120);
  });

  it("can enter a tagged phase before a scheduled cutoff without carrying twice", () => {
    const result = timeline([
      game("2026-08-15T20:00:00Z", "first"),
      game("2026-08-30T20:00:00Z", "second"),
    ]);
    expect(values(result.teams.get("team-1"))).toEqual([
      { day: "2026-08-15", score: 60 },
      { day: "2026-08-30", score: 90 },
    ]);
  });

  it("carries into a bracket final and scores its replacement roster", () => {
    const leagueType: LeagueTypeConfig = {
      displayName: "Bracket league",
      isTeamMode: true,
      regularPhase: { id: "first", scoring: { type: "cumulative" } },
      finalPhase: {
        id: "final",
        scoring: { type: "bracket-delta" },
        scoreCarryOver: { num: 1, den: 2 },
        stages: [],
      },
    };
    const finalGame = game("2026-09-15T20:00:00Z", "final");
    finalGame.results[0].userId = "replacement";
    const finalTeams = teams.map((team, index) =>
      index === 0
        ? {
            ...team,
            finalsRoster: { members: ["replacement"], substitutes: [] },
          }
        : team
    );
    const result = timeline(
      [game("2026-08-15T20:00:00Z", "first"), finalGame],
      {
        leagueType,
        teams: finalTeams,
        finalParticipantIds: new Set(["team-1", "team-2"]),
      }
    );
    expect(totalTimelineScore(result.teams.get("team-1"))).toBe(90);
    expect(totalTimelineScore(result.teams.get("team-2"))).toBe(15);
    expect(totalTimelineScore(result.players.get("replacement"))).toBe(60);
    expect(totalTimelineScore(result.teams.get("team-3"))).toBe(-20);
  });

  it("keeps unphased league scores cumulative", () => {
    const result = timeline(
      [
        game("2026-08-15T20:00:00Z", "first"),
        game("2026-09-15T20:00:00Z", "second"),
      ],
      { leagueType: null }
    );
    expect(totalTimelineScore(result.players.get("player-1"))).toBe(120);
    expect(totalTimelineScore(result.teams.get("team-1"))).toBe(120);
  });

  it("excludes official substitutes without changing the remaining table's placement bonuses", () => {
    const result = timeline(
      [
        game("2026-08-15T20:00:00Z", "first"),
        game("2026-09-15T20:00:00Z", "second"),
      ],
      { excludedPlayerIds: new Set(["player-1"]) }
    );
    expect(result.players.has("player-1")).toBe(false);
    expect(result.teams.has("team-1")).toBe(false);
    expect(totalTimelineScore(result.teams.get("team-2"))).toBe(15);
  });

  it("uses the configured individual regular ranking as the finals carry-over source", () => {
    const leagueType: LeagueTypeConfig = {
      displayName: "Best window into finals",
      isTeamMode: false,
      regularPhase: {
        id: "first",
        scoring: { type: "best-consecutive-window", windowSize: 1 },
      },
      finalPhase: {
        id: "final",
        scoring: { type: "bracket-delta" },
        scoreCarryOver: { num: 1, den: 2 },
        stages: [],
      },
    };
    const result = timeline(
      [
        game("2026-08-15T20:00:00Z", "first"),
        game("2026-08-16T20:00:00Z", "first", [10000, 20000, 30000, 40000]),
        game("2026-09-15T20:00:00Z", "final"),
      ],
      { leagueType, finalParticipantIds: new Set(["player-1", "player-2"]) }
    );
    expect(values(result.players.get("player-1"))).toEqual([
      { day: "2026-08-15", score: 60 },
      { day: "2026-08-16", score: 10 },
      { day: "2026-09-01", score: 30 },
      { day: "2026-09-15", score: 90 },
    ]);
    expect(totalTimelineScore(result.teams.get("team-1"))).toBe(90);
  });

  it("uses minimum-game eligibility for all-phase advancement", () => {
    const leagueType = config(2);
    leagueType.regularPhases![0].minGames = 2;
    const extraGame = game("2026-08-16T20:00:00Z", "first");
    extraGame.results[0].userId = "guest";
    extraGame.results[2].userId = "guest-2";
    extraGame.results[3].userId = "guest-3";
    const result = timeline(
      [
        game("2026-08-15T20:00:00Z", "first"),
        extraGame,
        game("2026-09-15T20:00:00Z", "second"),
      ],
      { leagueType }
    );
    expect(totalTimelineScore(result.teams.get("team-1"))).toBe(60);
    expect(totalTimelineScore(result.teams.get("team-2"))).toBe(20);
    expect(result.eliminatedTeams.get("team-1")).toBe("2026-09-01");
  });
});

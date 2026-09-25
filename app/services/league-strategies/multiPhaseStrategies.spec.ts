import { describe, expect, it } from "vitest";
import { Ruleset } from "~/core/models/tournament/League";
import type { LeagueTypeConfig } from "~/services/league-configs/types";
import { computeMultiPhaseStandings } from "./multiPhaseStrategies";

describe("computeMultiPhaseStandings", () => {
  it("shows retained scores before the advancing teams play a new phase game", () => {
    const config: LeagueTypeConfig = {
      displayName: "Two regular phases",
      isTeamMode: true,
      regularPhases: [
        {
          id: "regular",
          scoring: { type: "cumulative" },
          progression: {
            advancingCount: 4,
            scoreRetention: { num: 1, den: 2 },
          },
        },
        {
          id: "finals",
          scoring: { type: "cumulative" },
        },
      ],
    };
    const teams = [1, 2, 3, 4].map((index) => ({
      _id: `team-${index}`,
      roster: {
        members: [`player-${index}`],
        substitutes: [],
      },
    }));

    const result = computeMultiPhaseStandings(
      config,
      [
        {
          phaseId: "regular",
          results: [
            { userId: "player-1", score: 27800 },
            { userId: "player-2", score: 27700 },
            { userId: "player-3", score: 26300 },
            { userId: "player-4", score: 18200 },
          ],
        },
      ],
      Ruleset.MLEAGUE,
      teams,
      []
    );

    expect(result.phaseId).toBe("finals");
    expect(result.standings).toEqual([
      {
        teamId: "team-1",
        totalScore: 23.9,
        gamesPlayed: 0,
        retainedScore: 23.9,
      },
      {
        teamId: "team-2",
        totalScore: 3.9,
        gamesPlayed: 0,
        retainedScore: 3.9,
      },
      {
        teamId: "team-3",
        totalScore: -6.8,
        gamesPlayed: 0,
        retainedScore: -6.8,
      },
      {
        teamId: "team-4",
        totalScore: -20.9,
        gamesPlayed: 0,
        retainedScore: -20.9,
      },
    ]);
  });
});

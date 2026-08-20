import { describe, expect, it } from "vitest";
import {
  matchScheduledGamesToLiveGames,
  resolveLiveTeamIds,
} from "./scheduleLiveMatching";

const users = ["a", "b", "c", "d"];

describe("matchScheduledGamesToLiveGames", () => {
  it("matches an exact participant set regardless of seat order", () => {
    const matches = matchScheduledGamesToLiveGames(
      [
        {
          id: "scheduled-1",
          phaseId: "regular",
          scheduledAt: new Date("2026-08-20T18:00:00.000Z"),
          participantIds: users,
        },
      ],
      [
        {
          gameId: "live-1",
          platform: "tenhou",
          phaseId: "regular",
          startTime: new Date("2026-08-20T18:05:00.000Z"),
          participantIds: ["d", "b", "a", "c"],
          watchId: "watch-1",
        },
      ]
    );

    expect(matches.get("scheduled-1")?.gameId).toBe("live-1");
  });

  it("skips incomplete, unresolved, cross-phase, and non-Tenhou games", () => {
    const scheduledAt = new Date("2026-08-20T18:00:00.000Z");
    const matches = matchScheduledGamesToLiveGames(
      [
        {
          id: "incomplete",
          phaseId: "regular",
          scheduledAt,
          participantIds: ["a", "b", "c", null],
        },
        {
          id: "complete",
          phaseId: "regular",
          scheduledAt,
          participantIds: users,
        },
      ],
      [
        {
          gameId: "wrong-phase",
          platform: "tenhou",
          phaseId: "finals",
          startTime: scheduledAt,
          participantIds: users,
          watchId: "watch-phase",
        },
        {
          gameId: "unresolved",
          platform: "tenhou",
          phaseId: "regular",
          startTime: scheduledAt,
          participantIds: ["a", "b", "c", null],
          watchId: "watch-unresolved",
        },
        {
          gameId: "majsoul",
          platform: "majsoul",
          phaseId: "regular",
          startTime: scheduledAt,
          participantIds: users,
        },
      ]
    );

    expect(matches.size).toBe(0);
  });

  it("assigns repeated matchups one-to-one by nearest start time", () => {
    const matches = matchScheduledGamesToLiveGames(
      [
        {
          id: "early",
          phaseId: null,
          scheduledAt: new Date("2026-08-20T18:00:00.000Z"),
          participantIds: users,
        },
        {
          id: "late",
          phaseId: null,
          scheduledAt: new Date("2026-08-20T20:00:00.000Z"),
          participantIds: users,
        },
      ],
      [
        {
          gameId: "live-late",
          platform: "tenhou",
          phaseId: null,
          startTime: new Date("2026-08-20T19:55:00.000Z"),
          participantIds: users,
          watchId: "watch-late",
        },
        {
          gameId: "live-early",
          platform: "tenhou",
          phaseId: null,
          startTime: new Date("2026-08-20T18:10:00.000Z"),
          participantIds: users,
          watchId: "watch-early",
        },
      ]
    );

    expect(matches.get("early")?.gameId).toBe("live-early");
    expect(matches.get("late")?.gameId).toBe("live-late");
  });
});

describe("resolveLiveTeamIds", () => {
  const teams = [
    {
      id: "team-1",
      rosterUserIds: ["a"],
      finalsRosterUserIds: ["b"],
    },
    {
      id: "team-2",
      rosterUserIds: ["c"],
      finalsRosterUserIds: ["d"],
    },
  ];

  it("uses regular rosters outside finals", () => {
    expect(resolveLiveTeamIds(["a", "c"], teams, false)).toEqual([
      "team-1",
      "team-2",
    ]);
  });

  it("prefers finals rosters during finals", () => {
    expect(resolveLiveTeamIds(["b", "d"], teams, true)).toEqual([
      "team-1",
      "team-2",
    ]);
    expect(resolveLiveTeamIds(["a", "c"], teams, true)).toBeNull();
  });

  it("rejects unresolved or duplicate teams", () => {
    expect(resolveLiveTeamIds(["unknown"], teams, false)).toBeNull();
    expect(resolveLiveTeamIds(["a", "a"], teams, false)).toBeNull();
    expect(
      resolveLiveTeamIds(
        ["shared"],
        [
          ...teams,
          { id: "team-3", rosterUserIds: ["shared"] },
          { id: "team-4", rosterUserIds: ["shared"] },
          { id: "team-5", rosterUserIds: ["shared"] },
        ],
        false
      )
    ).toBeNull();
  });
});
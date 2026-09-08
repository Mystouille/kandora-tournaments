import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  partitionScheduledGames,
  TournamentScheduleGroups,
} from "./TournamentScheduleGroups";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW_MS = Date.parse("2026-08-26T12:00:00.000Z");

describe("partitionScheduledGames", () => {
  it("collapses only games scheduled more than 24 hours ago", () => {
    const games = [
      {
        id: "oldest",
        scheduledAt: new Date(NOW_MS - DAY_MS - 60_000).toISOString(),
      },
      {
        id: "boundary",
        scheduledAt: new Date(NOW_MS - DAY_MS).toISOString(),
      },
      {
        id: "recent",
        scheduledAt: new Date(NOW_MS - 60_000).toISOString(),
      },
      {
        id: "future",
        scheduledAt: new Date(NOW_MS + DAY_MS).toISOString(),
      },
      { id: "invalid", scheduledAt: "not-a-date" },
      {
        id: "older",
        scheduledAt: new Date(NOW_MS - 2 * DAY_MS).toISOString(),
      },
    ];

    const partitioned = partitionScheduledGames(games, NOW_MS);

    expect(partitioned.current.map((game) => game.id)).toEqual([
      "boundary",
      "recent",
      "future",
      "invalid",
    ]);
    expect(partitioned.past.map((game) => game.id)).toEqual([
      "oldest",
      "older",
    ]);
  });

  it("renders live games as document links without a delay parameter", () => {
    const game = {
      id: "game-1",
      phaseId: null,
      scheduledAt: new Date(NOW_MS).toISOString(),
      slots: [],
      live: { status: "ongoing" as const, watchId: "WATCH/123" },
    };
    const markup = renderToStaticMarkup(
      createElement(TournamentScheduleGroups, {
        groups: [{ phase: { id: null, kind: "tournament" }, days: [["day", [game]]] }],
        data: {
          leagueId: "league-1",
          leagueName: "League",
          isTeamMode: false,
          phases: [{ id: null, kind: "tournament" }],
          games: [game],
        },
        localeCode: "en",
        isMobile: false,
        labels: {
          tournamentPhase: "Tournament",
          tbd: "TBD",
          live: "Live",
          watchLive: "Watch live",
        },
      })
    );

    expect(markup).toContain('href="/watch/live/WATCH%2F123"');
    expect(markup).not.toContain("delay=");
  });
});

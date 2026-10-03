import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "~/contexts/LocaleContext";
import { gameSummaryFixture } from "../../../tests/e2e/statistics/gameSummaryFixture";
import { GameStatsScreen } from "./GameStatsScreen";
import { GameStandingsScreen } from "./GameStandingsScreen";
import { GameSummaryPage } from "./GameSummaryPage";
import { SummaryIdentityBanner } from "./SummaryPresentation";

function render(screen: ReactElement) {
  return renderToStaticMarkup(
    createElement(LocaleProvider, {
      initialLocale: "en",
      children: createElement(MemoryRouter, { children: screen }),
    })
  );
}

describe("game summary presentation", () => {
  it.each([false, true])(
    "renders a decorative team watermark behind the unchanged identity (compact: %s)",
    (compact) => {
      const identity = {
        ...gameSummaryFixture().players[0],
        imageUrl: "/portrait.webp",
        teamLogoUrl: "/team-logo.webp",
      };
      const html = render(
        createElement(SummaryIdentityBanner, { identity, compact })
      );
      const watermark = html.match(
        /<div class="gs-team-watermark"[\s\S]*?<\/div>/
      )?.[0];
      expect(watermark).toBeDefined();
      expect(watermark).toContain('aria-hidden="true"');
      expect(watermark).toContain('src="/team-logo.webp"');
      expect(watermark).toContain('alt=""');
      expect(html).toContain('src="/portrait.webp"');
      expect(html).toContain("Alice Martin");
      expect(html.indexOf('class="gs-team-watermark"')).toBeLessThan(
        html.indexOf('class="gs-identity-copy"')
      );
    }
  );

  it("keeps the colored identity banner when no team logo is available", () => {
    const identity = gameSummaryFixture().players[0];
    const html = render(createElement(SummaryIdentityBanner, { identity }));
    expect(html).not.toContain("gs-team-watermark");
    expect(html).toContain("linear-gradient");
    expect(html).toContain("Alice Martin");
  });

  it.each([
    {
      screen: "statistics",
      Component: GameStatsScreen,
      isTeamMode: true,
      names: ["Player", "Place"],
    },
    {
      screen: "team standings",
      Component: GameStandingsScreen,
      isTeamMode: true,
      names: ["Place", "Team"],
    },
    {
      screen: "individual standings",
      Component: GameStandingsScreen,
      isTeamMode: false,
      names: ["Place", "Player"],
    },
  ])(
    "omits visible identity/rank headings in $screen while preserving accessible names",
    ({ Component, isTeamMode, names }) => {
      const summary = gameSummaryFixture();
      summary.league.isTeamMode = isTeamMode;
      const html = render(createElement(Component, { summary }));
      const headings = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)];
      expect(headings.slice(0, 2).map((heading) => heading[1])).toEqual([
        "",
        "",
      ]);
      names.forEach((name, index) => {
        expect(headings[index][0]).toContain(`aria-label="${name}"`);
      });
      expect(html).not.toContain("Whole league");
      expect(html).not.toContain("gs-standings-caption");
    }
  );

  it("shows the game's start and end times in the exportable header", () => {
    const summary = gameSummaryFixture();
    const html = render(
      createElement(GameSummaryPage, { summary, returnTo: "/" })
    );
    const range = html.match(
      /<span class="gs-time-range">([\s\S]*?)<\/span>/
    )?.[1];
    expect(range).toBeDefined();
    for (const timestamp of [summary.startTime, summary.endTime!]) {
      expect(range).toContain(new Date(timestamp).toISOString());
      expect(range).toContain(
        new Date(timestamp).toLocaleTimeString("en", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    }
    expect(range).toContain("\u2013");
  });

  it("does not substitute the start time for an unknown end time", () => {
    const summary = gameSummaryFixture();
    summary.endTime = null;
    const html = render(
      createElement(GameSummaryPage, { summary, returnTo: "/" })
    );
    const range = html.match(
      /<span class="gs-time-range">([\s\S]*?)<\/span>/
    )?.[1];
    expect(range).toBeDefined();
    expect(range?.match(/<time\b/g)).toHaveLength(1);
    expect(range).toContain("\u2013 \u2014");
  });

  it("renders real scores and per-player counters", () => {
    const html = render(
      createElement(GameStatsScreen, { summary: gameSummaryFixture() })
    );
    expect(html).toContain("44,100");
    expect(html).toContain("+64.1");
    expect(html).toContain("Riichis");
    expect(html).toContain("Deal-ins");
    expect(html).toContain("Alice Martin");
  });

  it("marks missing statistics explicitly instead of supplying zero counters", () => {
    const summary = gameSummaryFixture();
    summary.stats = { status: "unavailable", reason: "missingRecord" };
    const html = render(createElement(GameStatsScreen, { summary }));
    expect(html).toContain("Detailed game records are not available");
    expect(html).toContain("44,100");
    expect(html).not.toContain('data-summary-stat="0"');
  });

  it("shows eliminated ranks with dashes instead of totals, gaps and games", () => {
    const html = render(
      createElement(GameStandingsScreen, { summary: gameSummaryFixture() })
    );
    const eliminated = html.match(
      /<tr[^>]*data-standing-id="team-3"[\s\S]*?<\/tr>/
    )?.[0];
    expect(eliminated).toBeDefined();
    expect(eliminated).toContain("Blue Waves");
    expect(eliminated).toContain("Eliminated");
    expect(eliminated).toContain('class="gs-standing-rank">3</td>');
    expect(eliminated).toContain('data-summary-total="">-</td>');
    expect(eliminated).toContain('data-summary-difference="">-</td>');
    expect(eliminated).toContain('data-summary-games="">-</td>');
    expect(html).toContain("164.7");
    expect(html).toContain("Point difference");
    expect(html).toContain("79.5");
    expect(html).not.toContain("After this game");
    expect(eliminated).not.toContain("gs-point-trend");
  });

  it("renders the games total only when known and identifies the highlighted rank", () => {
    const summary = gameSummaryFixture();
    if (summary.standings.status !== "available") {
      throw new Error("The standings fixture must be available");
    }
    summary.standings.data[1].totalGames = null;
    const html = render(createElement(GameStandingsScreen, { summary }));
    const leader = html.match(
      /<tr[^>]*data-standing-id="team-1"[\s\S]*?<\/tr>/
    )?.[0];
    const second = html.match(
      /<tr[^>]*data-standing-id="team-2"[\s\S]*?<\/tr>/
    )?.[0];
    expect(leader).toContain('data-rank-highlight="leader"');
    expect(leader).toContain("Current leader");
    expect(leader).toContain('data-summary-difference="">-</td>');
    expect(leader).toContain('data-summary-games="">12/14</td>');
    expect(second).toContain('data-summary-games="">12</td>');
    expect(second).not.toContain("data-rank-highlight");
  });

  it("labels currently qualifying ranks independently of being this game's participant", () => {
    const summary = gameSummaryFixture();
    if (summary.standings.status !== "available") {
      throw new Error("The standings fixture must be available");
    }
    summary.standings.data[1].rankHighlight = "qualified";
    summary.standings.data[1].playedThisGame = false;
    const html = render(createElement(GameStandingsScreen, { summary }));
    const second = html.match(
      /<tr[^>]*data-standing-id="team-2"[\s\S]*?<\/tr>/
    )?.[0];
    expect(second).toContain('data-rank-highlight="qualified"');
    expect(second).toContain("Currently qualified");
  });

  it("shows this game's up/down chevrons in total points without changing the gap column", () => {
    const summary = gameSummaryFixture();
    if (summary.standings.status !== "available") {
      throw new Error("The standings fixture must be available");
    }
    summary.standings.data[1].pointsChange = -10.2;
    const html = render(createElement(GameStandingsScreen, { summary }));
    const totals = [
      ...html.matchAll(/<td[^>]*data-summary-total=""[^>]*>([\s\S]*?)<\/td>/g),
    ];
    expect(totals[0][1]).toContain("164.7");
    expect(totals[0][1]).toContain('data-point-trend="up"');
    expect(totals[0][1]).toContain('aria-label="Points gained"');
    expect(totals[0][1]).toContain("gs-positive");
    expect(totals[1][1]).toContain("85.2");
    expect(totals[1][1]).toContain('data-point-trend="down"');
    expect(totals[1][1]).toContain('aria-label="Points lost"');
    expect(totals[1][1]).toContain("gs-negative");
    expect(html).toContain('data-summary-difference="">79.5</td>');
    expect(totals[2][1]).toBe("-");
    expect(totals[3][1]).toBe("-");
  });

  it("omits chevrons for unchanged, unavailable and eliminated totals", () => {
    const summary = gameSummaryFixture();
    if (summary.standings.status !== "available") {
      throw new Error("The standings fixture must be available");
    }
    summary.standings.data[0].pointsChange = 0;
    summary.standings.data[1].pointsChange = null;
    summary.standings.data[2].pointsChange = 10;
    const html = render(createElement(GameStandingsScreen, { summary }));
    expect(html).not.toContain("gs-point-trend");
  });
});

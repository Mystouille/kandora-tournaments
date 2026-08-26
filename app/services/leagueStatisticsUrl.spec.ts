import { describe, expect, it } from "vitest";
import { buildLeagueStatisticsUrl } from "./leagueStatisticsUrl";

describe("buildLeagueStatisticsUrl", () => {
  it("uses the configured tournaments base URL and current statistics route", () => {
    expect(
      buildLeagueStatisticsUrl({
        baseUrl: "https://tournaments.tnt-sessions.com",
        leagueName: "TNT League V",
        locale: "fr",
      })
    ).toBe(
      "https://tournaments.tnt-sessions.com/online-tournaments/tnt-league-v/statistics"
    );
  });

  it("normalizes a trailing slash and retains the English locale route", () => {
    expect(
      buildLeagueStatisticsUrl({
        baseUrl: "https://tournaments.tnt-sessions.com/",
        leagueName: "TNT League V",
        locale: "en",
      })
    ).toBe(
      "https://tournaments.tnt-sessions.com/en/online-tournaments/tnt-league-v/statistics"
    );
  });

  it("uses an explicit phase slug when supplied", () => {
    expect(
      buildLeagueStatisticsUrl({
        baseUrl: "https://tournaments.tnt-sessions.com",
        leagueName: "Ignored name",
        locale: "fr",
        slug: "custom-finals",
      })
    ).toBe(
      "https://tournaments.tnt-sessions.com/online-tournaments/custom-finals/statistics"
    );
  });
});

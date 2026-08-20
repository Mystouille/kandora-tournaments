import { describe, expect, it } from "vitest";
import {
  TOURNAMENT_INFO_TAB_ROUTES,
  resolveTournamentInfoTab,
  tournamentInfoTabKeyFromRoute,
  tournamentInfoTabRouteFromKey,
} from "./tournamentInfoTabRoutes";

describe("tournament information tab routes", () => {
  it.each(Object.entries(TOURNAMENT_INFO_TAB_ROUTES))(
    "round-trips %s through %s",
    (key, route) => {
      expect(tournamentInfoTabKeyFromRoute(route)).toBe(key);
      expect(
        tournamentInfoTabRouteFromKey(
          key as keyof typeof TOURNAMENT_INFO_TAB_ROUTES
        )
      ).toBe(route);
    }
  );

  it("rejects unknown and missing routes", () => {
    expect(tournamentInfoTabKeyFromRoute("unknown")).toBeNull();
    expect(tournamentInfoTabKeyFromRoute(undefined)).toBeNull();
  });

  it("uses presentation for the base and unknown routes", () => {
    const availability = { showSchedule: true, showFinalsRoster: true };

    expect(resolveTournamentInfoTab(undefined, availability)).toBe(
      "presentation"
    );
    expect(resolveTournamentInfoTab("unknown", availability)).toBe(
      "presentation"
    );
  });

  it("falls back when a conditional tab is unavailable", () => {
    const availability = { showSchedule: false, showFinalsRoster: false };

    expect(resolveTournamentInfoTab("schedule", availability)).toBe(
      "presentation"
    );
    expect(resolveTournamentInfoTab("finals-roster", availability)).toBe(
      "presentation"
    );
  });

  it("keeps available conditional tabs", () => {
    const availability = { showSchedule: true, showFinalsRoster: true };

    expect(resolveTournamentInfoTab("schedule", availability)).toBe(
      "schedule"
    );
    expect(resolveTournamentInfoTab("finals-roster", availability)).toBe(
      "finalsRoster"
    );
  });
});
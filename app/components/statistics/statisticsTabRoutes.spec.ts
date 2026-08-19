import { describe, expect, it } from "vitest";
import {
  STATISTICS_TAB_ROUTES,
  resolveStatisticsTab,
  statisticsTabKeyFromRoute,
  statisticsTabRouteFromKey,
} from "./statisticsTabRoutes";

describe("statistics tab routes", () => {
  it.each(Object.entries(STATISTICS_TAB_ROUTES))(
    "round-trips %s through %s",
    (key, route) => {
      expect(statisticsTabKeyFromRoute(route)).toBe(key);
      expect(statisticsTabRouteFromKey(key as keyof typeof STATISTICS_TAB_ROUTES)).toBe(
        route
      );
    }
  );

  it("rejects unknown and missing routes", () => {
    expect(statisticsTabKeyFromRoute("unknown")).toBeNull();
    expect(statisticsTabKeyFromRoute(undefined)).toBeNull();
  });

  it("restores the saved tab on the legacy base route", () => {
    expect(
      resolveStatisticsTab(undefined, "games", {
        showBracket: false,
        showGraphs: true,
      })
    ).toBe("games");
  });

  it("uses the default tab for unknown or unavailable routes", () => {
    const availability = { showBracket: false, showGraphs: true };

    expect(resolveStatisticsTab("unknown", "games", availability)).toBe(
      "graphs"
    );
    expect(resolveStatisticsTab("bracket", "games", availability)).toBe(
      "graphs"
    );
  });

  it("falls back to bracket for a finals-only tournament", () => {
    expect(
      resolveStatisticsTab("graphs", "graphs", {
        showBracket: true,
        showGraphs: false,
      })
    ).toBe("bracket");
  });
});
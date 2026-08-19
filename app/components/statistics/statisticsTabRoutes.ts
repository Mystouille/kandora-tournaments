export const STATISTICS_TAB_ROUTES = {
  bracket: "bracket",
  graphs: "graphs",
  standings: "standings",
  rankings: "rankings",
  moreRankings: "more-rankings",
  games: "games",
  yakuMap: "yaku-map",
} as const;

export type StatisticsTabKey = keyof typeof STATISTICS_TAB_ROUTES;
export type StatisticsTabRoute = (typeof STATISTICS_TAB_ROUTES)[StatisticsTabKey];

const TAB_KEYS_BY_ROUTE = new Map<StatisticsTabRoute, StatisticsTabKey>(
  Object.entries(STATISTICS_TAB_ROUTES).map(([key, route]) => [
    route,
    key as StatisticsTabKey,
  ])
);

export function statisticsTabKeyFromRoute(
  route: string | undefined
): StatisticsTabKey | null {
  return TAB_KEYS_BY_ROUTE.get(route as StatisticsTabRoute) ?? null;
}

export function statisticsTabRouteFromKey(key: StatisticsTabKey) {
  return STATISTICS_TAB_ROUTES[key];
}

export function isStatisticsTabKey(value: string): value is StatisticsTabKey {
  return Object.prototype.hasOwnProperty.call(STATISTICS_TAB_ROUTES, value);
}

interface StatisticsTabAvailability {
  showBracket: boolean;
  showGraphs: boolean;
}

function isTabAvailable(
  tab: StatisticsTabKey,
  availability: StatisticsTabAvailability
) {
  if (tab === "bracket") {
    return availability.showBracket;
  }
  if (tab === "graphs") {
    return availability.showGraphs;
  }
  return true;
}

export function resolveStatisticsTab(
  route: string | undefined,
  storedTab: string,
  availability: StatisticsTabAvailability
): StatisticsTabKey {
  const requestedTab = statisticsTabKeyFromRoute(route);
  if (requestedTab && isTabAvailable(requestedTab, availability)) {
    return requestedTab;
  }

  if (
    route === undefined &&
    isStatisticsTabKey(storedTab) &&
    isTabAvailable(storedTab, availability)
  ) {
    return storedTab;
  }

  if (availability.showGraphs) {
    return "graphs";
  }
  if (availability.showBracket) {
    return "bracket";
  }
  return "standings";
}
export const TOURNAMENT_INFO_TAB_ROUTES = {
  presentation: "presentation",
  rules: "rules",
  schedule: "schedule",
  players: "players",
  finalsRoster: "finals-roster",
} as const;

export type TournamentInfoTabKey =
  keyof typeof TOURNAMENT_INFO_TAB_ROUTES;
export type TournamentInfoTabRoute =
  (typeof TOURNAMENT_INFO_TAB_ROUTES)[TournamentInfoTabKey];

const TAB_KEYS_BY_ROUTE = new Map<
  TournamentInfoTabRoute,
  TournamentInfoTabKey
>(
  Object.entries(TOURNAMENT_INFO_TAB_ROUTES).map(([key, route]) => [
    route,
    key as TournamentInfoTabKey,
  ])
);

export function tournamentInfoTabKeyFromRoute(
  route: string | undefined
): TournamentInfoTabKey | null {
  return TAB_KEYS_BY_ROUTE.get(route as TournamentInfoTabRoute) ?? null;
}

export function tournamentInfoTabRouteFromKey(key: TournamentInfoTabKey) {
  return TOURNAMENT_INFO_TAB_ROUTES[key];
}

export function isTournamentInfoTabKey(
  value: string
): value is TournamentInfoTabKey {
  return Object.prototype.hasOwnProperty.call(
    TOURNAMENT_INFO_TAB_ROUTES,
    value
  );
}

interface TournamentInfoTabAvailability {
  showSchedule: boolean;
  showFinalsRoster: boolean;
}

export function resolveTournamentInfoTab(
  route: string | undefined,
  availability: TournamentInfoTabAvailability
): TournamentInfoTabKey {
  const requestedTab = tournamentInfoTabKeyFromRoute(route);
  if (requestedTab === "schedule" && !availability.showSchedule) {
    return "presentation";
  }
  if (requestedTab === "finalsRoster" && !availability.showFinalsRoster) {
    return "presentation";
  }
  return requestedTab ?? "presentation";
}
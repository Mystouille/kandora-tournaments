import GameMatch, { type GameMatchLoaderData } from "~/game/routes/match";
import { requireGameEnabled, getClientGameFlag } from "~/game/feature-gate";
import type { Route } from "./+types/game-match";

export async function loader({ params }: Route.LoaderArgs): Promise<GameMatchLoaderData> {
  requireGameEnabled();
  return {
    matchId: params.matchId,
    flag: getClientGameFlag(),
  };
}

export default function GameMatchRoute({ loaderData }: Route.ComponentProps) {
  return <GameMatch loaderData={loaderData} />;
}
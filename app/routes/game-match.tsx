import GameMatch, { type GameMatchLoaderData } from "~/game/routes/match";
import { requireGameEnabled, getClientGameFlag } from "~/game/feature-gate";
import type { Route } from "./+types/game-match";
import { requireGameUser } from "~/utils/gameAuth.server";

export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<GameMatchLoaderData> {
  requireGameEnabled();
  await requireGameUser(request);
  return {
    matchId: params.matchId,
    flag: getClientGameFlag(),
  };
}

export default function GameMatchRoute({ loaderData }: Route.ComponentProps) {
  return <GameMatch loaderData={loaderData} />;
}

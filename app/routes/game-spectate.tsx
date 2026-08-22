import GameSpectate, {
  loader as loadGameSpectate,
} from "~/game/routes/spectate";
import type { Route } from "./+types/game-spectate";
import { requireGameUser } from "~/utils/gameAuth.server";

export async function loader(args: Route.LoaderArgs) {
  await requireGameUser(args.request);
  return loadGameSpectate(args);
}

export default function GameSpectateHostRoute({
  loaderData,
}: Route.ComponentProps) {
  return <GameSpectate loaderData={loaderData} />;
}

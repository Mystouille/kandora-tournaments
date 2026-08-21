import GameSpectate, {
  loader as loadGameSpectate,
} from "~/game/routes/spectate";
import type { Route } from "./+types/game-spectate";

export function loader(args: Route.LoaderArgs) {
  return loadGameSpectate(args);
}

export default function GameSpectateHostRoute({
  loaderData,
}: Route.ComponentProps) {
  return <GameSpectate loaderData={loaderData} />;
}
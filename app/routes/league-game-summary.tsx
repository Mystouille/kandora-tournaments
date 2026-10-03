import { data, isRouteErrorResponse, Link } from "react-router";
import { Result } from "antd";
import type { Route } from "./+types/league-game-summary";
import { loadLeagueGameSummary } from "~/services/leagueGameSummary.server";
import {
  normalizeLocalReturnPath,
  stripAppBasePath,
} from "~/utils/gameReturnPath";
import { basePath } from "~/utils/basePath";
import { GameSummaryPage } from "~/components/game-summary/GameSummaryPage";
import { useLocale } from "~/contexts/LocaleContext";

export async function loader({ params, request }: Route.LoaderArgs) {
  try {
    const summary = await loadLeagueGameSummary(params.gameId);
    const url = new URL(request.url);
    const fallback = `/online-tournaments/${summary.league.slug}/statistics/games`;
    const returnTo = normalizeLocalReturnPath(
      stripAppBasePath(url.searchParams.get("from") ?? fallback, basePath),
      fallback
    );
    return data(
      { summary, returnTo },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("[game summary] Failed to load summary", error);
    throw new Response("Could not load the game summary", { status: 500 });
  }
}

export default function LeagueGameSummaryRoute({
  loaderData,
}: Route.ComponentProps) {
  return (
    <GameSummaryPage
      summary={loaderData.summary}
      returnTo={loaderData.returnTo}
    />
  );
}

export function meta({ data: loaderData }: Route.MetaArgs) {
  return [
    { title: `${loaderData?.summary.league.name ?? "Game summary"} | Kandora` },
  ];
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useLocale();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <Result
      status={status === 404 ? "404" : status === 409 ? "warning" : "error"}
      title={t.gameSummary.title}
      subTitle={
        status === 404
          ? t.gameSummary.notFound
          : status === 409
            ? t.gameSummary.notReady
            : t.gameSummary.loadFailed
      }
      extra={<Link to="/">{t.gameSummary.back}</Link>}
    />
  );
}

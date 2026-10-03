import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocaleProvider } from "../../../app/contexts/LocaleContext";
import { ThemeProvider } from "../../../app/contexts/ThemeContext";
import { GameSummaryPage } from "../../../app/components/game-summary/GameSummaryPage";
import GamesTab from "../../../app/components/statistics/GamesTab";
import { normalizeLocalReturnPath } from "../../../app/utils/gameReturnPath";
import { gameSummaryFixture } from "./gameSummaryFixture";

function Summary() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const scenario = params.get("fixture");
  const summary = gameSummaryFixture();
  if (scenario !== "missing") {
    summary.players.forEach((player, index) => {
      player.imageUrl = `/summary-assets/player-${index}.svg`;
    });
  }
  if (scenario === "missing") {
    summary.stats = { status: "unavailable", reason: "missingRecord" };
    summary.points = { status: "unavailable", reason: "missingRecord" };
    summary.handCount = null;
    summary.drawCount = null;
  }
  if (scenario === "watermarks" || scenario === "missing-watermarks") {
    const teamLogoUrl =
      scenario === "watermarks"
        ? "/summary-assets/team-watermark.svg"
        : "/summary-assets/team-watermark-missing.svg";
    summary.players.forEach((player) => {
      player.teamLogoUrl = teamLogoUrl;
    });
    if (summary.standings.status === "available") {
      summary.standings.data.forEach((row) => {
        row.teamLogoUrl = teamLogoUrl;
      });
    }
  }
  if (scenario === "individual" && summary.standings.status === "available") {
    summary.league.isTeamMode = false;
    summary.standings.data.forEach((row, index) => {
      row.name = summary.players[index].name;
      row.id = summary.players[index].id;
    });
  }
  if (scenario === "qualifying" && summary.standings.status === "available") {
    summary.phaseId = "regular";
    summary.standings.data.forEach((row) => {
      row.rankHighlight = row.eliminated ? null : "qualified";
    });
  }
  if (scenario === "unscheduled" && summary.standings.status === "available") {
    summary.standings.data.forEach((row) => {
      row.totalGames = null;
    });
  }
  if (scenario === "trends" && summary.standings.status === "available") {
    summary.standings.data[1].pointsChange = -10.2;
  }
  if (scenario === "unchanged" && summary.standings.status === "available") {
    summary.standings.data.forEach((row) => {
      row.pointsChange = row.eliminated ? null : 0;
    });
  }
  if (scenario === "long" && summary.standings.status === "available") {
    const first = summary.standings.data[0];
    summary.standings.data = Array.from({ length: 140 }, (_, index) => ({
      ...first,
      id: `team-${index + 1}`,
      name:
        index === 139
          ? "Last eliminated entrant"
          : `League entrant ${index + 1}`,
      rank: index + 1,
      rankHighlight: index === 0 ? "leader" : null,
      totalScore: index < 120 ? 200 - index : null,
      pointsChange: index >= 120 ? null : index < 4 ? first.pointsChange : 0,
      pointsDifference: index > 0 && index < 120 ? 1 : null,
      totalGames: index < 120 ? first.totalGames : null,
      eliminated: index >= 120,
      playedThisGame: index < 4,
    }));
  }
  if (scenario === "long-names") {
    summary.players[0].name = "Alexandria Montgomery-Wellington";
    summary.players[0].teamName =
      "The International Mahjong Players Association";
  }
  return (
    <GameSummaryPage
      summary={summary}
      returnTo={normalizeLocalReturnPath(
        params.get("from"),
        "/summary-fixture/games?filter=kept"
      )}
    />
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("The game summary browser harness root is missing");
}
const locale =
  new URLSearchParams(window.location.search).get("locale") === "fr"
    ? "fr"
    : "en";
document.body.style.cssText =
  "margin:0;padding:24px;background:#111a16;font-family:Arial,sans-serif;";

createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <LocaleProvider initialLocale={locale}>
      <ThemeProvider initialTheme="dark">
        <BrowserRouter>
          <Routes>
            <Route
              path="/summary-fixture/games"
              element={
                <GamesTab
                  leagueIds={["200000000000000000000001"]}
                  entityType="player"
                  entityIds={[]}
                  startDate={null}
                  endDate={null}
                  highlightedPlayerIds={new Set()}
                  autoRefresh={false}
                  teams={[]}
                />
              }
            />
            <Route path="/games/:gameId/summary" element={<Summary />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </LocaleProvider>
  </QueryClientProvider>
);

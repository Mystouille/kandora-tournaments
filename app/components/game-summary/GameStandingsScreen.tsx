import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { useLocale } from "~/contexts/LocaleContext";
import type { LeagueGameSummary } from "~/types/leagueGameSummary";
import {
  SummaryIdentityBanner,
  SummaryUnavailable,
  summaryNumber,
} from "./SummaryPresentation";

export function GameStandingsScreen({
  summary,
}: {
  summary: LeagueGameSummary;
}) {
  const { t, locale } = useLocale();
  const labels = t.gameSummary;
  if (summary.standings.status === "unavailable") {
    return <SummaryUnavailable reason={summary.standings.reason} />;
  }
  return (
    <section className="gs-standings-screen" aria-label={labels.standings}>
      <table className="gs-standings-table">
        <colgroup>
          <col style={{ width: 100 }} />
          <col style={{ width: 740 }} />
          <col style={{ width: 365 }} />
          <col style={{ width: 365 }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th aria-label={labels.place} />
            <th
              aria-label={
                summary.league.isTeamMode ? labels.team : labels.player
              }
            />
            <th>{labels.total}</th>
            <th>{labels.difference}</th>
            <th>{labels.games}</th>
          </tr>
        </thead>
        <tbody>
          {summary.standings.data.map((row) => (
            <tr
              key={row.id}
              data-standing-id={row.id}
              className={`${row.eliminated ? "gs-eliminated" : ""} ${row.playedThisGame ? "gs-played" : ""}`}
            >
              <td
                className="gs-standing-rank"
                data-rank-highlight={row.rankHighlight ?? undefined}
                title={
                  row.rankHighlight === "qualified"
                    ? labels.currentlyQualified
                    : row.rankHighlight === "leader"
                      ? labels.currentLeader
                      : undefined
                }
              >
                {row.rank}
              </td>
              <td>
                <SummaryIdentityBanner identity={row} compact />
                {row.eliminated && (
                  <span className="gs-eliminated-label">
                    {labels.eliminated}
                  </span>
                )}
              </td>
              <td className="gs-standing-total" data-summary-total="">
                {row.eliminated || row.totalScore === null
                  ? "-"
                  : summaryNumber(row.totalScore, locale, 1)}
                {!row.eliminated &&
                  row.totalScore !== null &&
                  row.pointsChange !== null &&
                  row.pointsChange !== 0 && (
                    <span
                      className={`gs-point-trend ${row.pointsChange > 0 ? "gs-positive" : "gs-negative"}`}
                      data-point-trend={row.pointsChange > 0 ? "up" : "down"}
                      title={`${row.pointsChange > 0 ? labels.gained : labels.lost}: ${summaryNumber(row.pointsChange, locale, 1, true)}`}
                    >
                      {row.pointsChange > 0 ? (
                        <UpOutlined aria-label={labels.gained} />
                      ) : (
                        <DownOutlined aria-label={labels.lost} />
                      )}
                    </span>
                  )}
              </td>
              <td className="gs-standing-difference" data-summary-difference="">
                {row.eliminated || row.pointsDifference === null
                  ? "-"
                  : summaryNumber(row.pointsDifference, locale, 1)}
              </td>
              <td className="gs-standing-games" data-summary-games="">
                {row.eliminated
                  ? "-"
                  : `${summaryNumber(row.gamesPlayed, locale)}${row.totalGames === null ? "" : `/${summaryNumber(row.totalGames, locale)}`}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

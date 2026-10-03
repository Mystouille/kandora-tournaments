import { useLocale } from "~/contexts/LocaleContext";
import type { LeagueGameSummary } from "~/types/leagueGameSummary";
import { SummaryIdentityBanner, summaryNumber } from "./SummaryPresentation";

export function GameStatsScreen({ summary }: { summary: LeagueGameSummary }) {
  const { t, locale } = useLocale();
  const labels = t.gameSummary;
  return (
    <section className="gs-stats-screen" aria-label={labels.stats}>
      <table className="gs-stats-table">
        <colgroup>
          <col style={{ width: 600 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 355 }} />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th aria-label={labels.player} />
            <th aria-label={labels.place} />
            <th>{labels.score}</th>
            <th>{labels.riichis}</th>
            <th>{labels.wins}</th>
            <th>{labels.dealIns}</th>
          </tr>
        </thead>
        <tbody>
          {summary.players.map((player) => {
            const stats =
              summary.stats.status === "available"
                ? summary.stats.data[player.id]
                : null;
            return (
              <tr key={player.id} data-player-id={player.id}>
                <td>
                  <SummaryIdentityBanner identity={player} />
                </td>
                <td className="gs-place" data-place={player.place}>
                  {player.place}
                </td>
                <td className="gs-final-points">
                  <strong>{summaryNumber(player.score, locale)}</strong>
                  <span
                    className={
                      player.gamePoints < 0 ? "gs-negative" : "gs-positive"
                    }
                  >
                    ({summaryNumber(player.gamePoints, locale, 1, true)})
                  </span>
                </td>
                {[stats?.riichis, stats?.wins, stats?.dealIns].map(
                  (value, index) => (
                    <td
                      className="gs-stat-value"
                      key={index}
                      data-summary-stat={value}
                    >
                      {value === undefined ? "\u2014" : value}
                    </td>
                  )
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {summary.stats.status === "unavailable" && (
        <p className="gs-inline-notice" role="status">
          {labels[summary.stats.reason]}
        </p>
      )}
    </section>
  );
}

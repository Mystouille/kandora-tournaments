import { useMemo } from "react";
import { Line } from "@nivo/line";
import { useLocale } from "~/contexts/LocaleContext";
import type {
  LeagueGameSummary,
  SummaryHandLabel,
} from "~/types/leagueGameSummary";
import { getDefaultTeamColor } from "~/utils/teamColors";
import {
  SummaryIdentityBanner,
  SummaryUnavailable,
  summaryNumber,
} from "./SummaryPresentation";

function handLabel(
  label: SummaryHandLabel,
  index: number,
  start: string,
  final: string
) {
  if (label.kind === "start") {
    return start;
  }
  if (label.kind === "final") {
    return final;
  }
  return label.wind && label.number
    ? `${label.wind}${label.number}${label.honba ? ` +${label.honba}` : ""}`
    : `#${index}`;
}

export function GamePointsScreen({ summary }: { summary: LeagueGameSummary }) {
  const { t, locale } = useLocale();
  const labels = t.gameSummary;
  const colors = useMemo(() => {
    const result = new Map<string, string>();
    const used = new Set<string>();
    for (const player of [...summary.players].sort(
      (a, b) => (a.seat ?? 4) - (b.seat ?? 4)
    )) {
      let color = player.color;
      let index = player.seat ?? 0;
      while (used.has(color)) {
        color = getDefaultTeamColor(index++);
      }
      result.set(player.id, color);
      used.add(color);
    }
    return result;
  }, [summary.players]);
  if (summary.points.status === "unavailable") {
    return <SummaryUnavailable reason={summary.points.reason} />;
  }
  const points = summary.points.data;
  const data = points.series.map((series) => ({
    id: series.playerId,
    data: series.scores.map((score, index) => ({ x: index, y: score })),
  }));
  const scores = points.series.flatMap((series) => series.scores);
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  const padding = Math.max(2000, (high - low) * 0.08);
  const lastIndex = points.labels.length - 1;
  const interval = Math.max(1, Math.ceil(lastIndex / 12));
  const ticks = points.labels.flatMap((_, index) =>
    index % interval === 0 || index === lastIndex ? [index] : []
  );
  return (
    <section className="gs-points-screen" aria-label={labels.points}>
      <div className="gs-chart" data-summary-chart="">
        <Line
          width={1290}
          height={716}
          data={data}
          margin={{ top: 30, right: 32, bottom: 80, left: 115 }}
          xScale={{ type: "linear", min: 0, max: lastIndex }}
          yScale={{
            type: "linear",
            min: Math.floor((low - padding) / 1000) * 1000,
            max: Math.ceil((high + padding) / 1000) * 1000,
          }}
          colors={({ id }) => colors.get(String(id)) ?? "#ffffff"}
          curve="linear"
          lineWidth={5}
          enablePoints={false}
          animate={false}
          isInteractive={false}
          axisTop={null}
          axisRight={null}
          axisLeft={{
            tickSize: 0,
            tickPadding: 16,
            tickValues: 6,
            format: (value) => summaryNumber(Number(value), locale),
          }}
          axisBottom={{
            tickSize: 0,
            tickPadding: 20,
            tickValues: ticks,
            format: (value) =>
              handLabel(
                points.labels[Number(value)],
                Number(value),
                labels.start,
                labels.final
              ),
          }}
          gridXValues={ticks}
          theme={{
            text: {
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 23,
              fill: "#e9f0ef",
            },
            axis: {
              domain: { line: { stroke: "#83948f", strokeWidth: 1 } },
              ticks: { text: { fill: "#cedbd6", fontSize: 23 } },
            },
            grid: { line: { stroke: "#ffffff20", strokeWidth: 1 } },
          }}
          role="img"
          ariaLabel={labels.points}
        />
      </div>
      <div className="gs-chart-legend">
        {summary.players.map((player) => (
          <div className="gs-legend-player" key={player.id}>
            <SummaryIdentityBanner
              identity={{ ...player, color: colors.get(player.id)! }}
            />
            <div className="gs-legend-score">
              <span
                className="gs-line-swatch"
                style={{ background: colors.get(player.id) }}
              />
              <strong>{summaryNumber(player.score, locale)}</strong>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

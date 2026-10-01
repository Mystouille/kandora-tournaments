import { useMemo, useRef, useCallback } from "react";
import { ResponsiveLine, type LineCustomSvgLayerProps } from "@nivo/line";
import { Spin, Typography } from "antd";
import { useLocale } from "../contexts/LocaleContext";
import { useAppTheme } from "../contexts/ThemeContext";
import { useHighlight } from "../contexts/HighlightContext";
import {
  buildRankingData,
  isEliminatedOnDay,
  type Series,
  type SeriesPoint,
} from "./scoreEvolutionData";

export type { Series, SeriesPoint } from "./scoreEvolutionData";

const { Text } = Typography;

/**
 * Given an array of { id, y } items (desired label positions),
 * push overlapping labels apart so they don't collide,
 * while keeping them as close to their original y as possible.
 * Returns a Map<id, adjustedY>.
 */
function resolveOverlaps(
  items: { id: string; y: number }[],
  labelHeight: number = 14,
  innerHeight: number = Infinity
): Map<string, number> {
  if (items.length === 0) {
    return new Map();
  }

  // Sort by original Y so we process top-to-bottom
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const adjusted = sorted.map((item) => ({ ...item, adjustedY: item.y }));

  // Iterative relaxation: push overlapping neighbours apart
  for (let iter = 0; iter < 20; iter++) {
    let anyOverlap = false;
    for (let i = 1; i < adjusted.length; i++) {
      const gap = adjusted[i].adjustedY - adjusted[i - 1].adjustedY;
      if (gap < labelHeight) {
        anyOverlap = true;
        const overlap = labelHeight - gap;
        // Split the correction: push upper one up, lower one down
        adjusted[i - 1].adjustedY -= overlap / 2;
        adjusted[i].adjustedY += overlap / 2;
      }
    }
    if (!anyOverlap) {
      break;
    }
  }

  // Clamp to chart bounds
  const minY = labelHeight / 2;
  const maxY = innerHeight - labelHeight / 2;
  for (const item of adjusted) {
    item.adjustedY = Math.max(minY, Math.min(maxY, item.adjustedY));
  }

  // Final pass to fix any remaining overlaps after clamping
  for (let i = 1; i < adjusted.length; i++) {
    if (adjusted[i].adjustedY - adjusted[i - 1].adjustedY < labelHeight) {
      adjusted[i].adjustedY = adjusted[i - 1].adjustedY + labelHeight;
    }
  }

  const result = new Map<string, number>();
  for (const item of adjusted) {
    result.set(item.id, item.adjustedY);
  }
  return result;
}

type NivoSeries = { id: string; data: SeriesPoint[] };

interface ScoreEvolutionChartProps {
  series: Series[];
  loading?: boolean;
  error?: string | null;
  activeDay?: string | null;
  onSliceClick?: (day: string) => void;
}

export default function ScoreEvolutionChart({
  series,
  loading,
  error,
  activeDay,
  onSliceClick,
}: ScoreEvolutionChartProps) {
  const { t } = useLocale();
  const { isDark } = useAppTheme();
  const { highlightedLabel, setHighlightedLabel } = useHighlight();

  // Track the currently hovered slice date for click capture
  const hoveredDayRef = useRef<string | null>(null);

  const handleChartClick = useCallback(() => {
    if (hoveredDayRef.current && onSliceClick) {
      onSliceClick(hoveredDayRef.current);
    }
  }, [onSliceClick]);

  // Determine if there is actual data to display
  const hasData = useMemo(
    () => series.some((s) => s.data.length > 0),
    [series]
  );

  // Map series to nivo format
  const nivoData = useMemo(
    () =>
      series.map((s) => ({
        id: s.label,
        data: s.data,
      })),
    [series]
  );

  const eliminationDatesByLabel = useMemo(
    () =>
      new Map(
        series
          .filter(
            (item): item is Series & { eliminatedAt: string } =>
              item.eliminatedAt !== undefined
          )
          .map((item) => [item.label, item.eliminatedAt])
      ),
    [series]
  );

  // Build a color map from nivo's category10 scheme
  const category10 = useMemo(
    () => [
      "#1f77b4",
      "#ff7f0e",
      "#2ca02c",
      "#d62728",
      "#9467bd",
      "#8c564b",
      "#e377c2",
      "#7f7f7f",
      "#bcbd22",
      "#17becf",
    ],
    []
  );

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    nivoData.forEach((s, i) => {
      map.set(s.id as string, category10[i % category10.length]);
    });
    return map;
  }, [nivoData, category10]);

  const rankingData = useMemo(() => buildRankingData(series), [series]);

  const theme = isDark
    ? {
        text: { fill: "#e0e0e0" },
        axis: {
          ticks: { text: { fill: "#b0b0b0" } },
          legend: { text: { fill: "#e0e0e0" } },
        },
        grid: { line: { stroke: "#333" } },
        crosshair: { line: { stroke: "#888" } },
        tooltip: {
          container: {
            background: "#1f1f1f",
            color: "#e0e0e0",
            borderRadius: 4,
          },
        },
        legends: { text: { fill: "#e0e0e0" } },
      }
    : {};

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <Text type="danger">{t.statistics.errorLoadingChart}</Text>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <Text type="secondary">{t.statistics.noDataForSelection}</Text>
      </div>
    );
  }

  return (
    <div>
      {/* Ranking evolution chart */}
      {rankingData.length > 0 && (
        <>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            {t.statistics.rankingEvolutionTitle}
          </Text>
          <div
            style={{
              height: 350,
              cursor: onSliceClick ? "pointer" : undefined,
            }}
            onClick={handleChartClick}
          >
            <ResponsiveLine
              data={rankingData}
              theme={theme}
              margin={{ top: 20, right: 120, bottom: 60, left: 70 }}
              xScale={{ type: "point" }}
              yScale={{
                type: "linear",
                min: 1,
                max: rankingData.length,
                reverse: true,
                stacked: false,
              }}
              axisBottom={{
                tickRotation: -45,
                legend: t.statistics.axisDate,
                legendOffset: 50,
                legendPosition: "middle",
                tickSize: 5,
                tickPadding: 5,
              }}
              axisLeft={{
                legend: t.statistics.axisRanking,
                legendOffset: -55,
                legendPosition: "middle",
                tickSize: 5,
                tickPadding: 5,
                tickValues: Array.from(
                  { length: rankingData.length },
                  (_, i) => i + 1
                ),
                format: (v) => `#${v}`,
              }}
              colors={rankingData.map(
                (s) => colorMap.get(s.id as string) ?? "#888"
              )}
              pointSize={0}
              enablePointLabel={false}
              layers={[
                "grid",
                "markers",
                "axes",
                "areas",
                "crosshair",
                ({
                  series: computedSeries,
                  lineGenerator,
                }: LineCustomSvgLayerProps<NivoSeries>) => {
                  return (
                    <g>
                      {computedSeries.map((s) => {
                        const eliminatedAt = eliminationDatesByLabel.get(s.id);
                        const eliminationIndex = s.data.findIndex((point) =>
                          isEliminatedOnDay(eliminatedAt, String(point.data.x))
                        );
                        const activeData =
                          eliminationIndex === -1
                            ? s.data
                            : eliminationIndex === 0
                              ? []
                              : s.data.slice(0, eliminationIndex + 1);
                        const eliminatedData =
                          eliminationIndex === -1
                            ? []
                            : s.data.slice(eliminationIndex);
                        const isActive =
                          !highlightedLabel || s.id === highlightedLabel;
                        return (
                          <g key={s.id}>
                            {activeData.length > 0 && (
                              <path
                                d={
                                  lineGenerator(
                                    activeData.map((d) => d.position)
                                  ) || ""
                                }
                                fill="none"
                                stroke={s.color}
                                strokeWidth={
                                  isActive && highlightedLabel ? 3 : 2
                                }
                                opacity={isActive ? 1 : 0.15}
                                style={{
                                  transition: "opacity 0.2s, stroke-width 0.2s",
                                }}
                              />
                            )}
                            {eliminatedData.length > 0 && (
                              <path
                                d={
                                  lineGenerator(
                                    eliminatedData.map((d) => d.position)
                                  ) || ""
                                }
                                fill="none"
                                stroke="#999"
                                strokeWidth={
                                  isActive && highlightedLabel ? 3 : 2
                                }
                                strokeDasharray="6 4"
                                opacity={0.4}
                                style={{
                                  transition: "opacity 0.2s, stroke-width 0.2s",
                                }}
                              />
                            )}
                          </g>
                        );
                      })}
                    </g>
                  );
                },
                "slices",
                ({
                  series: nivoSeries,
                  innerHeight: chartInnerHeight,
                }: LineCustomSvgLayerProps<NivoSeries>) => {
                  // Collect label items & resolve overlaps
                  const labelItems: { id: string; y: number }[] = [];
                  for (const s of nivoSeries) {
                    const last = s.data[s.data.length - 1];
                    if (
                      last &&
                      last.position.x != null &&
                      last.position.y != null
                    ) {
                      labelItems.push({ id: s.id, y: last.position.y });
                    }
                  }
                  const adjustedPositions = resolveOverlaps(
                    labelItems,
                    15,
                    chartInnerHeight
                  );
                  return (
                    <g>
                      {nivoSeries.map((s) => {
                        const last = s.data[s.data.length - 1];
                        if (
                          !last ||
                          last.position.x == null ||
                          last.position.y == null
                        ) {
                          return null;
                        }
                        const isActive =
                          !highlightedLabel || s.id === highlightedLabel;
                        const adjustedY =
                          adjustedPositions.get(s.id) ?? last.position.y;
                        return (
                          <g key={s.id}>
                            {/* Connector line from data point to label */}
                            {Math.abs(adjustedY - last.position.y) > 2 && (
                              <line
                                x1={last.position.x + 2}
                                y1={last.position.y}
                                x2={last.position.x + 7}
                                y2={adjustedY}
                                stroke={s.color}
                                strokeWidth={1}
                                opacity={isActive ? 0.4 : 0.1}
                                style={{ transition: "opacity 0.2s" }}
                              />
                            )}
                            <text
                              x={last.position.x + 8}
                              y={adjustedY}
                              fill={s.color}
                              fontSize={isActive && highlightedLabel ? 12 : 11}
                              fontWeight={
                                isActive && highlightedLabel ? 700 : 600
                              }
                              dominantBaseline="central"
                              opacity={isActive ? 1 : 0.2}
                              style={{
                                transition: "opacity 0.2s, font-size 0.2s",
                                cursor: "pointer",
                              }}
                              onMouseEnter={() => setHighlightedLabel(s.id)}
                              onMouseLeave={() => setHighlightedLabel(null)}
                            >
                              {s.id}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                },
                ({
                  points,
                  xScale,
                  innerHeight,
                }: LineCustomSvgLayerProps<NivoSeries>) => {
                  if (!activeDay) {
                    return (
                      <g>
                        {points.map((point) => (
                          <circle
                            key={point.id}
                            cx={point.x}
                            cy={point.y}
                            r={2.5}
                            fill={point.seriesColor}
                            stroke="none"
                          />
                        ))}
                      </g>
                    );
                  }
                  const x = xScale(activeDay);
                  return (
                    <g>
                      {x !== undefined && x !== null && (
                        <line
                          x1={x}
                          x2={x}
                          y1={0}
                          y2={innerHeight}
                          stroke={isDark ? "#ffd666" : "#fa8c16"}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          opacity={0.8}
                        />
                      )}
                      {points.map((point) => (
                        <circle
                          key={point.id}
                          cx={point.x}
                          cy={point.y}
                          r={2.5}
                          fill={point.seriesColor}
                          stroke="none"
                        />
                      ))}
                    </g>
                  );
                },
                "mesh",
                "legends",
              ]}
              enableSlices="x"
              sliceTooltip={({ slice }) => {
                const sorted = [...slice.points].sort(
                  (a, b) => (a.data.y as number) - (b.data.y as number)
                );
                hoveredDayRef.current = sorted[0]?.data.xFormatted as string;
                return (
                  <div
                    style={{
                      background: isDark ? "#1f1f1f" : "#fff",
                      color: isDark ? "#e0e0e0" : "#333",
                      border: `1px solid ${isDark ? "#444" : "#ccc"}`,
                      borderRadius: 4,
                      padding: "8px 12px",
                      fontSize: 13,
                    }}
                  >
                    <strong>{sorted[0]?.data.xFormatted}</strong>
                    {onSliceClick && (
                      <div
                        style={{
                          fontSize: 11,
                          color: isDark ? "#aaa" : "#888",
                          marginTop: 2,
                        }}
                      >
                        {t.statistics.clickToExpand}
                      </div>
                    )}
                    <div style={{ marginTop: 4 }}>
                      {sorted.map((point) => (
                        <div
                          key={point.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "2px 0",
                          }}
                        >
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: point.seriesColor,
                              flexShrink: 0,
                            }}
                          />
                          <span>{point.seriesId}</span>
                          <strong style={{ marginLeft: "auto" }}>
                            #{point.data.yFormatted}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }}
              legends={[]}
              animate
              motionConfig="gentle"
              curve="monotoneX"
            />
          </div>
        </>
      )}

      {/* Score evolution chart */}
      <Text strong style={{ display: "block", marginTop: 32, marginBottom: 8 }}>
        {t.statistics.scoreEvolutionTitle}
      </Text>
      <div
        style={{ height: 450, cursor: onSliceClick ? "pointer" : undefined }}
        onClick={handleChartClick}
      >
        <ResponsiveLine
          data={nivoData}
          theme={theme}
          margin={{ top: 20, right: 120, bottom: 60, left: 70 }}
          xScale={{ type: "point" }}
          yScale={{
            type: "linear",
            min: "auto",
            max: "auto",
            stacked: false,
          }}
          axisBottom={{
            tickRotation: -45,
            legend: t.statistics.axisDate,
            legendOffset: 50,
            legendPosition: "middle",
            tickSize: 5,
            tickPadding: 5,
          }}
          axisLeft={{
            legend: t.statistics.axisScore,
            legendOffset: -55,
            legendPosition: "middle",
            tickSize: 5,
            tickPadding: 5,
          }}
          colors={{ scheme: "category10" }}
          pointSize={0}
          enablePointLabel={false}
          layers={[
            "grid",
            "markers",
            "axes",
            "areas",
            "crosshair",
            ({
              series: computedSeries,
              lineGenerator,
            }: LineCustomSvgLayerProps<NivoSeries>) => {
              return (
                <g>
                  {computedSeries.map((s) => {
                    const eliminatedAt = eliminationDatesByLabel.get(s.id);
                    const eliminationIndex = s.data.findIndex((point) =>
                      isEliminatedOnDay(eliminatedAt, String(point.data.x))
                    );
                    const activeData =
                      eliminationIndex === -1
                        ? s.data
                        : eliminationIndex === 0
                          ? []
                          : s.data.slice(0, eliminationIndex + 1);
                    const eliminatedData =
                      eliminationIndex === -1
                        ? []
                        : s.data.slice(eliminationIndex);
                    const isActive =
                      !highlightedLabel || s.id === highlightedLabel;
                    return (
                      <g key={s.id}>
                        {activeData.length > 0 && (
                          <path
                            d={
                              lineGenerator(
                                activeData.map((d) => d.position)
                              ) || ""
                            }
                            fill="none"
                            stroke={s.color}
                            strokeWidth={isActive && highlightedLabel ? 3 : 2}
                            opacity={isActive ? 1 : 0.15}
                            style={{
                              transition: "opacity 0.2s, stroke-width 0.2s",
                            }}
                          />
                        )}
                        {eliminatedData.length > 0 && (
                          <path
                            d={
                              lineGenerator(
                                eliminatedData.map((d) => d.position)
                              ) || ""
                            }
                            fill="none"
                            stroke="#999"
                            strokeWidth={isActive && highlightedLabel ? 3 : 2}
                            strokeDasharray="6 4"
                            opacity={0.4}
                            style={{
                              transition: "opacity 0.2s, stroke-width 0.2s",
                            }}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            },
            "slices",
            ({
              series: nivoSeries,
              innerHeight: chartInnerHeight,
            }: LineCustomSvgLayerProps<NivoSeries>) => {
              // Collect label items & resolve overlaps
              const labelItems: { id: string; y: number }[] = [];
              for (const s of nivoSeries) {
                const last = s.data[s.data.length - 1];
                if (
                  last &&
                  last.position.x != null &&
                  last.position.y != null
                ) {
                  labelItems.push({ id: s.id, y: last.position.y });
                }
              }
              const adjustedPositions = resolveOverlaps(
                labelItems,
                15,
                chartInnerHeight
              );
              return (
                <g>
                  {nivoSeries.map((s) => {
                    const last = s.data[s.data.length - 1];
                    if (
                      !last ||
                      last.position.x == null ||
                      last.position.y == null
                    ) {
                      return null;
                    }
                    const isActive =
                      !highlightedLabel || s.id === highlightedLabel;
                    const isEliminated = isEliminatedOnDay(
                      eliminationDatesByLabel.get(s.id),
                      String(last.data.x)
                    );
                    const labelColor = isEliminated ? "#999" : s.color;
                    const adjustedY =
                      adjustedPositions.get(s.id) ?? last.position.y;
                    return (
                      <g key={s.id}>
                        {/* Connector line from data point to label */}
                        {Math.abs(adjustedY - last.position.y) > 2 && (
                          <line
                            x1={last.position.x + 2}
                            y1={last.position.y}
                            x2={last.position.x + 7}
                            y2={adjustedY}
                            stroke={labelColor}
                            strokeWidth={1}
                            opacity={isEliminated ? 0.3 : isActive ? 0.4 : 0.1}
                            style={{ transition: "opacity 0.2s" }}
                          />
                        )}
                        <text
                          x={last.position.x + 8}
                          y={adjustedY}
                          fill={labelColor}
                          fontSize={isActive && highlightedLabel ? 12 : 11}
                          fontWeight={isActive && highlightedLabel ? 700 : 600}
                          dominantBaseline="central"
                          opacity={isEliminated ? 0.5 : isActive ? 1 : 0.2}
                          style={{
                            transition: "opacity 0.2s, font-size 0.2s",
                            cursor: "pointer",
                          }}
                          onMouseEnter={() => setHighlightedLabel(s.id)}
                          onMouseLeave={() => setHighlightedLabel(null)}
                        >
                          {s.id}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            },
            ({
              points,
              xScale,
              innerHeight,
            }: LineCustomSvgLayerProps<NivoSeries>) => {
              if (!activeDay) {
                return null;
              }
              const x = xScale(activeDay);
              if (x === undefined || x === null) {
                return null;
              }
              return (
                <g>
                  <line
                    x1={x}
                    x2={x}
                    y1={0}
                    y2={innerHeight}
                    stroke={isDark ? "#ffd666" : "#fa8c16"}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    opacity={0.8}
                  />
                  {points.map((point) => (
                    <circle
                      key={point.id}
                      cx={point.x}
                      cy={point.y}
                      r={2.5}
                      fill={point.seriesColor}
                      stroke="none"
                    />
                  ))}
                </g>
              );
            },
            "mesh",
            "legends",
          ]}
          enableSlices="x"
          sliceTooltip={({ slice }) => {
            const sorted = [...slice.points].sort(
              (a, b) => (b.data.y as number) - (a.data.y as number)
            );
            hoveredDayRef.current = sorted[0]?.data.xFormatted as string;
            return (
              <div
                style={{
                  background: isDark ? "#1f1f1f" : "#fff",
                  color: isDark ? "#e0e0e0" : "#333",
                  border: `1px solid ${isDark ? "#444" : "#ccc"}`,
                  borderRadius: 4,
                  padding: "8px 12px",
                  fontSize: 13,
                }}
              >
                <strong>{sorted[0]?.data.xFormatted}</strong>
                {onSliceClick && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 11,
                      opacity: 0.7,
                      textAlign: "center",
                    }}
                  >
                    {t.statistics.clickToExpand}
                  </div>
                )}
                <div style={{ marginTop: 4 }}>
                  {sorted.map((point) => (
                    <div
                      key={point.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "2px 0",
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: point.seriesColor,
                          flexShrink: 0,
                        }}
                      />
                      <span>{point.seriesId}</span>
                      <strong style={{ marginLeft: "auto" }}>
                        {Math.round((point.data.y as number) * 10) / 10}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            );
          }}
          legends={[]}
          animate
          motionConfig="gentle"
        />
      </div>
      {/* Custom wrapping legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 16px",
          justifyContent: "center",
          marginTop: 12,
        }}
      >
        {nivoData.map((s) => {
          const isActive = !highlightedLabel || s.id === highlightedLabel;
          return (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                opacity: isActive ? 1 : 0.25,
                fontWeight: isActive && highlightedLabel ? 600 : 400,
                cursor: "pointer",
                transition: "opacity 0.2s, font-weight 0.2s",
              }}
              onMouseEnter={() => setHighlightedLabel(s.id as string)}
              onMouseLeave={() => setHighlightedLabel(null)}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: colorMap.get(s.id as string),
                  flexShrink: 0,
                }}
              />
              <span>{s.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

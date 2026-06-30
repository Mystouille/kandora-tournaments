import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ResponsiveBar, type BarCustomLayerProps } from "@nivo/bar";
import { Slider, Typography, Button, Tooltip } from "antd";
import { CaretRightOutlined, PauseOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { useAppTheme } from "../contexts/ThemeContext";
import { useHighlight } from "../contexts/HighlightContext";
import type { Series } from "./ScoreEvolutionChart";

const { Text } = Typography;

const CATEGORY10 = [
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
];

interface ScoreBreakdownChartProps {
  series: Series[];
  activeDay?: string | null;
  onActiveDayChange?: (day: string | null) => void;
  eliminatedEntityIds?: string[];
}

interface BarData {
  id: string;
  label: string;
  value: number;
  color: string;
  [key: string]: string | number;
}

interface BreakdownSlice {
  date: string;
  points: { seriesId: string; value: number; color: string }[];
}

export default function ScoreBreakdownChart({
  series,
  activeDay,
  onActiveDayChange,
  eliminatedEntityIds,
}: ScoreBreakdownChartProps) {
  const { t } = useLocale();
  const { isDark } = useAppTheme();
  const { highlightedLabel, setHighlightedLabel } = useHighlight();

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Map series to nivo-style data with labels
  const nivoData = useMemo(
    () => series.map((s) => ({ id: s.label, data: s.data })),
    [series]
  );

  // Build a set of eliminated labels
  const eliminatedLabels = useMemo(() => {
    if (!eliminatedEntityIds || eliminatedEntityIds.length === 0) {
      return new Set<string>();
    }
    const idSet = new Set(eliminatedEntityIds);
    const labels = new Set<string>();
    for (const s of series) {
      if (idSet.has(s.id)) {
        labels.add(s.label);
      }
    }
    return labels;
  }, [series, eliminatedEntityIds]);

  // Resolve color for a series by index, graying out eliminated ones
  const resolveColor = useCallback(
    (label: string, index: number) =>
      eliminatedLabels.has(label)
        ? "#999"
        : CATEGORY10[index % CATEGORY10.length],
    [eliminatedLabels]
  );

  // Collect all unique sorted days
  const sortedDays = useMemo(() => {
    const days = new Set<string>();
    for (const s of nivoData) {
      for (const pt of s.data) {
        days.add(pt.x);
      }
    }
    return [...days].sort();
  }, [nivoData]);

  // Build the default slice from the last data point of each series
  const latestSlice = useMemo<BreakdownSlice | null>(() => {
    if (nivoData.length === 0) {
      return null;
    }
    let latestDay = "";
    for (const s of nivoData) {
      for (const pt of s.data) {
        if (pt.x > latestDay) {
          latestDay = pt.x;
        }
      }
    }
    if (!latestDay) {
      return null;
    }
    const points = nivoData.map((s, i) => {
      const last = s.data.length > 0 ? s.data[s.data.length - 1] : null;
      return {
        seriesId: s.id as string,
        value: last ? last.y : 0,
        color: resolveColor(s.id as string, i),
      };
    });
    return { date: latestDay, points };
  }, [nivoData, resolveColor]);

  // Build a slice for a given day (by date string)
  const buildSliceForDay = useCallback(
    (day: string): BreakdownSlice | null => {
      if (!day) {
        return null;
      }
      const points = nivoData.map((s, i) => {
        let val = 0;
        for (const pt of s.data) {
          if (pt.x <= day) {
            val = pt.y;
          } else {
            break;
          }
        }
        return {
          seriesId: s.id as string,
          value: val,
          color: resolveColor(s.id as string, i),
        };
      });
      return { date: day, points };
    },
    [nivoData, resolveColor]
  );

  // Build a slice for a given day index
  const buildSliceForIndex = useCallback(
    (dayIdx: number): BreakdownSlice | null => {
      if (
        sortedDays.length === 0 ||
        dayIdx < 0 ||
        dayIdx >= sortedDays.length
      ) {
        return null;
      }
      return buildSliceForDay(sortedDays[dayIdx]);
    },
    [sortedDays, buildSliceForDay]
  );

  // Stop playback when data changes
  useEffect(() => {
    setIsPlaying(false);
    setPlaybackIndex(null);
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
  }, [series]);

  // Playback interval
  useEffect(() => {
    if (!isPlaying) {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
      return;
    }
    playIntervalRef.current = setInterval(() => {
      setPlaybackIndex((prev) => {
        const current = prev ?? 0;
        if (current >= sortedDays.length - 1) {
          setIsPlaying(false);
          return sortedDays.length - 1;
        }
        const next = current + 1;
        onActiveDayChange?.(sortedDays[next] ?? null);
        return next;
      });
    }, 1000);
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, sortedDays, onActiveDayChange]);

  // The playback slice (from playback index)
  const playbackSlice = useMemo(() => {
    if (playbackIndex === null) {
      return null;
    }
    return buildSliceForIndex(playbackIndex);
  }, [playbackIndex, buildSliceForIndex]);

  // External slice (from activeDay prop, e.g. line chart click)
  const externalSlice = useMemo(() => {
    if (!activeDay) {
      return null;
    }
    return buildSliceForDay(activeDay);
  }, [activeDay, buildSliceForDay]);

  // Active bar data: playback > external > latest
  const activeBarSlice = playbackSlice ?? externalSlice ?? latestSlice;

  // Resolve slider value: during playback use playbackIndex,
  // otherwise map activeDay to its index, fallback to last
  const sliderValue = useMemo(() => {
    if (playbackIndex !== null) {
      return playbackIndex;
    }
    if (activeDay) {
      const idx = sortedDays.indexOf(activeDay);
      if (idx >= 0) {
        return idx;
      }
    }
    return sortedDays.length - 1;
  }, [playbackIndex, activeDay, sortedDays]);

  // Pre-compute bar chart data and scale bounds
  const { barChartData, barChartMin, barChartMax } = useMemo(() => {
    if (!activeBarSlice) {
      return { barChartData: [], barChartMin: 0, barChartMax: 0 };
    }
    const barData = [...activeBarSlice.points]
      .sort((a, b) => b.value - a.value)
      .map((p) => ({
        id: p.seriesId,
        label: p.seriesId,
        value: Math.round(p.value * 10) / 10,
        color: p.color,
      }));
    const values = barData.map((d) => d.value);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const range = Math.max(dataMax - dataMin, 1);
    return {
      barChartData: barData,
      barChartMin: Math.floor(dataMin - range * 0.1),
      barChartMax: Math.ceil(dataMax + range * 0.1),
    };
  }, [activeBarSlice]);

  const handlePlayPause = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev) {
        setPlaybackIndex((idx) => {
          const startIdx =
            idx === null || idx >= sortedDays.length - 1 ? 0 : idx;
          onActiveDayChange?.(sortedDays[startIdx] ?? null);
          return startIdx;
        });
        return true;
      }
      return false;
    });
  }, [sortedDays, onActiveDayChange]);

  const handleSliderChange = useCallback(
    (value: number) => {
      setPlaybackIndex(value);
      setIsPlaying(false);
      onActiveDayChange?.(sortedDays[value] ?? null);
    },
    [sortedDays, onActiveDayChange]
  );

  const theme = isDark
    ? {
        text: { fill: "#e0e0e0" },
        axis: {
          ticks: { text: { fill: "#b0b0b0" } },
          legend: { text: { fill: "#e0e0e0" } },
        },
        grid: { line: { stroke: "#333" } },
        tooltip: {
          container: {
            background: "#1f1f1f",
            color: "#e0e0e0",
            borderRadius: 4,
          },
        },
      }
    : {};

  if (!activeBarSlice) {
    return null;
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 0,
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tooltip
            title={
              isPlaying ? t.statistics.pauseReplay : t.statistics.replayHistory
            }
          >
            <Button
              size="small"
              type="primary"
              icon={isPlaying ? <PauseOutlined /> : <CaretRightOutlined />}
              onClick={handlePlayPause}
              disabled={sortedDays.length < 2}
              style={{
                backgroundColor: sortedDays.length < 2 ? undefined : "#1677ff",
                borderColor: sortedDays.length < 2 ? undefined : "#1677ff",
                minWidth: 32,
                minHeight: 32,
              }}
            />
          </Tooltip>
          <Text strong>
            {t.statistics.scoreBreakdownTitle} — {activeBarSlice.date}
          </Text>
        </div>
      </div>
      {sortedDays.length > 1 && (
        <Slider
          min={0}
          max={sortedDays.length - 1}
          value={sliderValue}
          onChange={handleSliderChange}
          tooltip={{
            formatter: (val) =>
              val !== undefined && val !== null ? (sortedDays[val] ?? "") : "",
          }}
          style={{ marginTop: 0, marginBottom: 12 }}
        />
      )}
      <div style={{ height: 400 }}>
        <ResponsiveBar
          data={barChartData}
          keys={["value"]}
          indexBy="label"
          theme={theme}
          margin={{ top: 20, right: 20, bottom: 30, left: 70 }}
          padding={0.3}
          valueScale={{
            type: "linear",
            min: barChartMin,
            max: barChartMax,
          }}
          colors={({ data: barData }: { data: BarData }) => {
            const barColor = barData.color;
            if (!highlightedLabel || barData.label === highlightedLabel) {
              return barColor;
            }
            // Dim non-highlighted bars
            const r = parseInt(barColor.slice(1, 3), 16);
            const g = parseInt(barColor.slice(3, 5), 16);
            const b = parseInt(barColor.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, 0.15)`;
          }}
          enableLabel={false}
          layers={[
            "grid",
            "axes",
            "bars",
            // Custom label layer with dynamic font size on highlight
            ({ bars }: BarCustomLayerProps<BarData>) => (
              <g>
                {bars.map((bar) => {
                  const label = bar.data.indexValue ?? bar.data.data?.label;
                  const isActive =
                    !highlightedLabel || label === highlightedLabel;
                  return (
                    <text
                      key={bar.key}
                      x={bar.x + bar.width / 2}
                      y={bar.y + bar.height / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={isActive ? "#fff" : "transparent"}
                      fontSize={isActive && highlightedLabel ? 14 : 11}
                      fontWeight={isActive && highlightedLabel ? 700 : 600}
                      style={{
                        pointerEvents: "none",
                        transition: "font-size 0.2s, font-weight 0.2s",
                      }}
                    >
                      {label}
                    </text>
                  );
                })}
              </g>
            ),
            "markers",
            "legends",
            "annotations",
          ]}
          axisBottom={null}
          axisLeft={{
            legend: t.statistics.axisScore,
            legendOffset: -55,
            legendPosition: "middle",
            tickSize: 5,
            tickPadding: 5,
          }}
          onMouseEnter={(_data, _event) => {
            setHighlightedLabel((_data.data as BarData).label ?? null);
          }}
          onMouseLeave={() => {
            setHighlightedLabel(null);
          }}
          tooltip={({ data, value, color: _color }) => (
            <div
              style={{
                background: isDark ? "#1f1f1f" : "#fff",
                color: isDark ? "#e0e0e0" : "#333",
                border: `1px solid ${isDark ? "#444" : "#ccc"}`,
                borderRadius: 4,
                padding: "8px 12px",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: (data as BarData).color,
                  flexShrink: 0,
                }}
              />
              <span>{(data as BarData).label}</span>
              <strong style={{ marginLeft: "auto" }}>{value}</strong>
            </div>
          )}
          animate
          motionConfig="gentle"
        />
      </div>
    </div>
  );
}

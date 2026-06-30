import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Empty, InputNumber, Spin, Switch, Tooltip, Typography } from "antd";
import { useLocale } from "../../contexts/LocaleContext";
import { useAppTheme } from "../../contexts/ThemeContext";
import { basePath } from "../../utils/basePath";

import {
  CELL_SIZE,
  NAME_COL_WIDTH,
  TEAM_BAR_WIDTH,
  HEADER_HEIGHT,
  TEAM_COLORS,
  EASTER_EGG_PLAYER_ID,
  EASTER_EGG_YAKU_ID,
  type YakuMapData,
} from "./yakuMap.constants";
import {
  getYakuName,
  sortedYakuIds,
  mergeYakuCounts,
  heatColor,
} from "./yakuMap.utils";
import { useYakuMapFocus } from "./useYakuMapFocus";
import { useScrollSync } from "./useScrollSync";

const { Text } = Typography;

interface YakuMapTabProps {
  leagueIds: string[];
  entityType: "player" | "team";
  entityIds: string[];
  startDate: string | null;
  endDate: string | null;
  autoRefresh: boolean;
  minGames: number;
  onMinGamesChange: (v: number) => void;
}

export default function YakuMapTab({
  leagueIds,
  entityType,
  entityIds,
  startDate,
  endDate,
  autoRefresh,
  minGames,
  onMinGamesChange,
}: YakuMapTabProps) {
  const { t, locale } = useLocale();
  const { isDark } = useAppTheme();
  const [showRate, setShowRate] = useState(false);
  const [useRomaji, setUseRomajiRaw] = useState(() => {
    try {
      const stored = localStorage.getItem("kandora_yaku_romaji");
      if (stored !== null) {
        return JSON.parse(stored) as boolean;
      }
    } catch {}
    return true;
  });
  const [useJapanese, setUseJapanese] = useState(false);
  const setUseRomaji = (v: boolean) => {
    setUseRomajiRaw(v);
    // 1/20 chance: switching TO romaji secretly activates real Japanese names
    setUseJapanese(v && Math.random() < 0.05);
    try {
      localStorage.setItem("kandora_yaku_romaji", JSON.stringify(v));
    } catch {}
  };

  // Focus / hover highlighting (DOM-managed, no React re-renders)
  const {
    scopeId,
    styleRef,
    toggleFocusRow,
    toggleFocusCol,
    hoverRow,
    hoverCol,
    hoverCell,
    focusCell,
  } = useYakuMapFocus(isDark);

  /* ── data fetching ── */
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (leagueIds.length > 0) {
      params.set("leagueIds", leagueIds.join(","));
    }
    params.set("entityType", entityType);
    if (entityIds.length > 0) {
      params.set("entityIds", entityIds.join(","));
    }
    if (startDate) {
      params.set("startDate", startDate);
    }
    if (endDate) {
      params.set("endDate", endDate);
    }
    return params.toString();
  }, [
    leagueIds.join(","),
    entityType,
    entityIds.join(","),
    startDate,
    endDate,
  ]);

  const { data, isLoading } = useQuery<YakuMapData>({
    queryKey: ["yaku-map", queryParams],
    queryFn: async () => {
      const sep = queryParams ? "&" : "";
      const refresh = autoRefresh ? `${sep}forceRefresh=true` : "";
      const res = await fetch(
        `${basePath}/api/yaku-map?${queryParams}${refresh}`
      );
      if (!res.ok) {
        throw new Error("Failed to fetch yaku map");
      }
      return res.json();
    },
    refetchInterval: autoRefresh ? 60_000 : false,
  });

  /* ── derived data ── */
  const allColumns = data?.columns ?? [];
  const yakuCounts = useMemo(
    () => mergeYakuCounts(data?.yakuCounts ?? {}),
    [data?.yakuCounts]
  );
  const totalRounds = data?.totalRounds ?? {};
  const totalGames = data?.totalGames ?? {};

  const columns = useMemo(
    () =>
      allColumns.filter(
        (col) =>
          (totalRounds[col.id] ?? 0) > 0 &&
          (totalGames[col.id] ?? 0) >= minGames
      ),
    [allColumns, totalRounds, totalGames, minGames]
  );

  const yakuIds = useMemo(() => sortedYakuIds(yakuCounts), [yakuCounts]);

  const globalMax = useMemo(() => {
    let max = 0;
    for (const yakuId of yakuIds) {
      for (const col of columns) {
        const raw = yakuCounts[yakuId]?.[col.id] ?? 0;
        const val = showRate
          ? totalRounds[col.id]
            ? raw / totalRounds[col.id]
            : 0
          : raw;
        if (val > max) {
          max = val;
        }
      }
    }
    return max;
  }, [yakuIds, columns, yakuCounts, totalRounds, showRate]);

  const colMaxValues = useMemo(() => {
    const maxMap = new Map<number, number>();
    for (const yakuId of yakuIds) {
      let max = 0;
      for (const col of columns) {
        const raw = yakuCounts[yakuId]?.[col.id] ?? 0;
        const val = showRate
          ? totalRounds[col.id]
            ? raw / totalRounds[col.id]
            : 0
          : raw;
        if (val > max) {
          max = val;
        }
      }
      maxMap.set(yakuId, max);
    }
    return maxMap;
  }, [yakuIds, columns, yakuCounts, totalRounds, showRate]);

  /* ── scroll sync ── */
  const {
    containerRef: tableContainerRef,
    proxyRef: stickyScrollRef,
    scrollWidth: tableScrollWidth,
    onContainerScroll: onTableScroll,
    onProxyScroll: onStickyScroll,
  } = useScrollSync([columns.length, yakuIds.length]);

  /* ── controls bar (rendered in both populated and empty states) ── */
  const controlsBar = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
        paddingLeft: 4,
        flexWrap: "wrap",
      }}
    >
      <Text>{t.statistics.minGamesPlayed}:</Text>
      <InputNumber
        min={0}
        value={minGames}
        onChange={(v) => onMinGamesChange(v ?? 0)}
        style={{ width: 80 }}
      />
      <div
        style={{
          marginLeft: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text strong={!showRate} style={{ fontSize: 14 }}>
          {t.statistics.yakuMapCount}
        </Text>
        <Switch
          checked={showRate}
          onChange={setShowRate}
          style={{ backgroundColor: "#1677ff" }}
        />
        <Text strong={showRate} style={{ fontSize: 14 }}>
          {t.statistics.yakuMapRate}
        </Text>
      </div>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text
          strong={!useRomaji}
          style={{ fontSize: 14, opacity: useRomaji ? 0.45 : 1 }}
        >
          {locale === "fr"
            ? "On est en Frônce, on parle Frônçais"
            : "English, please?"}
        </Text>
        <Switch
          checked={useRomaji}
          onChange={setUseRomaji}
          style={{
            backgroundColor: useRomaji ? "rgba(0,0,0,0.25)" : "#1677ff",
          }}
        />
      </div>
    </div>
  );

  /* ── loading / empty states ── */
  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (columns.length === 0 || yakuIds.length === 0) {
    return (
      <div style={{ padding: "16px 0" }}>
        {controlsBar}
        <div style={{ textAlign: "center", padding: 80 }}>
          <Empty description={t.statistics.yakuMapNoData} />
        </div>
      </div>
    );
  }

  /* ── team spans (player mode) ── */
  let teamSpans: { teamName: string; startIdx: number; count: number }[] = [];
  if (entityType === "player") {
    for (let i = 0; i < columns.length; i++) {
      const tn = columns[i].teamName ?? "";
      if (
        teamSpans.length > 0 &&
        teamSpans[teamSpans.length - 1].teamName === tn
      ) {
        teamSpans[teamSpans.length - 1].count++;
      } else {
        teamSpans.push({ teamName: tn, startIdx: i, count: 1 });
      }
    }
  }
  const uniqueTeams = [...new Set(columns.map((c) => c.teamName ?? ""))];
  const teamColorMap = new Map<string, string>();
  uniqueTeams.forEach((tn, i) => {
    teamColorMap.set(tn, TEAM_COLORS[i % TEAM_COLORS.length]);
  });
  const spanStartMap = new Map<number, { teamName: string; count: number }>();
  for (const span of teamSpans) {
    spanStartMap.set(span.startIdx, span);
  }

  /* ── render ── */
  return (
    <div style={{ padding: "16px 0" }}>
      {/* Controls */}
      {controlsBar}

      {/* Dynamic focus highlight styles – managed via ref, not React state */}
      <style ref={styleRef} />

      {/* Heatmap table (transposed: rows=players/teams, cols=yakus) */}
      <div
        ref={tableContainerRef}
        onScroll={onTableScroll}
        style={{
          overflowX: "auto",
          overflowY: "clip",
          scrollbarWidth: "none",
          paddingTop: 80,
        }}
      >
        <table
          id={scopeId}
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            fontFamily: "inherit",
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              {/* Corner: name column */}
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 3,
                  minWidth: NAME_COL_WIDTH,
                  background: isDark ? "#141414" : "#fff",
                }}
              />
              {/* Corner: team bar column (player mode only) */}
              {entityType === "player" && (
                <th
                  style={{
                    position: "sticky",
                    left: NAME_COL_WIDTH,
                    zIndex: 3,
                    width: TEAM_BAR_WIDTH,
                    minWidth: TEAM_BAR_WIDTH,
                    background: isDark ? "#141414" : "#fff",
                  }}
                />
              )}
              {/* Yaku column headers at 45° */}
              {yakuIds.map((yakuId) => (
                <th
                  key={yakuId}
                  style={{
                    width: CELL_SIZE,
                    minWidth: CELL_SIZE,
                    padding: 0,
                    textAlign: "left",
                    fontWeight: 600,
                    fontSize: 13,
                    borderBottom: `1px solid ${isDark ? "#303030" : "#e8e8e8"}`,
                    height: HEADER_HEIGHT,
                    verticalAlign: "bottom",
                    position: "relative",
                    overflow: "visible",
                    background: isDark ? "#141414" : "#fff",
                  }}
                  title={getYakuName(yakuId, t)}
                >
                  <div
                    style={{
                      transform: "rotate(-45deg)",
                      transformOrigin: "bottom left",
                      whiteSpace: "nowrap",
                      position: "absolute",
                      bottom: 6,
                      left: CELL_SIZE / 2 + 4,
                      zIndex: 1,
                      cursor: "pointer",
                      padding: "2px 4px",
                      borderRadius: 3,
                      fontWeight: 600,
                    }}
                    data-yaku-label={yakuId}
                    onClick={() => toggleFocusCol(yakuId)}
                    onMouseEnter={() => hoverCol(yakuId)}
                    onMouseLeave={() => hoverCol(null)}
                  >
                    {getYakuName(yakuId, t, useRomaji, useJapanese)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((col, rowIdx) => {
              const span = spanStartMap.get(rowIdx);
              return (
                <tr key={col.id}>
                  {/* Player/team name (sticky left) */}
                  <td
                    className="ym-name"
                    data-row={col.id}
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      background: isDark ? "#141414" : "#fff",
                      padding: "0 8px",
                      height: CELL_SIZE,
                      maxHeight: CELL_SIZE,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      borderRight:
                        entityType === "player"
                          ? "none"
                          : `1px solid ${isDark ? "#303030" : "#e8e8e8"}`,
                      borderBottom: `1px solid ${isDark ? "#303030" : "#e8e8e8"}`,
                      minWidth: NAME_COL_WIDTH,
                      maxWidth: NAME_COL_WIDTH,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      cursor: "pointer",
                      color: undefined,
                    }}
                    title={col.name}
                    onClick={() => toggleFocusRow(col.id)}
                    onMouseEnter={() => hoverRow(col.id)}
                    onMouseLeave={() => hoverRow(null)}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {col.avatarUrl && (
                        <img
                          src={col.avatarUrl}
                          alt=""
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {col.name}
                      </span>
                      <span
                        style={{
                          flexShrink: 0,
                          opacity: 0.5,
                          fontSize: 11,
                          marginLeft: 2,
                        }}
                      >
                        ({totalRounds[col.id] ?? 0})
                      </span>
                    </div>
                  </td>
                  {/* Team color bar cell (player mode only) — one per row */}
                  {entityType === "player" &&
                    (() => {
                      const teamName = col.teamName ?? "";
                      const color = teamColorMap.get(teamName) ?? "#888";
                      const isSpanStart = !!span;
                      return (
                        <td
                          style={{
                            position: "sticky",
                            left: NAME_COL_WIDTH,
                            zIndex: isSpanStart ? 3 : 2,
                            width: TEAM_BAR_WIDTH,
                            minWidth: TEAM_BAR_WIDTH,
                            maxWidth: TEAM_BAR_WIDTH,
                            height: CELL_SIZE,
                            background: color,
                            borderRight: `1px solid ${isDark ? "#303030" : "#e8e8e8"}`,
                            borderBottom: `1px solid ${color}`,
                            padding: 0,
                          }}
                          title={teamName}
                        >
                          {isSpanStart && (
                            <div
                              style={{
                                position: "relative",
                                height: 0,
                                overflow: "visible",
                                pointerEvents: "none",
                              }}
                            >
                              <div
                                style={{
                                  position: "absolute",
                                  top: 0,
                                  left: 0,
                                  width: TEAM_BAR_WIDTH,
                                  height: (span?.count ?? 1) * CELL_SIZE,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  pointerEvents: "none",
                                }}
                              >
                                <div
                                  style={{
                                    writingMode: "vertical-rl",
                                    textOrientation: "mixed",
                                    transform: "rotate(180deg)",
                                    color: "#fff",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    maxHeight:
                                      (span?.count ?? 1) * CELL_SIZE - 4,
                                    lineHeight: `${TEAM_BAR_WIDTH}px`,
                                  }}
                                >
                                  {teamName}
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })()}
                  {/* Data cells */}
                  {yakuIds.map((yakuId) => {
                    const raw = yakuCounts[yakuId]?.[col.id] ?? 0;
                    const rounds = totalRounds[col.id] ?? 0;
                    const rate = rounds > 0 ? raw / rounds : 0;
                    const displayVal = showRate
                      ? rate > 0
                        ? `${(rate * 100).toFixed(1)}`
                        : ""
                      : raw > 0
                        ? String(raw)
                        : "";
                    const numVal = showRate ? rate : raw;
                    const isEasterEgg =
                      col.id === EASTER_EGG_PLAYER_ID &&
                      yakuId === EASTER_EGG_YAKU_ID;
                    const bg = heatColor(
                      numVal,
                      globalMax,
                      isDark,
                      isEasterEgg ? "red" : "blue"
                    );
                    const colMax = colMaxValues.get(yakuId) ?? 0;
                    const isColMax = numVal > 0 && numVal === colMax;
                    const tooltipText = `${col.name} — ${getYakuName(yakuId, t, useRomaji, useJapanese)}: ${raw} (${rounds > 0 ? (rate * 100).toFixed(1) : 0}%)`;

                    return (
                      <td
                        key={yakuId}
                        className={numVal === 0 ? "ym-empty" : undefined}
                        data-row={col.id}
                        data-col={yakuId}
                        style={{
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          maxHeight: CELL_SIZE,
                          minWidth: CELL_SIZE,
                          padding: 0,
                          textAlign: "center",
                          background: bg,
                          color:
                            numVal > globalMax * 0.6
                              ? "#fff"
                              : isDark
                                ? "#d9d9d9"
                                : "#333",
                          fontWeight: numVal > 0 ? 600 : 400,
                          fontSize: 12,
                          border: isColMax ? "2px solid #1677ff" : undefined,
                          borderBottom: isColMax
                            ? "2px solid #1677ff"
                            : `1px solid ${isDark ? "#303030" : "#e8e8e8"}`,
                          borderRight: isColMax
                            ? "2px solid #1677ff"
                            : `1px solid ${isDark ? "#303030" : "#e8e8e8"}`,
                          transition: "background 0.15s",
                          cursor: "pointer",
                        }}
                        onMouseEnter={() => hoverCell(col.id, yakuId)}
                        onMouseLeave={() => hoverCell(null, null)}
                        onClick={() => focusCell(col.id, yakuId)}
                      >
                        <Tooltip
                          title={tooltipText}
                          overlayStyle={{ pointerEvents: "none" }}
                        >
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {displayVal}
                          </div>
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sticky scrollbar pinned to viewport bottom */}
      <div
        ref={stickyScrollRef}
        onScroll={onStickyScroll}
        style={{
          position: "sticky",
          bottom: 0,
          overflowX: "auto",
          overflowY: "hidden",
          height: 16,
          zIndex: 3,
          background: isDark ? "#141414" : "#fff",
        }}
      >
        <div style={{ width: tableScrollWidth, height: 1 }} />
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, Empty, Select, Spin, Table, Tag, Typography } from "antd";
import { StarFilled, UserOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useLocale } from "../../contexts/LocaleContext";
import { useAppTheme } from "../../contexts/ThemeContext";
import { basePath } from "../../utils/basePath";
import { PlayerAvatar } from "../PlayerAvatar";

const { Text } = Typography;

interface StandingEntry {
  id: string;
  label: string;
  avatarUrl: string | null;
  leaguePicture: import("../../types/pictures").PicturePair | null;
  majsoulName: string | null;
  teamId: string | null;
  teamName: string | null;
  totalScore: number;
  rawPoints: number;
  bonusPoints: number;
  gameCount: number;
  avgPlacement: number;
  placements: [number, number, number, number];
  yakumanCount: number;
  members?: StandingEntry[];
}

export interface PinOption {
  label: any;
  value?: string;
  searchLabel?: string;
  options?: PinOption[];
}

interface PlayerStandingTabProps {
  leagueIds: string[];
  entityType: "player" | "team";
  entityIds: string[];
  startDate: string | null;
  endDate: string | null;
  pinPlayerOptions: PinOption[];
  eliminatedEntityIds?: string[];
}

/** Assign ranks where tied entries share the best (lowest) rank */
function assignRanks(standings: StandingEntry[]): Map<string, number> {
  const rankMap = new Map<string, number>();
  let rank = 1;
  for (let i = 0; i < standings.length; i++) {
    if (i > 0 && standings[i].totalScore !== standings[i - 1].totalScore) {
      rank = i + 1;
    }
    rankMap.set(standings[i].id, rank);
  }
  return rankMap;
}

const PLACEMENT_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32", "#888"];

export default function PlayerStandingTab({
  leagueIds,
  entityType,
  entityIds,
  startDate,
  endDate,
  pinPlayerOptions,
  eliminatedEntityIds,
}: PlayerStandingTabProps) {
  const { t } = useLocale();
  const { isDark } = useAppTheme();

  const LS_KEY = "kandora_listing_pinned_player";

  const [pinnedPlayerId, setPinnedPlayerIdRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_KEY) || null;
    } catch {
      return null;
    }
  });

  const setPinnedPlayerId = (id: string | null) => {
    setPinnedPlayerIdRaw(id);
    try {
      if (id) {
        localStorage.setItem(LS_KEY, id);
      } else {
        localStorage.removeItem(LS_KEY);
      }
    } catch {}
  };

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

  const { data, isLoading, error } = useQuery({
    queryKey: ["player-standings", queryParams],
    queryFn: async () => {
      const res = await fetch(
        `${basePath}/api/player-standings?${queryParams}`
      );
      if (!res.ok) {
        throw new Error("Failed to fetch");
      }
      const json = await res.json();
      return {
        standings: (json.standings ?? []) as StandingEntry[],
        rankingLabel: (json.rankingLabel ?? null) as string | null,
      };
    },
    enabled: leagueIds.length > 0,
  });

  const standings = data?.standings ?? [];
  const rankingLabel = data?.rankingLabel ?? null;
  const isTeamMode = entityType === "team";

  // Build eliminated set and sort eliminated to bottom
  const eliminatedSet = useMemo(
    () => new Set(eliminatedEntityIds ?? []),
    [eliminatedEntityIds]
  );
  const sortedStandings = useMemo(() => {
    if (eliminatedSet.size === 0) {
      return standings;
    }
    const active = standings.filter(
      (s: StandingEntry) => !eliminatedSet.has(s.id)
    );
    const eliminated = standings.filter((s: StandingEntry) =>
      eliminatedSet.has(s.id)
    );
    return [...active, ...eliminated];
  }, [standings, eliminatedSet]);

  const rankMap = useMemo(() => assignRanks(standings), [standings]);

  // Compute which rows to highlight based on pinned player
  const highlightedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!pinnedPlayerId) {
      return ids;
    }
    if (!isTeamMode) {
      // Player mode: highlight the player row directly
      ids.add(pinnedPlayerId);
    } else {
      // Team mode: find which team(s) the player belongs to and highlight
      for (const team of standings) {
        if (team.members?.some((m) => m.id === pinnedPlayerId)) {
          ids.add(team.id);
          ids.add(pinnedPlayerId);
        }
      }
    }
    return ids;
  }, [pinnedPlayerId, isTeamMode, standings]);

  // In team mode, auto-expand teams containing the pinned player
  const pinnedTeamKeys = useMemo(() => {
    if (!isTeamMode || !pinnedPlayerId) {
      return [] as string[];
    }
    return standings
      .filter((team) => team.members?.some((m) => m.id === pinnedPlayerId))
      .map((team) => team.id);
  }, [isTeamMode, pinnedPlayerId, standings]);

  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);

  // When pinned player changes, auto-expand the matching team(s)
  useEffect(() => {
    if (pinnedTeamKeys.length > 0) {
      setExpandedRowKeys((prev) => {
        const set = new Set(prev);
        for (const key of pinnedTeamKeys) {
          set.add(key);
        }
        return [...set];
      });
    }
  }, [pinnedTeamKeys]);

  const tableRef = useRef<HTMLDivElement>(null);

  // Scroll to the highlighted row when pinned player changes
  useEffect(() => {
    if (!pinnedPlayerId || !tableRef.current) {
      return;
    }

    // If the element is already in the DOM, scroll immediately
    const existing = tableRef.current.querySelector(
      ".standing-row-highlighted"
    );
    if (existing) {
      existing.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // Otherwise, observe the DOM until it appears (e.g. after team expansion)
    const observer = new MutationObserver(() => {
      const el = tableRef.current?.querySelector(".standing-row-highlighted");
      if (el) {
        observer.disconnect();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    observer.observe(tableRef.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pinnedPlayerId, standings]);

  const highlightRowClass = (record: StandingEntry) => {
    const classes: string[] = [];
    if (highlightedIds.has(record.id)) {
      classes.push("standing-row-highlighted");
    }
    if (eliminatedSet.has(record.id)) {
      classes.push("standing-row-eliminated");
    }
    return classes.join(" ");
  };

  const highlightStyle = useMemo(
    () =>
      `<style>.standing-row-highlighted td{background:${isDark ? "rgba(22,119,255,0.15)" : "rgba(22,119,255,0.08)"} !important;}.standing-row-eliminated td{color:#999 !important;opacity:0.6;}</style>`,
    [isDark]
  );

  // Pin player toolbar
  const toolbar = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
      }}
    >
      <Select
        placeholder={t.statistics.pinPlayer}
        allowClear
        showSearch
        optionFilterProp="searchLabel"
        style={{ minWidth: 220 }}
        value={pinnedPlayerId}
        onChange={setPinnedPlayerId}
        options={pinPlayerOptions}
        size="small"
        suffixIcon={null}
      />
    </div>
  );

  const columns: ColumnsType<StandingEntry> = useMemo(
    () => [
      {
        title: "#",
        dataIndex: "rank",
        key: "rank",
        width: 60,
        align: "center" as const,
        render: (_: any, record: StandingEntry) => {
          const rank = rankMap.get(record.id) ?? "-";
          return (
            <Text strong style={{ fontSize: 14 }}>
              {rank}
            </Text>
          );
        },
      },
      {
        title: isTeamMode
          ? t.statistics.standingTeam
          : t.statistics.standingPlayer,
        dataIndex: "label",
        key: "label",
        width: 180,
        ellipsis: true,
        render: (_: any, record: StandingEntry) => (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              overflow: "hidden",
            }}
          >
            {(record.avatarUrl || !record.members) &&
              (record.members ? (
                <Avatar
                  size={28}
                  src={record.avatarUrl}
                  icon={!record.avatarUrl ? <UserOutlined /> : undefined}
                  style={{ flexShrink: 0 }}
                />
              ) : (
                <PlayerAvatar
                  size={28}
                  src={record.avatarUrl}
                  leaguePicture={record.leaguePicture}
                  style={{ flexShrink: 0 }}
                />
              ))}
            <Text
              strong
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {record.label}
            </Text>
            {record.majsoulName && (
              <span style={{ fontSize: "0.8em", opacity: 0.5 }}>
                ({record.majsoulName})
              </span>
            )}
          </div>
        ),
      },
      {
        title: rankingLabel
          ? t.statistics.standingBestOfScore
          : t.statistics.standingTotalScore,
        dataIndex: "totalScore",
        key: "totalScore",
        width: 110,
        align: "right" as const,
        sorter: (a: StandingEntry, b: StandingEntry) =>
          a.totalScore - b.totalScore,
        defaultSortOrder: "descend" as const,
        sortDirections: ["descend", "ascend"] as const,
        render: (val: number) => (
          <Text
            strong
            style={{
              color: val > 0 ? "#52c41a" : val < 0 ? "#ff4d4f" : undefined,
            }}
          >
            {val > 0 ? "+" : ""}
            {val.toFixed(1)}
          </Text>
        ),
      },
      {
        title: t.statistics.standingRawPoints,
        dataIndex: "rawPoints",
        key: "rawPoints",
        width: 110,
        align: "right" as const,
        sorter: (a: StandingEntry, b: StandingEntry) =>
          a.rawPoints - b.rawPoints,
        sortDirections: ["descend", "ascend"] as const,
        render: (val: number) => (
          <Text
            style={{
              color: val > 0 ? "#52c41a" : val < 0 ? "#ff4d4f" : undefined,
            }}
          >
            {val > 0 ? "+" : ""}
            {val.toFixed(1)}
          </Text>
        ),
      },
      {
        title: t.statistics.standingBonusPoints,
        dataIndex: "bonusPoints",
        key: "bonusPoints",
        width: 110,
        align: "right" as const,
        sorter: (a: StandingEntry, b: StandingEntry) =>
          a.bonusPoints - b.bonusPoints,
        sortDirections: ["descend", "ascend"] as const,
        render: (val: number) => (
          <Text
            style={{
              color: val > 0 ? "#52c41a" : val < 0 ? "#ff4d4f" : undefined,
            }}
          >
            {val > 0 ? "+" : ""}
            {val.toFixed(1)}
          </Text>
        ),
      },
      {
        title: t.statistics.standingAvgPlacement,
        dataIndex: "avgPlacement",
        key: "avgPlacement",
        width: 90,
        align: "center" as const,
        sorter: (a: StandingEntry, b: StandingEntry) =>
          a.avgPlacement - b.avgPlacement,
        sortDirections: ["descend", "ascend"] as const,
        render: (val: number) =>
          val > 0 ? (
            <Text>{val.toFixed(2)}</Text>
          ) : (
            <Text type="secondary">-</Text>
          ),
      },
      {
        title: t.statistics.standingPlacements,
        dataIndex: "placements",
        key: "placements",
        width: 140,
        align: "center" as const,
        render: (placements: [number, number, number, number]) => (
          <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
            {placements.map((count, i) => (
              <Tag
                key={i}
                style={{
                  margin: 0,
                  minWidth: 28,
                  textAlign: "center",
                  borderColor: PLACEMENT_COLORS[i],
                  color: PLACEMENT_COLORS[i],
                  fontWeight: 600,
                  background: isDark
                    ? `${PLACEMENT_COLORS[i]}18`
                    : `${PLACEMENT_COLORS[i]}20`,
                }}
              >
                {count}
              </Tag>
            ))}
          </div>
        ),
      },
      {
        title: t.statistics.standingGames,
        dataIndex: "gameCount",
        key: "gameCount",
        width: 70,
        align: "center" as const,
        sorter: (a: StandingEntry, b: StandingEntry) =>
          a.gameCount - b.gameCount,
        sortDirections: ["descend", "ascend"] as const,
        render: (val: number) => <Text>{val}</Text>,
      },
      {
        title: t.statistics.standingYakuman,
        dataIndex: "yakumanCount",
        key: "yakumanCount",
        width: 90,
        align: "center" as const,
        sorter: (a: StandingEntry, b: StandingEntry) =>
          a.yakumanCount - b.yakumanCount,
        sortDirections: ["descend", "ascend"] as const,
        render: (val: number) =>
          val > 0 ? (
            <span>
              {Array.from({ length: val }, (_, i) => (
                <StarFilled
                  key={i}
                  style={{ color: "#faad14", fontSize: 14, marginRight: 1 }}
                />
              ))}
            </span>
          ) : (
            <Text type="secondary">-</Text>
          ),
      },
    ],
    [t, rankMap, isDark]
  );

  // For team mode, build columns for the expanded member rows (same columns without rank)
  const memberColumns: ColumnsType<StandingEntry> = useMemo(() => {
    // Same columns but rank is computed within team members
    return columns.map((col) => {
      if (col.key === "rank") {
        return {
          ...col,
          render: (_: any, __: StandingEntry, index: number) => (
            <Text type="secondary" style={{ fontSize: 13 }}>
              {index + 1}
            </Text>
          ),
        };
      }
      return col;
    });
  }, [columns]);

  if (isLoading) {
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

  if (standings.length === 0) {
    return (
      <div style={{ padding: "60px 0" }}>
        <Empty description={t.statistics.noDataForSelection} />
      </div>
    );
  }

  if (isTeamMode) {
    return (
      <div ref={tableRef} style={{ padding: "24px 0" }}>
        <div dangerouslySetInnerHTML={{ __html: highlightStyle }} />
        {toolbar}
        <Table<StandingEntry>
          dataSource={sortedStandings}
          columns={columns}
          rowKey="id"
          rowClassName={highlightRowClass}
          pagination={false}
          size="middle"
          scroll={{ x: 800 }}
          sticky={{ offsetScroll: 0 }}
          expandable={{
            expandedRowKeys,
            onExpandedRowsChange: (keys) =>
              setExpandedRowKeys([...keys] as string[]),
            expandedRowRender: (record) => {
              if (!record.members || record.members.length === 0) {
                return (
                  <Text type="secondary">
                    {t.statistics.noDataForSelection}
                  </Text>
                );
              }
              return (
                <Table<StandingEntry>
                  dataSource={record.members}
                  columns={memberColumns}
                  rowKey="id"
                  rowClassName={highlightRowClass}
                  pagination={false}
                  size="small"
                  showHeader={false}
                  style={{ margin: "-8px 0" }}
                />
              );
            },
            rowExpandable: (record) =>
              !!record.members && record.members.length > 0,
          }}
        />
      </div>
    );
  }

  return (
    <div ref={tableRef} style={{ padding: "24px 0" }}>
      <div dangerouslySetInnerHTML={{ __html: highlightStyle }} />
      {toolbar}
      <Table<StandingEntry>
        dataSource={sortedStandings}
        columns={columns}
        rowKey="id"
        rowClassName={highlightRowClass}
        pagination={false}
        size="middle"
        scroll={{ x: 800 }}
        sticky={{ offsetScroll: 0 }}
      />
    </div>
  );
}

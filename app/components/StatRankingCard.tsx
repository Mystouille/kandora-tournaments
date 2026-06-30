import { useEffect, useState } from "react";
import {
  Card,
  Spin,
  Typography,
  Switch,
  Avatar,
  List,
  Button,
  Tooltip,
} from "antd";
import { EyeInvisibleOutlined, InfoCircleOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { useLocale } from "../contexts/LocaleContext";
import { useAppTheme } from "../contexts/ThemeContext";
import { basePath } from "../utils/basePath";
import { useHighlight } from "../contexts/HighlightContext";
import { PlayerAvatar } from "./PlayerAvatar";

const { Text, Title } = Typography;

interface StatRankingCardProps {
  leagueIds: string[];
  playerIds: string[];
  teamIds: string[];
  startDate: string | null;
  endDate: string | null;
  /** Unique card identifier used for localStorage persistence */
  cardId?: string;
  /** Icon rendered before the title */
  icon: ReactNode;
  /** Card title */
  title: string;
  /** Optional tooltip describing how the metric is computed, shown via an
   *  info icon next to the title. */
  infoTooltip?: string;
  /** Accent color for the value display */
  accentColor: string;
  /** Label shown below the value in total mode */
  totalLabel: string;
  /** Label shown below the value in average mode */
  avgLabel: string;
  /** Label shown when there is no data */
  noDataLabel: string;
  /** Extract the total value from a ranking entry */
  getTotal: (item: RankingEntry) => number;
  /** Extract the average value from a ranking entry */
  getAvg: (item: RankingEntry) => number;
  /** When true, only show average mode (no toggle) */
  averageOnly?: boolean;
  /** Minimum number of games to be included in the ranking */
  minGames?: number;
  /** When true, show bottom 6 instead of top 6 */
  invertRanking?: boolean;
  /** When true, the card's natural sort order is ascending (lowest first) */
  defaultInverted?: boolean;
  /** Pre-fetched rankings data. When provided, the card skips its own fetch. */
  rankingsData?: RankingEntry[] | null;
  /** Whether the parent is still loading the shared data */
  rankingsLoading?: boolean;
  /** Error message from the parent fetch */
  rankingsError?: string | null;
  /** Callback to hide this card */
  onHide?: () => void;
  /** ID of a pinned player to always show in the list */
  pinnedPlayerId?: string | null;
}

export interface RankingEntry {
  id: string;
  label: string;
  avatarUrl?: string | null;
  /** Present only for player entries; null when no per-league picture is set. */
  leaguePicture?: import("../types/pictures").PicturePair | null;
  totalDora: number;
  totalUraDora: number;
  totalHan: number;
  totalFu: number;
  totalRyuukyoku: number;
  totalOpened: number;
  totalRounds: number;
  gameCount: number;
  roundsWon: number;
  roundsDrawn: number;
  avgDoraPerRoundWon: number;
  avgUraDoraPerRoundWon: number;
  avgHanPerRoundWon: number;
  avgFuPerRoundWon: number;
  avgRyuukyokuPerDraw: number;
  callRate: number;
  totalCalls: number;
  avgCallsPerRound: number;
  avgTenpaiTurn: number;
  winRate: number;
  tsumoRate: number;
  totalTsumo: number;
  totalDealIn: number;
  dealInRate: number;
  avgDealInValue: number;
  avgWinValue: number;
}

const MEDAL_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"];

export default function StatRankingCard({
  leagueIds,
  playerIds,
  teamIds,
  startDate,
  endDate,
  cardId,
  icon,
  title,
  infoTooltip,
  accentColor,
  totalLabel,
  avgLabel,
  noDataLabel,
  getTotal,
  getAvg,
  averageOnly = false,
  minGames = 0,
  invertRanking = false,
  defaultInverted = false,
  rankingsData,
  rankingsLoading,
  rankingsError,
  onHide,
  pinnedPlayerId = null,
}: StatRankingCardProps) {
  const { t } = useLocale();
  const { isDark } = useAppTheme();
  const { highlightedLabel, setHighlightedLabel } = useHighlight();

  const useExternalData = rankingsData !== undefined;

  const [internalRankings, setInternalRankings] = useState<RankingEntry[]>([]);
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [showAverage, setShowAverage] = useState(() => {
    if (cardId) {
      try {
        const stored = localStorage.getItem(`kandora_card_avg_${cardId}`);
        if (stored !== null) {
          return JSON.parse(stored) as boolean;
        }
      } catch {}
      // eslint-disable-next-line no-empty
    }
    return true;
  });

  useEffect(() => {
    if (cardId) {
      localStorage.setItem(
        `kandora_card_avg_${cardId}`,
        JSON.stringify(showAverage)
      );
    }
  }, [cardId, showAverage]);

  useEffect(() => {
    if (useExternalData) {
      return;
    }
    if (leagueIds.length === 0) {
      setInternalRankings([]);
      return;
    }

    const params = new URLSearchParams();
    params.set("leagueIds", leagueIds.join(","));
    if (playerIds.length > 0) {
      params.set("playerIds", playerIds.join(","));
    }
    if (teamIds.length > 0) {
      params.set("teamIds", teamIds.join(","));
    }
    if (startDate) {
      params.set("startDate", startDate);
    }
    if (endDate) {
      params.set("endDate", endDate);
    }

    setInternalLoading(true);
    setInternalError(null);

    fetch(`${basePath}/api/ranking-data?${params.toString()}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch");
        }
        return res.json();
      })
      .then((data) => {
        setInternalRankings(data.rankings ?? []);
      })
      .catch((err) => {
        console.error("Failed to load stat rankings:", err);
        setInternalError(t.statistics.errorLoadingChart);
      })
      .finally(() => setInternalLoading(false));
  }, [
    useExternalData,
    leagueIds.join(","),
    playerIds.join(","),
    teamIds.join(","),
    startDate,
    endDate,
  ]);

  const rankings = useExternalData ? (rankingsData ?? []) : internalRankings;
  const loading = useExternalData
    ? (rankingsLoading ?? false)
    : internalLoading;
  const error = useExternalData ? (rankingsError ?? null) : internalError;

  // Filter by minimum games, then re-sort based on this card's stat extractor
  const effectiveInvert = defaultInverted ? !invertRanking : invertRanking;
  const filteredAndSorted = [...rankings]
    .filter((item) => item.gameCount >= minGames)
    .sort((a, b) => {
      const diff = showAverage
        ? getAvg(b) - getAvg(a)
        : getTotal(b) - getTotal(a);
      return effectiveInvert ? -diff : diff;
    });

  const totalEntries = filteredAndSorted.length;
  const top5 = filteredAndSorted.slice(0, 5);

  // If a player is pinned and not already in the top 5, append them
  // Search in filteredAndSorted first, then fall back to full rankings
  // (so pinned entry appears even if below the minGames threshold)
  const pinnedEntry = pinnedPlayerId
    ? (filteredAndSorted.find((item) => item.id === pinnedPlayerId) ??
      rankings.find((item) => item.id === pinnedPlayerId) ??
      null)
    : null;
  const pinnedInTop5 = pinnedEntry
    ? top5.some((item) => item.id === pinnedPlayerId)
    : true;
  const sortedRankings =
    pinnedEntry && !pinnedInTop5 ? [...top5, pinnedEntry] : top5;

  const cardBg = isDark ? "#1a1a2e" : "#ffffff";
  const cardBorder = isDark ? "1px solid #303030" : "1px solid #f0f0f0";

  return (
    <Card
      style={{
        background: cardBg,
        border: cardBorder,
        borderRadius: 12,
        maxWidth: 320,
        width: "100%",
      }}
      styles={{ body: { padding: "16px 20px" } }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon}
          <Title level={5} style={{ margin: 0, flex: 1 }}>
            {title}
          </Title>
          {infoTooltip && (
            <Tooltip title={infoTooltip}>
              <InfoCircleOutlined
                style={{ color: "#8c8c8c", flexShrink: 0, cursor: "help" }}
              />
            </Tooltip>
          )}
          {onHide && (
            <Tooltip title={t.statistics.hideCard}>
              <Button
                type="text"
                size="small"
                icon={<EyeInvisibleOutlined />}
                onClick={onHide}
                style={{ flexShrink: 0 }}
              />
            </Tooltip>
          )}
        </div>

        {/* Toggle */}
        {!averageOnly && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t.statistics.total}
            </Text>
            <Switch
              size="small"
              checked={showAverage}
              onChange={setShowAverage}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t.statistics.average}
            </Text>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <Spin />
        </div>
      ) : error ? (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <Text type="danger">{error}</Text>
        </div>
      ) : sortedRankings.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <Text type="secondary">{noDataLabel}</Text>
        </div>
      ) : (
        <List
          dataSource={sortedRankings}
          split={false}
          renderItem={(item, index) => {
            const value = showAverage ? getAvg(item) : getTotal(item);
            // Compute actual rank from the full sorted list
            const actualIndex = filteredAndSorted.indexOf(item);
            const isUnranked = actualIndex === -1; // pinned but below minGames
            const rank = isUnranked
              ? "-"
              : invertRanking
                ? totalEntries - actualIndex
                : actualIndex + 1;
            const isPinned = item.id === pinnedPlayerId && !pinnedInTop5;
            const isDisplayedInTop = index < 5;
            const medalColor =
              isDisplayedInTop && actualIndex < 3
                ? MEDAL_COLORS[actualIndex]
                : undefined;
            const isHighlighted = highlightedLabel === item.label;
            const isDimmed = highlightedLabel !== null && !isHighlighted;

            return (
              <List.Item
                style={{
                  padding: "8px 0",
                  border: "none",
                  ...(isPinned
                    ? {
                        borderTop: isDark
                          ? "1px dashed #404040"
                          : "1px dashed #d9d9d9",
                        marginTop: 4,
                        paddingTop: 12,
                      }
                    : {}),
                }}
                onMouseEnter={() => setHighlightedLabel(item.label)}
                onMouseLeave={() => setHighlightedLabel(null)}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    gap: 12,
                    padding: "4px 8px",
                    borderRadius: 8,
                    background: isHighlighted
                      ? isDark
                        ? "rgba(22, 119, 255, 0.15)"
                        : "rgba(22, 119, 255, 0.08)"
                      : "transparent",
                    opacity: isDimmed ? 0.35 : 1,
                    transition: "background 0.2s, opacity 0.2s",
                    cursor: "default",
                  }}
                >
                  {/* Rank badge */}
                  <Tooltip
                    title={isUnranked ? t.statistics.notEnoughGames : undefined}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 13,
                        background: medalColor
                          ? medalColor
                          : isDark
                            ? "#303030"
                            : "#f0f0f0",
                        color: medalColor
                          ? "#000"
                          : isDark
                            ? "#ffffffa6"
                            : "#00000073",
                        flexShrink: 0,
                      }}
                    >
                      {rank}
                    </div>
                  </Tooltip>

                  {/* Avatar (players only) */}
                  {item.avatarUrl !== undefined &&
                    ("leaguePicture" in item ? (
                      <PlayerAvatar
                        src={
                          item.avatarUrl ||
                          "https://cdn.discordapp.com/embed/avatars/0.png"
                        }
                        leaguePicture={item.leaguePicture}
                        size={32}
                      />
                    ) : (
                      <Avatar
                        src={
                          item.avatarUrl ||
                          "https://cdn.discordapp.com/embed/avatars/0.png"
                        }
                        size={32}
                      />
                    ))}

                  {/* Name + game count */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <Text strong ellipsis style={{ fontSize: 14 }}>
                      {item.label}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {t.statistics.gamesPlayed.replace(
                        "{count}",
                        String(item.gameCount)
                      )}
                    </Text>
                  </div>

                  {/* Value */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <Text
                      strong
                      style={{
                        fontSize: 18,
                        color: accentColor,
                      }}
                    >
                      {showAverage ? value.toFixed(2) : value}
                    </Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {showAverage ? avgLabel : totalLabel}
                    </Text>
                  </div>
                </div>
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
}

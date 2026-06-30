import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Empty,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { ClockCircleOutlined, SwapOutlined } from "@ant-design/icons";
import { useLocale } from "../../contexts/LocaleContext";
import { useAppTheme } from "../../contexts/ThemeContext";
import { basePath } from "../../utils/basePath";
import type { TeamOption } from "./types";
import { CopyLogIdButton } from "./CopyLogIdButton";
import { WatchReplayButton } from "./WatchReplayButton";
import { TeamLogo } from "../TeamLogo";
import { PlayerAvatar } from "../PlayerAvatar";

const { Text } = Typography;

interface PlayerEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  leaguePicture: import("../../types/pictures").PicturePair | null;
  teamName: string | null;
  teamPicture: import("../../types/pictures").PicturePair | null;
  score: number;
  place: number;
  deltaPoints: number | null;
  isSub?: boolean;
  isOfficialSub?: boolean;
}

interface GameEntry {
  gameId: string;
  platform: string | null;
  startTime: string;
  endTime: string | null;
  replayUrl: string | null;
  players: PlayerEntry[];
}

interface GamesTabProps {
  leagueIds: string[];
  entityType: "player" | "team";
  entityIds: string[];
  startDate: string | null;
  endDate: string | null;
  highlightedPlayerIds: Set<string>;
  autoRefresh: boolean;
  teams: TeamOption[];
}

const MEDAL_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32", "#888888"];
const MEDAL_LABELS = ["🥇", "🥈", "🥉", "4th"];

function formatTime(dateStr: string, locale: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string, locale: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDelta(delta: number): string {
  if (delta > 0) {
    return `+${delta.toFixed(1)}`;
  }
  return delta.toFixed(1);
}

export default function GamesTab({
  leagueIds,
  entityType,
  entityIds,
  startDate,
  endDate,
  highlightedPlayerIds,
  autoRefresh,
  teams,
}: GamesTabProps) {
  const { t, locale } = useLocale();
  const { isDark } = useAppTheme();

  const [matchMode, setMatchMode] = useState<"union" | "intersection">("union");

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (leagueIds.length > 0) {
      params.set("leagueIds", leagueIds.join(","));
    }
    params.set("entityType", entityType === "player" ? "player" : "team");
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
  }, [leagueIds, entityType, entityIds, startDate, endDate]);

  const PAGE_SIZE = 100;

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["games-list", queryParams],
    queryFn: async ({ pageParam = 0 }) => {
      const res = await fetch(
        `${basePath}/api/games?${queryParams}&skip=${pageParam}&limit=${PAGE_SIZE}`
      );
      if (!res.ok) {
        throw new Error("Failed to fetch");
      }
      const json = await res.json();
      return {
        games: (json.games ?? []) as GameEntry[],
        total: (json.total ?? 0) as number,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => {
      const total = allPages[0]?.total ?? 0;
      const loaded = allPages.reduce((acc, p) => acc + p.games.length, 0);
      return loaded < total ? loaded : undefined;
    },
    enabled: leagueIds.length > 0,
    refetchInterval: autoRefresh ? 60_000 : false,
  });

  const games = useMemo(
    () => data?.pages.flatMap((p) => p.games) ?? [],
    [data]
  );
  const totalGames = data?.pages[0]?.total ?? 0;

  // Apply intersection filtering client-side
  const filteredGames = useMemo(() => {
    if (matchMode === "union" || entityIds.length === 0) {
      return games;
    }

    if (entityType === "player") {
      // Intersection: game must contain ALL selected players
      return games.filter((game) => {
        const gamePlayerIds = new Set(game.players.map((p) => p.userId));
        return entityIds.every((id) => gamePlayerIds.has(id));
      });
    } else {
      // Team intersection: each selected team must have at least one member in the game
      const teamMembersMap = new Map<string, Set<string>>();
      for (const teamId of entityIds) {
        const team = teams.find((t) => t._id === teamId);
        if (team) {
          teamMembersMap.set(teamId, new Set(team.roster.members));
        }
      }
      return games.filter((game) => {
        const gamePlayerIds = new Set(game.players.map((p) => p.userId));
        return [...teamMembersMap.values()].every((members) =>
          [...members].some((memberId) => gamePlayerIds.has(memberId))
        );
      });
    }
  }, [games, matchMode, entityType, entityIds, teams]);

  if (isLoading) {
    return (
      <div style={{ padding: "80px 0", textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "80px 0", textAlign: "center" }}>
        <Text type="danger">{t.statistics.errorLoadingChart}</Text>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div style={{ padding: "80px 0" }}>
        <Empty description={t.statistics.noDataForSelection} />
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 0" }}>
      {/* Match mode toggle */}
      {entityIds.length > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              fontSize: "0.85rem",
              fontWeight: matchMode === "union" ? "bold" : "normal",
            }}
          >
            {t.statistics.matchUnion}
          </Text>
          <Switch
            size="small"
            checked={matchMode === "intersection"}
            onChange={(checked) =>
              setMatchMode(checked ? "intersection" : "union")
            }
            style={{ backgroundColor: "#1677ff" }}
          />
          <Text
            style={{
              fontSize: "0.85rem",
              fontWeight: matchMode === "intersection" ? "bold" : "normal",
            }}
          >
            {t.statistics.matchIntersection}
          </Text>
          {matchMode === "intersection" &&
            filteredGames.length !== games.length && (
              <Text
                type="secondary"
                style={{ fontSize: "0.8rem", marginLeft: 8 }}
              >
                ({filteredGames.length}/{games.length})
              </Text>
            )}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: 16,
        }}
      >
        {filteredGames.map((game) => (
          <GameCard
            key={game.gameId}
            game={game}
            isDark={isDark}
            locale={locale}
            highlightedPlayerIds={highlightedPlayerIds}
          />
        ))}
      </div>
      {hasNextPage && (
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <Button
            type="default"
            size="large"
            loading={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {t.statistics.loadMore} ({games.length}/{totalGames})
          </Button>
        </div>
      )}
    </div>
  );
}

function GameCard({
  game,
  isDark,
  locale,
  highlightedPlayerIds,
}: {
  game: GameEntry;
  isDark: boolean;
  locale: string;
  highlightedPlayerIds: Set<string>;
}) {
  const cardBg = isDark
    ? "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)"
    : "linear-gradient(135deg, #fafbfc 0%, #f0f2f5 100%)";

  const dateStr = formatDate(game.startTime, locale);
  const startTimeStr = formatTime(game.startTime, locale);

  return (
    <Card
      size="small"
      style={{
        background: cardBg,
        border: isDark ? "1px solid #303030" : "1px solid #e8e8e8",
        borderRadius: 10,
      }}
      styles={{
        body: { padding: "12px 16px" },
      }}
    >
      {/* Header row: date, time, replay/copy link */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text strong style={{ fontSize: "0.95rem" }}>
            {dateStr}
          </Text>
          <Text
            type="secondary"
            style={{
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <ClockCircleOutlined />
            {startTimeStr}
          </Text>
        </div>
        <div
          style={{
            marginLeft: "auto",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <CopyLogIdButton gameId={game.gameId} />
          {game.gameId ? <WatchReplayButton gameId={game.gameId} /> : null}
        </div>
      </div>

      {/* Player rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {game.players.map((player, idx) => (
          <PlayerRow
            key={player.userId}
            player={player}
            rank={idx}
            isDark={isDark}
            highlighted={highlightedPlayerIds.has(player.userId)}
          />
        ))}
      </div>
    </Card>
  );
}

function PlayerRow({
  player,
  rank,
  isDark,
  highlighted,
}: {
  player: PlayerEntry;
  rank: number;
  isDark: boolean;
  highlighted: boolean;
}) {
  const { t } = useLocale();
  const _medalColor = MEDAL_COLORS[rank] ?? MEDAL_COLORS[3];
  const medalLabel = rank < 3 ? MEDAL_LABELS[rank] : `${rank + 1}th`;

  const _deltaColor =
    player.deltaPoints !== null
      ? player.deltaPoints > 0
        ? "#52c41a"
        : player.deltaPoints < 0
          ? "#ff4d4f"
          : undefined
      : undefined;

  const rowBg = highlighted
    ? isDark
      ? "rgba(24, 144, 255, 0.12)"
      : "rgba(24, 144, 255, 0.08)"
    : undefined;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        borderRadius: 6,
        background: rowBg,
      }}
    >
      {/* Medal */}
      <span
        style={{
          fontSize: rank < 3 ? "1.1rem" : "0.8rem",
          width: 28,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {medalLabel}
      </span>

      {/* Avatar */}
      <PlayerAvatar
        size={28}
        src={player.avatarUrl}
        leaguePicture={player.leaguePicture}
        style={{ flexShrink: 0 }}
      />

      {/* Name and team */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Text
          strong
          style={{
            fontSize: "0.9rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: player.isOfficialSub
              ? isDark
                ? "#b37feb"
                : "#722ed1"
              : player.isSub
                ? isDark
                  ? "#d4b106"
                  : "#ad8b00"
                : undefined,
          }}
        >
          {player.name}
        </Text>
        {player.isOfficialSub && (
          <Tooltip title={t.statistics.bracketOfficialSubstitute}>
            <SwapOutlined
              style={{
                fontSize: "0.75rem",
                opacity: 0.7,
                color: isDark ? "#b37feb" : "#722ed1",
                flexShrink: 0,
              }}
            />
          </Tooltip>
        )}
        {player.isSub && !player.isOfficialSub && (
          <Tooltip title={t.statistics.bracketSubstitute}>
            <SwapOutlined
              style={{
                fontSize: "0.75rem",
                opacity: 0.7,
                color: isDark ? "#d4b106" : "#ad8b00",
                flexShrink: 0,
              }}
            />
          </Tooltip>
        )}
        {player.teamName && (
          <>
            {player.teamPicture && (
              <TeamLogo
                pictures={player.teamPicture}
                size={16}
                style={{ flexShrink: 0 }}
              />
            )}
            <Text
              type="secondary"
              style={{
                fontSize: "0.8rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexShrink: 1,
              }}
            >
              ({player.teamName})
            </Text>
          </>
        )}
      </div>

      {/* Delta */}
      {player.deltaPoints !== null && (
        <Tag
          color={
            player.deltaPoints > 0
              ? "success"
              : player.deltaPoints < 0
                ? "error"
                : "default"
          }
          style={{
            margin: 0,
            fontSize: "0.8rem",
            lineHeight: "1.4",
            flexShrink: 0,
          }}
        >
          {formatDelta(player.deltaPoints)}
        </Tag>
      )}
    </div>
  );
}

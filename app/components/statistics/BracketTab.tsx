import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Card, Typography, Button, Spin, Tag, Tooltip, Badge } from "antd";
import {
  EyeOutlined,
  TrophyOutlined,
  CrownOutlined,
  CloseOutlined,
  CopyOutlined,
  SwapOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useLocale } from "../../contexts/LocaleContext";
import { TeamLogo } from "../TeamLogo";
import { PlayerAvatar } from "../PlayerAvatar";
import { useAppTheme } from "../../contexts/ThemeContext";
import type { TeamOption } from "./types";
import { CopyLogIdButton } from "./CopyLogIdButton";
import { WatchReplayButton } from "./WatchReplayButton";

const { Text, Title } = Typography;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BracketSlot {
  /** Resolved team (null when the slot depends on a future result) */
  team: TeamOption | null;
  /** Human-readable description when the team isn't known yet */
  description: string;
  /** Cumulative score in this phase */
  score: number | null;
  /** Final rank within the phase (set only when the phase is complete) */
  rank: number | null;
}

export interface BracketGamePlayer {
  teamId: string;
  teamName: string;
  playerName: string;
  platformName: string | null;
  avatarUrl: string | null;
  leaguePicture: import("../../types/pictures").PicturePair | null;
  score: number;
  delta: number;
  place: number;
  isSub: boolean;
  isOfficialSub?: boolean;
}

export interface BracketGame {
  gameId: string | null;
  startTime: string;
  replayUrl: string | null;
  players: BracketGamePlayer[];
}

export interface BracketPlannedPlayer {
  teamId: string | null;
  /** Resolved seat occupant (declared subs applied); null for TBD seats. */
  memberId?: string | null;
  teamName: string;
  playerName: string;
  platformName: string | null;
  avatarUrl: string | null;
  leaguePicture: import("../../types/pictures").PicturePair | null;
  isSub?: boolean;
  isOfficialSub?: boolean;
}

export interface BracketPlannedGame {
  roundIndex: number;
  players: BracketPlannedPlayer[];
  /** Linked finished game id, when this planned table has been played. */
  gameId?: string | null;
  /** True once any seat was observed in-game (persisted tables only). */
  wasInGame?: boolean;
  /** Derived table status: scheduled, ongoing, or finished. */
  status?: "scheduled" | "ongoing" | "finished";
}

export interface BracketPhase {
  key: string;
  title: string;
  /** Structural column index from API (0-based), when available. */
  groupIndex?: number;
  /** Stable stage order from API, used for sorting within a column. */
  stageOrder?: number;
  /** Number of top-ranked teams that advance to subsequent stages. */
  advancingCount?: number;
  /** Names (keys) of upstream phases that feed into this phase. */
  sources?: string[];
  slots: BracketSlot[];
  /**
   * Stable column order for the details popup. Mirrors the API's natural
   * slot order (typically seeding/structural) so columns don't shuffle as
   * scores change. Falls back to `slots` when not provided.
   */
  columnSlots?: BracketSlot[];
  /** True when all games of the phase have been played */
  isComplete: boolean;
  /** Number of games played in this phase so far */
  gamesPlayed?: number;
  /** Total expected games in this phase */
  totalGames?: number;
  /** Individual game results */
  games?: BracketGame[];
  /** Planned matchups for all games (incl. completed). Length = totalGames. */
  plannedGames?: BracketPlannedGame[];
}

interface BracketTabProps {
  phases: BracketPhase[];
  isLoading?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Single bracket card                                                */
/* ------------------------------------------------------------------ */

function BracketCard({
  phase,
  isFinalPhase,
  containerRef,
}: {
  phase: BracketPhase;
  isFinalPhase: boolean;
  containerRef?: (el: HTMLDivElement | null) => void;
}) {
  const { t, locale } = useLocale();
  const { isDark } = useAppTheme();
  const [popupOpen, setPopupOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Light dismiss: close on outside click
  useEffect(() => {
    if (!popupOpen) {
      return;
    }
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopupOpen(false);
      }
    }
    // Delay listener to avoid the opening click from immediately closing
    const id = setTimeout(
      () => document.addEventListener("mousedown", handleClick),
      0
    );
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [popupOpen]);

  const cardBg = isDark ? "#1f1f1f" : "#ffffff";
  const slotBg = isDark ? "#141414" : "#fafafa";
  const borderColor = isDark ? "#303030" : "#e8e8e8";

  const advancingCount =
    phase.isComplete && !isFinalPhase ? (phase.advancingCount ?? 0) : 0;
  const advanceBg = isDark
    ? "rgba(82, 196, 26, 0.10)"
    : "rgba(82, 196, 26, 0.08)";
  const advanceBorder = isDark
    ? "rgba(82, 196, 26, 0.35)"
    : "rgba(82, 196, 26, 0.45)";
  const hasStarted = (phase.gamesPlayed ?? 0) > 0;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <Card
        style={{
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: 10,
          minWidth: 240,
          flex: "0 0 auto",
        }}
        styles={{ body: { padding: "16px 20px" } }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          {isFinalPhase ? (
            <TrophyOutlined style={{ fontSize: 18, color: "#faad14" }} />
          ) : (
            <CrownOutlined style={{ fontSize: 18, opacity: 0.6 }} />
          )}
          <Title level={5} style={{ margin: 0 }}>
            {phase.title}
          </Title>
          {phase.gamesPlayed != null && phase.totalGames != null && (
            <Tag
              color={phase.gamesPlayed >= phase.totalGames ? "green" : "blue"}
              style={{ marginLeft: "auto" }}
            >
              {phase.gamesPlayed >= phase.totalGames
                ? "✓"
                : `${phase.gamesPlayed}/${phase.totalGames}`}
            </Tag>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {phase.slots.map((slot, idx) => {
            const isAdvancing = idx < advancingCount && slot.team != null;
            const shouldShowScore =
              slot.score != null && (hasStarted || slot.score !== 0);
            const scoreValue = slot.score ?? 0;
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: isAdvancing ? advanceBg : slotBg,
                  border: `1px solid ${isAdvancing ? advanceBorder : borderColor}`,
                }}
              >
                {/* Rank badge (only when phase is complete) */}
                {phase.isComplete && slot.rank != null && (
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 12,
                      flexShrink: 0,
                      color: "#fff",
                      background:
                        slot.rank === 1
                          ? "#faad14"
                          : slot.rank === 2
                            ? "#8c8c8c"
                            : "#ad6800",
                    }}
                  >
                    {slot.rank}
                  </div>
                )}

                {/* Team logo (persona placeholder when no picture) */}
                <TeamLogo
                  pictures={slot.team?.pictures ?? null}
                  icon={<UserOutlined />}
                  size={20}
                  style={{ flexShrink: 0 }}
                />
                <Text
                  style={{
                    flex: 1,
                    fontWeight: slot.team ? 600 : 400,
                    fontStyle: slot.team ? "normal" : "italic",
                    opacity: slot.team ? 1 : 0.65,
                  }}
                  ellipsis
                >
                  {slot.team ? slot.team.displayName : slot.description}
                </Text>

                {/* Score */}
                {shouldShowScore && (
                  <Text
                    strong
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {scoreValue.toLocaleString()}
                  </Text>
                )}
              </div>
            );
          })}
        </div>

        {/* Show details button */}
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setPopupOpen(true)}
          >
            {t.statistics.bracketShowDetails}
          </Button>
        </div>
      </Card>

      {/* Details modal */}
      {popupOpen && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 999,
              background: "rgba(0,0,0,0.35)",
            }}
            onClick={() => setPopupOpen(false)}
          />
          {/* Modal */}
          <div
            ref={popupRef}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 1000,
              minWidth: 320,
              maxWidth: "90vw",
              width: "fit-content",
              maxHeight: "80vh",
              overflowY: "auto",
              background: cardBg,
              border: `1px solid ${borderColor}`,
              borderRadius: 10,
              boxShadow: isDark
                ? "0 8px 32px rgba(0,0,0,0.6)"
                : "0 8px 32px rgba(0,0,0,0.18)",
              padding: "16px 20px",
            }}
          >
            {/* Header with close button */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <Title level={5} style={{ margin: 0 }}>
                {phase.title} — {t.statistics.bracketShowDetails}
              </Title>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={() => setPopupOpen(false)}
              />
            </div>

            {/* Games table */}
            {(() => {
              const planned = phase.plannedGames ?? [];
              const allGames = phase.games ?? [];
              // Index finished games by id so each planned table can resolve
              // its own linked game (set server-side by player-identity match),
              // independent of the order games finished in.
              const gamesById = new Map<string, BracketGame>();
              for (const g of allGames) {
                if (g.gameId) {
                  gamesById.set(g.gameId, g);
                }
              }
              type DetailRow = {
                plannedRow: BracketPlannedGame | null;
                game: BracketGame | undefined;
              };
              const rows: DetailRow[] = [];
              const linkedGameIds = new Set<string>();
              for (const plannedRow of planned) {
                const linked = plannedRow.gameId
                  ? gamesById.get(plannedRow.gameId)
                  : undefined;
                if (linked?.gameId) {
                  linkedGameIds.add(linked.gameId);
                }
                rows.push({ plannedRow, game: linked });
              }
              // Append any finished games not linked to a planned table (e.g.
              // extra games) so nothing is hidden, sorted chronologically.
              const overflow = allGames
                .filter((g) => !g.gameId || !linkedGameIds.has(g.gameId))
                .sort(
                  (a, b) =>
                    new Date(a.startTime).getTime() -
                    new Date(b.startTime).getTime()
                );
              for (const g of overflow) {
                rows.push({ plannedRow: null, game: g });
              }
              if (rows.length === 0) {
                return (
                  <Text
                    type="secondary"
                    style={{
                      fontSize: "0.85rem",
                      textAlign: "center",
                      display: "block",
                    }}
                  >
                    —
                  </Text>
                );
              }
              const columnSlots = phase.columnSlots ?? phase.slots;
              const slotKey = (s: BracketSlot): string =>
                s.team?._id ?? s.description;
              return (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.85rem",
                    }}
                  >
                    <thead>
                      <tr>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "6px 8px",
                            borderBottom: `2px solid ${borderColor}`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          #
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "6px 8px",
                            borderBottom: `2px solid ${borderColor}`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t.statistics.bracketGameDate}
                        </th>
                        {columnSlots.map((s) => (
                          <th
                            key={slotKey(s)}
                            style={{
                              textAlign: "center",
                              padding: "6px 8px",
                              borderBottom: `2px solid ${borderColor}`,
                              whiteSpace: "nowrap",
                              minWidth: 110,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 4,
                              }}
                            >
                              <TeamLogo
                                pictures={s.team?.pictures ?? null}
                                icon={<UserOutlined />}
                                size={18}
                              />
                              {s.team?.displayName ?? s.description}
                            </div>
                          </th>
                        ))}
                        <th
                          style={{
                            textAlign: "center",
                            padding: "6px 8px",
                            borderBottom: `2px solid ${borderColor}`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <CopyOutlined />
                        </th>
                        <th
                          style={{
                            textAlign: "center",
                            padding: "6px 8px",
                            borderBottom: `2px solid ${borderColor}`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <EyeOutlined />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, gi) => {
                        const game: BracketGame | undefined = row.game;
                        const plannedRow = row.plannedRow;
                        const prevPlanned =
                          gi > 0 ? rows[gi - 1].plannedRow : null;
                        const showRoundSeparator =
                          plannedRow != null &&
                          prevPlanned != null &&
                          plannedRow.roundIndex !== prevPlanned.roundIndex;
                        const totalCols = 4 + columnSlots.length;
                        const playedMap = new Map<string, BracketGamePlayer>();
                        if (game) {
                          for (const p of game.players) {
                            playedMap.set(p.teamId, p);
                          }
                        }
                        const plannedMap = new Map<
                          string,
                          BracketPlannedPlayer
                        >();
                        if (plannedRow) {
                          for (const p of plannedRow.players) {
                            plannedMap.set(p.teamId ?? p.teamName, p);
                          }
                        }
                        return (
                          <Fragment key={gi}>
                            {showRoundSeparator && (
                              <tr aria-hidden>
                                <td
                                  colSpan={totalCols}
                                  style={{
                                    padding: 0,
                                    height: 10,
                                    borderTop: `3px double ${
                                      isDark ? "#666" : "#bbb"
                                    }`,
                                    background: isDark
                                      ? "rgba(255,255,255,0.04)"
                                      : "rgba(0,0,0,0.04)",
                                  }}
                                />
                              </tr>
                            )}
                            <tr
                              style={{
                                background:
                                  gi % 2 === 0 ? "transparent" : slotBg,
                                opacity: game ? 1 : 0.85,
                              }}
                            >
                              <td
                                style={{
                                  padding: "5px 8px",
                                  borderBottom: `1px solid ${borderColor}`,
                                  color: isDark
                                    ? "rgba(255,255,255,0.45)"
                                    : "rgba(0,0,0,0.45)",
                                }}
                              >
                                {gi + 1}
                              </td>
                              <td
                                style={{
                                  padding: "5px 8px",
                                  borderBottom: `1px solid ${borderColor}`,
                                  whiteSpace: "nowrap",
                                  color: game
                                    ? undefined
                                    : isDark
                                      ? "rgba(255,255,255,0.4)"
                                      : "rgba(0,0,0,0.4)",
                                  fontStyle: game ? undefined : "italic",
                                }}
                              >
                                {game ? (
                                  new Date(game.startTime).toLocaleString(
                                    locale,
                                    {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    }
                                  )
                                ) : plannedRow?.status === "ongoing" ? (
                                  <Badge
                                    status="processing"
                                    text={t.statistics.bracketOngoing}
                                  />
                                ) : (
                                  t.statistics.bracketUpcoming
                                )}
                              </td>
                              {columnSlots.map((s) => {
                                const key = slotKey(s);
                                const p = game
                                  ? playedMap.get(s.team?._id ?? "")
                                  : undefined;
                                if (p) {
                                  return (
                                    <td
                                      key={key}
                                      style={{
                                        padding: "5px 8px",
                                        borderBottom: `1px solid ${borderColor}`,
                                        textAlign: "center",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          gap: 6,
                                        }}
                                      >
                                        <PlayerAvatar
                                          size={22}
                                          src={p.avatarUrl}
                                          leaguePicture={p.leaguePicture}
                                          style={{ flexShrink: 0 }}
                                        />
                                        <Tooltip
                                          title={
                                            p.platformName
                                              ? p.platformName
                                              : undefined
                                          }
                                        >
                                          <span
                                            style={{
                                              color: p.isOfficialSub
                                                ? isDark
                                                  ? "#b37feb"
                                                  : "#722ed1"
                                                : p.isSub
                                                  ? isDark
                                                    ? "#d4b106"
                                                    : "#ad8b00"
                                                  : "inherit",
                                              cursor: p.platformName
                                                ? "help"
                                                : undefined,
                                            }}
                                          >
                                            {p.playerName}
                                          </span>
                                        </Tooltip>
                                        {p.isOfficialSub && (
                                          <Tooltip
                                            title={
                                              t.statistics
                                                .bracketOfficialSubstitute
                                            }
                                          >
                                            <SwapOutlined
                                              style={{
                                                marginLeft: 4,
                                                fontSize: "0.75rem",
                                                opacity: 0.7,
                                                color: isDark
                                                  ? "#b37feb"
                                                  : "#722ed1",
                                              }}
                                            />
                                          </Tooltip>
                                        )}
                                        {p.isSub && !p.isOfficialSub && (
                                          <Tooltip
                                            title={
                                              t.statistics.bracketSubstitute
                                            }
                                          >
                                            <SwapOutlined
                                              style={{
                                                marginLeft: 4,
                                                fontSize: "0.75rem",
                                                opacity: 0.7,
                                                color: isDark
                                                  ? "#d4b106"
                                                  : "#ad8b00",
                                              }}
                                            />
                                          </Tooltip>
                                        )}
                                      </div>
                                      <span
                                        style={{
                                          fontVariantNumeric: "tabular-nums",
                                          fontWeight: 600,
                                          fontSize: "0.8rem",
                                          color:
                                            p.delta > 0
                                              ? "#52c41a"
                                              : p.delta < 0
                                                ? "#ff4d4f"
                                                : "inherit",
                                        }}
                                      >
                                        {p.delta > 0 ? "+" : ""}
                                        {p.delta}
                                      </span>
                                    </td>
                                  );
                                }
                                const planned = plannedMap.get(key);
                                if (!planned) {
                                  return (
                                    <td
                                      key={key}
                                      style={{
                                        padding: "5px 8px",
                                        borderBottom: `1px solid ${borderColor}`,
                                        textAlign: "center",
                                        opacity: 0.3,
                                      }}
                                    >
                                      —
                                    </td>
                                  );
                                }
                                return (
                                  <td
                                    key={key}
                                    style={{
                                      padding: "5px 8px",
                                      borderBottom: `1px solid ${borderColor}`,
                                      textAlign: "center",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 6,
                                        opacity: 0.75,
                                      }}
                                    >
                                      <PlayerAvatar
                                        size={22}
                                        src={planned.avatarUrl}
                                        leaguePicture={planned.leaguePicture}
                                        style={{ flexShrink: 0 }}
                                      />
                                      <Tooltip
                                        title={
                                          planned.platformName
                                            ? planned.platformName
                                            : undefined
                                        }
                                      >
                                        <span
                                          style={{
                                            fontStyle: planned.teamId
                                              ? undefined
                                              : "italic",
                                            cursor: planned.platformName
                                              ? "help"
                                              : undefined,
                                            color: planned.isOfficialSub
                                              ? isDark
                                                ? "#b37feb"
                                                : "#722ed1"
                                              : planned.isSub
                                                ? isDark
                                                  ? "#d4b106"
                                                  : "#ad8b00"
                                                : undefined,
                                          }}
                                        >
                                          {planned.playerName}
                                        </span>
                                      </Tooltip>
                                      {planned.isOfficialSub && (
                                        <Tooltip
                                          title={
                                            t.statistics
                                              .bracketOfficialSubstitute
                                          }
                                        >
                                          <SwapOutlined
                                            style={{
                                              marginLeft: 4,
                                              fontSize: "0.75rem",
                                              opacity: 0.7,
                                              color: isDark
                                                ? "#b37feb"
                                                : "#722ed1",
                                            }}
                                          />
                                        </Tooltip>
                                      )}
                                      {planned.isSub &&
                                        !planned.isOfficialSub && (
                                          <Tooltip
                                            title={
                                              t.statistics.bracketSubstitute
                                            }
                                          >
                                            <SwapOutlined
                                              style={{
                                                marginLeft: 4,
                                                fontSize: "0.75rem",
                                                opacity: 0.7,
                                                color: isDark
                                                  ? "#d4b106"
                                                  : "#ad8b00",
                                              }}
                                            />
                                          </Tooltip>
                                        )}
                                    </div>
                                  </td>
                                );
                              })}
                              <td
                                style={{
                                  padding: "5px 8px",
                                  borderBottom: `1px solid ${borderColor}`,
                                  textAlign: "center",
                                }}
                              >
                                {game?.gameId ? (
                                  <CopyLogIdButton gameId={game.gameId} />
                                ) : (
                                  <span style={{ opacity: 0.25 }}>—</span>
                                )}
                              </td>
                              <td
                                style={{
                                  padding: "5px 8px",
                                  borderBottom: `1px solid ${borderColor}`,
                                  textAlign: "center",
                                }}
                              >
                                {game?.gameId ? (
                                  <WatchReplayButton gameId={game.gameId} />
                                ) : null}
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bracket layout (main export)                                       */
/* ------------------------------------------------------------------ */

/**
 * Renders a generic elimination bracket.
 *
 * Phases are grouped into columns using API-provided structural metadata
 * (`groupIndex`), with a fallback grouping by key stem when metadata is not
 * available. Connectors are drawn between consecutive columns, so the layout
 * supports any number of phases and bracket shapes.
 */
export default function BracketTab({ phases, isLoading }: BracketTabProps) {
  const { t } = useLocale();
  const { isDark } = useAppTheme();

  if (phases.length === 0) {
    if (isLoading) {
      return (
        <div style={{ padding: "48px 0", textAlign: "center" }}>
          <Spin />
        </div>
      );
    }
    return (
      <div style={{ padding: "24px 0" }}>
        <Title level={4} style={{ marginBottom: 24, textAlign: "center" }}>
          <TrophyOutlined style={{ marginRight: 8 }} />
          {t.statistics.tabBracket}
        </Title>
        <Text
          type="secondary"
          style={{ display: "block", textAlign: "center" }}
        >
          {t.statistics.bracketNoData}
        </Text>
      </div>
    );
  }

  const sortByNumericSuffix = (a: BracketPhase, b: BracketPhase): number => {
    const aNum = Number(a.key.match(/\d+/)?.[0] ?? "0");
    const bNum = Number(b.key.match(/\d+/)?.[0] ?? "0");
    if (aNum !== bNum) {
      return aNum - bNum;
    }
    return a.key.localeCompare(b.key);
  };

  const sortPhase = (a: BracketPhase, b: BracketPhase): number => {
    if (
      a.stageOrder != null &&
      b.stageOrder != null &&
      a.stageOrder !== b.stageOrder
    ) {
      return a.stageOrder - b.stageOrder;
    }
    return sortByNumericSuffix(a, b);
  };

  const normalizePhaseGroupKey = (phaseKey: string): string => {
    return phaseKey.toLowerCase().replace(/\d+$/, "");
  };

  const hasStructuralGroups = phases.some((phase) => phase.groupIndex != null);
  let phaseGroups: BracketPhase[][];
  if (hasStructuralGroups) {
    const groupedByIndex = new Map<number, BracketPhase[]>();
    for (const phase of phases) {
      const groupIndex = phase.groupIndex ?? 0;
      const existing = groupedByIndex.get(groupIndex);
      if (existing) {
        existing.push(phase);
      } else {
        groupedByIndex.set(groupIndex, [phase]);
      }
    }
    phaseGroups = Array.from(groupedByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, group]) => [...group].sort(sortPhase));
  } else {
    const groupedPhases = new Map<string, BracketPhase[]>();
    for (const phase of phases) {
      const groupKey = normalizePhaseGroupKey(phase.key);
      const existing = groupedPhases.get(groupKey);
      if (existing) {
        existing.push(phase);
      } else {
        groupedPhases.set(groupKey, [phase]);
      }
    }
    phaseGroups = Array.from(groupedPhases.values()).map((group) =>
      [...group].sort(sortPhase)
    );
  }
  const lastGroup =
    phaseGroups.length > 0 ? phaseGroups[phaseGroups.length - 1] : [];
  const finalPhase = lastGroup.length === 1 ? lastGroup[0] : null;

  const ROW_GAP = 24;
  const COL_GAP = 64;
  const WINNER_KEY = "__winner__";

  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setCardRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) {
        cardRefs.current.set(key, el);
      } else {
        cardRefs.current.delete(key);
      }
    },
    []
  );

  type CardRect = {
    left: number;
    right: number;
    top: number;
    bottom: number;
    cy: number;
  };
  const [layouts, setLayouts] = useState<Map<string, CardRect>>(new Map());
  const [containerHeight, setContainerHeight] = useState(0);

  const remeasure = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const cRect = container.getBoundingClientRect();
    const next = new Map<string, CardRect>();
    cardRefs.current.forEach((el, key) => {
      const r = el.getBoundingClientRect();
      next.set(key, {
        left: r.left - cRect.left,
        right: r.right - cRect.left,
        top: r.top - cRect.top,
        bottom: r.bottom - cRect.top,
        cy: (r.top + r.bottom) / 2 - cRect.top,
      });
    });
    setLayouts(next);
    setContainerHeight(cRect.height);
  }, []);

  useLayoutEffect(() => {
    remeasure();
  }, [phases, remeasure]);

  useEffect(() => {
    const ro = new ResizeObserver(() => remeasure());
    if (containerRef.current) {
      ro.observe(containerRef.current);
    }
    cardRefs.current.forEach((el) => ro.observe(el));
    window.addEventListener("resize", remeasure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", remeasure);
    };
  }, [phases, remeasure]);

  // Build edges: list of (sourceKey, destKey, destIdxInColumn, destColumnSize)
  const edges = useMemo(() => {
    type Edge = {
      sourceKey: string;
      destKey: string;
      destIdx: number;
      destCount: number;
    };
    const result: Edge[] = [];
    for (const group of phaseGroups) {
      group.forEach((phase, destIdx) => {
        for (const sourceKey of phase.sources ?? []) {
          result.push({
            sourceKey,
            destKey: phase.key,
            destIdx,
            destCount: group.length,
          });
        }
      });
    }
    if (finalPhase) {
      result.push({
        sourceKey: finalPhase.key,
        destKey: WINNER_KEY,
        destIdx: 0,
        destCount: 1,
      });
    }
    return result;
  }, [phaseGroups, finalPhase]);

  return (
    <div style={{ padding: "24px 0" }}>
      <Title level={4} style={{ marginBottom: 24, textAlign: "center" }}>
        <TrophyOutlined style={{ marginRight: 8 }} />
        {t.statistics.tabBracket}
      </Title>

      {/* ---- Desktop / wide bracket layout ---- */}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "safe center",
          gap: COL_GAP,
          overflowX: "auto",
          overflowY: "hidden",
          padding: "48px 0 16px",
        }}
      >
        {/* Connector overlay */}
        <svg
          width="100%"
          height={containerHeight}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
            overflow: "visible",
            color: isDark ? "#bfbfbf" : "#595959",
          }}
        >
          {edges.map((edge, i) => {
            const src = layouts.get(edge.sourceKey);
            const dst = layouts.get(edge.destKey);
            if (!src || !dst) {
              return null;
            }
            const sx = src.right;
            const sy = src.cy;
            const dx = dst.left;
            const dy = dst.cy;
            // Trunk x lives in the gap between source's right edge and
            // destination's left edge. Each destination card gets its own
            // trunk x so multiple incoming edges meet cleanly without
            // overlapping other destinations' trunks.
            const gapStart = sx + 6;
            const gapEnd = dx - 6;
            const t = (edge.destIdx + 1) / (edge.destCount + 1);
            const trunkX = gapStart + (gapEnd - gapStart) * t;
            // Rounded corners at the two bends of the orthogonal path.
            // Cap the radius so it never exceeds half of any adjacent segment.
            const vertical = dy - sy;
            const dirY = vertical >= 0 ? 1 : -1;
            const maxR = Math.min(
              8,
              Math.abs(trunkX - sx) / 2,
              Math.abs(dx - trunkX) / 2,
              Math.abs(vertical) / 2
            );
            let path: string;
            if (maxR <= 0.5) {
              path = `M ${sx} ${sy} L ${trunkX} ${sy} L ${trunkX} ${dy} L ${dx} ${dy}`;
            } else {
              const r = maxR;
              path =
                `M ${sx} ${sy} ` +
                `L ${trunkX - r} ${sy} ` +
                `Q ${trunkX} ${sy} ${trunkX} ${sy + dirY * r} ` +
                `L ${trunkX} ${dy - dirY * r} ` +
                `Q ${trunkX} ${dy} ${trunkX + r} ${dy} ` +
                `L ${dx} ${dy}`;
            }
            return (
              <path
                key={`edge-${i}-${edge.sourceKey}-${edge.destKey}`}
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                opacity={0.45}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </svg>

        {phaseGroups.map((group, index) => {
          const isLastGroup = index === phaseGroups.length - 1;
          return (
            <div
              key={`group-${index}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: ROW_GAP,
                alignItems: "stretch",
              }}
            >
              {group.map((phase) => (
                <BracketCard
                  key={phase.key}
                  phase={phase}
                  isFinalPhase={isLastGroup}
                  containerRef={setCardRef(phase.key)}
                />
              ))}
            </div>
          );
        })}

        {/* Winner column */}
        {finalPhase &&
          (() => {
            const winner = finalPhase.isComplete
              ? (finalPhase.slots.find((s) => s.rank === 1) ?? null)
              : null;
            return (
              <div
                ref={setCardRef(WINNER_KEY)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <TrophyOutlined
                  style={{
                    fontSize: 28,
                    color: "#faad14",
                    opacity: 0.9,
                    position: "absolute",
                    top: -36,
                    left: "50%",
                    transform: "translateX(-50%)",
                  }}
                />
                <Card
                  style={{
                    background: isDark ? "#1f1f1f" : "#ffffff",
                    border: `1px solid ${isDark ? "#303030" : "#e8e8e8"}`,
                    borderRadius: 10,
                    minWidth: 160,
                  }}
                  styles={{
                    body: { padding: "12px 16px", textAlign: "center" },
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    {winner?.team?.pictures && (
                      <TeamLogo pictures={winner.team.pictures} size={24} />
                    )}
                    <Text
                      strong={!!winner?.team}
                      style={{
                        fontStyle: winner?.team ? "normal" : "italic",
                        opacity: winner?.team ? 1 : 0.5,
                        fontSize: "0.95rem",
                      }}
                    >
                      {winner?.team ? winner.team.displayName : "—"}
                    </Text>
                  </div>
                </Card>
              </div>
            );
          })()}
      </div>
    </div>
  );
}

import { Link } from "react-router";
import {
  Avatar,
  Button,
  List,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  EyeOutlined,
  QuestionOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { PicturePair } from "../types/pictures";
import { basePath } from "../utils/basePath";
import { PlayerAvatar } from "./PlayerAvatar";
import { TeamLogo } from "./TeamLogo";

const { Text, Title } = Typography;
const PAST_GAME_AGE_MS = 24 * 60 * 60 * 1_000;

export interface PublicScheduleParticipant {
  id: string;
  name: string;
  pictures: PicturePair | null;
}

export interface PublicScheduleGame {
  id: string;
  phaseId: string | null;
  scheduledAt: string;
  slots: Array<{
    seatIndex: number;
    participant: PublicScheduleParticipant | null;
  }>;
  live: { status: "ongoing"; watchId: string } | null;
}

export interface PublicScheduleData {
  leagueId: string;
  leagueName: string;
  isTeamMode: boolean;
  phases: Array<{
    id: string | null;
    kind: "regular" | "final" | "tournament";
  }>;
  games: PublicScheduleGame[];
}

export interface SchedulePhaseGroup {
  phase: PublicScheduleData["phases"][number];
  days: Array<[string, PublicScheduleGame[]]>;
}

interface ScheduleLabels {
  tournamentPhase: string;
  tbd: string;
  live: string;
  watchLive: string;
}

function localDateKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function partitionScheduledGames<
  T extends Pick<PublicScheduleGame, "scheduledAt">,
>(games: T[], nowMs = Date.now()): { current: T[]; past: T[] } {
  const cutoff = nowMs - PAST_GAME_AGE_MS;
  const current: T[] = [];
  const past: T[] = [];

  for (const game of games) {
    const scheduledAt = Date.parse(game.scheduledAt);
    if (Number.isFinite(scheduledAt) && scheduledAt < cutoff) {
      past.push(game);
    } else {
      current.push(game);
    }
  }

  return { current, past };
}

export function buildSchedulePhaseGroups(
  phases: PublicScheduleData["phases"],
  games: PublicScheduleGame[]
): SchedulePhaseGroup[] {
  return phases.flatMap((phase) => {
    const phaseGames = games.filter((game) => game.phaseId === phase.id);
    if (phaseGames.length === 0) {
      return [];
    }
    const days = new Map<string, PublicScheduleGame[]>();
    for (const game of phaseGames) {
      const key = localDateKey(game.scheduledAt);
      const dayGames = days.get(key);
      if (dayGames) {
        dayGames.push(game);
      } else {
        days.set(key, [game]);
      }
    }
    return [{ phase, days: [...days.entries()] }];
  });
}

export function TournamentScheduleGroups({
  groups,
  data,
  localeCode,
  isMobile,
  labels,
}: {
  groups: SchedulePhaseGroup[];
  data: PublicScheduleData;
  localeCode: string;
  isMobile: boolean;
  labels: ScheduleLabels;
}): React.JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {groups.map(({ phase, days }) => (
        <section key={phase.id ?? "tournament"}>
          <Title level={4} style={{ marginTop: 0 }}>
            {phase.id ?? labels.tournamentPhase}
          </Title>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {days.map(([dayKey, games]) => (
              <div key={dayKey}>
                <Title level={5} style={{ margin: "0 0 8px" }}>
                  {new Intl.DateTimeFormat(localeCode, {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  }).format(new Date(games[0].scheduledAt))}
                </Title>
                <List
                  bordered
                  dataSource={games}
                  renderItem={(game) => (
                    <List.Item>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: isMobile
                            ? "minmax(0, 1fr)"
                            : "90px minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: 16,
                          width: "100%",
                        }}
                      >
                        <Text strong style={{ fontSize: 16 }}>
                          {new Intl.DateTimeFormat(localeCode, {
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(game.scheduledAt))}
                        </Text>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: isMobile
                              ? "minmax(0, 1fr)"
                              : "repeat(2, minmax(0, 1fr))",
                            gap: "8px 16px",
                          }}
                        >
                          {game.slots.map((slot) => (
                            <div
                              key={slot.seatIndex}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                minWidth: 0,
                              }}
                            >
                              {slot.participant ? (
                                data.isTeamMode ? (
                                  <TeamLogo
                                    pictures={slot.participant.pictures}
                                    icon={<TeamOutlined />}
                                    size="small"
                                  />
                                ) : (
                                  <PlayerAvatar
                                    src={null}
                                    leaguePicture={slot.participant.pictures}
                                    size="small"
                                  />
                                )
                              ) : (
                                <Avatar
                                  size="small"
                                  icon={<QuestionOutlined />}
                                />
                              )}
                              <Text
                                type={slot.participant ? undefined : "secondary"}
                                ellipsis
                              >
                                {slot.participant?.name ?? labels.tbd}
                              </Text>
                            </div>
                          ))}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: isMobile
                              ? "flex-start"
                              : "flex-end",
                            gap: 8,
                          }}
                        >
                          {game.live && (
                            <>
                              <Tag color="red">{labels.live}</Tag>
                              <Link
                                to={`${basePath}/watch/live/${encodeURIComponent(game.live.watchId)}`}
                                aria-label={labels.watchLive}
                              >
                                {isMobile ? (
                                  <Tooltip title={labels.watchLive}>
                                    <Button
                                      type="primary"
                                      aria-label={labels.watchLive}
                                      icon={<EyeOutlined />}
                                    />
                                  </Tooltip>
                                ) : (
                                  <Button type="primary" icon={<EyeOutlined />}>
                                    {labels.watchLive}
                                  </Button>
                                )}
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

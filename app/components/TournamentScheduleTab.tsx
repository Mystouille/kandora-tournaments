import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Alert,
  Avatar,
  Button,
  Empty,
  List,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  EyeOutlined,
  QuestionOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { useIsMobile } from "../hooks/useIsMobile";
import type { PicturePair } from "../types/pictures";
import { basePath } from "../utils/basePath";
import { PlayerAvatar } from "./PlayerAvatar";
import { TeamLogo } from "./TeamLogo";

const { Text, Title } = Typography;
const REFRESH_INTERVAL_MS = 30_000;

interface PublicScheduleParticipant {
  id: string;
  name: string;
  pictures: PicturePair | null;
}

interface PublicScheduleGame {
  id: string;
  phaseId: string | null;
  scheduledAt: string;
  slots: Array<{
    seatIndex: number;
    participant: PublicScheduleParticipant | null;
  }>;
  live: { status: "ongoing"; watchId: string } | null;
}

interface PublicScheduleData {
  leagueId: string;
  leagueName: string;
  isTeamMode: boolean;
  phases: Array<{
    id: string | null;
    kind: "regular" | "final" | "tournament";
  }>;
  games: PublicScheduleGame[];
}

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function TournamentScheduleTab({ leagueId }: { leagueId: string }) {
  const { t, locale } = useLocale();
  const isMobile = useIsMobile();
  const [data, setData] = useState<PublicScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const localeCode = locale === "fr" ? "fr-FR" : "en-US";

  useEffect(() => {
    let active = true;
    let inFlight = false;

    const load = async (initial: boolean) => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      if (initial) {
        setLoading(true);
      }
      try {
        const response = await fetch(
          `${basePath}/api/league-schedule?leagueId=${encodeURIComponent(leagueId)}`
        );
        if (!response.ok) {
          throw new Error("Failed to load schedule");
        }
        const schedule = (await response.json()) as PublicScheduleData;
        if (active) {
          setData(schedule);
          setError(false);
        }
      } catch {
        if (active) {
          setError(true);
        }
      } finally {
        if (active && initial) {
          setLoading(false);
        }
        inFlight = false;
      }
    };

    void load(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(false);
      }
    }, REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void load(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, [leagueId, reloadKey]);

  const phaseGroups = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.phases.flatMap((phase) => {
      const phaseGames = data.games.filter(
        (game) => game.phaseId === phase.id
      );
      if (phaseGames.length === 0) {
        return [];
      }
      const days = new Map<string, PublicScheduleGame[]>();
      for (const game of phaseGames) {
        const key = localDateKey(game.scheduledAt);
        const games = days.get(key);
        if (games) {
          games.push(game);
        } else {
          days.set(key, [game]);
        }
      }
      return [{ phase, days: [...days.entries()] }];
    });
  }, [data]);

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!data) {
    return (
      <Alert
        type="error"
        showIcon
        message={t.onlineTournaments.scheduleError}
        action={
          <Button size="small" onClick={() => setReloadKey((key) => key + 1)}>
            {t.onlineTournaments.scheduleRetry}
          </Button>
        }
      />
    );
  }

  return (
    <div>
      {error && (
        <Alert
          type="warning"
          showIcon
          message={t.onlineTournaments.scheduleRefreshError}
          style={{ marginBottom: 16 }}
          action={
            <Button
              size="small"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              {t.onlineTournaments.scheduleRetry}
            </Button>
          }
        />
      )}

      {phaseGroups.length === 0 ? (
        <Empty description={t.onlineTournaments.scheduleEmpty} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {phaseGroups.map(({ phase, days }) => (
            <section key={phase.id ?? "tournament"}>
              <Title level={4} style={{ marginTop: 0 }}>
                {phase.id ?? t.onlineTournaments.scheduleTournamentPhase}
              </Title>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 20 }}
              >
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
                                        leaguePicture={
                                          slot.participant.pictures
                                        }
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
                                    type={
                                      slot.participant
                                        ? undefined
                                        : "secondary"
                                    }
                                    ellipsis
                                  >
                                    {slot.participant?.name ??
                                      t.onlineTournaments.scheduleTbd}
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
                                  <Tag color="red">
                                    {t.onlineTournaments.scheduleLive}
                                  </Tag>
                                  <Link
                                    to={`${basePath}/watch/live/${encodeURIComponent(game.live.watchId)}`}
                                    aria-label={
                                      t.onlineTournaments.scheduleWatchLive
                                    }
                                  >
                                    {isMobile ? (
                                      <Tooltip
                                        title={
                                          t.onlineTournaments.scheduleWatchLive
                                        }
                                      >
                                        <Button
                                          type="primary"
                                          aria-label={
                                            t.onlineTournaments
                                              .scheduleWatchLive
                                          }
                                          icon={<EyeOutlined />}
                                        />
                                      </Tooltip>
                                    ) : (
                                      <Button
                                        type="primary"
                                        icon={<EyeOutlined />}
                                      >
                                        {t.onlineTournaments.scheduleWatchLive}
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
      )}
    </div>
  );
}
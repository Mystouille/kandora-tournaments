import { useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Link, useParams } from "react-router";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Result,
  Segmented,
  Select,
  Spin,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import type { Route } from "./+types/admin.online-tournaments.$id.set-schedule";
import { useLocale } from "../contexts/LocaleContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { basePath } from "../utils/basePath";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";

const { Text, Title } = Typography;
const TOURNAMENT_PHASE_KEY = "__tournament__";

interface SchedulePhase {
  id: string | null;
  kind: "regular" | "final" | "tournament";
}

interface ScheduleParticipant {
  id: string;
  name: string;
}

interface ScheduleData {
  leagueId: string;
  leagueName: string;
  startTime: string;
  endTime: string;
  isTeamMode: boolean;
  platformName: string;
  phases: SchedulePhase[];
  participants: ScheduleParticipant[];
  games: Array<{
    id: string;
    phaseId: string | null;
    scheduledAt: string;
    slots: Array<{ seatIndex: number; participantId: string | null }>;
  }>;
}

interface DraftGame {
  key: string;
  id?: string;
  phaseId: string | null;
  scheduledAt: Dayjs | null;
  slots: Array<{ seatIndex: number; participantId: string | null }>;
}

let nextDraftId = 1;

function phaseKey(phaseId: string | null) {
  return phaseId ?? TOURNAMENT_PHASE_KEY;
}

function draftsFromData(data: ScheduleData): DraftGame[] {
  return data.games.map((game) => ({
    key: game.id,
    id: game.id,
    phaseId: game.phaseId,
    scheduledAt: dayjs(game.scheduledAt),
    slots: game.slots,
  }));
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireLeagueAdminOrRedirect(request, params.id!);
  return null;
}

export function meta() {
  return [{ title: "Set Schedule - Kandora Tournaments" }];
}

export default function SetSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const tt = t.onlineTournaments.admin;
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [data, setData] = useState<ScheduleData | null>(null);
  const [games, setGames] = useState<DraftGame[]>([]);
  const [activePhaseKey, setActivePhaseKey] = useState(TOURNAMENT_PHASE_KEY);

  useEffect(() => {
    if (!id) {
      return;
    }
    setLoading(true);
    setLoadError(false);
    fetch(
      `${basePath}/api/admin/league-schedule?leagueId=${encodeURIComponent(id)}`
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load schedule");
        }
        return response.json();
      })
      .then((schedule: ScheduleData) => {
        setData(schedule);
        setGames(draftsFromData(schedule));
        setActivePhaseKey(phaseKey(schedule.phases[0]?.id ?? null));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [id]);

  const activePhase = data?.phases.find(
    (phase) => phaseKey(phase.id) === activePhaseKey
  );
  const phaseLabel = (phase: SchedulePhase) =>
    phase.id ?? tt.scheduleTournamentPhase;
  const visibleGames = games.filter(
    (game) => phaseKey(game.phaseId) === activePhaseKey
  );
  const participantOptions = useMemo(
    () =>
      (data?.participants ?? []).map((participant) => ({
        label: participant.name,
        value: participant.id,
      })),
    [data?.participants]
  );

  const updateGame = (
    key: string,
    update: (game: DraftGame) => DraftGame
  ) => {
    setGames((current) =>
      current.map((game) => (game.key === key ? update(game) : game))
    );
  };

  const addGame = () => {
    if (!data || !activePhase) {
      return;
    }
    const start = dayjs(data.startTime);
    const end = dayjs(data.endTime);
    const now = dayjs();
    const scheduledAt = (now.isBefore(start)
      ? start
      : now.isAfter(end)
        ? end
        : now
    )
      .second(0)
      .millisecond(0);
    setGames((current) => [
      ...current,
      {
        key: `draft-${nextDraftId++}`,
        phaseId: activePhase.id,
        scheduledAt,
        slots: [0, 1, 2, 3].map((seatIndex) => ({
          seatIndex,
          participantId: null,
        })),
      },
    ]);
  };

  const saveSchedule = async () => {
    if (!id || !data) {
      return;
    }
    if (games.some((game) => !game.scheduledAt?.isValid())) {
      message.error(tt.scheduleInvalidDate);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${basePath}/api/admin/league-schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: id,
          games: games.map((game) => ({
            id: game.id,
            phaseId: game.phaseId,
            scheduledAt: game.scheduledAt!.toISOString(),
            slots: game.slots,
          })),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        message.error(tt.scheduleSaveError);
        return;
      }
      const saved = result as ScheduleData;
      setData(saved);
      setGames(draftsFromData(saved));
      message.success(tt.scheduleSaved);
    } catch {
      message.error(tt.scheduleSaveError);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 96, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (loadError || !data) {
    return <Result status="404" title={tt.scheduleLoadError} />;
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <Link to={`/admin/online-tournaments/${id}`}>
        <Button
          size="small"
          icon={<ArrowLeftOutlined />}
          style={{ marginBottom: 12 }}
        >
          {t.admin.manageTournament}
        </Button>
      </Link>

      <Title level={2}>{tt.scheduleEditor}</Title>
      <Text type="secondary">{data.leagueName}</Text>
      <Alert
        type="info"
        showIcon
        message={tt.scheduleDescription}
        style={{ margin: "16px 0" }}
      />

      <div style={{ overflowX: "auto", marginBottom: 20 }}>
        <Segmented
          value={activePhaseKey}
          options={data.phases.map((phase) => ({
            value: phaseKey(phase.id),
            label: phaseLabel(phase),
          }))}
          onChange={(value) => setActivePhaseKey(String(value))}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          {activePhase ? phaseLabel(activePhase) : ""}
        </Title>
        <Button icon={<PlusOutlined />} onClick={addGame}>
          {tt.scheduleAddGame}
        </Button>
      </div>

      {visibleGames.length === 0 ? (
        <Empty description={tt.scheduleNoGames} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleGames.map((game, gameIndex) => {
            const selectedIds = new Set(
              game.slots.flatMap((slot) =>
                slot.participantId ? [slot.participantId] : []
              )
            );
            return (
              <Card
                key={game.key}
                size="small"
                title={tt.scheduleGame.replace(
                  "{n}",
                  String(gameIndex + 1)
                )}
                extra={
                  <Tooltip title={tt.scheduleRemoveGame}>
                    <Button
                      type="text"
                      danger
                      aria-label={tt.scheduleRemoveGame}
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setGames((current) =>
                          current.filter((item) => item.key !== game.key)
                        )
                      }
                    />
                  </Tooltip>
                }
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "minmax(0, 1fr)"
                      : "minmax(220px, 1.2fr) repeat(2, minmax(180px, 1fr))",
                    gap: 12,
                  }}
                >
                  <label>
                    <Text strong>{tt.scheduleStart}</Text>
                    <DatePicker
                      showTime
                      format="YYYY-MM-DD HH:mm"
                      value={game.scheduledAt}
                      onChange={(value) =>
                        updateGame(game.key, (current) => ({
                          ...current,
                          scheduledAt: value,
                        }))
                      }
                      style={{ display: "block", width: "100%", marginTop: 4 }}
                    />
                  </label>
                  {game.slots.map((slot) => (
                    <label key={slot.seatIndex}>
                      <Text strong>
                        {tt.scheduleSeat.replace(
                          "{n}",
                          String(slot.seatIndex + 1)
                        )}
                      </Text>
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        value={slot.participantId}
                        placeholder={tt.scheduleTbd}
                        options={participantOptions.map((option) => ({
                          ...option,
                          disabled:
                            option.value !== slot.participantId &&
                            selectedIds.has(option.value),
                        }))}
                        onChange={(participantId) =>
                          updateGame(game.key, (current) => ({
                            ...current,
                            slots: current.slots.map((currentSlot) =>
                              currentSlot.seatIndex === slot.seatIndex
                                ? {
                                    ...currentSlot,
                                    participantId: participantId ?? null,
                                  }
                                : currentSlot
                            ),
                          }))
                        }
                        style={{ display: "block", marginTop: 4 }}
                      />
                    </label>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 24, textAlign: "right" }}>
        <Button
          type="primary"
          size="large"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={saveSchedule}
        >
          {tt.scheduleSave}
        </Button>
      </div>
    </div>
  );
}
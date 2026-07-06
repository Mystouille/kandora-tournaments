import { useEffect, useMemo, useState } from "react";
import type { Dayjs } from "dayjs";
import {
  Alert,
  Button,
  DatePicker,
  Divider,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Switch,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  LoadingOutlined,
  ReloadOutlined,
  SaveOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import { Platform, Ruleset } from "../types/league-enums";
import {
  LeagueTypeConfigForm,
  type LeagueTypeConfigFormResult,
} from "./admin/leagueTypeConfig";
import type { LeagueTypeConfig } from "../services/league-configs/types";

const { Title } = Typography;

interface LeagueFormProps {
  onSuccess?: (league: { _id: string; name: string }) => void;
  botFriendIds?: {
    majsoul?: string;
    riichiCity?: string;
  };
}

interface DiscordServer {
  id: string;
  name: string;
}

interface DiscordChannel {
  id: string;
  name: string;
  categoryId: string | null;
  canSend: boolean;
}

interface DiscordCategory {
  id: string;
  name: string;
}

const platformOptions = [
  { label: "Mahjong Soul", value: Platform.MAJSOUL },
  { label: "Riichi City", value: Platform.RIICHICITY },
  { label: "Tenhou", value: Platform.TENHOU },
];

const rulesetOptions = Object.values(Ruleset).map((r) => ({
  label: r,
  value: r,
}));

export function LeagueForm({ onSuccess, botFriendIds }: LeagueFormProps) {
  const { t, locale } = useLocale();
  const [form] = Form.useForm();

  // Section A: platform validation
  const [platform, setPlatform] = useState<string | null>(null);
  const [tournamentId, setTournamentId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [internalTournamentId, setInternalTournamentId] = useState<
    string | undefined
  >();
  const [seasonId, setSeasonId] = useState<string | undefined>();
  const [seasons, setSeasons] = useState<
    Array<{
      seasonId: number;
      startTime: number;
      endTime: number;
      remark: string;
    }>
  >([]);

  // Per-phase tournament lobbies. When `perPhaseMode` is on, each config phase
  // is bound to its own tournament lobby (keyed by phase id) instead of the
  // single primary lobby above.
  const [perPhaseMode, setPerPhaseMode] = useState(false);
  const [phaseLobbies, setPhaseLobbies] = useState<
    Record<
      string,
      {
        tournamentId: string;
        internalTournamentId?: string;
        validating: boolean;
        validated: boolean;
        error?: string;
      }
    >
  >({});

  // Section C: discord
  const [publishOnDiscord, setPublishOnDiscord] = useState(false);
  const [servers, setServers] = useState<DiscordServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [categories, setCategories] = useState<DiscordCategory[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);

  // Cutoff dates
  const [cutoffDates, setCutoffDates] = useState<(Dayjs | null)[]>([]);

  // League type config
  const [configResult, setConfigResult] =
    useState<LeagueTypeConfigFormResult | null>(null);

  // Derive the resolved config object for cutoff computation
  const leagueTypeConfig: LeagueTypeConfig | null =
    configResult?.config ?? null;

  // Derive cutoff count from leagueTypeConfig
  const hasRegularPhase = !!(
    leagueTypeConfig?.regularPhase || leagueTypeConfig?.regularPhases
  );
  const cutoffCount = leagueTypeConfig?.regularPhases
    ? leagueTypeConfig.regularPhases.length - 1
    : hasRegularPhase && leagueTypeConfig?.finalPhase
      ? 1
      : 0;

  // Ordered list of config phases (regular phases first, then finals). Each can
  // be bound to its own tournament lobby in per-phase mode.
  const orderedPhases = useMemo(() => {
    const phases: { id: string; kind: "regular" | "final" }[] = [];
    if (
      leagueTypeConfig?.regularPhases &&
      leagueTypeConfig.regularPhases.length > 0
    ) {
      for (const phase of leagueTypeConfig.regularPhases) {
        phases.push({ id: phase.id, kind: "regular" });
      }
    } else if (leagueTypeConfig?.regularPhase) {
      phases.push({ id: leagueTypeConfig.regularPhase.id, kind: "regular" });
    }
    if (leagueTypeConfig?.finalPhase) {
      phases.push({ id: leagueTypeConfig.finalPhase.id, kind: "final" });
    }
    return phases;
  }, [leagueTypeConfig]);

  // Per-phase mode is only meaningful once the config exposes phases; turn it
  // off automatically when no phases are available.
  useEffect(() => {
    if (orderedPhases.length === 0 && perPhaseMode) {
      setPerPhaseMode(false);
    }
  }, [orderedPhases.length, perPhaseMode]);

  // Sync cutoff slots when structure changes
  useEffect(() => {
    setCutoffDates((prev) => {
      if (prev.length === cutoffCount) {
        return prev;
      }
      const next = Array.from(
        { length: cutoffCount },
        (_, i) => prev[i] ?? null
      );
      return next;
    });
  }, [cutoffCount]);

  // Submitting
  const [submitting, setSubmitting] = useState(false);

  const needsTournamentId = platform !== null;

  const canValidate = needsTournamentId && tournamentId.trim().length > 0;

  const isUnlocked = validated;

  const botFriendId =
    platform === Platform.MAJSOUL
      ? botFriendIds?.majsoul
      : platform === Platform.RIICHICITY
        ? botFriendIds?.riichiCity
        : undefined;

  // Reset validation when platform or tournament ID changes
  useEffect(() => {
    setValidated(false);
    setValidationError(null);
    setInternalTournamentId(undefined);
  }, [platform, tournamentId]);

  // Fetch Discord servers when toggle is activated
  useEffect(() => {
    if (publishOnDiscord && servers.length === 0) {
      fetch(`${basePath}/api/admin/discord-servers`)
        .then((res) => res.json())
        .then((data) => {
          if (data.servers) {
            setServers(data.servers);
          }
        })
        .catch((err) => {
          console.error("Failed to load Discord servers:", err);
        });
    }
  }, [publishOnDiscord, servers.length]);

  // Fetch Discord channels when server is selected
  useEffect(() => {
    if (!selectedServer) {
      setChannels([]);
      setCategories([]);
      return;
    }

    setLoadingChannels(true);
    fetch(
      `${basePath}/api/admin/discord-channels?serverId=${encodeURIComponent(selectedServer)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.channels) {
          setChannels(data.channels);
        }
        if (data.categories) {
          setCategories(data.categories);
        }
      })
      .catch((err) => {
        console.error("Failed to load Discord channels:", err);
      })
      .finally(() => {
        setLoadingChannels(false);
      });
  }, [selectedServer]);

  const handleReset = () => {
    setTournamentId("");
    setValidated(false);
    setValidationError(null);
    setDuplicateError(null);
    setInternalTournamentId(undefined);
    setSeasonId(undefined);
    setSeasons([]);
  };

  const checkDuplicate = async (
    plat: string,
    intId: string | number,
    season?: string
  ) => {
    try {
      const params = new URLSearchParams({
        platform: plat,
        internalTournamentId: String(intId),
      });
      if (season) {
        params.set("seasonId", season);
      }
      const res = await fetch(
        `${basePath}/api/admin/check-duplicate-tournament?${params}`
      );
      const data = await res.json();
      if (data.duplicate) {
        setDuplicateError(
          t.onlineTournaments.admin.duplicateTournament.replace(
            "{name}",
            data.existingName ?? ""
          )
        );
      } else {
        setDuplicateError(null);
      }
    } catch {
      // Non-blocking — the server-side guard will still catch it
    }
  };

  const handleValidate = async () => {
    if (!platform || !tournamentId.trim()) {
      return;
    }

    setValidating(true);
    setValidationError(null);

    try {
      const res = await fetch(
        `${basePath}/api/admin/validate-tournament?platform=${encodeURIComponent(platform)}&tournamentId=${encodeURIComponent(tournamentId.trim())}`
      );
      const data = await res.json();

      if (data.valid) {
        setValidated(true);
        setInternalTournamentId(data.internalTournamentId);
        if (data.tournamentName) {
          form.setFieldsValue({ name: data.tournamentName });
        }

        // Check for duplicate tournament (Riichi City: immediate, Majsoul: after season pick)
        if (platform !== Platform.MAJSOUL && data.internalTournamentId) {
          checkDuplicate(platform, data.internalTournamentId);
        }

        // Fetch seasons for Majsoul tournaments
        if (platform === Platform.MAJSOUL) {
          try {
            const seasonRes = await fetch(
              `${basePath}/api/admin/majsoul-seasons?tournamentId=${encodeURIComponent(tournamentId.trim())}`
            );
            const seasonData = await seasonRes.json();
            if (seasonData.seasons) {
              setSeasons(seasonData.seasons);
            }
          } catch {
            console.error("Failed to fetch Majsoul seasons");
          }
        }
      } else {
        setValidationError(
          data.error || t.onlineTournaments.admin.validationFailed
        );
      }
    } catch {
      setValidationError(t.onlineTournaments.admin.validationFailed);
    } finally {
      setValidating(false);
    }
  };

  const setPhaseLobbyTournamentId = (phaseId: string, value: string) => {
    setPhaseLobbies((prev) => ({
      ...prev,
      [phaseId]: {
        tournamentId: value,
        internalTournamentId: undefined,
        validating: prev[phaseId]?.validating ?? false,
        validated: false,
        error: undefined,
      },
    }));
  };

  const handleValidatePhase = async (phaseId: string) => {
    const tid = phaseLobbies[phaseId]?.tournamentId?.trim();
    if (!platform || !tid) {
      return;
    }
    setPhaseLobbies((prev) => ({
      ...prev,
      [phaseId]: {
        tournamentId: prev[phaseId]?.tournamentId ?? "",
        internalTournamentId: undefined,
        validating: true,
        validated: false,
        error: undefined,
      },
    }));
    try {
      const res = await fetch(
        `${basePath}/api/admin/validate-tournament?platform=${encodeURIComponent(platform)}&tournamentId=${encodeURIComponent(tid)}`
      );
      const data = await res.json();
      if (data.valid) {
        setPhaseLobbies((prev) => ({
          ...prev,
          [phaseId]: {
            tournamentId: prev[phaseId]?.tournamentId ?? "",
            internalTournamentId: data.internalTournamentId,
            validating: false,
            validated: true,
            error: undefined,
          },
        }));
      } else {
        setPhaseLobbies((prev) => ({
          ...prev,
          [phaseId]: {
            tournamentId: prev[phaseId]?.tournamentId ?? "",
            internalTournamentId: undefined,
            validating: false,
            validated: false,
            error: data.error || t.onlineTournaments.admin.validationFailed,
          },
        }));
      }
    } catch {
      setPhaseLobbies((prev) => ({
        ...prev,
        [phaseId]: {
          tournamentId: prev[phaseId]?.tournamentId ?? "",
          internalTournamentId: undefined,
          validating: false,
          validated: false,
          error: t.onlineTournaments.admin.validationFailed,
        },
      }));
    }
  };

  const updateCutoffDate = (index: number, value: Dayjs | null) => {
    setCutoffDates((prev) => prev.map((d, i) => (i === index ? value : d)));
  };

  const handleSubmit = async (values: Record<string, unknown>) => {
    setSubmitting(true);

    try {
      const startTime = (values.startTime as Dayjs)?.toISOString();
      const endTime = (values.endTime as Dayjs)?.toISOString();

      if (!startTime || !endTime) {
        message.error(t.onlineTournaments.admin.dateRequired);
        return;
      }

      const phaseCutoffTimes = cutoffDates
        .filter((d): d is Dayjs => d !== null && d.isValid())
        .map((d) => d.toISOString());

      // In per-phase mode, bind each config phase to its own tournament lobby.
      const phaseTournaments =
        perPhaseMode && orderedPhases.length > 0
          ? orderedPhases.map((phase) => ({
              phaseId: phase.id,
              tournamentId: phaseLobbies[phase.id]?.tournamentId?.trim() ?? "",
              internalTournamentId:
                phaseLobbies[phase.id]?.internalTournamentId || undefined,
            }))
          : [];

      if (perPhaseMode) {
        const missing = phaseTournaments.filter((p) => !p.tournamentId);
        if (missing.length > 0) {
          message.error(t.onlineTournaments.admin.phaseLobbyRequired);
          return;
        }
      }

      const payload: Record<string, unknown> = {
        name: values.name,
        startTime,
        endTime,
        phaseCutoffTimes,
        rulesConfig: {
          gameRules: values.gameRules,
          isTeamMode:
            leagueTypeConfig?.isTeamMode ?? values.isTeamMode ?? false,
        },
        platformConfig: {
          platformName: platform,
          tournamentId: needsTournamentId ? tournamentId.trim() : undefined,
          internalTournamentId: internalTournamentId || undefined,
          seasonId: seasonId || undefined,
          phaseTournaments: perPhaseMode ? phaseTournaments : undefined,
        },
        leagueTypeConfigId:
          configResult?.mode === "existing" ? configResult.configId : undefined,
        leagueTypeConfig:
          configResult?.mode === "new" ? configResult.config : undefined,
      };

      if (publishOnDiscord && selectedServer) {
        payload.discordConfig = {
          serverId: selectedServer,
          rankingChannel: values.rankingChannel || undefined,
          resultChannel: values.resultChannel || undefined,
          adminChannel: values.adminChannel || undefined,
          schedulingChannel: values.schedulingChannel || undefined,
          locale: values.discordLocale === "en" ? "en" : "fr",
        };
      }

      const res = await fetch(`${basePath}/api/admin/online-tournaments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "duplicateTournament") {
          const msg = t.onlineTournaments.admin.duplicateTournament.replace(
            "{name}",
            data.existingName ?? ""
          );
          setDuplicateError(msg);
          message.error(msg);
        } else {
          message.error(data.error || "Failed to create league");
        }
        return;
      }

      message.success(t.onlineTournaments.admin.createSuccess);
      onSuccess?.({ _id: data.league._id, name: data.league.name });
    } catch (err) {
      console.error("Failed to create league:", err);
      message.error("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const channelOptions = (() => {
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
    const grouped = new Map<
      string,
      { label: React.ReactNode; value: string }[]
    >();
    const uncategorized: { label: React.ReactNode; value: string }[] = [];

    for (const ch of channels) {
      const option = {
        label: ch.canSend ? (
          `#${ch.name}`
        ) : (
          <span
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            #{ch.name}
            <Tooltip title={t.onlineTournaments.admin.channelNoPermission}>
              <WarningOutlined style={{ color: "#faad14" }} />
            </Tooltip>
          </span>
        ),
        value: ch.id,
      };
      if (ch.categoryId && categoryMap.has(ch.categoryId)) {
        if (!grouped.has(ch.categoryId)) {
          grouped.set(ch.categoryId, []);
        }
        grouped.get(ch.categoryId)!.push(option);
      } else {
        uncategorized.push(option);
      }
    }

    const result: {
      label: string;
      options: { label: React.ReactNode; value: string }[];
    }[] = [];
    for (const cat of categories) {
      const options = grouped.get(cat.id);
      if (options?.length) {
        result.push({ label: cat.name.toUpperCase(), options });
      }
    }
    if (uncategorized.length) {
      result.push({ label: "—", options: uncategorized });
    }
    return result;
  })();

  const filterChannel = (input: string, option?: unknown): boolean => {
    const opt = option as { value?: string } | undefined;
    return (
      channels
        .find((c) => c.id === opt?.value)
        ?.name.toLowerCase()
        .includes(input.toLowerCase()) ?? false
    );
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      disabled={submitting}
    >
      {/* ── Section A: Platform & Tournament ID ── */}
      <Title level={4}>{t.onlineTournaments.admin.platformSection}</Title>

      <Form.Item label={t.onlineTournaments.platform} required>
        <Select
          options={platformOptions}
          value={platform}
          onChange={(val) => {
            setPlatform(val);
            setTournamentId("");
          }}
          placeholder={t.onlineTournaments.admin.selectPlatform}
        />
      </Form.Item>

      {needsTournamentId && (
        <>
          {botFriendId && !validated && (
            <Alert
              type="info"
              message={t.onlineTournaments.admin.botAdminWarning.replace(
                "{id}",
                botFriendId
              )}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          {validated && (
            <Alert
              type="success"
              message={t.onlineTournaments.admin.validationSuccess}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <Form.Item label={t.onlineTournaments.admin.tournamentId}>
            <Space.Compact style={{ width: "100%" }}>
              <Input
                value={tournamentId}
                onChange={(e) => setTournamentId(e.target.value)}
                placeholder={t.onlineTournaments.admin.tournamentIdPlaceholder}
                disabled={validated}
              />
              {validated ? (
                <Button onClick={handleReset} icon={<ReloadOutlined />}>
                  {t.onlineTournaments.admin.reset}
                </Button>
              ) : (
                <Button
                  type="primary"
                  onClick={handleValidate}
                  disabled={!canValidate}
                  loading={validating}
                >
                  {t.onlineTournaments.admin.validate}
                </Button>
              )}
            </Space.Compact>
          </Form.Item>
        </>
      )}

      {platform === Platform.MAJSOUL && validated && seasons.length > 0 && (
        <Form.Item label={t.onlineTournaments.admin.seasonLabel}>
          <Select
            value={seasonId}
            onChange={(val) => {
              setSeasonId(val);
              if (val && internalTournamentId) {
                checkDuplicate(Platform.MAJSOUL, internalTournamentId, val);
              } else {
                setDuplicateError(null);
              }
            }}
            allowClear
            placeholder={t.onlineTournaments.admin.seasonPlaceholder}
            options={seasons.map((s) => {
              const start = new Date(s.startTime * 1000).toLocaleDateString(
                locale
              );
              const end = new Date(s.endTime * 1000).toLocaleDateString(locale);
              const remark = s.remark ? ` — ${s.remark}` : "";
              const label =
                t.onlineTournaments.admin.seasonOption
                  .replace("{id}", String(s.seasonId))
                  .replace("{start}", start)
                  .replace("{end}", end) + remark;
              return {
                value: String(s.seasonId),
                label,
              };
            })}
          />
        </Form.Item>
      )}

      {validationError && (
        <Alert
          type="error"
          message={validationError}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {duplicateError && (
        <Alert
          type="error"
          message={duplicateError}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* ── Section B: League Details (disabled until validated) ── */}
      <Divider />
      <Title level={4}>{t.onlineTournaments.admin.detailsSection}</Title>

      <fieldset
        disabled={!isUnlocked}
        style={{
          border: "none",
          padding: 0,
          margin: 0,
          opacity: isUnlocked ? 1 : 0.5,
        }}
      >
        <Form.Item
          label={t.onlineTournaments.admin.nameLabel}
          name="name"
          rules={[
            { required: true, message: t.onlineTournaments.admin.nameRequired },
          ]}
        >
          <Input />
        </Form.Item>

        <Space size="large" wrap>
          <Form.Item
            label={t.onlineTournaments.startDate}
            name="startTime"
            rules={[
              {
                required: true,
                message: t.onlineTournaments.admin.dateRequired,
              },
            ]}
          >
            <DatePicker showTime />
          </Form.Item>

          <Form.Item
            label={t.onlineTournaments.endDate}
            name="endTime"
            rules={[
              {
                required: true,
                message: t.onlineTournaments.admin.dateRequired,
              },
            ]}
          >
            <DatePicker showTime />
          </Form.Item>
        </Space>

        <Form.Item
          label={t.onlineTournaments.gameRules}
          name="gameRules"
          rules={[{ required: true }]}
        >
          <Select options={rulesetOptions} />
        </Form.Item>

        <LeagueTypeConfigForm
          value={leagueTypeConfig}
          onChange={setConfigResult}
        />

        {/* Per-phase tournament lobbies (optional): bind each config phase to
            its own tournament lobby for fetching + attribution. The primary
            lobby above stays the main lobby used for scheduling and live game
            management. */}
        {orderedPhases.length > 0 && needsTournamentId && (
          <>
            <Form.Item
              label={t.onlineTournaments.admin.perPhaseLobbies}
              tooltip={t.onlineTournaments.admin.perPhaseLobbiesHelp}
            >
              <Switch checked={perPhaseMode} onChange={setPerPhaseMode} />
            </Form.Item>
            {perPhaseMode &&
              orderedPhases.map((phase) => {
                const entry = phaseLobbies[phase.id];
                const trimmed = entry?.tournamentId?.trim();
                return (
                  <Form.Item
                    key={phase.id}
                    label={t.onlineTournaments.admin.phaseLobbyFor.replace(
                      "{phase}",
                      phase.id
                    )}
                    style={{ marginBottom: 8 }}
                    validateStatus={entry?.error ? "error" : undefined}
                    help={entry?.error}
                  >
                    <Space.Compact style={{ width: "100%" }}>
                      <Input
                        value={entry?.tournamentId ?? ""}
                        onChange={(e) =>
                          setPhaseLobbyTournamentId(phase.id, e.target.value)
                        }
                        placeholder={
                          t.onlineTournaments.admin.tournamentIdPlaceholder
                        }
                        disabled={entry?.validated}
                      />
                      <Button
                        type={entry?.validated ? "default" : "primary"}
                        icon={entry?.validated ? <ReloadOutlined /> : undefined}
                        onClick={() =>
                          entry?.validated
                            ? setPhaseLobbyTournamentId(phase.id, "")
                            : handleValidatePhase(phase.id)
                        }
                        loading={entry?.validating}
                        disabled={!entry?.validated && !trimmed}
                      >
                        {entry?.validated
                          ? t.onlineTournaments.admin.validated
                          : t.onlineTournaments.admin.validate}
                      </Button>
                    </Space.Compact>
                  </Form.Item>
                );
              })}
          </>
        )}

        {/* Cutoff dates (driven by leagueTypeConfig) */}
        {cutoffCount > 0 && (
          <Form.Item label={t.onlineTournaments.admin.cutoffDates}>
            {cutoffDates.map((date, index) => (
              <Form.Item
                key={index}
                label={t.onlineTournaments.admin.cutoffDateLabel.replace(
                  "{n}",
                  String(index + 1)
                )}
                style={{ marginBottom: 8 }}
              >
                <DatePicker
                  showTime
                  value={date}
                  onChange={(val) => updateCutoffDate(index, val)}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            ))}
          </Form.Item>
        )}

        {!leagueTypeConfig && (
          <Form.Item
            label={t.onlineTournaments.mode}
            name="isTeamMode"
            valuePropName="checked"
          >
            <Switch
              checkedChildren={t.onlineTournaments.teamMode}
              unCheckedChildren={t.onlineTournaments.individualMode}
            />
          </Form.Item>
        )}

        {/* ── Section C: Discord ── */}
        <Divider />
        <Title level={4}>{t.onlineTournaments.admin.discordSection}</Title>

        <Form.Item label={t.onlineTournaments.admin.publishOnDiscord}>
          <Switch
            checked={publishOnDiscord}
            onChange={(checked) => {
              setPublishOnDiscord(checked);
              if (!checked) {
                setSelectedServer(null);
                setChannels([]);
              }
            }}
          />
        </Form.Item>

        {publishOnDiscord && (
          <>
            <Form.Item
              label={t.onlineTournaments.admin.discordLocale}
              name="discordLocale"
              initialValue="fr"
              tooltip={t.onlineTournaments.admin.discordLocaleHelp}
            >
              <Select
                options={[
                  { label: "Français", value: "fr" },
                  { label: "English", value: "en" },
                ]}
              />
            </Form.Item>

            <Form.Item label={t.onlineTournaments.admin.discordServer}>
              <Select
                options={servers.map((s) => ({
                  label: s.name,
                  value: s.id,
                }))}
                value={selectedServer}
                onChange={setSelectedServer}
                placeholder={t.onlineTournaments.admin.selectServer}
              />
            </Form.Item>

            {loadingChannels && (
              <div style={{ textAlign: "center", padding: 16 }}>
                <Spin indicator={<LoadingOutlined spin />} />
              </div>
            )}

            {selectedServer && channels.length > 0 && (
              <>
                <Form.Item
                  label={t.onlineTournaments.admin.rankingChannel}
                  name="rankingChannel"
                >
                  <Select
                    options={channelOptions}
                    placeholder={t.onlineTournaments.admin.selectChannel}
                    allowClear
                    showSearch
                    filterOption={filterChannel}
                  />
                </Form.Item>

                <Form.Item
                  label={t.onlineTournaments.admin.resultChannel}
                  name="resultChannel"
                >
                  <Select
                    options={channelOptions}
                    placeholder={t.onlineTournaments.admin.selectChannel}
                    allowClear
                    showSearch
                    filterOption={filterChannel}
                  />
                </Form.Item>

                <Form.Item
                  label={t.onlineTournaments.admin.adminChannel}
                  name="adminChannel"
                >
                  <Select
                    options={channelOptions}
                    placeholder={t.onlineTournaments.admin.selectChannel}
                    allowClear
                    showSearch
                    filterOption={filterChannel}
                  />
                </Form.Item>

                <Form.Item
                  label={t.onlineTournaments.admin.schedulingChannel}
                  name="schedulingChannel"
                >
                  <Select
                    options={channelOptions}
                    placeholder={t.onlineTournaments.admin.selectChannel}
                    allowClear
                    showSearch
                    filterOption={filterChannel}
                  />
                </Form.Item>
              </>
            )}
          </>
        )}

        <Divider />

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            disabled={!!duplicateError}
            icon={<SaveOutlined />}
            size="large"
          >
            {t.onlineTournaments.admin.submit}
          </Button>
        </Form.Item>
      </fieldset>
    </Form>
  );
}

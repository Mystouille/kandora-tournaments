import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { CopyOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { LeagueTypeConfig } from "../../../services/league-configs/types";
import { basePath } from "../../../utils/basePath";
import { useLocale } from "../../../contexts/LocaleContext";
import { ScoringFields } from "./ScoringFields";
import { ProgressionFields } from "./ProgressionFields";
import { RationalInput } from "./RationalInput";
import { StageEditor } from "./StageEditor";
import {
  defaultRegularPhase,
  defaultFinalPhase,
  type LeagueTypeConfigFormResult,
} from "./types";

const { Text } = Typography;

interface LeagueTypeConfigFormProps {
  value?: LeagueTypeConfig | null;
  onChange?: (result: LeagueTypeConfigFormResult | null) => void;
}

interface ExistingConfig {
  _id: string;
  displayName: string;
  isTeamMode: boolean;
  regularPhase?: unknown;
  regularPhases?: unknown;
  finalPhase?: unknown;
}

export function LeagueTypeConfigForm({
  value,
  onChange,
}: LeagueTypeConfigFormProps) {
  const { t } = useLocale();
  const ct = t.onlineTournaments.admin.config;

  const [enabled, setEnabled] = useState(value != null);
  const [source, setSource] = useState<"existing" | "new">("existing");
  const [existingConfigs, setExistingConfigs] = useState<ExistingConfig[]>([]);
  const [configsLoaded, setConfigsLoaded] = useState(false);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [config, setConfig] = useState<LeagueTypeConfig>(
    value ?? {
      displayName: "",
      isTeamMode: false,
      regularPhase: defaultRegularPhase(),
    }
  );
  const [hasRegularPhase, setHasRegularPhase] = useState(
    value?.regularPhase != null || value?.regularPhases != null
  );
  const [isMultiPhase, setIsMultiPhase] = useState(
    value?.regularPhases != null
  );
  const [hasFinalPhase, setHasFinalPhase] = useState(value?.finalPhase != null);

  useEffect(() => {
    if (enabled && !configsLoaded) {
      setConfigsLoaded(true);
      fetch(`${basePath}/api/admin/league-type-config`)
        .then((res) => res.json())
        .then((data) => {
          if (data.configs) {
            setExistingConfigs(data.configs);
          }
        })
        .catch((err) => {
          console.error("Failed to load existing configs:", err);
        });
    }
  }, [enabled, configsLoaded]);

  const emitChange = (
    nextEnabled: boolean,
    nextSource: "existing" | "new",
    nextConfigId: string | null,
    nextConfig: LeagueTypeConfig
  ) => {
    if (!nextEnabled) {
      onChange?.(null);
      return;
    }
    if (nextSource === "existing" && nextConfigId) {
      onChange?.({
        mode: "existing",
        configId: nextConfigId,
        config: nextConfig,
      });
    } else if (nextSource === "new") {
      onChange?.({ mode: "new", config: nextConfig });
    } else {
      onChange?.(null);
    }
  };

  const update = (patch: Partial<LeagueTypeConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    if (enabled) {
      emitChange(true, source, selectedConfigId, next);
    }
  };

  const handleToggleEnabled = (on: boolean) => {
    setEnabled(on);
    emitChange(on, source, selectedConfigId, config);
  };

  const handleSourceChange = (newSource: "existing" | "new") => {
    setSource(newSource);
    if (newSource === "existing" && selectedConfigId) {
      emitChange(true, "existing", selectedConfigId, config);
    } else if (newSource === "new") {
      emitChange(true, "new", null, config);
    } else {
      onChange?.(null);
    }
  };

  const handleSelectExisting = (configId: string | null) => {
    setSelectedConfigId(configId);
    if (configId) {
      const found = existingConfigs.find((c) => c._id === configId);
      if (found) {
        const asConfig = JSON.parse(
          JSON.stringify(found)
        ) as LeagueTypeConfig & { _id?: string };
        delete asConfig._id;
        setConfig(asConfig);
        setHasRegularPhase(
          asConfig.regularPhase != null || asConfig.regularPhases != null
        );
        setIsMultiPhase(asConfig.regularPhases != null);
        setHasFinalPhase(asConfig.finalPhase != null);
        emitChange(true, "existing", configId, asConfig);
      }
    } else {
      onChange?.(null);
    }
  };

  const handleDuplicateForEdit = () => {
    setSource("new");
    emitChange(true, "new", null, config);
  };

  const handleToggleMultiPhase = (multi: boolean) => {
    setIsMultiPhase(multi);
    if (multi) {
      const phase1 = config.regularPhase ?? defaultRegularPhase("phase-1");
      const phase2 = defaultRegularPhase("phase-2");
      phase1.progression = phase1.progression ?? {
        advancingCount: 8,
        scoreRetention: { num: 0, den: 1 },
      };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { regularPhase: _rp, ...rest } = config;
      const next = {
        ...rest,
        regularPhases: [phase1, phase2],
        regularPhase: undefined,
      } as any as LeagueTypeConfig;
      setConfig(next);
      emitChange(true, source, selectedConfigId, next);
    } else {
      const first = config.regularPhases?.[0] ?? defaultRegularPhase();
      delete first.progression;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { regularPhases: _rps, ...rest } = config;
      const next = {
        ...rest,
        regularPhase: first,
        regularPhases: undefined,
      } as any as LeagueTypeConfig;
      setConfig(next);
      emitChange(true, source, selectedConfigId, next);
    }
  };

  const handleToggleFinalPhase = (on: boolean) => {
    setHasFinalPhase(on);
    if (on) {
      update({ finalPhase: defaultFinalPhase() });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { finalPhase: _fp, ...rest } = config;
      const next = {
        ...rest,
        finalPhase: undefined,
      } as any as LeagueTypeConfig;
      setConfig(next);
      emitChange(true, source, selectedConfigId, next);
    }
  };

  const handleToggleRegularPhase = (on: boolean) => {
    setHasRegularPhase(on);
    if (on) {
      // Re-enable: restore single regular phase by default
      setIsMultiPhase(false);
      const next = {
        ...config,
        regularPhase: defaultRegularPhase(),
        regularPhases: undefined,
      } as any as LeagueTypeConfig;
      setConfig(next);
      emitChange(true, source, selectedConfigId, next);
    } else {
      // Disable regular phase: ensure final phase is enabled
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { regularPhase: _rp, regularPhases: _rps, ...rest } = config;
      const next = {
        ...rest,
        regularPhase: undefined,
        regularPhases: undefined,
      } as any as LeagueTypeConfig;
      if (!next.finalPhase) {
        next.finalPhase = defaultFinalPhase();
        setHasFinalPhase(true);
      }
      setIsMultiPhase(false);
      setConfig(next);
      emitChange(true, source, selectedConfigId, next);
    }
  };

  return (
    <Card
      title={ct.title}
      size="small"
      extra={
        <Switch
          checked={enabled}
          onChange={handleToggleEnabled}
          checkedChildren={ct.enabled}
          unCheckedChildren={ct.none}
        />
      }
    >
      {!enabled && <Text type="secondary">{ct.noConfigDescription}</Text>}

      {enabled && (
        <>
          <Form.Item label={ct.configSource} style={{ marginBottom: 12 }}>
            <Select
              value={source}
              onChange={handleSourceChange}
              options={[
                { label: ct.useExisting, value: "existing" },
                { label: ct.createNew, value: "new" },
              ]}
              style={{ width: 220 }}
            />
          </Form.Item>

          {source === "existing" && (
            <Form.Item label={ct.selectConfig} style={{ marginBottom: 12 }}>
              <Space.Compact style={{ width: "100%" }}>
                <Select
                  placeholder={ct.selectConfigPlaceholder}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  value={selectedConfigId}
                  options={existingConfigs.map((c) => ({
                    label: c.displayName,
                    value: c._id,
                  }))}
                  onChange={handleSelectExisting}
                  style={{ flex: 1 }}
                />
                {selectedConfigId && (
                  <Button
                    icon={<CopyOutlined />}
                    onClick={handleDuplicateForEdit}
                    title={ct.duplicateTooltip}
                  >
                    {ct.duplicateAndEdit}
                  </Button>
                )}
              </Space.Compact>
            </Form.Item>
          )}

          {source === "new" && (
            <>
              <Form.Item label={ct.displayName} style={{ marginBottom: 8 }}>
                <Input
                  value={config.displayName}
                  onChange={(e) => update({ displayName: e.target.value })}
                  placeholder={ct.displayNamePlaceholder}
                />
              </Form.Item>

              <Form.Item label={ct.teamMode} style={{ marginBottom: 8 }}>
                <Switch
                  checked={config.isTeamMode}
                  onChange={(v) => update({ isTeamMode: v })}
                />
              </Form.Item>

              <Divider titlePlacement="left">{ct.regularPhaseSection}</Divider>

              <Form.Item label={ct.hasRegularPhase} style={{ marginBottom: 8 }}>
                <Switch
                  checked={hasRegularPhase}
                  onChange={handleToggleRegularPhase}
                />
              </Form.Item>

              {hasRegularPhase && (
                <Form.Item
                  label={ct.multiPhaseLeague}
                  style={{ marginBottom: 8 }}
                >
                  <Switch
                    checked={isMultiPhase}
                    onChange={handleToggleMultiPhase}
                  />
                </Form.Item>
              )}

              {hasRegularPhase && !isMultiPhase && config.regularPhase && (
                <Card type="inner" size="small" style={{ marginBottom: 16 }}>
                  <Form.Item label={ct.phaseId} style={{ marginBottom: 8 }}>
                    <Input
                      value={config.regularPhase.id}
                      onChange={(e) =>
                        update({
                          regularPhase: {
                            ...config.regularPhase!,
                            id: e.target.value,
                          },
                        })
                      }
                    />
                  </Form.Item>
                  <ScoringFields
                    scoring={config.regularPhase.scoring}
                    onChange={(scoring) =>
                      update({
                        regularPhase: { ...config.regularPhase!, scoring },
                      })
                    }
                    ct={ct}
                  />
                  <Form.Item
                    label={ct.minGamesToQualify}
                    style={{ marginBottom: 8 }}
                  >
                    <InputNumber
                      min={0}
                      step={1}
                      value={config.regularPhase.minGames}
                      onChange={(v) =>
                        update({
                          regularPhase: {
                            ...config.regularPhase!,
                            minGames: v ?? undefined,
                          },
                        })
                      }
                    />
                  </Form.Item>
                </Card>
              )}

              {hasRegularPhase && isMultiPhase && config.regularPhases && (
                <>
                  {config.regularPhases.map((phase, i) => (
                    <Card
                      key={i}
                      type="inner"
                      size="small"
                      title={`Phase ${i + 1}: ${phase.id}`}
                      style={{ marginBottom: 8 }}
                      extra={
                        config.regularPhases!.length > 2 ? (
                          <Button
                            danger
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => {
                              const next = config.regularPhases!.filter(
                                (_, j) => j !== i
                              );
                              update({ regularPhases: next });
                            }}
                          />
                        ) : undefined
                      }
                    >
                      <Form.Item label={ct.phaseId} style={{ marginBottom: 8 }}>
                        <Input
                          value={phase.id}
                          onChange={(e) => {
                            const next = config.regularPhases!.map((p, j) =>
                              j === i ? { ...p, id: e.target.value } : p
                            );
                            update({ regularPhases: next });
                          }}
                        />
                      </Form.Item>
                      <ScoringFields
                        scoring={phase.scoring}
                        onChange={(scoring) => {
                          const next = config.regularPhases!.map((p, j) =>
                            j === i ? { ...p, scoring } : p
                          );
                          update({ regularPhases: next });
                        }}
                        ct={ct}
                      />
                      <Form.Item
                        label={ct.minGamesToQualify}
                        style={{ marginBottom: 8 }}
                      >
                        <InputNumber
                          min={0}
                          step={1}
                          value={phase.minGames}
                          onChange={(v) => {
                            const next = config.regularPhases!.map((p, j) =>
                              j === i ? { ...p, minGames: v ?? undefined } : p
                            );
                            update({ regularPhases: next });
                          }}
                        />
                      </Form.Item>
                      {i < config.regularPhases!.length - 1 && (
                        <ProgressionFields
                          progression={phase.progression}
                          onChange={(prog) => {
                            const next = config.regularPhases!.map((p, j) =>
                              j === i ? { ...p, progression: prog } : p
                            );
                            update({ regularPhases: next });
                          }}
                          ct={ct}
                        />
                      )}
                    </Card>
                  ))}
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      const id = `phase-${config.regularPhases!.length + 1}`;
                      const phases = [...config.regularPhases!];
                      const lastIndex = phases.length - 1;
                      if (!phases[lastIndex].progression) {
                        phases[lastIndex] = {
                          ...phases[lastIndex],
                          progression: {
                            advancingCount: 8,
                            scoreRetention: { num: 0, den: 1 },
                          },
                        };
                      }
                      update({
                        regularPhases: [...phases, defaultRegularPhase(id)],
                      });
                    }}
                    style={{ marginBottom: 16, width: "100%" }}
                  >
                    {ct.addPhase}
                  </Button>
                </>
              )}

              <Divider titlePlacement="left">{ct.finalPhaseSection}</Divider>

              <Form.Item label={ct.hasFinalPhase} style={{ marginBottom: 8 }}>
                <Switch
                  checked={hasFinalPhase}
                  disabled={!hasRegularPhase}
                  onChange={handleToggleFinalPhase}
                />
              </Form.Item>

              {hasFinalPhase && config.finalPhase && (
                <Card type="inner" size="small" style={{ marginBottom: 16 }}>
                  <Form.Item
                    label={ct.finalPhaseId}
                    style={{ marginBottom: 8 }}
                  >
                    <Input
                      value={config.finalPhase.id}
                      onChange={(e) =>
                        update({
                          finalPhase: {
                            ...config.finalPhase!,
                            id: e.target.value,
                          },
                        })
                      }
                    />
                  </Form.Item>
                  <RationalInput
                    label={ct.regularToFinalsCarryOver}
                    value={config.finalPhase.scoreCarryOver}
                    onChange={(v) =>
                      update({
                        finalPhase: {
                          ...config.finalPhase!,
                          scoreCarryOver: v,
                        },
                      })
                    }
                    disabled={!hasRegularPhase}
                  />
                  <Divider titlePlacement="left" plain>
                    {ct.bracketStages}
                  </Divider>
                  <StageEditor
                    stages={config.finalPhase.stages}
                    onChange={(stages) =>
                      update({
                        finalPhase: { ...config.finalPhase!, stages },
                      })
                    }
                    ct={ct}
                    regularPhaseIds={
                      config.regularPhases?.map((p) => p.id) ??
                      (config.regularPhase ? [config.regularPhase.id] : [])
                    }
                  />
                </Card>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}

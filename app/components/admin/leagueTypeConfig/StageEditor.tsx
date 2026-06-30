import {
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { LeagueTypeConfig } from "../../../services/league-configs/types";
import { RationalInput } from "./RationalInput";
import { defaultFinalStage, type ConfigT } from "./types";

const { Text } = Typography;

type FinalStage = NonNullable<LeagueTypeConfig["finalPhase"]>["stages"][0];

interface StageEditorProps {
  stages: FinalStage[];
  onChange: (s: FinalStage[]) => void;
  ct: ConfigT;
}

export function StageEditor({ stages, onChange, ct }: StageEditorProps) {
  const updateStage = (index: number, patch: Partial<FinalStage>) => {
    const next = stages.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  const removeStage = (index: number) => {
    onChange(stages.filter((_, i) => i !== index));
  };

  const addStage = () => {
    const id = `stage-${stages.length + 1}`;
    onChange([...stages, defaultFinalStage(id)]);
  };

  const stageIdsBefore = (currentIndex: number) =>
    stages.slice(0, currentIndex).map((s) => s.id);

  return (
    <>
      <Collapse
        accordion
        items={stages.map((stage, i) => ({
          key: String(i),
          label: (
            <Space>
              <Text strong>{stage.id || `Stage ${i + 1}`}</Text>
              <Text type="secondary">
                ({stage.gameCount} {ct.gameCount.toLowerCase()})
              </Text>
            </Space>
          ),
          extra:
            stages.length > 1 ? (
              <Button
                danger
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  removeStage(i);
                }}
              />
            ) : undefined,
          children: (
            <div>
              <Form.Item label={ct.stageId} style={{ marginBottom: 8 }}>
                <Input
                  value={stage.id}
                  onChange={(e) => updateStage(i, { id: e.target.value })}
                />
              </Form.Item>
              <Form.Item label={ct.gameCount} style={{ marginBottom: 8 }}>
                <InputNumber
                  min={0}
                  step={1}
                  value={stage.gameCount}
                  onChange={(v) => updateStage(i, { gameCount: v ?? 0 })}
                />
              </Form.Item>
              <Form.Item label={ct.slice} style={{ marginBottom: 8 }}>
                <InputNumber
                  min={0}
                  step={1}
                  value={stage.slice}
                  onChange={(v) =>
                    updateStage(i, { slice: v == null ? undefined : v })
                  }
                  placeholder={ct.slicePlaceholder}
                />
              </Form.Item>
              <Form.Item label={ct.directSeeds} style={{ marginBottom: 8 }}>
                <Input
                  value={stage.seeds.join(", ")}
                  onChange={(e) => {
                    const seeds = e.target.value
                      .split(",")
                      .map((s) => parseInt(s.trim(), 10))
                      .filter((n) => !isNaN(n) && n > 0);
                    updateStage(i, { seeds });
                  }}
                  placeholder={ct.directSeedsPlaceholder}
                />
              </Form.Item>
              <Form.Item label={ct.fromStages} style={{ marginBottom: 8 }}>
                {stage.fromStages.map((edge, j) => {
                  const mode: "top" | "places" =
                    edge.places && edge.places.length > 0 ? "places" : "top";
                  return (
                    <Space key={j} style={{ display: "flex", marginBottom: 4 }}>
                      <Select
                        value={edge.stageId}
                        options={stageIdsBefore(i).map((id) => ({
                          label: id,
                          value: id,
                        }))}
                        onChange={(v) => {
                          const next = stage.fromStages.map((e, k) =>
                            k === j ? { ...e, stageId: v } : e
                          );
                          updateStage(i, { fromStages: next });
                        }}
                        style={{ width: 160 }}
                        placeholder={ct.stageIdPlaceholder}
                      />
                      <Select
                        value={mode}
                        options={[
                          { label: ct.topMode, value: "top" },
                          { label: ct.placesMode, value: "places" },
                        ]}
                        onChange={(v) => {
                          const next = stage.fromStages.map((e, k) => {
                            if (k !== j) {
                              return e;
                            }
                            if (v === "top") {
                              const { places: _places, ...rest } = e;
                              void _places;
                              return { ...rest, topN: e.topN || 1 };
                            }
                            const seed =
                              e.places && e.places.length > 0
                                ? e.places
                                : Array.from(
                                    { length: Math.max(1, e.topN) },
                                    (_, k2) => k2 + 1
                                  );
                            return { ...e, places: seed, topN: seed.length };
                          });
                          updateStage(i, { fromStages: next });
                        }}
                        style={{ width: 160 }}
                      />
                      {mode === "top" ? (
                        <InputNumber
                          min={1}
                          step={1}
                          value={edge.topN}
                          onChange={(v) => {
                            const next = stage.fromStages.map((e, k) =>
                              k === j ? { ...e, topN: v ?? 1 } : e
                            );
                            updateStage(i, { fromStages: next });
                          }}
                          addonBefore={ct.top}
                          style={{ width: 120 }}
                        />
                      ) : (
                        <Input
                          value={(edge.places ?? []).join(", ")}
                          onChange={(e) => {
                            const places = e.target.value
                              .split(",")
                              .map((s) => parseInt(s.trim(), 10))
                              .filter((n) => !isNaN(n) && n > 0);
                            const next = stage.fromStages.map((edg, k) =>
                              k === j
                                ? {
                                    ...edg,
                                    places,
                                    topN: places.length || 1,
                                  }
                                : edg
                            );
                            updateStage(i, { fromStages: next });
                          }}
                          addonBefore={ct.places}
                          placeholder={ct.placesPlaceholder}
                          style={{ width: 200 }}
                        />
                      )}
                      <Button
                        danger
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => {
                          const next = stage.fromStages.filter(
                            (_, k) => k !== j
                          );
                          updateStage(i, { fromStages: next });
                        }}
                      />
                    </Space>
                  );
                })}
                {stageIdsBefore(i).length > 0 && (
                  <Button
                    type="dashed"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      const fromIds = stageIdsBefore(i);
                      updateStage(i, {
                        fromStages: [
                          ...stage.fromStages,
                          { stageId: fromIds[fromIds.length - 1], topN: 2 },
                        ],
                      });
                    }}
                  >
                    {ct.addSourceStage}
                  </Button>
                )}
              </Form.Item>
              {stage.scoreCarryOver != null ? (
                <Space>
                  <RationalInput
                    label={ct.interStageCarryOver}
                    value={stage.scoreCarryOver}
                    onChange={(v) => updateStage(i, { scoreCarryOver: v })}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    onClick={() => {
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const { scoreCarryOver: _sco, ...rest } = stage;
                      updateStage(i, {
                        ...rest,
                        scoreCarryOver: undefined,
                      } as any);
                    }}
                  >
                    {ct.remove}
                  </Button>
                </Space>
              ) : (
                <Button
                  type="dashed"
                  size="small"
                  onClick={() =>
                    updateStage(i, { scoreCarryOver: { num: 0, den: 1 } })
                  }
                >
                  {ct.addInterStageCarryOver}
                </Button>
              )}
            </div>
          ),
        }))}
      />
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={addStage}
        style={{ marginTop: 8, width: "100%" }}
      >
        {ct.addStage}
      </Button>
    </>
  );
}

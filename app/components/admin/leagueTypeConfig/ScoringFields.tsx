import { Form, InputNumber, Select, Space } from "antd";
import type { RegularScoringConfig } from "../../../services/league-configs/types";
import type { ConfigT } from "./types";

interface ScoringFieldsProps {
  scoring: RegularScoringConfig;
  onChange: (s: RegularScoringConfig) => void;
  ct: ConfigT;
}

export function ScoringFields({ scoring, onChange, ct }: ScoringFieldsProps) {
  const s = scoring as any;
  const scoringOptions = [
    { label: ct.teamDeltaCap, value: "team-delta-cap" },
    { label: ct.bestConsecutiveWindow, value: "best-consecutive-window" },
    { label: ct.cumulative, value: "cumulative" },
  ];

  return (
    <>
      <Form.Item label={ct.scoringType} style={{ marginBottom: 8 }}>
        <Select
          options={scoringOptions}
          value={s?.type ?? "cumulative"}
          onChange={(type) => {
            if (type === "team-delta-cap") {
              onChange({ type, capPercent: 0.35, minGamesForCap: 6 });
            } else if (type === "best-consecutive-window") {
              onChange({ type, windowSize: 5 });
            } else {
              onChange({ type });
            }
          }}
        />
      </Form.Item>

      {s?.type === "team-delta-cap" && (
        <Space size="large" wrap>
          <Form.Item label={ct.capPercent} style={{ marginBottom: 8 }}>
            <InputNumber
              min={0.01}
              max={0.99}
              step={0.01}
              value={s.capPercent}
              onChange={(v) => onChange({ ...s, capPercent: v })}
            />
          </Form.Item>
          <Form.Item label={ct.minGamesForCap} style={{ marginBottom: 8 }}>
            <InputNumber
              min={0}
              step={1}
              value={s.minGamesForCap}
              onChange={(v) => onChange({ ...s, minGamesForCap: v })}
            />
          </Form.Item>
        </Space>
      )}

      {s?.type === "best-consecutive-window" && (
        <Space size="large" wrap>
          <Form.Item label={ct.windowSize} style={{ marginBottom: 8 }}>
            <InputNumber
              min={1}
              step={1}
              value={s.windowSize}
              onChange={(v) => onChange({ ...s, windowSize: v })}
            />
          </Form.Item>
          <Form.Item label={ct.qualificationMode} style={{ marginBottom: 8 }}>
            <Select
              allowClear
              placeholder={ct.qualificationModeNone}
              options={[{ label: ct.factionTopN, value: "faction-top-n" }]}
              value={s.qualificationMode ?? undefined}
              onChange={(mode) => {
                if (mode) {
                  onChange({
                    ...s,
                    qualificationMode: mode,
                    qualificationCount: s.qualificationCount ?? 2,
                  });
                } else {
                  /* eslint-disable @typescript-eslint/no-unused-vars */
                  const {
                    qualificationMode: _qm,
                    qualificationCount: _qc,
                    ...rest
                  } = s;
                  /* eslint-enable @typescript-eslint/no-unused-vars */
                  onChange(rest);
                }
              }}
            />
          </Form.Item>
          {s.qualificationMode === "faction-top-n" && (
            <Form.Item
              label={ct.qualificationCount}
              style={{ marginBottom: 8 }}
            >
              <InputNumber
                min={1}
                step={1}
                value={s.qualificationCount}
                onChange={(v) => onChange({ ...s, qualificationCount: v })}
              />
            </Form.Item>
          )}
        </Space>
      )}
    </>
  );
}

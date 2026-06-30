import { Form, InputNumber, Space, Switch } from "antd";
import { RationalInput } from "./RationalInput";
import type { ConfigT } from "./types";

interface ProgressionFieldsProps {
  progression?: {
    advancingCount: number;
    scoreRetention: { num: number; den: number };
  };
  onChange: (
    p:
      | { advancingCount: number; scoreRetention: { num: number; den: number } }
      | undefined
  ) => void;
  ct: ConfigT;
}

export function ProgressionFields({
  progression,
  onChange,
  ct,
}: ProgressionFieldsProps) {
  const hasProgression = progression != null;
  return (
    <>
      <Form.Item label={ct.hasProgression} style={{ marginBottom: 8 }}>
        <Switch
          checked={hasProgression}
          onChange={(on) => {
            if (on) {
              onChange({
                advancingCount: 8,
                scoreRetention: { num: 0, den: 1 },
              });
            } else {
              onChange(undefined);
            }
          }}
        />
      </Form.Item>
      {hasProgression && progression && (
        <Space size="large" wrap>
          <Form.Item label={ct.advancingCount} style={{ marginBottom: 8 }}>
            <InputNumber
              min={1}
              step={1}
              value={progression.advancingCount}
              onChange={(v) =>
                onChange({ ...progression, advancingCount: v ?? 1 })
              }
            />
          </Form.Item>
          <RationalInput
            label={ct.scoreRetention}
            value={progression.scoreRetention}
            onChange={(sr) => onChange({ ...progression, scoreRetention: sr })}
          />
        </Space>
      )}
    </>
  );
}

import { Form, InputNumber, Space } from "antd";

interface RationalInputProps {
  label: string;
  value: { num: number; den: number };
  onChange: (v: { num: number; den: number }) => void;
  disabled?: boolean;
}

export function RationalInput({
  label,
  value,
  onChange,
  disabled,
}: RationalInputProps) {
  return (
    <Form.Item label={label} style={{ marginBottom: 8 }}>
      <Space>
        <InputNumber
          min={0}
          step={1}
          value={value.num}
          onChange={(n) => onChange({ ...value, num: n ?? 0 })}
          style={{ width: 80 }}
          addonAfter="/"
          disabled={disabled}
        />
        <InputNumber
          min={1}
          step={1}
          value={value.den}
          onChange={(d) => onChange({ ...value, den: d ?? 1 })}
          style={{ width: 80 }}
          disabled={disabled}
        />
      </Space>
    </Form.Item>
  );
}

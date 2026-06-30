import { Radio } from "antd";
import { TileSetName } from "./HandImage";

interface TileSetSelectorProps {
  value: TileSetName;
  onChange: (value: TileSetName) => void;
}

export function TileSetSelector({ value, onChange }: TileSetSelectorProps) {
  return (
    <div style={{ textAlign: "center", marginTop: 16 }}>
      <Radio.Group
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        optionType="button"
        buttonStyle="solid"
        options={[
          { label: "Mahjong Soul", value: TileSetName.MahjongSoul },
          { label: "Tenhou", value: TileSetName.Tenhou },
          { label: "Trainer", value: TileSetName.Trainer },
        ]}
      />
    </div>
  );
}

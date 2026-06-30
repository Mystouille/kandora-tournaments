import { NodeViewWrapper } from "@tiptap/react";
import { HandDisplay } from "../mahjong/TileDisplay";
import { useTileSet } from "../../contexts/TileSetContext";

export function MahjongHandNodeView({ node }: { node: any }) {
  const { hand, label } = node.attrs;
  const { tileSet } = useTileSet();
  return (
    <NodeViewWrapper style={{ margin: "12px 0", textAlign: "center" }}>
      {hand && <HandDisplay hand={hand} tileHeight={48} tileSet={tileSet} />}
      {label && (
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>{label}</div>
      )}
    </NodeViewWrapper>
  );
}

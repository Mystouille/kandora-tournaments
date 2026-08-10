import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { HandDisplay } from "../mahjong/TileDisplay";
import { useTileSet } from "../../contexts/TileSetContext";

export function MahjongHandNodeView({ node, extension }: NodeViewProps) {
  const { hand, label } = node.attrs;
  const { tileSet } = useTileSet();
  return (
    <NodeViewWrapper
      style={{ margin: extension.options.margin, textAlign: "center" }}
    >
      {hand && (
        <HandDisplay
          hand={hand}
          tileHeight={extension.options.tileHeight}
          tileSet={tileSet}
        />
      )}
      {label && (
        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>{label}</div>
      )}
    </NodeViewWrapper>
  );
}

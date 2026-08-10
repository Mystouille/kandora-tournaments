import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { TileImage } from "../mahjong/HandImage";
import { useTileSet } from "../../contexts/TileSetContext";

export function MahjongTileNodeView({ node, extension }: NodeViewProps) {
  const { tileSet } = useTileSet();
  return (
    <NodeViewWrapper
      as="span"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        lineHeight: 0,
      }}
    >
      <TileImage
        tile={node.attrs.tile}
        sizeFactor={extension.options.sizeFactor}
        tileSet={tileSet}
      />
    </NodeViewWrapper>
  );
}

import { NodeViewWrapper } from "@tiptap/react";
import { TileImage } from "../mahjong/HandImage";
import { useTileSet } from "../../contexts/TileSetContext";

export function MahjongTileNodeView({ node }: { node: any }) {
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
      <TileImage tile={node.attrs.tile} height={22} tileSet={tileSet} />
    </NodeViewWrapper>
  );
}

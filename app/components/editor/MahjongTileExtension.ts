import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MahjongTileNodeView } from "./MahjongTileNodeView";

export const MahjongTileExtension = Node.create({
  name: "mahjongTile",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      tile: {
        default: "1m",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-tile"),
        renderHTML: (attributes: Record<string, any>) => ({
          "data-tile": attributes.tile,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "mahjong-tile" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mahjong-tile", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MahjongTileNodeView);
  },
});

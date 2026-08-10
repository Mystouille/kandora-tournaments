import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MahjongHandNodeView } from "./MahjongHandNodeView";

export interface MahjongHandOptions {
  tileHeight: number;
  margin: string;
}

export const MahjongHandExtension = Node.create<MahjongHandOptions>({
  name: "mahjongHand",
  group: "block",
  atom: true,
  selectable: false,

  addOptions() {
    return {
      tileHeight: 48,
      margin: "16px 0",
    };
  },

  addAttributes() {
    return {
      hand: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-hand"),
        renderHTML: (attributes: Record<string, any>) => ({
          "data-hand": attributes.hand,
        }),
      },
      label: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-label"),
        renderHTML: (attributes: Record<string, any>) => ({
          "data-label": attributes.label,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "mahjong-hand" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mahjong-hand", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MahjongHandNodeView);
  },
});

import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MahjongTileNodeView } from "./MahjongTileNodeView";
import { splitHandTiles } from "../mahjong/TileDisplay";

/**
 * Matches mahjong shorthand (groups of digits / back-tile `x` markers each
 * ending in a suit letter m/p/s/z) at a word boundary, immediately followed by
 * a single space — e.g. "34s ", "123m456p ", "1z ". The trailing space triggers
 * the rule; the leading `\b` avoids mid-word matches like the "3s" in "mp3s ".
 */
const TILE_INPUT_REGEX = /\b((?:[0-9xX]+[mpsz])+)(\s)$/;

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

  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: TILE_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          const tiles = splitHandTiles(match[1]);
          if (tiles.length === 0) {
            return null;
          }
          const nodes = tiles.map((tile) => type.create({ tile }));
          // Replace the shorthand with tile nodes, then re-add the single
          // trigger space (input rules consume it) so the word gap survives.
          const tr = state.tr.replaceWith(range.from, range.to, nodes);
          tr.insertText(" ", range.from + nodes.length);
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MahjongTileNodeView);
  },
});

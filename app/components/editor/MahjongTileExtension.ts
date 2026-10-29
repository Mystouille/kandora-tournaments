import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MahjongTileNodeView } from "./MahjongTileNodeView";
import { splitHandTiles } from "../mahjong/TileDisplay";

/**
 * Matches suited tile groups with optional called-tile apostrophes, followed by
 * whitespace. The lookbehind prevents matching inside words or after a called
 * marker, e.g. the trailing "5s" inside "mp55'5s ".
 */
const TILE_INPUT_REGEX = /(?<![\w'])((?:(?:[0-9xX]'{0,2})+[mpsz])+)(\s)$/;

export interface MahjongTileOptions {
  sizeFactor: number;
}

export const MahjongTileExtension = Node.create<MahjongTileOptions>({
  name: "mahjongTile",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return {
      sizeFactor: 22 / 14,
    };
  },

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
          const tiles = splitHandTiles(match[1], { preserveCalled: true });
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

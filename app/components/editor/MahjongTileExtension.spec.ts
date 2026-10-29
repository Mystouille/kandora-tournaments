import {
  Editor,
  createChainableState,
  getExtensionField,
  type InputRule,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { MahjongTileExtension } from "./MahjongTileExtension";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) {
    editor.destroy();
  }
  editors.length = 0;
});

function createEditor(text: string) {
  const editor = new Editor({
    element: null,
    extensions: [StarterKit, MahjongTileExtension],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  });
  editors.push(editor);
  const [rule] = getExtensionField<() => InputRule[]>(
    MahjongTileExtension,
    "addInputRules",
    { type: editor.schema.nodes.mahjongTile }
  )();
  if (!(rule.find instanceof RegExp)) {
    throw new Error("Expected a regular-expression tile input rule");
  }
  return { editor, rule, pattern: rule.find };
}

describe("MahjongTileExtension", () => {
  it.each([
    ["5s", ["5s"]],
    ["5's", ["5's"]],
    ["55'5s", ["5s", "5's", "5s"]],
    ["5s5's5s", ["5s", "5's", "5s"]],
    ["1'23m0'p7'z", ["1'm", "2m", "3m", "0'p", "7'z"]],
    ["x'5Xs", ["8'z", "5s", "8z"]],
  ])("converts %s and preserves the following word gap", (notation, tiles) => {
    const text = `Tiles: ${notation}`;
    const { editor, rule, pattern } = createEditor(text);
    const match = pattern.exec(`${text} `);
    if (!match) {
      throw new Error(`Tile input rule did not match ${notation}`);
    }
    const transaction = editor.state.tr;
    rule.handler({
      state: createChainableState({ state: editor.state, transaction }),
      range: { from: 1 + match.index, to: 1 + text.length },
      match,
      commands: editor.commands,
      chain: () => editor.chain(),
      can: () => editor.can(),
    });

    expect(transaction.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Tiles: " },
            ...tiles.map((tile) => ({ type: "mahjongTile", attrs: { tile } })),
            { type: "text", text: " " },
          ],
        },
      ],
    });
  });

  it.each(["mp3s ", "mp5's ", "mp55'5s ", "55'5s", "5'''s "])(
    "does not convert incomplete or mid-word notation: %s",
    (text) => {
      const { pattern } = createEditor(text);
      expect(pattern.test(text)).toBe(false);
    }
  );
});

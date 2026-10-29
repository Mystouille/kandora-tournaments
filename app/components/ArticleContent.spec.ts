import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sanitizeArticleHtml } from "../utils/sanitize.server";
import { ArticleContent } from "./ArticleContent";
import { TileImage } from "./mahjong/HandImage";

vi.mock("../contexts/TileSetContext", () => ({
  useTileSet: () => ({ tileSet: "default" }),
}));

vi.mock("../contexts/GlossaryContext", () => ({
  useGlossary: () => ({ termPattern: null, openTerm: vi.fn() }),
}));

vi.mock("./mahjong/HandImage", () => ({
  TileImage: vi.fn(({ tile }: { tile: string }) =>
    createElement("span", {}, tile)
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ArticleContent inline tiles", () => {
  it.each(["5s", "5's", "0'm", "7'z", "8'z", "5''s"])(
    "displays %s after HTML sanitization",
    (tile) => {
      const html = sanitizeArticleHtml(
        `<p>Before <mahjong-tile data-tile="${tile}"></mahjong-tile> after</p>`
      );
      const rendered = renderToStaticMarkup(
        createElement(ArticleContent, { html })
      );

      expect(
        vi.mocked(TileImage).mock.calls.map(([props]) => props.tile)
      ).toEqual([tile]);
      expect(rendered).toContain("Before ");
      expect(rendered).toContain(" after");
      expect(rendered).not.toContain("<mahjong-tile");
    }
  );

  it.each(["", "55'5s", "5'''s", "5's<script>", "5q"])(
    "does not render invalid tile attributes: %s",
    (tile) => {
      renderToStaticMarkup(
        createElement(ArticleContent, {
          html: `<p><mahjong-tile data-tile="${tile}"></mahjong-tile></p>`,
        })
      );
      expect(TileImage).not.toHaveBeenCalled();
    }
  );
});

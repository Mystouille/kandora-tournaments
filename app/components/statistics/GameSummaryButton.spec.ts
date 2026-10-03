import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "~/contexts/LocaleContext";
import { basePath } from "~/utils/basePath";
import { GameSummaryButton } from "./GameSummaryButton";

describe("completed game summary navigation", () => {
  it("links the database game ID and preserves the filtered return page", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, {
        initialEntries: [
          "/online-tournaments/summer/statistics/games?team=cranes",
        ],
        children: createElement(LocaleProvider, {
          initialLocale: "en",
          children: createElement(GameSummaryButton, { gameId: "database-id" }),
        }),
      })
    );
    expect(html).toContain(
      `href="${basePath}/games/database-id/summary?from=%2Fonline-tournaments%2Fsummer%2Fstatistics%2Fgames%3Fteam%3Dcranes"`
    );
    expect(html).toContain('aria-label="Game summary"');
  });
});

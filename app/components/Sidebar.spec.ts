import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

vi.mock("../contexts/ThemeContext", () => ({
  useAppTheme: () => ({
    isDark: false,
    customTokens: {
      siderBg: "#fff",
      logoPathMobileLight: "/logo-light.png",
      logoPathMobileDark: "/logo-dark.png",
    },
  }),
}));

vi.mock("../contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: {
      nav: {
        tournaments: "Tournaments",
        gameLobby: "Game lobby",
        onlineTools: "Analysis tools",
        replayTools: "Open replay",
        myReplays: "My replays",
      },
      onlineTournaments: {
        navInfo: "Information",
        navStatistics: "Statistics",
      },
      admin: { title: "Administration" },
    },
  }),
}));

vi.mock("./LogoDisplay", () => ({ LogoDisplay: () => null }));

function renderSidebar(
  currentUser: Record<string, never> | null,
  selectedTournament?: { slug: string; name: string }
): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/"] },
      createElement(Sidebar, {
        collapsed: false,
        currentUser,
        selectedTournament,
      })
    )
  );
}

describe("Sidebar", () => {
  it("hides the lobby from signed-out users", () => {
    const html = renderSidebar(null);

    expect(html).not.toContain("Game lobby");
    expect(html).not.toContain('href="/lobby"');
  });

  it("links signed-in users to the game lobby", () => {
    const html = renderSidebar({});

    expect(html).toContain("Game lobby");
    expect(html).toContain('href="/lobby"');
  });

  it("shows My replays only to signed-in users", () => {
    const signedOutHtml = renderSidebar(null);
    const signedInHtml = renderSidebar({});

    expect(signedOutHtml).toContain("Open replay");
    expect(signedOutHtml).not.toContain("My replays");
    expect(signedInHtml).toContain('href="/my-replays"');
  });

  it("groups tournament links under the selected tournament name", () => {
    const html = renderSidebar(
      {},
      {
        slug: "spring-cup",
        name: "Spring Cup",
      }
    );

    const tournamentMenuIndex = html.indexOf("Spring Cup");
    const informationIndex = html.indexOf(
      'href="/online-tournaments/spring-cup/presentation"'
    );
    const statisticsIndex = html.indexOf(
      'href="/online-tournaments/spring-cup/statistics"'
    );
    const lobbyIndex = html.indexOf('href="/lobby"');

    expect(html).toContain("Spring Cup");
    expect(tournamentMenuIndex).toBeLessThan(informationIndex);
    expect(informationIndex).toBeLessThan(statisticsIndex);
    expect(statisticsIndex).toBeLessThan(lobbyIndex);
  });
});

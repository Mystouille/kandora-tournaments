import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileReplays, ReplayLibraryList } from "./MobileReplays";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mobile replay library view", () => {
  it("renders both modes, the filter control, and compact columns", () => {
    const html = renderToStaticMarkup(
      createElement(MobileReplays, {
        replayStore: null,
        storageState: "loading",
        webAppBaseUrl: "https://play.example.com",
        authSession: null,
        authPending: false,
        onBack: vi.fn(),
        onSignIn: vi.fn(),
        onUnauthorized: vi.fn(),
      })
    );

    expect(html).toContain("Offline");
    expect(html).toContain("Online");
    expect(html).toContain('aria-label="Filters"');
    expect(html).toContain("Date");
    expect(html).toContain("Players / Result");
    expect(html).toContain("Context");
    expect(html).toContain("Rules");
    expect(html).not.toContain("Import replay");
    expect(html).not.toContain("table-canvas");
  });

  it("disables Online mode when the device is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });

    const html = renderToStaticMarkup(
      createElement(MobileReplays, {
        replayStore: null,
        storageState: "loading",
        webAppBaseUrl: "https://play.example.com",
        authSession: null,
        authPending: false,
        onBack: vi.fn(),
        onSignIn: vi.fn(),
        onUnauthorized: vi.fn(),
      })
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Online<\/button>/);
    expect(html).toContain(
      'title="Online replays require an internet connection"'
    );
  });

  it("renders rows as non-interactive until an open handler exists", () => {
    const html = renderToStaticMarkup(
      createElement(ReplayLibraryList, {
        rows: [
          {
            key: "offline:ingame:one",
            mode: "offline",
            source: "ingame",
            sourceGameId: "one",
            replayUrl: null,
            gameDate: 1_700_000_000_000,
            seats: [
              {
                seat: 0,
                displayName: "Alice",
                finalScore: 40_000,
                place: 1,
              },
            ],
            context: { kind: "friendly" },
            ruleset: { id: "m-league", label: "M-League" },
            reasons: [],
          },
        ],
      })
    );

    expect(html).toContain("Alice");
    expect(html).toContain("M-League");
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex="0"');
  });
});

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
            groupKey: "offline:ingame:one",
            kind: "replay",
            mode: "offline",
            source: "ingame",
            sourceGameId: "one",
            reviewShortId: null,
            reviewedPlayerName: null,
            commentCount: 0,
            treeBranch: null,
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

  it("makes the full row keyboard-openable when a viewer handler exists", () => {
    const html = renderToStaticMarkup(
      createElement(ReplayLibraryList, {
        rows: [
          {
            key: "online:tenhou:one",
            groupKey: "online:tenhou:one",
            kind: "replay",
            mode: "online",
            source: "tenhou",
            sourceGameId: "one",
            reviewShortId: null,
            reviewedPlayerName: null,
            commentCount: 0,
            treeBranch: null,
            replayUrl: "/watch/replay/one",
            gameDate: 1_700_000_000_000,
            seats: [],
            context: { kind: "external" },
            ruleset: { id: "platform:tenhou", label: "Tenhou" },
            reasons: ["played"],
          },
        ],
        onOpenReplay: vi.fn(),
      })
    );

    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("is-interactive");
  });

  it("renders an online review as a distinct openable child row", () => {
    const html = renderToStaticMarkup(
      createElement(ReplayLibraryList, {
        rows: [
          {
            key: "tenhou:one:review:review-one",
            groupKey: "tenhou:one",
            kind: "review",
            mode: "online",
            source: "tenhou",
            sourceGameId: "one",
            reviewShortId: "review-one",
            reviewedPlayerName: "Alice",
            commentCount: 2,
            treeBranch: "last",
            replayUrl: "/watch/replay/one",
            gameDate: 1_700_000_000_000,
            seats: [],
            context: { kind: "external" },
            ruleset: { id: "platform:tenhou", label: "Tenhou" },
            reasons: ["reviewed"],
          },
        ],
        onOpenReplay: vi.fn(),
      })
    );

    expect(html).toContain('aria-label="Open Review of Alice"');
    expect(html).toContain("Review of Alice");
    expect(html).toContain("2 comments");
    expect(html).toContain("is-review");
  });
});

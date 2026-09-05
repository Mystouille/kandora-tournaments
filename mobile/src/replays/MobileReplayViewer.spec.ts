import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  MobileReplayDisplayMenu,
  MobileReplayNavigationMenu,
  MobileReplayViewer,
  replayNavigationState,
} from "./MobileReplayViewer";

const log = {
  source: "ingame" as const,
  sourceGameId: "game-1",
  ruleSet: "m-league",
  startedAt: 1_000,
  endedAt: 2_000,
  seats: [0, 1, 2, 3].map((seat) => ({
    seat: seat as 0 | 1 | 2 | 3,
    displayName: `Player ${seat}`,
    finalScore: 40_000 - seat * 10_000,
    place: (seat + 1) as 1 | 2 | 3 | 4,
  })),
  events: [],
  schemaVersion: 6,
};

describe("mobile replay viewer", () => {
  it("resolves previous and next round boundaries", () => {
    expect(replayNavigationState([2, 10, 20], 12)).toEqual({
      currentRoundIndex: 1,
      previousRound: 2,
      nextRound: 20,
    });
    expect(replayNavigationState([2], 1)).toEqual({
      currentRoundIndex: -1,
      previousRound: null,
      nextRound: null,
    });
  });

  it("keeps navigation controls inside the right-side menu", () => {
    const html = renderToStaticMarkup(
      createElement(MobileReplayNavigationMenu, {
        expanded: true,
        handTop: 300,
        log,
        index: -1,
        focusSeat: 0,
        rounds: [],
        bounds: { min: -1, max: -1 },
        onExpandedChange: vi.fn(),
        onFocusSeatChange: vi.fn(),
        onGoTo: vi.fn(),
        onStep: vi.fn(),
      })
    );

    expect(html).toContain('aria-label="Replay navigation"');
    expect(html).toContain('aria-label="Focus player"');
    expect(html).toContain('aria-label="Previous event"');
    expect(html).toContain('aria-label="Next round"');
  });

  it("renders square display toggles behind the left eye control", () => {
    const html = renderToStaticMarkup(
      createElement(MobileReplayDisplayMenu, {
        expanded: true,
        handTop: 300,
        options: {
          showWaits: false,
          showHands: true,
          showTsumogiri: false,
          showNames: true,
        },
        onExpandedChange: vi.fn(),
        onToggle: vi.fn(),
      })
    );

    expect(html).toContain('aria-label="Replay display options"');
    expect(html).toContain('aria-label="Hide display options"');
    expect(html).toContain('aria-label="Waits"');
    expect(html).toContain('aria-label="Names"');
  });

  it("shows a retryable loading shell before the log is available", () => {
    const html = renderToStaticMarkup(
      createElement(MobileReplayViewer, {
        log: null,
        loading: false,
        error: "Replay unavailable",
        onClose: vi.fn(),
        onRetry: vi.fn(),
      })
    );

    expect(html).toContain("Replay unavailable");
    expect(html).toContain("Try again");
    expect(html).toContain('aria-label="Back to replays"');
  });
});

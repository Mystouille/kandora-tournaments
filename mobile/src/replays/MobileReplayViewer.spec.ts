import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  MobileReplayDisplayMenu,
  MobileReplayCommentsOverlay,
  MobileReplayNavigationMenu,
  MobileReplayViewer,
  replayCommentNavigationState,
  replayNavigationState,
  replaySeatEnrichmentForFocus,
  reviewCommentIndices,
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
  it("rotates team enrichment with the focused player", () => {
    const enrichment = [
      { teamName: "Team 0", teamLogoUrl: "https://app.test/0.webp" },
      { teamName: "Team 1", teamLogoUrl: "https://app.test/1.webp" },
      null,
      { teamName: "Team 3", teamLogoUrl: null },
    ];

    expect(replaySeatEnrichmentForFocus(enrichment, 1)).toEqual([
      enrichment[1],
      enrichment[2],
      enrichment[3],
      enrichment[0],
    ]);
  });

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

  it("indexes annotations and resolves strict previous and next comments", () => {
    const review = {
      shortId: "review-1",
      seat: 0,
      targetName: "Player 0",
      edits: [
        {
          eventIndex: 8,
          authorName: "A",
          colorIndex: 0,
          text: "<p>Later</p>",
          drawingBase64: null,
          updatedAt: "2026-01-02T03:04:05.000Z",
        },
        {
          eventIndex: 2,
          authorName: "B",
          colorIndex: 1,
          text: "",
          drawingBase64: "AQAA",
          updatedAt: "2026-01-02T03:04:05.000Z",
        },
        {
          eventIndex: 8,
          authorName: "B",
          colorIndex: 1,
          text: "<p>Same move</p>",
          drawingBase64: null,
          updatedAt: "2026-01-02T03:04:05.000Z",
        },
      ],
    };

    expect(reviewCommentIndices(review)).toEqual([2, 8]);
    expect(replayCommentNavigationState([2, 8], 5)).toEqual({
      previousComment: 2,
      nextComment: 8,
    });
    expect(replayCommentNavigationState([2, 8], 8)).toEqual({
      previousComment: 2,
      nextComment: null,
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
        commentIndices: [2, 8],
        onExpandedChange: vi.fn(),
        onFocusSeatChange: vi.fn(),
        onGoTo: vi.fn(),
        onStep: vi.fn(),
      })
    );

    expect(html).toContain('aria-label="Replay navigation"');
    expect(html).toContain('aria-label="Focus player"');
    expect(html).toContain('aria-label="Previous move"');
    expect(html).toContain('aria-label="Next round"');
    expect(html).toContain('aria-label="Previous comment"');
    expect(html).toContain('aria-label="Next comment"');
    expect(html.indexOf('aria-label="Previous round"')).toBeLessThan(
      html.indexOf('aria-label="Previous move"')
    );
    expect(html.indexOf('aria-label="Previous move"')).toBeLessThan(
      html.indexOf('aria-label="Next move"')
    );
    expect(html.indexOf('aria-label="Next move"')).toBeLessThan(
      html.indexOf('aria-label="Next round"')
    );
    expect(html.indexOf('aria-label="Next round"')).toBeLessThan(
      html.indexOf('aria-label="Previous comment"')
    );
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
        reviewAvailable: true,
        commentsVisible: true,
        onExpandedChange: vi.fn(),
        onToggle: vi.fn(),
      })
    );

    expect(html).toContain('aria-label="Replay display options"');
    expect(html).toContain('aria-label="Hide display options"');
    expect(html).toContain('aria-label="Waits"');
    expect(html).toContain('aria-label="Names"');
    expect(html).toContain('aria-label="Hide review comments"');
    expect(html.indexOf('aria-label="Hide display options"')).toBeLessThan(
      html.indexOf('aria-label="Hide review comments"')
    );
  });

  it("renders current review text in the full-screen comment region", () => {
    const html = renderToStaticMarkup(
      createElement(MobileReplayCommentsOverlay, {
        targetName: "Player 2",
        edits: [
          {
            eventIndex: 4,
            authorName: "Reviewer",
            colorIndex: 0,
            text: '<p>Keep <mahjong-tile data-tile="5m"></mahjong-tile>.</p>',
            drawingBase64: null,
            updatedAt: "2026-01-02T03:04:05.000Z",
          },
        ],
      })
    );

    expect(html).toContain('aria-label="Review comments"');
    expect(html).toContain("Review of Player 2");
    expect(html).toContain("Reviewer");
    expect(html).toContain("Keep");
    expect(html).toContain('aria-label="5m"');
  });

  it("shows a retryable loading shell before the log is available", () => {
    const html = renderToStaticMarkup(
      createElement(MobileReplayViewer, {
        log: null,
        seatEnrichment: [null, null, null, null],
        review: null,
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

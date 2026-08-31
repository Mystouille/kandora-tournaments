import { describe, expect, it } from "vitest";
import {
  MY_REPLAY_COLUMN_DISPLAY_ORDER,
  defaultMyReplayTablePreferences,
  fitMyReplayColumns,
  longestHeaderWordLength,
  mergeMyReplayHeaderFilters,
  parseMyReplayTablePreferences,
  resolveMyReplayColumnWidths,
} from "./myReplayTableConfig";

describe("My Replays table preferences", () => {
  it("uses the requested column display order without Type", () => {
    expect(MY_REPLAY_COLUMN_DISPLAY_ORDER).toEqual([
      "gameDate",
      "context",
      "platform",
      "links",
      "ruleset",
      "reason",
      "lastModified",
      "comments",
    ]);
  });

  it("falls back safely for missing or malformed storage", () => {
    expect(parseMyReplayTablePreferences(null)).toEqual(
      defaultMyReplayTablePreferences()
    );
    expect(parseMyReplayTablePreferences("not-json")).toEqual(
      defaultMyReplayTablePreferences()
    );
  });

  it("restores valid filters, sorting, columns, and page size", () => {
    const preferences = parseMyReplayTablePreferences(
      JSON.stringify({
        filters: {
          gameDateRange: [100, 200],
          lastModifiedRange: [300, 400],
          platforms: ["tenhou", "invalid"],
          // Legacy preference is intentionally ignored after removing Type.
          rowTypes: ["review"],
          reasons: ["commented"],
          contexts: ["external"],
          rulesets: ["wrc"],
        },
        sort: { field: "lastModified", order: "ascend" },
        enabledColumns: ["gameDate", "context", "links", "type", "invalid"],
        pageSize: 50,
      })
    );

    expect(preferences).toEqual({
      filters: {
        gameDateRange: [100, 200],
        lastModifiedRange: [300, 400],
        platforms: ["tenhou"],
        reasons: ["commented"],
        contexts: ["external"],
        rulesets: ["wrc"],
      },
      sort: { field: "lastModified", order: "ascend" },
      enabledColumns: ["gameDate", "context", "links"],
      pageSize: 50,
    });
  });

  it("never restores an empty column selection", () => {
    expect(
      parseMyReplayTablePreferences(
        JSON.stringify({ enabledColumns: ["invalid"] })
      ).enabledColumns
    ).toEqual(MY_REPLAY_COLUMN_DISPLAY_ORDER);
  });
});

describe("My Replays responsive columns", () => {
  it("uses the longest complete header word as the minimum width", () => {
    expect(longestHeaderWordLength("Dernière modification")).toBe(12);
    const widths = resolveMyReplayColumnWidths({
      gameDate: "Date de la partie",
      context: "Contexte",
      platform: "Plateforme",
      links: "Liens",
      ruleset: "Règles",
      reason: "Raison",
      lastModified: "Dernière modification",
      comments: "Commentaires",
    });

    expect(widths.platform).toBeGreaterThanOrEqual(146);
    expect(widths.gameDate).toBe(220);
    expect(widths.lastModified).toBeGreaterThanOrEqual(184);
    expect(widths.comments).toBeGreaterThanOrEqual(140);
  });

  it("admits columns in priority order and never clips the next column", () => {
    expect(fitMyReplayColumns(MY_REPLAY_COLUMN_DISPLAY_ORDER, 450)).toEqual([
      "gameDate",
    ]);
    expect(fitMyReplayColumns(MY_REPLAY_COLUMN_DISPLAY_ORDER, 800)).toEqual([
      "gameDate",
      "context",
      "links",
      "lastModified",
    ]);
  });

  it("lets users surface a lower-priority column by hiding others", () => {
    expect(fitMyReplayColumns(["links", "reason"], 500)).toEqual([
      "links",
      "reason",
    ]);
  });

  it("reclaims the expand-column width when no reviews are visible", () => {
    expect(fitMyReplayColumns(["gameDate", "links"], 450, false)).toEqual([
      "gameDate",
      "links",
    ]);
    expect(fitMyReplayColumns(["gameDate", "links"], 450, true)).toEqual([
      "gameDate",
    ]);
  });

  it("fits against the resolved localized header widths", () => {
    const widths = resolveMyReplayColumnWidths({
      gameDate: "Game date",
      context: "Context",
      platform: "Platform",
      links: "Links",
      ruleset: "Ruleset",
      reason: "Reason",
      lastModified: "Last modified",
      comments: "Comments",
    });

    expect(
      fitMyReplayColumns(
        MY_REPLAY_COLUMN_DISPLAY_ORDER,
        widths.gameDate + widths.links + 48,
        true,
        widths
      )
    ).toEqual(["gameDate", "links"]);
  });

  it("keeps Last Modified visible in the French desktop layout", () => {
    const widths = resolveMyReplayColumnWidths({
      gameDate: "Date de la partie",
      context: "Contexte",
      platform: "Plateforme",
      links: "Liens",
      ruleset: "Règles",
      reason: "Raison",
      lastModified: "Dernière modification",
      comments: "Commentaires",
    });
    const fitted = fitMyReplayColumns(
      MY_REPLAY_COLUMN_DISPLAY_ORDER,
      1392,
      true,
      widths
    );

    expect(fitted).toContain("lastModified");
    expect(fitted).not.toContain("comments");
  });
});

describe("My Replays header filter synchronization", () => {
  it("updates reported headers without clearing hidden-column filters", () => {
    const current = defaultMyReplayTablePreferences().filters;
    current.platforms = ["tenhou"];
    current.reasons = ["created"];
    current.contexts = ["external"];

    expect(
      mergeMyReplayHeaderFilters(current, {
        platform: ["majsoul"],
        ruleset: ["wrc"],
      })
    ).toMatchObject({
      platforms: ["majsoul"],
      rulesets: ["wrc"],
      reasons: ["created"],
      contexts: ["external"],
    });
  });

  it("clears a filter when its visible header reports null", () => {
    const current = defaultMyReplayTablePreferences().filters;
    current.reasons = ["played"];

    expect(
      mergeMyReplayHeaderFilters(current, { reason: null }).reasons
    ).toEqual([]);
  });
});

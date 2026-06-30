import { describe, expect, it } from "vitest";
import { isGameScored } from "./leagueUtils";

describe("isGameScored", () => {
  it("treats a fully scored game (real places) as scored", () => {
    const results = [
      { score: 38200, place: 1 },
      { score: 28900, place: 2 },
      { score: 27600, place: 3 },
      { score: 5300, place: 4 },
    ];

    expect(isGameScored(results)).toBe(true);
  });

  it("treats a placeholder game (all places 0) as not scored", () => {
    // Mirrors a Riichi City Game document created from listing metadata before
    // its log is hydrated: every score and place is zero.
    const results = [
      { score: 0, place: 0 },
      { score: 0, place: 0 },
      { score: 0, place: 0 },
      { score: 0, place: 0 },
    ];

    expect(isGameScored(results)).toBe(false);
  });

  it("treats a partially hydrated game (some place still 0) as not scored", () => {
    const results = [
      { score: 38200, place: 1 },
      { score: 28900, place: 2 },
      { score: 27600, place: 3 },
      { score: 5300, place: 0 },
    ];

    expect(isGameScored(results)).toBe(false);
  });

  it("returns false for empty or missing results", () => {
    expect(isGameScored([])).toBe(false);
    expect(isGameScored(undefined)).toBe(false);
    expect(isGameScored(null)).toBe(false);
  });
});

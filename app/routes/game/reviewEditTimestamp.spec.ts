import { describe, expect, it } from "vitest";
import { formatReviewEditTimestamp } from "./reviewEditTimestamp";

describe("formatReviewEditTimestamp", () => {
  it("formats the comment timestamp in English", () => {
    const formatted = formatReviewEditTimestamp(
      "2026-08-27T12:34:00",
      "en"
    );

    expect(formatted).toContain("Aug");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("12:34");
  });

  it("formats the comment timestamp in French", () => {
    const formatted = formatReviewEditTimestamp(
      "2026-08-27T12:34:00",
      "fr"
    );

    expect(formatted).toContain("août");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("12:34");
  });

  it("omits invalid legacy timestamps", () => {
    expect(formatReviewEditTimestamp("not-a-date", "en")).toBeNull();
  });
});

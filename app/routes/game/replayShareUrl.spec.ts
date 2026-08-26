import { describe, expect, it } from "vitest";
import { buildReplayViewerShareUrl } from "./replayShareUrl";

const currentUrl =
  "https://tournaments.example/watch/replay/game-123?from=%2Fstatistics%3Ftab%3Dgames&seat=3#drawing";

describe("buildReplayViewerShareUrl", () => {
  it("omits the opener path from copied Share URLs", () => {
    const url = new URL(
      buildReplayViewerShareUrl(currentUrl, {
        seat: 1,
        round: 4,
        event: 72,
        review: "review-abc",
      })
    );

    expect(url.searchParams.has("from")).toBe(false);
    expect(url.hash).toBe("");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      seat: "1",
      round: "4",
      event: "72",
      review: "review-abc",
    });
  });

  it("omits the opener path from copied Publish URLs", () => {
    const url = new URL(
      buildReplayViewerShareUrl(currentUrl, {
        event: 72,
        review: "review-abc",
      })
    );

    expect(url.searchParams.has("from")).toBe(false);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      event: "72",
      review: "review-abc",
    });
  });
});
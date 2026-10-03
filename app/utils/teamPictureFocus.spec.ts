import { describe, expect, it } from "vitest";
import {
  teamWatermarkFocusOffset,
  TEAM_WATERMARK_ZOOM,
} from "./teamPictureFocus";

describe("team watermark focus geometry", () => {
  it.each([
    [595, 148],
    [465, 112],
    [735, 92],
  ])(
    "centers the selected source line in a %s by %s watermark",
    (width, height) => {
      const sourceWidth = 800;
      const sourceHeight = 800;
      const coveredHeight =
        sourceHeight * Math.max(width / sourceWidth, height / sourceHeight);
      for (const centerY of [0.25, 0.5, 0.75]) {
        const offset = teamWatermarkFocusOffset(
          sourceWidth,
          sourceHeight,
          width,
          height,
          centerY
        );
        const visibleLineY =
          (height - coveredHeight * TEAM_WATERMARK_ZOOM) / 2 +
          (offset + centerY * coveredHeight) * TEAM_WATERMARK_ZOOM;
        expect(visibleLineY).toBeCloseTo(height / 2, 8);
      }
    }
  );

  it("retains the existing center crop by default", () => {
    expect(teamWatermarkFocusOffset(800, 800, 595, 148, 0.5)).toBe(0);
  });

  it.each([
    [800, 800],
    [1600, 200],
  ])(
    "keeps edge-focused crops inside a %s by %s source, including extra zoom",
    (sourceWidth, sourceHeight) => {
      const width = 595;
      const height = 148;
      const coveredHeight =
        sourceHeight * Math.max(width / sourceWidth, height / sourceHeight);
      for (const centerY of [0, 1]) {
        const offset = teamWatermarkFocusOffset(
          sourceWidth,
          sourceHeight,
          width,
          height,
          centerY
        );
        const top =
          (height - coveredHeight * TEAM_WATERMARK_ZOOM) / 2 +
          offset * TEAM_WATERMARK_ZOOM;
        expect(top).toBeLessThanOrEqual(0.000001);
        expect(
          top + coveredHeight * TEAM_WATERMARK_ZOOM
        ).toBeGreaterThanOrEqual(height - 0.000001);
      }
    }
  );

  it.each([-1, 2, NaN, Infinity])("rejects invalid focus %s", (value) => {
    expect(() => teamWatermarkFocusOffset(800, 800, 595, 148, value)).toThrow();
  });

  it("rejects unloaded or invalid image dimensions", () => {
    expect(() => teamWatermarkFocusOffset(0, 800, 595, 148, 0.5)).toThrow();
    expect(() => teamWatermarkFocusOffset(800, 800, 595, 0, 0.5)).toThrow();
  });
});

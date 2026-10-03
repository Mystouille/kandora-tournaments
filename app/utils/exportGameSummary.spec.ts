import { describe, expect, it } from "vitest";
import {
  gameSummaryExportScale,
  gameSummaryFilename,
} from "./exportGameSummary";

describe("game summary PNG export", () => {
  it("keeps normal broadcast screens at 1920 by 1080", () => {
    expect(gameSummaryExportScale(1920, 1080)).toBe(1);
  });

  it("scales very tall tables proportionally without cropping or dropping rows", () => {
    const width = 1920;
    const height = 50000;
    const scale = gameSummaryExportScale(width, height);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
    expect(height * scale).toBeLessThanOrEqual(16384);
    expect(width * height * scale ** 2).toBeLessThanOrEqual(16_000_000);
    expect((width * scale) / (height * scale)).toBeCloseTo(width / height);
  });

  it.each([0, -1, Infinity, NaN])(
    "rejects invalid export dimensions: %s",
    (value) => {
      expect(() => gameSummaryExportScale(1920, value)).toThrow(
        "invalid dimensions"
      );
    }
  );

  it("builds portable image filenames", () => {
    expect(gameSummaryFilename("../Ligue été: partie? /stats")).toBe(
      "game-summary-Ligue-ete-partie-stats.png"
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  buildRankingData,
  isEliminatedOnDay,
  type Series,
} from "./scoreEvolutionData";

describe("score evolution data", () => {
  it("only treats a team as eliminated from its phase boundary", () => {
    expect(isEliminatedOnDay("2026-09-01", "2026-08-31")).toBe(false);
    expect(isEliminatedOnDay("2026-09-01", "2026-09-01")).toBe(true);
    expect(isEliminatedOnDay(undefined, "2026-09-01")).toBe(false);
  });

  it("ranks qualified teams before eliminated teams after the boundary", () => {
    const series: Series[] = [
      {
        id: "high-eliminated",
        label: "High Eliminated",
        eliminatedAt: "2026-09-01",
        data: [
          { x: "2026-08-31", y: 100 },
          { x: "2026-09-01", y: 100 },
          { x: "2026-09-02", y: 100 },
        ],
      },
      {
        id: "qualified",
        label: "Qualified",
        data: [
          { x: "2026-08-31", y: 50 },
          { x: "2026-09-01", y: 40 },
          { x: "2026-09-02", y: 30 },
        ],
      },
      {
        id: "lower-qualified",
        label: "Lower Qualified",
        data: [
          { x: "2026-08-31", y: 0 },
          { x: "2026-09-01", y: -10 },
          { x: "2026-09-02", y: -20 },
        ],
      },
    ];

    expect(buildRankingData(series)).toEqual([
      {
        id: "High Eliminated",
        data: [
          { x: "2026-08-31", y: 1 },
          { x: "2026-09-01", y: 3 },
          { x: "2026-09-02", y: 3 },
        ],
      },
      {
        id: "Qualified",
        data: [
          { x: "2026-08-31", y: 2 },
          { x: "2026-09-01", y: 1 },
          { x: "2026-09-02", y: 1 },
        ],
      },
      {
        id: "Lower Qualified",
        data: [
          { x: "2026-08-31", y: 3 },
          { x: "2026-09-01", y: 2 },
          { x: "2026-09-02", y: 2 },
        ],
      },
    ]);
  });
});

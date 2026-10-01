import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Series } from "../ScoreEvolutionChart";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  breakdown: vi.fn(),
  evolution: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("../ScoreBreakdownChart", () => ({ default: mocks.breakdown }));
vi.mock("../ScoreEvolutionChart", () => ({ default: mocks.evolution }));
vi.mock("../../utils/basePath", () => ({ basePath: "" }));

import GraphsTab from "./GraphsTab";

function renderGraph(
  overrides: Partial<ComponentProps<typeof GraphsTab>> = {}
) {
  renderToStaticMarkup(
    createElement(GraphsTab, {
      leagueIds: ["league-1"],
      entityType: "team",
      entityIds: [],
      phaseFilter: "both",
      startDate: null,
      endDate: null,
      eliminatedEntityIds: ["eliminated-team"],
      ...overrides,
    })
  );
}

describe("GraphsTab phase selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useQuery.mockReturnValue({ data: [], isLoading: false, error: null });
    mocks.breakdown.mockReturnValue(null);
    mocks.evolution.mockReturnValue(null);
  });

  it("includes the selected phase and empty-selection entity mode in the query", async () => {
    const startDate = "2026-09-24T05:00:00.000Z";
    renderGraph({ phaseFilter: "phase1", entityType: "player", startDate });
    const query: { queryKey: string[]; queryFn: () => Promise<Series[]> } =
      mocks.useQuery.mock.calls[0][0];
    const params = new URLSearchParams(query.queryKey[1]);
    expect(params.get("phaseFilter")).toBe("phase1");
    expect(params.get("entityType")).toBe("player");
    expect(params.get("startDate")).toBe(startDate);
    expect(params.has("playerIds")).toBe(false);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ series: [] }));
    try {
      await query.queryFn();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/score-evolution?${query.queryKey[1]}`
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("uses different cache keys for phase selection even with identical dates", () => {
    renderGraph();
    renderGraph({ phaseFilter: "phase0" });

    expect(mocks.useQuery.mock.calls[0][0].queryKey).not.toEqual(
      mocks.useQuery.mock.calls[1][0].queryKey
    );
  });

  it.each(["both", "phase0", "phase1"] as const)(
    "only applies current elimination styling to all-phases graphs (%s)",
    (phaseFilter) => {
      renderGraph({ phaseFilter });

      const expectedIds =
        phaseFilter === "both" ? ["eliminated-team"] : undefined;
      expect(mocks.breakdown.mock.calls[0][0].eliminatedEntityIds).toEqual(
        expectedIds
      );
      expect(mocks.evolution.mock.calls[0][0].eliminatedEntityIds).toEqual(
        expectedIds
      );
    }
  );
});

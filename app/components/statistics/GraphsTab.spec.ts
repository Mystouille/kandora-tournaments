import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Series } from "../scoreEvolutionData";

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

  it("passes phase-aware elimination metadata through to both charts", () => {
    const series: Series[] = [
      {
        id: "eliminated-team",
        label: "Eliminated Team",
        eliminatedAt: "2026-09-01",
        data: [{ x: "2026-08-31", y: 42 }],
      },
    ];
    mocks.useQuery.mockReturnValue({
      data: series,
      isLoading: false,
      error: null,
    });

    renderGraph();

    expect(mocks.breakdown.mock.calls[0][0].series).toEqual(series);
    expect(mocks.evolution.mock.calls[0][0].series).toEqual(series);
  });

  it("decorates filtered team series by stable team ID for both charts", () => {
    const series: Series[] = [
      {
        id: "second-team",
        label: "Renamed Team",
        eliminatedAt: "2026-09-01",
        data: [{ x: "2026-08-31", y: 42 }],
      },
    ];
    mocks.useQuery.mockReturnValue({
      data: series,
      isLoading: false,
      error: null,
    });
    renderGraph({
      entityIds: ["second-team"],
      teamColors: new Map([
        ["first-team", "#112233"],
        ["second-team", "#aabbcc"],
      ]),
    });
    const expected = [{ ...series[0], color: "#aabbcc" }];
    expect(mocks.breakdown.mock.calls[0][0].series).toEqual(expected);
    expect(mocks.evolution.mock.calls[0][0].series).toEqual(expected);
    expect(series[0]).not.toHaveProperty("color");
  });

  it("leaves player series unchanged even when team colors are supplied", () => {
    const series: Series[] = [{ id: "player", label: "Player", data: [] }];
    mocks.useQuery.mockReturnValue({
      data: series,
      isLoading: false,
      error: null,
    });
    renderGraph({
      entityType: "player",
      teamColors: new Map([["player", "#aabbcc"]]),
    });
    expect(mocks.breakdown.mock.calls[0][0].series).toEqual(series);
    expect(mocks.evolution.mock.calls[0][0].series).toEqual(series);
  });
});

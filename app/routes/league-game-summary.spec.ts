import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameSummaryFixture } from "../../tests/e2e/statistics/gameSummaryFixture";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("~/services/leagueGameSummary.server", () => ({
  loadLeagueGameSummary: mocks.load,
}));

import { loader } from "./league-game-summary";

function args(search = ""): Parameters<typeof loader>[0] {
  return {
    unstable_pattern: "/games/:gameId/summary",
    params: { gameId: "100000000000000000000001" },
    request: new Request(
      `https://kandora.test/games/100000000000000000000001/summary${search}`
    ),
    context: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(gameSummaryFixture());
});

describe("league summary page loader contract", () => {
  it("returns the public summary with a local return path and no stale caching", async () => {
    const result = await loader(args("?from=%2Fstatistics%3Ftab%3Dgames"));
    expect(result).toMatchObject({
      data: {
        summary: { id: "100000000000000000000001" },
        returnTo: "/statistics?tab=games",
      },
      init: { headers: { "Cache-Control": "no-store" } },
    });
    expect(mocks.load).toHaveBeenCalledWith("100000000000000000000001");
  });

  it("does not turn a crafted return path into an external redirect", async () => {
    const result = await loader(args("?from=https%3A%2F%2Fexample.invalid"));
    expect(result.data.returnTo).toBe(
      "/online-tournaments/kandora-premier-league/statistics/games"
    );
  });

  it.each([404, 409])("preserves an explicit %i response", async (status) => {
    mocks.load.mockRejectedValue(new Response("Unavailable", { status }));
    await expect(loader(args())).rejects.toMatchObject({ status });
  });

  it("logs unexpected failures and returns an error, not an empty summary", async () => {
    const error = new Error("database unavailable");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.load.mockRejectedValue(error);
      await expect(loader(args())).rejects.toMatchObject({ status: 500 });
      expect(log).toHaveBeenCalledWith(
        "[game summary] Failed to load summary",
        error
      );
    } finally {
      log.mockRestore();
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicLeagueSchedule: vi.fn(),
}));

vi.mock("../../services/publicSchedule.server", () => ({
  getPublicLeagueSchedule: mocks.getPublicLeagueSchedule,
}));

vi.mock("../../services/scheduleService.server", () => {
  class LeagueScheduleError extends Error {
    constructor(
      public readonly code: "not-found" | "disabled" | "invalid-schedule",
      message: string
    ) {
      super(message);
    }
  }
  return { LeagueScheduleError };
});

import { LeagueScheduleError } from "../../services/scheduleService.server";
import { loader } from "./league-schedule";

const leagueId = "64b000000000000000000001";

describe("GET /api/league-schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed league IDs", async () => {
    const response = await loader({
      request: new Request(
        "http://localhost/api/league-schedule?leagueId=invalid"
      ),
    });

    expect(response.status).toBe(400);
    expect(mocks.getPublicLeagueSchedule).not.toHaveBeenCalled();
  });

  it("returns the public projection", async () => {
    mocks.getPublicLeagueSchedule.mockResolvedValue({
      leagueId,
      games: [
        {
          id: "game-1",
          live: { status: "ongoing", watchId: "safe-watch-id" },
        },
      ],
    });

    const response = await loader({
      request: new Request(
        `http://localhost/api/league-schedule?leagueId=${leagueId}`
      ),
    });

    expect(mocks.getPublicLeagueSchedule).toHaveBeenCalledWith(leagueId);
    await expect(response.json()).resolves.toEqual({
      leagueId,
      games: [
        {
          id: "game-1",
          live: { status: "ongoing", watchId: "safe-watch-id" },
        },
      ],
    });
  });

  it("hides missing or schedule-disabled leagues", async () => {
    mocks.getPublicLeagueSchedule.mockRejectedValue(
      new LeagueScheduleError("not-found", "Schedule not found")
    );

    const response = await loader({
      request: new Request(
        `http://localhost/api/league-schedule?leagueId=${leagueId}`
      ),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not-found" });
  });
});
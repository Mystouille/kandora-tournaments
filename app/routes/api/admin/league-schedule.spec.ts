import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLeagueScheduleData: vi.fn(),
  replaceLeagueSchedule: vi.fn(),
  requireLeagueAdmin: vi.fn(),
}));

vi.mock("../../../services/scheduleService.server", () => {
  class LeagueScheduleError extends Error {
    constructor(
      public readonly code: "not-found" | "disabled" | "invalid-schedule",
      message: string
    ) {
      super(message);
    }
  }

  return {
    getLeagueScheduleData: mocks.getLeagueScheduleData,
    replaceLeagueSchedule: mocks.replaceLeagueSchedule,
    LeagueScheduleError,
  };
});

vi.mock("../../../utils/league-permissions.server", () => ({
  requireLeagueAdmin: mocks.requireLeagueAdmin,
}));

import { LeagueScheduleError } from "../../../services/scheduleService.server";
import { action, loader } from "./league-schedule";

const leagueId = "64b000000000000000000001";

function putRequest(body: unknown) {
  return new Request("http://localhost/api/admin/league-schedule", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/league-schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLeagueAdmin.mockResolvedValue({
      authorized: true,
      jwtPayload: { sub: "admin" },
    });
  });

  it("rejects malformed IDs before checking permissions", async () => {
    const response = await loader({
      request: new Request(
        "http://localhost/api/admin/league-schedule?leagueId=invalid"
      ),
    });

    expect(response.status).toBe(400);
    expect(mocks.requireLeagueAdmin).not.toHaveBeenCalled();
  });

  it("returns the league permission failure", async () => {
    mocks.requireLeagueAdmin.mockResolvedValue({
      authorized: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

    const response = await loader({
      request: new Request(
        `http://localhost/api/admin/league-schedule?leagueId=${leagueId}`
      ),
    });

    expect(response.status).toBe(403);
    expect(mocks.getLeagueScheduleData).not.toHaveBeenCalled();
  });

  it("loads an authorized schedule", async () => {
    mocks.getLeagueScheduleData.mockResolvedValue({ leagueId, games: [] });

    const response = await loader({
      request: new Request(
        `http://localhost/api/admin/league-schedule?leagueId=${leagueId}`
      ),
    });

    expect(mocks.getLeagueScheduleData).toHaveBeenCalledWith(leagueId);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ leagueId, games: [] });
  });

  it("forwards the complete schedule on PUT", async () => {
    const games = [
      {
        phaseId: null,
        scheduledAt: "2026-08-20T18:00:00.000Z",
        slots: [],
      },
    ];
    mocks.replaceLeagueSchedule.mockResolvedValue({ leagueId, games });

    const response = await action({
      request: putRequest({ leagueId, games }),
    });

    expect(mocks.replaceLeagueSchedule).toHaveBeenCalledWith(leagueId, games);
    expect(response.status).toBe(200);
  });

  it("rejects direct access when scheduling is disabled", async () => {
    mocks.getLeagueScheduleData.mockRejectedValue(
      new LeagueScheduleError("disabled", "Schedule disabled")
    );

    const response = await loader({
      request: new Request(
        `http://localhost/api/admin/league-schedule?leagueId=${leagueId}`
      ),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "disabled" });
  });
});
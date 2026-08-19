import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteLeague: vi.fn(),
  requireLeagueAdmin: vi.fn(),
}));

vi.mock("../../../services/deleteLeague.server", () => {
  class DeleteLeagueError extends Error {
    constructor(
      public readonly code: "not-found" | "name-mismatch",
      message: string
    ) {
      super(message);
    }
  }

  return {
    deleteLeague: mocks.deleteLeague,
    DeleteLeagueError,
  };
});

vi.mock("../../../utils/league-permissions.server", () => ({
  requireLeagueAdmin: mocks.requireLeagueAdmin,
}));

import { DeleteLeagueError } from "../../../services/deleteLeague.server";
import { action } from "./league-delete";

const leagueId = "64b000000000000000000001";

function deleteRequest(body: unknown) {
  return new Request("http://localhost/api/admin/league-delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/admin/league-delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLeagueAdmin.mockResolvedValue({
      authorized: true,
      jwtPayload: { sub: "admin" },
    });
  });

  it("rejects malformed input before checking permissions", async () => {
    const response = await action({
      request: deleteRequest({ leagueId: "invalid", confirmationName: "Cup" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.requireLeagueAdmin).not.toHaveBeenCalled();
    expect(mocks.deleteLeague).not.toHaveBeenCalled();
  });

  it("returns the league permission failure", async () => {
    mocks.requireLeagueAdmin.mockResolvedValue({
      authorized: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });

    const response = await action({
      request: deleteRequest({ leagueId, confirmationName: "Summer Cup" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.deleteLeague).not.toHaveBeenCalled();
  });

  it("forwards the exact confirmation name and returns deletion counts", async () => {
    mocks.deleteLeague.mockResolvedValue({
      deletedGames: 4,
      preservedGames: 2,
      deletedUsers: 7,
    });

    const response = await action({
      request: deleteRequest({ leagueId, confirmationName: "Summer Cup" }),
    });

    expect(mocks.deleteLeague).toHaveBeenCalledWith(leagueId, "Summer Cup");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      deletedGames: 4,
      preservedGames: 2,
      deletedUsers: 7,
    });
  });

  it("rejects a confirmation name that no longer matches", async () => {
    mocks.deleteLeague.mockRejectedValue(
      new DeleteLeagueError("name-mismatch", "Tournament name does not match")
    );

    const response = await action({
      request: deleteRequest({ leagueId, confirmationName: "Wrong name" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "name-mismatch" });
  });
});
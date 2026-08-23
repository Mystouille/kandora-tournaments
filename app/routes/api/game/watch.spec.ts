import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findLiveGame: vi.fn(),
  gameEnabled: true,
  requireGameApiAccess: vi.fn(),
  startRelay: vi.fn(),
  updateLiveGame: vi.fn(),
}));

vi.mock("~/game/feature-gate", () => ({
  isGameEnabled: () => mocks.gameEnabled,
}));

vi.mock("~/utils/gameAuth.server", () => ({
  requireGameApiAccess: mocks.requireGameApiAccess,
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));

vi.mock("~/core/models/tournament/LiveGame", () => ({
  LiveGameModel: {
    findOne: mocks.findLiveGame,
    updateOne: mocks.updateLiveGame,
  },
}));

vi.mock("~/services/gameServer.server", () => ({
  RelayError: class RelayError extends Error {},
  startRelay: mocks.startRelay,
}));

import { action } from "./watch";

function watchRequest(): Request {
  const body = new FormData();
  body.set("watchId", "watch-1");
  return new Request("http://app.test/api/game/watch", {
    method: "POST",
    body,
  });
}

describe("game watch API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.gameEnabled = true;
    mocks.requireGameApiAccess.mockResolvedValue({
      authorized: true,
      user: { sub: "user-1", username: "Alice", loginMethod: "discord" },
    });
    mocks.findLiveGame.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: "live-1", watchId: "watch-1" }),
    });
    mocks.startRelay.mockResolvedValue({ matchId: "relay-1" });
    mocks.updateLiveGame.mockReturnValue({
      exec: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("does not start a relay when live-game access is denied", async () => {
    mocks.requireGameApiAccess.mockResolvedValue({
      authorized: false,
      response: Response.json(
        { error: "tnt_membership_required" },
        { status: 403 }
      ),
    });

    const response = await action({ request: watchRequest() });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "tnt_membership_required",
    });
    expect(mocks.connectToDatabase).not.toHaveBeenCalled();
    expect(mocks.startRelay).not.toHaveBeenCalled();
  });

  it("starts a relay for an authorized guild member", async () => {
    const response = await action({ request: watchRequest() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      matchId: "relay-1",
    });
    expect(mocks.startRelay).toHaveBeenCalledWith("watch-1");
  });
});
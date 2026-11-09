import { beforeEach, describe, expect, it, vi } from "vitest";
import type { getAuthenticatedUser } from "~/utils/jwt.server";
import type { resolveReplayViewerData } from "~/services/replayViewerData.server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn<typeof getAuthenticatedUser>(),
  resolve: vi.fn<typeof resolveReplayViewerData>(),
}));
vi.mock("~/utils/jwt.server", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("~/services/replayViewerData.server", () => ({
  resolveReplayViewerData: mocks.resolve,
}));

import { loader } from "./replayLoader.server";
import type { Route } from "./+types/replay";

function argumentsFor(gameId: string): Route.LoaderArgs {
  return {
    params: { gameId },
    context: {},
    unstable_pattern: "/watch/replay/:gameId",
    request: new Request(`http://localhost/watch/replay/${gameId}?seat=2`),
  };
}

async function responseFrom(promise: Promise<unknown>): Promise<Response> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a replay response");
}

describe("replay server loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue(null);
    mocks.resolve.mockResolvedValue({
      status: "not_found",
      canonicalGameId: "game",
    });
  });

  it("canonicalizes a Majsoul sharer suffix without changing the requested seat", async () => {
    const response = await responseFrom(loader(argumentsFor("game_a123")));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/watch/replay/game?seat=2");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("retains explicit missing-id and unavailable-replay responses", async () => {
    expect((await responseFrom(loader(argumentsFor("")))).status).toBe(404);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect((await responseFrom(loader(argumentsFor("game")))).status).toBe(404);
    expect(mocks.resolve).toHaveBeenCalledWith({
      gameId: "game",
      reviewShortId: null,
      userId: null,
    });
  });

  it("uses the auth helper's anonymous result but surfaces unexpected failures", async () => {
    const error = new Error("Unexpected authentication failure");
    mocks.auth.mockRejectedValue(error);
    await expect(loader(argumentsFor("game"))).rejects.toBe(error);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});

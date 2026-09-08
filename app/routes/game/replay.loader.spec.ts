import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  annotateWaits: vi.fn(),
  resolveReplayViewerData: vi.fn(),
}));

vi.mock("~/utils/jwt.server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("~/services/annotateWaits", () => ({
  annotateWaits: mocks.annotateWaits,
}));
vi.mock("~/services/replayViewerData.server", () => ({
  resolveReplayViewerData: mocks.resolveReplayViewerData,
}));

import { loader } from "./replay";

const gameId = "2026041906gm-0001-14853-b8890fb3";

const found = {
  status: "found",
  canonicalGameId: gameId,
  resolvedSeat: null,
  log: {
    source: "tenhou",
    sourceGameId: gameId,
    ruleSet: "tenhou",
    startedAt: 100,
    endedAt: 200,
    seats: [],
    events: [],
    schemaVersion: 6,
  },
  review: null,
  seatEnrichment: [],
};

function loaderArgs() {
  return {
    request: new Request(`http://app.test/watch/replay/${gameId}`),
    params: { gameId },
    context: {},
    unstable_pattern: "/watch/replay/:gameId",
  };
}

describe("replay viewer cache authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    mocks.annotateWaits.mockReturnValue([]);
    mocks.resolveReplayViewerData.mockResolvedValue(found);
  });

  it("allows an anonymous cache hit", async () => {
    const result = await loader(loaderArgs());

    expect(result.log.sourceGameId).toBe(gameId);
    expect(mocks.resolveReplayViewerData).toHaveBeenCalledWith({
      gameId,
      reviewShortId: null,
      userId: null,
    });
  });

  it("redirects a Tenhou watch-id alias to its canonical replay", async () => {
    const canonicalGameId = "2026082503gm-0009-19370-0e3a95d1";
    mocks.resolveReplayViewerData.mockResolvedValue({
      ...found,
      canonicalGameId,
      log: { ...found.log, sourceGameId: canonicalGameId },
    });
    let thrown: unknown;

    try {
      await loader({
        ...loaderArgs(),
        request: new Request("http://app.test/watch/replay/66b555f2?seat=2"),
        params: { gameId: "66b555f2" },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe(
      `/watch/replay/${canonicalGameId}?seat=2`
    );
  });

  it("redirects an anonymous cache miss before fetch", async () => {
    mocks.resolveReplayViewerData.mockResolvedValue({
      status: "authentication_required",
      canonicalGameId: gameId,
    });
    let thrown: unknown;

    try {
      await loader(loaderArgs());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe(
      `/sign-in?mode=auth&returnTo=%2Fwatch%2Freplay%2F${gameId}`
    );
  });

  it("attributes an authenticated cache miss", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      sub: "507f1f77bcf86cd799439011",
      username: "Alice",
    });

    const result = await loader(loaderArgs());

    expect(result.log.sourceGameId).toBe(gameId);
    expect(mocks.resolveReplayViewerData).toHaveBeenCalledWith({
      gameId,
      reviewShortId: null,
      userId: "507f1f77bcf86cd799439011",
    });
  });
});

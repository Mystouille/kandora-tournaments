import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRedisClient: vi.fn(),
  isRedisConfigured: vi.fn(),
}));

vi.mock("./redisConnection.server", () => ({
  createRedisClient: mocks.createRedisClient,
  isRedisConfigured: mocks.isRedisConfigured,
}));

function createClient() {
  return {
    on: vi.fn(),
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn(),
  };
}

describe("cache invalidation Redis integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("stays in-process when Redis is not configured", async () => {
    mocks.isRedisConfigured.mockReturnValue(false);
    const listener = vi.fn();
    const { emitLeagueUpdated, onLeagueUpdated } =
      await import("./cacheInvalidation.server");

    onLeagueUpdated(listener);
    emitLeagueUpdated("league-1");

    expect(listener).toHaveBeenCalledWith("league-1");
    expect(mocks.createRedisClient).not.toHaveBeenCalled();
  });

  it("subscribes and publishes when Redis is configured", async () => {
    mocks.isRedisConfigured.mockReturnValue(true);
    const subscriber = createClient();
    const publisher = createClient();
    mocks.createRedisClient
      .mockReturnValueOnce(subscriber)
      .mockReturnValueOnce(publisher);
    const { emitLeagueUpdated, onLeagueUpdated } =
      await import("./cacheInvalidation.server");

    onLeagueUpdated(vi.fn());
    emitLeagueUpdated("league-1");

    expect(subscriber.subscribe).toHaveBeenCalledWith(
      "kandora:cache:league-updated",
      expect.any(Function)
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      "kandora:cache:league-updated",
      expect.stringContaining('"leagueId":"league-1"')
    );
  });
});

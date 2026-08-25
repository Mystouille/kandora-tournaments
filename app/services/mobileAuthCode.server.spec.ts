import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const entries = new Map<string, string>();
  return {
    entries,
    redis: {
      set: vi.fn(
        async (key: string, value: string): Promise<"OK" | null> => {
          if (entries.has(key)) {
            return null;
          }
          entries.set(key, value);
          return "OK";
        }
      ),
      eval: vi.fn(
        async (
          _script: string,
          _keyCount: number,
          key: string,
          challenge: string
        ): Promise<string | null> => {
          const value = entries.get(key);
          if (value === undefined || !value.startsWith(`${challenge}:`)) {
            return null;
          }
          entries.delete(key);
          return value.slice(challenge.length + 1);
        }
      ),
    },
  };
});

vi.mock("./redisConnection.server", () => ({
  getRedisConnection: () => mocks.redis,
}));

import {
  consumeMobileAuthCode,
  createMobileAuthCode,
} from "./mobileAuthCode.server";

describe("mobile authentication codes", () => {
  beforeEach(() => {
    mocks.entries.clear();
    mocks.redis.set.mockClear();
    mocks.redis.eval.mockClear();
  });

  it("is single use and remains redeemable after a wrong verifier", async () => {
    const verifier = "v".repeat(43);
    const challenge = createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const code = await createMobileAuthCode(
      { userId: "user-1", username: "Alice" },
      challenge
    );

    await expect(
      consumeMobileAuthCode(code, "x".repeat(43))
    ).resolves.toBeNull();
    await expect(consumeMobileAuthCode(code, verifier)).resolves.toEqual({
      userId: "user-1",
      username: "Alice",
    });
    await expect(consumeMobileAuthCode(code, verifier)).resolves.toBeNull();
  });

  it("rejects malformed challenges without writing to Redis", async () => {
    await expect(
      createMobileAuthCode(
        { userId: "user-1", username: "Alice" },
        "not-a-challenge"
      )
    ).rejects.toThrow("Invalid mobile authentication challenge");
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });
});
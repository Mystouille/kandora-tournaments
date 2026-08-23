import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";

vi.mock("config", () => ({
  coreConfig: {
    JWT_SECRET: "test-secret-that-is-long-enough-for-hs256",
  },
}));

import {
  signGameToken,
  signToken,
  verifyGameToken,
  verifyToken,
} from "./jwt.server";

describe("game-scoped JWTs", () => {
  it("keeps site and game token audiences separate", async () => {
    const siteToken = await signToken({
      sub: "user-1",
      username: "Alice",
      loginMethod: "discord",
    });
    const gameToken = await signGameToken("user-1");

    await expect(verifyToken(siteToken)).resolves.toMatchObject({
      sub: "user-1",
      username: "Alice",
    });
    await expect(verifyGameToken(gameToken)).resolves.toEqual(
      expect.objectContaining({ sub: "user-1", scope: "game" })
    );
    await expect(verifyToken(gameToken)).resolves.toBeNull();
    await expect(verifyGameToken(siteToken)).resolves.toBeNull();
  });

  it("issues game credentials for twelve hours", async () => {
    const token = await signGameToken("user-1");
    const payload = decodeJwt(token);

    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(12 * 60 * 60);
  });
});
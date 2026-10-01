import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  clearMobileAuthSession,
  createMobileAuthRequest,
  exchangeMobileAuthCode,
  loadMobileAuthSession,
  loadPendingMobileAuthVerifier,
  MobileAuthHttpError,
  saveMobileAuthSession,
  savePendingMobileAuth,
  shouldRefreshMobileAuthSession,
  verifyMobileAuthSession,
} from "./mobileAuth";

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
}

describe("native mobile authentication", () => {
  it("creates a verifier and matching SHA-256 challenge", async () => {
    const request = await createMobileAuthRequest();
    const expected = createHash("sha256")
      .update(request.verifier)
      .digest("base64url");

    expect(request.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(request.challenge).toBe(expected);
  });

  it("loads only unexpired pending verifiers", () => {
    const { storage } = createStorage();
    savePendingMobileAuth(storage, "v".repeat(43), 1_000);

    expect(loadPendingMobileAuthVerifier(storage, 1_001)).toBe(
      "v".repeat(43)
    );
    expect(loadPendingMobileAuthVerifier(storage, 601_001)).toBeNull();
  });

  it("loads only structured, unexpired sessions", () => {
    const { storage, values } = createStorage();
    const session = {
      token: "game-token",
      username: "Alice",
      expiresAt: 10_000,
    };
    saveMobileAuthSession(storage, session);
    expect(loadMobileAuthSession(storage, 9_999)).toEqual(session);
    expect(loadMobileAuthSession(storage, 10_000)).toBeNull();

    values.set("kandora_mobile_auth_session_v1", "not-json");
    expect(loadMobileAuthSession(storage, 1)).toBeNull();
    clearMobileAuthSession(storage);
  });

  it("keeps an expired access token while its refresh credential is valid", () => {
    const { storage } = createStorage();
    const session = {
      token: "expired-game-token",
      username: "Alice",
      expiresAt: 10_000,
      refreshToken: "refresh-token",
      refreshExpiresAt: 20_000,
    };
    saveMobileAuthSession(storage, session);

    expect(loadMobileAuthSession(storage, 10_000)).toEqual(session);
    expect(loadMobileAuthSession(storage, 20_000)).toBeNull();
  });

  it("refreshes only renewable sessions close to access-token expiry", () => {
    const session = {
      token: "game-token",
      username: "Alice",
      expiresAt: 400_000,
      refreshToken: "refresh-token",
      refreshExpiresAt: 1_000_000,
    };

    expect(shouldRefreshMobileAuthSession(session, 99_999)).toBe(false);
    expect(shouldRefreshMobileAuthSession(session, 100_000)).toBe(true);
    expect(
      shouldRefreshMobileAuthSession(
        {
          token: session.token,
          username: session.username,
          expiresAt: session.expiresAt,
        },
        100_000
      )
    ).toBe(false);
  });

  it("exchanges a callback code and verifies stored sessions", async () => {
    const expiresAt = Date.now() + 60_000;
    const refreshExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          token: "game-token",
          refreshToken: "refresh-token",
          username: "Alice",
          expiresAt,
          refreshExpiresAt,
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          token: "renewed-game-token",
          expiresAt: expiresAt - 1_000,
          refreshToken: "refresh-token",
          refreshExpiresAt,
        })
      );

    const session = await exchangeMobileAuthCode(
      "https://play.example.com",
      "callback-code",
      "verifier",
      fetcher
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://play.example.com/api/mobile/auth/exchange",
      {
        method: "POST",
        body: expect.any(URLSearchParams),
      }
    );
    await expect(
      verifyMobileAuthSession(
        "https://play.example.com",
        session,
        fetcher
      )
    ).resolves.toEqual({
      ...session,
      token: "renewed-game-token",
      expiresAt: expiresAt - 1_000,
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://play.example.com/api/mobile/auth/session",
      {
        method: "POST",
        body: expect.any(URLSearchParams),
      }
    );
    const verificationBody = fetcher.mock.calls[1]?.[1]?.body;
    expect(verificationBody).toBeInstanceOf(URLSearchParams);
    expect((verificationBody as URLSearchParams).get("refreshToken")).toBe(
      "refresh-token"
    );
  });

  it("surfaces a rejected stored token as an authentication error", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "expired" }, { status: 401 }));

    await expect(
      verifyMobileAuthSession(
        "https://play.example.com",
        { token: "expired", username: "Alice", expiresAt: Date.now() + 1_000 },
        fetcher
      )
    ).rejects.toEqual(expect.objectContaining<Partial<MobileAuthHttpError>>({
      status: 401,
    }));
  });
});
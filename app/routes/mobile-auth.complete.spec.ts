import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMobileAuthCode: vi.fn(),
  requireGameUser: vi.fn(),
}));
vi.mock("~/utils/gameAuth.server", () => ({
  requireGameUser: mocks.requireGameUser,
}));
vi.mock("~/services/mobileAuthCode.server", () => ({
  createMobileAuthCode: mocks.createMobileAuthCode,
  isMobileAuthChallenge: (value: string | null) =>
    value !== null && /^[A-Za-z0-9_-]{43}$/.test(value),
}));

import { loader } from "./mobile-auth.complete";

describe("mobile auth completion", () => {
  beforeEach(() => {
    mocks.createMobileAuthCode.mockReset();
    mocks.requireGameUser.mockResolvedValue({
      sub: "user-1",
      username: "Alice",
    });
    mocks.createMobileAuthCode.mockResolvedValue("b".repeat(43));
  });

  it("returns authenticated users to the Kandora app", async () => {
    const response = await loader({
      request: new Request("https://app.test/mobile-auth/complete", {
        headers: { Cookie: `mobile_auth_challenge=${"a".repeat(43)}` },
      }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `kandora://auth/complete?code=${"b".repeat(43)}`
    );
    expect(mocks.createMobileAuthCode).toHaveBeenCalledWith(
      { userId: "user-1", username: "Alice" },
      "a".repeat(43)
    );
    expect(response.headers.get("Set-Cookie")).toContain(
      "mobile_auth_challenge=;"
    );
  });

  it("returns an error callback when no verifier challenge survives", async () => {
    const response = await loader({
      request: new Request("https://app.test/mobile-auth/complete"),
    });

    expect(response.headers.get("Location")).toBe(
      "kandora://auth/complete?error=invalid_request"
    );
    expect(mocks.createMobileAuthCode).not.toHaveBeenCalled();
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateGameAccess: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("~/utils/gameAuth.server", () => ({
  evaluateGameAccess: mocks.evaluateGameAccess,
}));

vi.mock("~/utils/jwt.server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

import { loader } from "./sign-in";

describe("sign-in route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateGameAccess.mockResolvedValue({ status: "signed_out" });
    mocks.getAuthenticatedUser.mockResolvedValue(null);
  });

  it("returns the denied state and validated game destination", async () => {
    const request = new Request(
      "http://app.test/sign-in?returnTo=%2Fspectate%2Fmatch-1%3Fdelay%3D300000"
    );

    await expect(loader({ request })).resolves.toEqual({
      status: "signed_out",
      returnTo: "/spectate/match-1?delay=300000",
      authOnly: false,
    });
  });

  it("falls back to the lobby for an invalid destination", async () => {
    const request = new Request(
      "http://app.test/sign-in?returnTo=https%3A%2F%2Fevil.test"
    );

    await expect(loader({ request })).resolves.toEqual({
      status: "signed_out",
      returnTo: "/lobby",
      authOnly: false,
    });
  });

  it("redirects an authorized member to the attempted destination", async () => {
    mocks.evaluateGameAccess.mockResolvedValue({
      status: "allowed",
      user: { sub: "user-1" },
    });
    const request = new Request(
      "http://app.test/sign-in?returnTo=%2Fgame%2Froom-1"
    );
    let thrown: unknown;

    try {
      await loader({ request });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe("/game/room-1");
  });

  it("preserves the trusted mobile auth completion destination", async () => {
    const request = new Request(
      "http://app.test/sign-in?returnTo=%2Fmobile-auth%2Fcomplete"
    );

    await expect(loader({ request })).resolves.toEqual({
      status: "signed_out",
      returnTo: "/mobile-auth/complete",
      authOnly: false,
    });
  });

  it("accepts a safe non-game destination in auth-only mode", async () => {
    const request = new Request(
      "http://app.test/sign-in?mode=auth&returnTo=%2Fmy-replays%3Ftype%3Dreview"
    );

    await expect(loader({ request })).resolves.toEqual({
      status: "signed_out",
      returnTo: "/my-replays?type=review",
      authOnly: true,
    });
    expect(mocks.evaluateGameAccess).not.toHaveBeenCalled();
  });

  it("redirects an authenticated site user in auth-only mode", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ sub: "user-1" });
    const request = new Request(
      "http://app.test/sign-in?mode=auth&returnTo=%2Fmy-replays"
    );

    await expect(loader({ request })).rejects.toMatchObject({
      status: 302,
      headers: expect.objectContaining({}),
    });
  });
});

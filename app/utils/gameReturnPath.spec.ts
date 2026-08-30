import { describe, expect, it } from "vitest";
import {
  authSignInPath,
  gameReturnPathFromRequest,
  gameSignInPath,
  localReturnPathFromRequest,
  normalizeGameReturnPath,
  normalizeLocalReturnPath,
  stripAppBasePath,
} from "./gameReturnPath";

describe("game return paths", () => {
  it("preserves game paths and their complete query strings", () => {
    const path =
      "/spectate/match-1?delay=300000&returnTo=%2Fonline-tournaments%2Fcup%3Ftab%3Dgames";

    expect(normalizeGameReturnPath(path)).toBe(path);
    expect(gameSignInPath(path)).toBe(
      "/sign-in?returnTo=%2Fspectate%2Fmatch-1%3Fdelay%3D300000%26returnTo%3D%252Fonline-tournaments%252Fcup%253Ftab%253Dgames"
    );
  });

  it("accepts only live game entry routes", () => {
    expect(normalizeGameReturnPath("/lobby")).toBe("/lobby");
    expect(normalizeGameReturnPath("/mobile-auth/complete")).toBe(
      "/mobile-auth/complete"
    );
    expect(normalizeGameReturnPath("/game/room-1")).toBe("/game/room-1");
    expect(normalizeGameReturnPath("/mobile-auth/other")).toBe("/lobby");
    expect(normalizeGameReturnPath("/watch/replay/game-1")).toBe("/lobby");
    expect(normalizeGameReturnPath("/account")).toBe("/lobby");
  });

  it("rejects external and ambiguous local targets", () => {
    expect(normalizeLocalReturnPath("https://evil.test/path")).toBe("/");
    expect(normalizeLocalReturnPath("//evil.test/path")).toBe("/");
    expect(normalizeLocalReturnPath("/\\evil.test/path")).toBe("/");
    expect(normalizeLocalReturnPath("/%5C%5Cevil.test/path")).toBe("/");
    expect(normalizeLocalReturnPath("/game/%E0%A4%A")).toBe("/");
  });

  it("strips the configured basename from request URLs", () => {
    const request = new Request("https://app.test/kandora/game/room-1?debug=1");

    expect(gameReturnPathFromRequest(request, "/kandora")).toBe(
      "/game/room-1?debug=1"
    );
    expect(
      stripAppBasePath("/kandora/sign-in?returnTo=%2Flobby", "/kandora")
    ).toBe("/sign-in?returnTo=%2Flobby");
    expect(localReturnPathFromRequest(request, "/kandora")).toBe(
      "/game/room-1?debug=1"
    );
  });

  it("builds auth-only sign-in paths for any safe local destination", () => {
    expect(authSignInPath("/my-replays?type=review")).toBe(
      "/sign-in?mode=auth&returnTo=%2Fmy-replays%3Ftype%3Dreview"
    );
    expect(authSignInPath("https://evil.test/path")).toBe(
      "/sign-in?mode=auth&returnTo=%2F"
    );
  });
});

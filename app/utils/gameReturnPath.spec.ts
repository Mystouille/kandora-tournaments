import { describe, expect, it } from "vitest";
import {
  gameReturnPathFromRequest,
  gameSignInPath,
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
    expect(normalizeGameReturnPath("/game/room-1")).toBe("/game/room-1");
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
    const request = new Request(
      "https://app.test/kandora/game/room-1?debug=1"
    );

    expect(gameReturnPathFromRequest(request, "/kandora")).toBe(
      "/game/room-1?debug=1"
    );
    expect(
      stripAppBasePath("/kandora/sign-in?returnTo=%2Flobby", "/kandora")
    ).toBe("/sign-in?returnTo=%2Flobby");
  });
});
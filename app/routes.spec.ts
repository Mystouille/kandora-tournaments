import { describe, expect, it } from "vitest";
import routes from "./routes";

describe("route config", () => {
  it("registers the standalone game sign-in route", () => {
    const signInRoute = routes.find((entry) => entry.path === "/sign-in");

    expect(signInRoute).toMatchObject({
      path: "/sign-in",
      file: "routes/sign-in.tsx",
    });
  });

  it("registers the native game spectator route", () => {
    const spectatorRoute = routes.find(
      (entry) => entry.path === "/spectate/:matchId"
    );

    expect(spectatorRoute).toMatchObject({
      path: "/spectate/:matchId",
      file: "routes/game-spectate.tsx",
    });
  });
});
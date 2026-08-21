import { describe, expect, it } from "vitest";
import routes from "./routes";

describe("route config", () => {
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
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireGameUser: vi.fn() }));
vi.mock("~/game/feature-gate", () => ({ requireGameEnabled: vi.fn() }));
vi.mock("~/utils/gameAuth.server", () => ({
  requireGameUser: mocks.requireGameUser,
}));

import { loader } from "./mobile.game.create";

describe("mobile game creation bridge", () => {
  beforeEach(() => {
    mocks.requireGameUser.mockResolvedValue({ sub: "user-1" });
  });

  it("accepts an authenticated known preset", async () => {
    await expect(
      loader({
        request: new Request(
          "https://app.test/mobile/game/create?preset=tenhou-hanchan"
        ),
      })
    ).resolves.toEqual({
      preset: "tenhou-hanchan",
      playerCount: 4,
      sanmaType: "online",
      mode: { type: "normal" },
      spectatorDelayMs: 0,
    });
  });

  it("rejects unknown presets before room creation", async () => {
    await expect(
      loader({
        request: new Request(
          "https://app.test/mobile/game/create?preset=not-a-rule"
        ),
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(["online", "kansai"] as const)(
    "preserves %s sanma plus Duplicate through the creation link",
    async (sanmaType) => {
      const mode = {
        type: "duplicate",
        seed: "Linked board",
        generationVersion: 1,
      };
      const params = new URLSearchParams({
        preset: "m-league",
        playerCount: "3",
        sanmaType,
        mode: JSON.stringify(mode),
        spectatorDelayMs: "300000",
      });
      await expect(
        loader({
          request: new Request(`https://app.test/mobile/game/create?${params}`),
        })
      ).resolves.toEqual({
        preset: "m-league",
        playerCount: 3,
        sanmaType,
        mode,
        spectatorDelayMs: 300000,
      });
    }
  );

  it.each([
    "playerCount=3&preset=buu-east",
    "playerCount=2",
    "sanmaType=unknown",
    "mode=not-json",
    `mode=${encodeURIComponent(JSON.stringify({ type: "duplicate", seed: "", generationVersion: 1 }))}`,
  ])("rejects an invalid setup link: %s", async (query) => {
    await expect(
      loader({
        request: new Request(`https://app.test/mobile/game/create?${query}`),
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

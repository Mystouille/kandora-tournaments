import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireGameUser: vi.fn() }));
vi.mock("~/game/feature-gate", () => ({ requireGameEnabled: vi.fn() }));
vi.mock("~/utils/gameAuth.server", () => ({
  requireGameUser: mocks.requireGameUser,
}));
vi.mock("~/game/rules/presets", () => ({
  listPresetIds: () => ["m-league", "tenhou-hanchan"],
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
    ).resolves.toEqual({ preset: "tenhou-hanchan" });
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
});
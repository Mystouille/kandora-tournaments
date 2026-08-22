import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("./jwt.server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

import { requireGameUser } from "./gameAuth.server";

describe("requireGameUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the authenticated identity", async () => {
    const user = {
      sub: "user-1",
      username: "Alice",
      loginMethod: "discord" as const,
    };
    mocks.getAuthenticatedUser.mockResolvedValue(user);

    await expect(
      requireGameUser(new Request("http://app.test/lobby"))
    ).resolves.toBe(user);
  });

  it("throws a forbidden response for anonymous users", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    let thrown: unknown;
    try {
      await requireGameUser(new Request("http://app.test/lobby"));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
    expect((thrown as Response).statusText).toBe("Forbidden");
  });
});

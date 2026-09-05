import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrincipal: vi.fn(),
  getMyReplaysApiResponse: vi.fn(),
}));

vi.mock("~/utils/requestAuth.server", () => ({
  getAuthenticatedPrincipal: mocks.getAuthenticatedPrincipal,
}));
vi.mock("~/services/myReplaysApi.server", () => ({
  getMyReplaysApiResponse: mocks.getMyReplaysApiResponse,
}));

import { loader, meta } from "./my-replays";

describe("My Replays route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedPrincipal.mockResolvedValue(null);
    mocks.getMyReplaysApiResponse.mockResolvedValue({ replays: [] });
  });

  it("redirects signed-out users through the auth-only continuation", async () => {
    let thrown: unknown;
    try {
      await loader({ request: new Request("http://app.test/my-replays") });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe(
      "/sign-in?mode=auth&returnTo=%2Fmy-replays"
    );
    expect(mocks.getMyReplaysApiResponse).not.toHaveBeenCalled();
  });

  it("loads only the authenticated user's related groups", async () => {
    const groups = [{ key: "tenhou:game-1" }];
    mocks.getAuthenticatedPrincipal.mockResolvedValue({
      userId: "user-1",
      transport: "web-cookie",
    });
    mocks.getMyReplaysApiResponse.mockResolvedValue({ replays: groups });

    await expect(
      loader({ request: new Request("http://app.test/my-replays") })
    ).resolves.toEqual({
      groups,
      canonicalUrl: "http://app.test/my-replays",
      imageUrl: "http://app.test/banner/TNT_logo-WHITE.png",
      previewOnly: false,
    });
    expect(mocks.getAuthenticatedPrincipal).toHaveBeenCalledWith(
      expect.any(Request),
      { transport: "web-cookie" }
    );
    expect(mocks.getMyReplaysApiResponse).toHaveBeenCalledWith("user-1");
  });

  it("serves a data-free metadata shell to Discord's crawler", async () => {
    const data = await loader({
      request: new Request("http://internal.test/my-replays", {
        headers: {
          "User-Agent": "Discordbot/2.0",
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": "tournaments.example.test",
        },
      }),
    });

    expect(data).toEqual({
      groups: [],
      canonicalUrl: "https://tournaments.example.test/my-replays",
      imageUrl: "https://tournaments.example.test/banner/TNT_logo-WHITE.png",
      previewOnly: true,
    });
    expect(mocks.getAuthenticatedPrincipal).not.toHaveBeenCalled();
    expect(mocks.getMyReplaysApiResponse).not.toHaveBeenCalled();

    expect(meta({ data })).toEqual(
      expect.arrayContaining([
        { property: "og:title", content: "My Replays | TNT Paris Mahjong" },
        {
          property: "og:url",
          content: "https://tournaments.example.test/my-replays",
        },
        {
          property: "og:image",
          content: "https://tournaments.example.test/banner/TNT_logo-WHITE.png",
        },
        { name: "twitter:card", content: "summary" },
      ])
    );
  });

  it("rejects a stale token whose user no longer exists", async () => {
    mocks.getAuthenticatedPrincipal.mockResolvedValue({
      userId: "user-1",
      transport: "web-cookie",
    });
    mocks.getMyReplaysApiResponse.mockResolvedValue(null);

    await expect(
      loader({ request: new Request("http://app.test/my-replays") })
    ).rejects.toMatchObject({ status: 401 });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { basePath } from "../utils/basePath";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  find: vi.fn(),
}));

vi.mock("../core/models/tournament/League", () => ({
  LeagueModel: { find: mocks.find },
}));

vi.mock("../utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));

import { loader, meta } from "./online-tournaments.$slug";

describe("online tournament metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
  });

  it("renders the summary and cover image for Discord previews", async () => {
    const lean = vi.fn().mockResolvedValue([
      {
        name: "Summer League",
        summary: { fr: "Ligue estivale", en: "A summer mahjong league." },
        coverImageUrl: "/api/uploads/summer.webp",
        platformConfig: { platformName: "MAJSOUL" },
      },
    ]);
    const select = vi.fn().mockReturnValue({ lean });
    mocks.find.mockReturnValue({ select });
    const request = new Request(
      "http://internal.test/online-tournaments/summer-league",
      {
        headers: {
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Discordbot/2.0",
          "X-Forwarded-Host": "tournaments.example.test",
          "X-Forwarded-Proto": "https",
        },
      }
    );

    const data = await loader({
      params: { slug: "summer-league" },
      request,
    } as Parameters<typeof loader>[0]);

    expect(meta({ data })).toEqual(
      expect.arrayContaining([
        {
          property: "og:title",
          content: "Summer League | TNT Paris Mahjong",
        },
        { property: "og:description", content: "A summer mahjong league." },
        {
          property: "og:url",
          content: `https://tournaments.example.test${basePath}/online-tournaments/summer-league`,
        },
        {
          property: "og:image",
          content: "https://tournaments.example.test/api/uploads/summer.webp",
        },
        { name: "twitter:card", content: "summary_large_image" },
      ])
    );
    expect(select).toHaveBeenCalledWith(
      "name summary coverImageUrl platformConfig.platformName"
    );
  });

  it("uses generic metadata when the tournament does not exist", async () => {
    const lean = vi.fn().mockResolvedValue([]);
    mocks.find.mockReturnValue({ select: vi.fn().mockReturnValue({ lean }) });

    const data = await loader({
      params: { slug: "missing" },
      request: new Request(
        "https://tournaments.example.test/online-tournaments/missing"
      ),
    } as Parameters<typeof loader>[0]);

    expect(data.metadata.title).toBe(
      "Online Tournament | TNT Paris Mahjong"
    );
    expect(meta({ data })).toEqual(
      expect.arrayContaining([
        { name: "twitter:card", content: "summary" },
      ])
    );
  });
});
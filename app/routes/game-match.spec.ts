import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findById: vi.fn(),
  getGameServerHttpUrl: vi.fn(),
  requireGameUser: vi.fn(),
}));

vi.mock("~/game/routes/match", () => ({
  default: () => null,
}));

vi.mock("~/game/feature-gate", () => ({
  requireGameEnabled: vi.fn(),
  getClientGameFlag: () => ({ gameEnabled: true }),
}));

vi.mock("~/services/gameServer.server", () => ({
  getGameServerHttpUrl: mocks.getGameServerHttpUrl,
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));

vi.mock("~/core/models/game/Match", () => ({
  MatchModel: { findById: mocks.findById },
}));

vi.mock("~/utils/gameAuth.server", () => ({
  requireGameUser: mocks.requireGameUser,
}));

import { loader, meta } from "./game-match";

describe("game link metadata", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getGameServerHttpUrl.mockReturnValue("http://game.test");
    mocks.requireGameUser.mockResolvedValue({
      sub: "user-1",
      username: "Alice",
      loginMethod: "discord",
    });
  });

  it("serves ruleset and spectator-delay metadata to Discord", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        rooms: [
          {
            matchId: "room-1",
            status: "waiting",
            presetId: "m-league",
            mode: { type: "normal" },
            seats: [],
          },
        ],
      })
    );
    const request = new Request("http://internal.test/game/room-1", {
      headers: {
        "User-Agent": "Discordbot/2.0",
        "X-Forwarded-Host": "tournaments.example.test",
        "X-Forwarded-Proto": "https",
      },
    });

    const data = await loader({
      params: { matchId: "room-1" },
      request,
    } as Parameters<typeof loader>[0]);

    expect(mocks.requireGameUser).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://game.test/rooms",
      expect.objectContaining({
        headers: { accept: "application/json" },
      })
    );
    expect(data.metadata).toEqual({
      title: "M-League Game | TNT Paris Mahjong",
      description:
        "Ruleset: M-League. Spectator delay: none (live). Status: waiting for players.",
      canonicalUrl: "https://tournaments.example.test/game/room-1",
      imageUrl: "https://tournaments.example.test/banner/TNT_logo-WHITE.png",
    });
    expect(meta({ data } as Parameters<typeof meta>[0])).toEqual(
      expect.arrayContaining([
        {
          property: "og:title",
          content: "M-League Game | TNT Paris Mahjong",
        },
        {
          property: "og:description",
          content:
            "Ruleset: M-League. Spectator delay: none (live). Status: waiting for players.",
        },
        {
          property: "og:url",
          content: "https://tournaments.example.test/game/room-1",
        },
        {
          property: "og:image",
          content: "https://tournaments.example.test/banner/TNT_logo-WHITE.png",
        },
        { name: "twitter:card", content: "summary" },
      ])
    );
  });

  it("preserves game access checks for normal visitors", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        rooms: [
          {
            matchId: "room-1",
            status: "playing",
            presetId: "buu-east",
            mode: { type: "normal" },
          },
        ],
      })
    );
    const request = new Request(
      "https://tournaments.example.test/game/room-1",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
        },
      }
    );

    await loader({
      params: { matchId: "room-1" },
      request,
    } as Parameters<typeof loader>[0]);

    expect(mocks.requireGameUser).toHaveBeenCalledWith(request);
  });

  it("uses persisted match details after a room leaves live memory", async () => {
    fetchMock.mockResolvedValue(Response.json({ rooms: [] }));
    const lean = vi.fn().mockResolvedValue({
      ruleSet: "jpml-hanchan",
      status: "finished",
      mode: {
        type: "duplicate",
        seed: "Board-A",
        generationVersion: 1,
      },
    });
    const select = vi.fn().mockReturnValue({ lean });
    mocks.findById.mockReturnValue({ select });

    const data = await loader({
      params: { matchId: "finished-game" },
      request: new Request(
        "https://tournaments.example.test/game/finished-game",
        { headers: { "User-Agent": "Discordbot/2.0" } }
      ),
    } as Parameters<typeof loader>[0]);

    expect(mocks.connectToDatabase).toHaveBeenCalledOnce();
    expect(mocks.findById).toHaveBeenCalledWith("finished-game");
    expect(select).toHaveBeenCalledWith("ruleSet status mode");
    expect(data.metadata).toMatchObject({
      title: "JPML A — Hanchan Game | TNT Paris Mahjong",
      description:
        "Ruleset: JPML A — Hanchan. Mode: Duplicate. Spectator delay: none (live). Status: finished.",
    });
  });

  it("falls back to generic metadata when the game cannot be found", async () => {
    fetchMock.mockResolvedValue(Response.json({ rooms: [] }));
    const lean = vi.fn().mockResolvedValue(null);
    mocks.findById.mockReturnValue({
      select: vi.fn().mockReturnValue({ lean }),
    });

    const data = await loader({
      params: { matchId: "missing" },
      request: new Request("https://tournaments.example.test/game/missing", {
        headers: { "User-Agent": "Discordbot/2.0" },
      }),
    } as Parameters<typeof loader>[0]);

    expect(data.metadata).toMatchObject({
      title: "Mahjong Game | TNT Paris Mahjong",
      description: "Online riichi mahjong game. Spectator delay: none (live).",
    });
  });
});

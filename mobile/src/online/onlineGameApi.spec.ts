import { describe, expect, it, vi } from "vitest";
import type { MobileAuthSession } from "../auth/mobileAuth";
import { GameSetupSchema } from "~/game/rules/gameSetup";
import {
  createOnlineRoom,
  getActiveOnlineGame,
  getOnlineGameEnrichment,
  getOnlineGameConnectionDetails,
  resolveOnlineWatchId,
} from "./onlineGameApi";

const session: MobileAuthSession = {
  token: "game-token",
  username: "Alice",
  expiresAt: Date.now() + 60_000,
};

describe("mobile online game API", () => {
  it.each(
    (["online", "kansai"] as const).flatMap((sanmaType) =>
      [false, true].map((duplicate) => ({ sanmaType, duplicate }))
    )
  )(
    "creates $sanmaType sanma, Duplicate=$duplicate",
    async ({ sanmaType, duplicate }) => {
      const setup = GameSetupSchema.parse({
        preset: "m-league",
        playerCount: 3,
        sanmaType,
        spectatorDelayMs: 300000,
        mode: duplicate
          ? { type: "duplicate", seed: " Board ", generationVersion: 1 }
          : { type: "normal" },
      });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          matchId: "sanma-room",
          ...setup,
        })
      );
      await expect(
        createOnlineRoom("https://play.test", session, setup, 0, fetcher)
      ).resolves.toBe("sanma-room");
      expect(
        Object.fromEntries(fetcher.mock.calls[0][1]?.body as URLSearchParams)
      ).toEqual({
        token: session.token,
        preset: "m-league",
        playerCount: "3",
        sanmaType,
        spectatorDelayMs: "300000",
        mode: JSON.stringify(setup.mode),
      });
    }
  );

  it.each([
    {},
    { playerCount: 4, sanmaType: "online" },
    { playerCount: 3 },
    { playerCount: 3, sanmaType: "kansai" },
  ])(
    "does not join an old or mismatched server-created room: %j",
    async (variant) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          matchId: "wrong-room",
          ...variant,
        })
      );
      const setup = GameSetupSchema.parse({
        preset: "m-league",
        playerCount: 3,
        sanmaType: "online",
      });
      await expect(
        createOnlineRoom("https://play.test", session, setup, 0, fetcher)
      ).rejects.toThrow("does not support the selected sanma rules");
    }
  );

  it("rejects a server that silently drops Duplicate mode", async () => {
    const setup = GameSetupSchema.parse({
      preset: "m-league",
      mode: { type: "duplicate", seed: "Board", generationVersion: 1 },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ matchId: "normal-room" }));
    await expect(
      createOnlineRoom("https://play.test", session, setup, 0, fetcher)
    ).rejects.toThrow("did not confirm the Duplicate seed");
  });

  it("validates incompatible Buu and empty seeds before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const setup = GameSetupSchema.parse({ preset: "m-league", playerCount: 3 });
    await expect(
      createOnlineRoom(
        "https://play.test",
        session,
        { ...setup, preset: "buu-east" },
        0,
        fetcher
      )
    ).rejects.toThrow();
    await expect(
      createOnlineRoom(
        "https://play.test",
        session,
        {
          ...setup,
          mode: { type: "duplicate", seed: " ", generationVersion: 1 },
        },
        0,
        fetcher
      )
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("discovers the authenticated player's active match", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        activeMatch: {
          matchId: "match-1",
          status: "playing",
          connected: true,
        },
      })
    );

    await expect(
      getActiveOnlineGame("https://play.example.com", session, fetcher)
    ).resolves.toEqual({
      matchId: "match-1",
      status: "playing",
      connected: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://play.example.com/api/game/active-match",
      {
        method: "POST",
        body: expect.any(URLSearchParams),
      }
    );
  });

  it("creates rooms with a CORS-simple form request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ matchId: "room 1" }));

    await expect(
      createOnlineRoom(
        "https://play.example.com",
        session,
        "m-league",
        0,
        fetcher
      )
    ).resolves.toBe("room 1");
    expect(fetcher).toHaveBeenCalledWith(
      "https://play.example.com/api/game/rooms",
      { method: "POST", body: expect.any(URLSearchParams) }
    );
    expect(
      Object.fromEntries(fetcher.mock.calls[0][1]?.body as URLSearchParams)
    ).toEqual({
      token: "game-token",
      preset: "m-league",
      spectatorDelayMs: "0",
    });
  });

  it("sends the selected five-minute delay when creating a room", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ matchId: "delayed-room" }));

    await expect(
      createOnlineRoom(
        "https://play.example.com",
        session,
        "m-league",
        300_000,
        fetcher
      )
    ).resolves.toBe("delayed-room");
    expect(
      Object.fromEntries(fetcher.mock.calls[0][1]?.body as URLSearchParams)
    ).toEqual({
      token: "game-token",
      preset: "m-league",
      spectatorDelayMs: "300000",
    });
  });

  it("builds configured and same-origin WebSocket URLs", async () => {
    const configuredFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        token: "game-token",
        wsUrl: "wss://game.example.com/",
        wsPath: "/ws/game",
      })
    );
    await expect(
      getOnlineGameConnectionDetails(
        "https://play.example.com",
        session,
        "room 1",
        configuredFetcher
      )
    ).resolves.toEqual({
      token: "game-token",
      wsUrl: "wss://game.example.com/ws/game/room%201",
    });

    const fallbackFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        token: "game-token",
        wsUrl: null,
        wsPath: "/ws/game",
      })
    );
    await expect(
      getOnlineGameConnectionDetails(
        "http://localhost:5173",
        session,
        "room-2",
        fallbackFetcher
      )
    ).resolves.toEqual({
      token: "game-token",
      wsUrl: "ws://localhost:5173/ws/game/room-2",
    });
  });

  it("resolves a public watch id with the native game token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true, matchId: "relay-1" }));

    await expect(
      resolveOnlineWatchId(
        "https://play.example.com",
        session,
        "AB12CD34",
        fetcher
      )
    ).resolves.toBe("relay-1");
    expect(fetcher).toHaveBeenCalledWith(
      "https://play.example.com/api/game/watch",
      { method: "POST", body: expect.any(URLSearchParams) }
    );
    const body = fetcher.mock.calls[0][1]?.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      token: "game-token",
      watchId: "AB12CD34",
    });
  });

  it("loads spectator team enrichment with absolute logo URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        seats: [
          {
            seat: 0,
            playerName: "East",
            teamName: "East Club",
            teamLogoUrl: "/api/uploads/east.webp",
          },
          {
            seat: 2,
            playerName: "West",
            teamName: "West Club",
            teamLogoUrl: "https://cdn.example.com/west.webp",
          },
        ],
      })
    );

    await expect(
      getOnlineGameEnrichment("https://play.example.com", "relay/1", fetcher)
    ).resolves.toEqual([
      {
        teamName: "East Club",
        teamLogoUrl: "https://play.example.com/api/uploads/east.webp",
      },
      null,
      {
        teamName: "West Club",
        teamLogoUrl: "https://cdn.example.com/west.webp",
      },
      null,
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://play.example.com/api/game/enrichment?matchId=relay%2F1"
    );
  });
});

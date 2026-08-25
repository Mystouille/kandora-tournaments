import { describe, expect, it, vi } from "vitest";
import type { MobileAuthSession } from "../auth/mobileAuth";
import {
  createOnlineRoom,
  getOnlineGameConnectionDetails,
} from "./onlineGameApi";

const session: MobileAuthSession = {
  token: "game-token",
  username: "Alice",
  expiresAt: Date.now() + 60_000,
};

describe("mobile online game API", () => {
  it("creates rooms with a CORS-simple form request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ matchId: "room 1" }));

    await expect(
      createOnlineRoom(
        "https://play.example.com",
        session,
        "m-league",
        fetcher
      )
    ).resolves.toBe("room 1");
    expect(fetcher).toHaveBeenCalledWith(
      "https://play.example.com/api/mobile/game/rooms",
      { method: "POST", body: expect.any(URLSearchParams) }
    );
  });

  it("builds configured and same-origin WebSocket URLs", async () => {
    const configuredFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          authenticated: true,
          expiresAt: Date.now() + 60_000,
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

    const fallbackFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          authenticated: true,
          expiresAt: Date.now() + 60_000,
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
});
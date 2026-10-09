import { describe, expect, it, vi } from "vitest";
import type { GameWSOptions } from "~/game/client/ws";
import { GameSetupSchema } from "~/game/rules/gameSetup";
import type { MobileAuthSession } from "../auth/mobileAuth";
import {
  INITIAL_ONLINE_MATCH_STATE,
  OnlineMatchController,
} from "./OnlineMatchController";

const session: MobileAuthSession = {
  token: "game-token",
  username: "Alice",
  expiresAt: Date.now() + 60_000,
};

function setup() {
  let options: GameWSOptions | null = null;
  const getSpectatorEnrichment = vi
    .fn()
    .mockResolvedValue([null, null, null, null]);
  const socket = {
    connect: vi.fn(),
    close: vi.fn(),
    forceReconnect: vi.fn(),
    act: vi.fn(),
    ready: vi.fn(),
    setWaitingRoomReady: vi.fn(),
    addWaitingRoomBot: vi.fn(),
    kickWaitingRoomSeat: vi.fn(),
    startMatch: vi.fn(),
    leaveSeat: vi.fn(),
    voteContinue: vi.fn(),
  };
  const createRoom = vi.fn().mockResolvedValue("room-1");
  const resolveWatchId = vi.fn().mockResolvedValue("relay-1");
  const controller = new OnlineMatchController({
    createRoom,
    resolveWatchId,
    getConnectionDetails: vi.fn().mockResolvedValue({
      token: "game-token",
      wsUrl: "wss://game.test/ws/game/room-1",
    }),
    getSpectatorEnrichment,
    createSocket: (nextOptions) => {
      options = nextOptions;
      return socket;
    },
    waitForLeave: () => Promise.resolve(),
  });
  return {
    controller,
    createRoom,
    resolveWatchId,
    getSpectatorEnrichment,
    socket,
    options: () => {
      if (options === null) {
        throw new Error("Socket was not created");
      }
      return options;
    },
  };
}

describe("online match controller", () => {
  it.each(["online", "kansai"] as const)(
    "forwards complete %s Duplicate setup before connecting",
    async (sanmaType) => {
      const { controller, createRoom, socket } = setup();
      const config = GameSetupSchema.parse({
        preset: "m-league",
        playerCount: 3,
        sanmaType,
        mode: { type: "duplicate", seed: "Board", generationVersion: 1 },
        spectatorDelayMs: 300000,
      });
      await controller.create("https://play.test", session, config);
      expect(createRoom).toHaveBeenCalledWith(
        "https://play.test",
        session,
        config,
        300000
      );
      expect(socket.connect).toHaveBeenCalledOnce();
      controller.dispose();
    }
  );

  it("does not connect when the API detects an incompatible sanma server", async () => {
    const { controller, createRoom, socket } = setup();
    createRoom.mockRejectedValue(
      new Error("The game server does not support the selected sanma rules.")
    );
    await controller.create(
      "https://play.test",
      session,
      GameSetupSchema.parse({
        preset: "m-league",
        playerCount: 3,
      })
    );
    expect(socket.connect).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      status: "error",
      matchId: null,
      error: "The game server does not support the selected sanma rules.",
    });
  });

  it("rejects invalid creation options without calling the API", async () => {
    const { controller, createRoom } = setup();
    await controller.create("https://play.test", session, {
      preset: "buu-east",
      rulesFamily: "riichi",
      playerCount: 3,
      sanmaType: "online",
      mode: { type: "normal" },
      spectatorDelayMs: 0,
    });
    expect(createRoom).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("error");
  });

  it("surfaces a sanma capability error for both players and spectators", () => {
    const { controller, options } = setup();
    controller.join("https://play.test", session, "three");
    options().onError?.("sanma_update_required", "Update required for sanma");
    expect(controller.getState()).toMatchObject({
      status: "error",
      error: "Update required for sanma",
    });
    controller.watch("https://play.test", session, "three");
    options().onError?.("sanma_update_required", "Update required for sanma");
    expect(controller.getState()).toMatchObject({
      status: "error",
      error: "Update required for sanma",
    });
    controller.dispose();
  });

  it("resolves a tracked Tenhou watch ID before connecting as a spectator", async () => {
    const { controller, resolveWatchId, socket, options } = setup();
    const opening = controller.watchLive(
      "https://play.test",
      session,
      "WATCH123"
    );

    expect(controller.getState()).toMatchObject({
      status: "connecting",
      mode: "spectator",
      matchId: null,
    });
    expect(socket.connect).not.toHaveBeenCalled();
    await opening;

    expect(resolveWatchId).toHaveBeenCalledExactlyOnceWith(
      "https://play.test",
      session,
      "WATCH123"
    );
    expect(controller.getState()).toMatchObject({
      status: "connecting",
      mode: "spectator",
      matchId: "relay-1",
    });
    expect(options().matchId).toBe("relay-1");
    expect(options().spectate).toBe(true);
    expect(socket.connect).toHaveBeenCalledOnce();
  });

  it("shows a relay preflight error without opening a socket", async () => {
    const { controller, resolveWatchId, socket } = setup();
    resolveWatchId.mockRejectedValue(new Error("This game is no longer live"));

    await controller.watchLive("https://play.test", session, "WATCH123");

    expect(controller.getState()).toMatchObject({
      status: "error",
      mode: "spectator",
      matchId: null,
      error: "This game is no longer live",
    });
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it.each(["leave", "dispose"] as const)(
    "does not reconnect a late Tenhou relay after %s",
    async (action) => {
      const { controller, resolveWatchId, socket } = setup();
      let resolve!: (matchId: string) => void;
      resolveWatchId.mockReturnValue(
        new Promise<string>((fulfill) => {
          resolve = fulfill;
        })
      );
      const opening = controller.watchLive(
        "https://play.test",
        session,
        "WATCH123"
      );
      await controller[action]();
      resolve("late-relay");
      await opening;

      expect(controller.getState()).toEqual(INITIAL_ONLINE_MATCH_STATE);
      expect(socket.connect).not.toHaveBeenCalled();
    }
  );

  it("does not replace a newer native spectator session with an older relay", async () => {
    const { controller, resolveWatchId, socket } = setup();
    let resolve!: (matchId: string) => void;
    resolveWatchId.mockReturnValue(
      new Promise<string>((fulfill) => {
        resolve = fulfill;
      })
    );
    const opening = controller.watchLive(
      "https://play.test",
      session,
      "WATCH123"
    );
    controller.watch("https://play.test", session, "native-room");
    resolve("late-relay");
    await opening;

    expect(controller.getState()).toMatchObject({
      mode: "spectator",
      matchId: "native-room",
    });
    expect(socket.connect).toHaveBeenCalledOnce();
  });

  it("ignores a failed preflight after the user leaves the live game", async () => {
    const { controller, resolveWatchId } = setup();
    let reject!: (error: Error) => void;
    resolveWatchId.mockReturnValue(
      new Promise<string>((_resolve, fail) => {
        reject = fail;
      })
    );
    const opening = controller.watchLive(
      "https://play.test",
      session,
      "WATCH123"
    );
    await controller.leave();
    reject(new Error("relay unavailable"));
    await opening;

    expect(controller.getState()).toEqual(INITIAL_ONLINE_MATCH_STATE);
  });

  it("reports the enforced delay while waiting for spectator game data", () => {
    const { controller, options } = setup();
    controller.watch("https://play.test", session, "delayed-room");
    options().onMessage?.({
      type: "spectator_config",
      matchId: "delayed-room",
      delayMs: 300_000,
    });

    expect(controller.getState()).toMatchObject({
      status: "spectating",
      mode: "spectator",
      spectatorDelayMs: 300_000,
      spectatorTimeline: { baseline: null, events: [] },
    });
  });

  it.each([0, 300_000] as const)(
    "passes the selected %i ms spectator delay to room creation",
    async (spectatorDelayMs) => {
      const { controller, createRoom } = setup();
      await controller.create(
        "https://play.test",
        session,
        "m-league",
        spectatorDelayMs
      );

      expect(createRoom).toHaveBeenCalledWith(
        "https://play.test",
        session,
        "m-league",
        spectatorDelayMs
      );
    }
  );

  it("readies and starts an explicitly requested solo room once", () => {
    const { controller, socket, options } = setup();
    controller.join("https://play.test", session, "solo-room", {
      autoStart: true,
    });
    const waitingRoom = {
      type: "room_state" as const,
      matchId: "solo-room",
      status: "waiting" as const,
      mySeat: 0 as const,
      hostSeat: 0 as const,
      canStart: false,
      seats: [0, 1, 2, 3].map((seat) => ({
        seat: seat as 0 | 1 | 2 | 3,
        occupant:
          seat === 0
            ? {
                kind: "human" as const,
                userId: "user-1",
                displayName: "Alice",
                connected: true,
              }
            : { kind: "empty" as const },
        ready: false,
      })),
    };

    options().onMessage?.(waitingRoom);
    expect(socket.setWaitingRoomReady).toHaveBeenCalledWith(true);
    expect(socket.startMatch).not.toHaveBeenCalled();

    options().onMessage?.({
      ...waitingRoom,
      canStart: true,
      seats: waitingRoom.seats.map((seat) =>
        seat.seat === 0 ? { ...seat, ready: true } : seat
      ),
    });
    options().onMessage?.({
      ...waitingRoom,
      canStart: true,
      seats: waitingRoom.seats.map((seat) =>
        seat.seat === 0 ? { ...seat, ready: true } : seat
      ),
    });

    expect(socket.startMatch).toHaveBeenCalledOnce();
  });

  it("does not carry solo auto-start into a later ordinary join", () => {
    const { controller, socket, options } = setup();
    controller.join("https://play.test", session, "solo-room", {
      autoStart: true,
    });
    controller.join("https://play.test", session, "shared-room");

    options().onMessage?.({
      type: "room_state",
      matchId: "shared-room",
      status: "waiting",
      mySeat: 0,
      hostSeat: 0,
      canStart: true,
      seats: [0, 1, 2, 3].map((seat) => ({
        seat: seat as 0 | 1 | 2 | 3,
        occupant:
          seat === 0
            ? {
                kind: "human" as const,
                userId: "user-1",
                displayName: "Alice",
                connected: true,
              }
            : { kind: "empty" as const },
        ready: seat === 0,
      })),
    });

    expect(socket.setWaitingRoomReady).not.toHaveBeenCalled();
    expect(socket.startMatch).not.toHaveBeenCalled();
  });

  it("creates a room, renders waiting state, then enters play", async () => {
    const { controller, socket, options } = setup();
    await controller.create("https://play.test", session, "m-league");
    expect(controller.getState()).toMatchObject({
      status: "connecting",
      matchId: "room-1",
      mode: "player",
    });
    expect(socket.connect).toHaveBeenCalledOnce();

    options().onMessage?.({
      type: "room_state",
      matchId: "room-1",
      status: "waiting",
      mySeat: 0,
      hostSeat: 0,
      canStart: true,
      seats: [0, 1, 2, 3].map((seat) => ({
        seat: seat as 0 | 1 | 2 | 3,
        occupant:
          seat === 0
            ? {
                kind: "human" as const,
                userId: "user-1",
                displayName: "Alice",
                connected: true,
              }
            : { kind: "empty" as const },
        ready: seat === 0,
      })),
    });
    expect(controller.getState().status).toBe("waiting");

    controller.startMatch();
    expect(socket.startMatch).toHaveBeenCalledOnce();
    options().onMessage?.({
      type: "room_state",
      matchId: "room-1",
      status: "playing",
      mySeat: 0,
      hostSeat: 0,
      canStart: false,
      seats: [0, 1, 2, 3].map((seat) => ({
        seat: seat as 0 | 1 | 2 | 3,
        occupant: {
          kind: "bot" as const,
          userId: `bot-${seat}`,
          displayName: `Bot ${seat}`,
        },
        ready: true,
      })),
    });
    expect(controller.getState().status).toBe("playing");
    controller.act("discard:draw:1m");
    controller.ready();
    expect(socket.act).toHaveBeenCalledWith("discard:draw:1m");
    expect(socket.ready).toHaveBeenCalledOnce();
  });

  it("passes explicit takeover only for a reconnect join", () => {
    const { controller, options } = setup();

    controller.join("https://play.test", session, "room-1", {
      takeover: true,
    });

    expect(options().takeover).toBe(true);
    expect(options().spectate).toBe(false);
  });

  it("enters a terminal transferred state when another device takes over", () => {
    const { controller, options } = setup();
    controller.join("https://play.test", session, "room-1");

    options().onMessage?.({
      type: "session_replaced",
      matchId: "room-1",
      message: "Game resumed on another device.",
    });

    expect(controller.getState()).toMatchObject({
      status: "transferred",
      mode: "player",
      matchId: "room-1",
      error: "Game resumed on another device.",
    });
  });

  it("requires a fresh confirmation before retrying a takeover", () => {
    const { controller, options, socket } = setup();
    controller.join("https://play.test", session, "room-1");

    options().onError?.(
      "takeover_required",
      "This game is active on another device."
    );

    expect(controller.getState()).toMatchObject({
      status: "takeover-required",
      error: "This game is active on another device.",
    });

    controller.takeover();

    expect(socket.close).toHaveBeenCalledOnce();
    expect(options().takeover).toBe(true);
  });

  it("surfaces a terminal active-match conflict as an error screen", () => {
    const { controller, options } = setup();
    controller.join("https://play.test", session, "room-2");

    options().onError?.(
      "active_match_exists",
      "You already have an in-progress match (room-1)."
    );

    expect(controller.getState()).toMatchObject({
      status: "error",
      matchId: "room-2",
      error: "You already have an in-progress match (room-1).",
    });
  });

  it("uses spectator mode for active rooms and leaves waiting rooms", async () => {
    const { controller, socket, options } = setup();
    controller.watch("https://play.test", session, "room-2");
    expect(options().spectate).toBe(true);
    options().onMessage?.({
      type: "room_state",
      matchId: "room-2",
      status: "playing",
      mySeat: null,
      hostSeat: 0,
      canStart: false,
      seats: [0, 1, 2, 3].map((seat) => ({
        seat: seat as 0 | 1 | 2 | 3,
        occupant: { kind: "empty" as const },
        ready: false,
      })),
    });
    expect(controller.getState().status).toBe("spectating");

    controller.join("https://play.test", session, "room-3");
    options().onMessage?.({
      type: "room_state",
      matchId: "room-3",
      status: "waiting",
      mySeat: 1,
      hostSeat: 1,
      canStart: false,
      seats: [0, 1, 2, 3].map((seat) => ({
        seat: seat as 0 | 1 | 2 | 3,
        occupant: { kind: "empty" as const },
        ready: false,
      })),
    });
    await controller.leave();
    expect(socket.leaveSeat).toHaveBeenCalledOnce();
    expect(controller.getState()).toEqual(INITIAL_ONLINE_MATCH_STATE);
  });

  it("loads team enrichment for the active spectator match", async () => {
    const { controller, getSpectatorEnrichment } = setup();
    const enrichment = [
      {
        teamName: "East Club",
        teamLogoUrl: "https://play.test/east.webp",
      },
      null,
      null,
      null,
    ];
    getSpectatorEnrichment.mockResolvedValue(enrichment);

    controller.watch("https://play.test", session, "relay-1");

    await vi.waitFor(() => {
      expect(controller.getState().spectatorEnrichment).toEqual(enrichment);
    });
    expect(getSpectatorEnrichment).toHaveBeenCalledWith(
      "https://play.test",
      "relay-1"
    );
  });

  it("accumulates and deduplicates the spectator event timeline", () => {
    const { controller, options } = setup();
    controller.watch("https://play.test", session, "room-2");
    const message = {
      type: "event" as const,
      seq: 0,
      events: [
        {
          type: "match_start" as const,
          seats: [],
          ruleSet: "tenhou-default",
        },
      ],
      legalActions: [],
    };

    options().onMessage?.(message);
    options().onMessage?.(message);

    expect(controller.getState().spectatorTimeline).toMatchObject({
      lastSeq: 0,
      events: message.events,
    });
  });
});

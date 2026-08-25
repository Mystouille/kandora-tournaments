import { describe, expect, it, vi } from "vitest";
import type { GameWSOptions } from "~/game/client/ws";
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
  const controller = new OnlineMatchController({
    createRoom: vi.fn().mockResolvedValue("room-1"),
    getConnectionDetails: vi.fn().mockResolvedValue({
      token: "game-token",
      wsUrl: "wss://game.test/ws/game/room-1",
    }),
    createSocket: (nextOptions) => {
      options = nextOptions;
      return socket;
    },
    waitForLeave: () => Promise.resolve(),
  });
  return {
    controller,
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
});
import { afterEach, describe, expect, it } from "vitest";
import type { PluginListenerHandle } from "@capacitor/core";
import { useMatchStore } from "~/game/client/store";
import type { RoomState } from "~/game/protocol/messages";
import {
  setDelayAfterDiscardMs,
  setReadyCheckMs,
} from "~/game/server/src/match";
import { createMemoryMatchRepository } from "~/game/server/src/repository";
import type { MobileMatchRepositoryHandle } from "../persistence/mobileMatchRepository";
import {
  NearbyMatchController,
  type NearbyTransport,
} from "./NearbyMatchController";
import type {
  NearbyConnectionInitiated,
  NearbyConnectionResult,
  NearbyEndpoint,
  NearbyError,
  NearbyMessage,
} from "./NearbyConnections";
import {
  encodeNearbyFrame,
  NEARBY_PROTOCOL_VERSION,
  parseNearbyFrame,
} from "./protocol";

type FakeEventMap = {
  endpointFound: NearbyEndpoint;
  endpointLost: { endpointId: string };
  connectionInitiated: NearbyConnectionInitiated;
  connectionResult: NearbyConnectionResult;
  disconnected: { endpointId: string };
  message: NearbyMessage;
  nearbyError: NearbyError;
};

class FakeNearbyTransport implements NearbyTransport {
  readonly listeners = new Map<
    keyof FakeEventMap,
    Set<(event: never) => void>
  >();
  readonly sent: Array<{ endpointIds: string[]; data: string }> = [];
  readonly accepted: string[] = [];
  readonly requested: string[] = [];
  advertisingName: string | null = null;
  discovering = false;

  async getState() {
    return {
      available: true,
      advertising: false,
      discovering: false,
      connected: [],
      permissions: { granted: true, missing: [] },
    };
  }

  async requestNearbyPermissions() {
    return { granted: true, missing: [] };
  }

  async startAdvertising(options: { endpointName: string }) {
    this.advertisingName = options.endpointName;
  }

  async stopAdvertising() {
    this.advertisingName = null;
  }

  async startDiscovery() {
    this.discovering = true;
  }

  async stopDiscovery() {
    this.discovering = false;
  }

  async requestConnection(options: {
    endpointId: string;
    endpointName: string;
  }) {
    this.requested.push(options.endpointId);
  }

  async acceptConnection(options: { endpointId: string }) {
    this.accepted.push(options.endpointId);
  }

  async rejectConnection() {}

  async disconnect() {}

  async send(options: { endpointIds: string[]; data: string }) {
    this.sent.push(options);
  }

  async stopAll() {
    this.advertisingName = null;
    this.discovering = false;
  }

  async addListener<EventName extends keyof FakeEventMap>(
    eventName: EventName,
    listener: (event: FakeEventMap[EventName]) => void
  ): Promise<PluginListenerHandle> {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener as (event: never) => void);
    this.listeners.set(eventName, listeners);
    return {
      remove: async () => {
        listeners.delete(listener as (event: never) => void);
      },
    };
  }

  emit<EventName extends keyof FakeEventMap>(
    eventName: EventName,
    event: FakeEventMap[EventName]
  ): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(event as never);
    }
  }
}

function memoryPersistence(): MobileMatchRepositoryHandle {
  let activeMatch: Awaited<
    ReturnType<MobileMatchRepositoryHandle["getActiveMatch"]>
  > = null;
  return {
    repository: createMemoryMatchRepository(),
    storage: "memory",
    getActiveMatch: async () => activeMatch,
    setActiveMatch: async (nextActiveMatch) => {
      activeMatch = nextActiveMatch;
    },
    close: async () => undefined,
  };
}

function serverFrames(transport: FakeNearbyTransport, endpointId: string) {
  return transport.sent
    .filter((send) => send.endpointIds[0] === endpointId)
    .map((send) => parseNearbyFrame(send.data))
    .filter((frame) => frame.kind === "server");
}

describe("Nearby mobile match controller", () => {
  afterEach(() => {
    useMatchStore.getState().reset();
    setReadyCheckMs(0);
    setDelayAfterDiscardMs(350);
  });

  it("requires explicit pairing and keeps a remote callback through seat randomization", async () => {
    setReadyCheckMs(0);
    setDelayAfterDiscardMs(0);
    const transport = new FakeNearbyTransport();
    const persistence = memoryPersistence();
    const controller = new NearbyMatchController(persistence, transport);
    await controller.host({
      deviceId: "mobile:host",
      displayName: "Host",
    });

    expect(transport.advertisingName).toBe("Host's table");
    expect(controller.getState().status).toBe("lobby");
    transport.emit("connectionInitiated", {
      endpointId: "remote-endpoint",
      endpointName: "Guest",
      authenticationDigits: "3141",
      incoming: true,
    });
    expect(transport.accepted).toEqual([]);

    await controller.confirmPairing("remote-endpoint");
    expect(transport.accepted).toEqual(["remote-endpoint"]);
    transport.emit("connectionResult", {
      endpointId: "remote-endpoint",
      endpointName: "Guest",
      status: "connected",
    });
    transport.emit("message", {
      endpointId: "remote-endpoint",
      data: encodeNearbyFrame({
        version: NEARBY_PROTOCOL_VERSION,
        kind: "hello",
        deviceId: "mobile:guest",
        displayName: "Guest",
      }),
    });
    await controller.waitForIdle();

    const waitingRoom = controller.getState().roomState;
    expect(
      waitingRoom?.seats.filter((seat) => seat.occupant.kind === "human")
    ).toHaveLength(2);

    await controller.startMatch();
    await controller.waitForIdle();
    const roomFrames = serverFrames(transport, "remote-endpoint")
      .map((frame) => frame.message)
      .filter((message): message is RoomState => message.type === "room_state");
    const finalRoom = roomFrames.at(-1);
    expect(finalRoom?.status).toBe("playing");
    const guestSeat = finalRoom?.seats.find(
      (seat) =>
        seat.occupant.kind === "human" &&
        seat.occupant.userId === "mobile:guest"
    )?.seat;
    expect(finalRoom?.mySeat).toBe(guestSeat);
  });

  it("discovers, verifies, handshakes, and sends validated guest commands", async () => {
    const transport = new FakeNearbyTransport();
    const controller = new NearbyMatchController(
      memoryPersistence(),
      transport
    );
    await controller.discover({
      deviceId: "mobile:guest",
      displayName: "Guest",
    });
    transport.emit("endpointFound", {
      endpointId: "host-endpoint",
      endpointName: "Host's table",
    });
    await controller.requestConnection("host-endpoint");
    expect(transport.requested).toEqual(["host-endpoint"]);
    transport.emit("connectionInitiated", {
      endpointId: "host-endpoint",
      endpointName: "Host's table",
      authenticationDigits: "2718",
      incoming: false,
    });
    expect(transport.accepted).toEqual([]);
    await controller.confirmPairing("host-endpoint");
    transport.emit("connectionResult", {
      endpointId: "host-endpoint",
      endpointName: "Host's table",
      status: "connected",
    });
    await controller.waitForIdle();
    expect(parseNearbyFrame(transport.sent[0].data)).toMatchObject({
      kind: "hello",
      deviceId: "mobile:guest",
    });

    const roomState: RoomState = {
      type: "room_state",
      matchId: "nearby-room",
      status: "waiting",
      mySeat: 1,
      seats: [
        {
          seat: 0,
          occupant: {
            kind: "human",
            userId: "mobile:host",
            displayName: "Host",
            connected: true,
          },
        },
        {
          seat: 1,
          occupant: {
            kind: "human",
            userId: "mobile:guest",
            displayName: "Guest",
            connected: true,
          },
        },
        { seat: 2, occupant: { kind: "empty" } },
        { seat: 3, occupant: { kind: "empty" } },
      ],
    };
    transport.emit("message", {
      endpointId: "host-endpoint",
      data: encodeNearbyFrame({
        version: NEARBY_PROTOCOL_VERSION,
        kind: "server",
        message: roomState,
      }),
    });
    await controller.waitForIdle();
    expect(useMatchStore.getState()).toMatchObject({
      matchId: "nearby-room",
      mySeat: 1,
      conn: "open",
    });

    await controller.act("discard:draw:5m");
    await controller.waitForIdle();
    expect(parseNearbyFrame(transport.sent.at(-1)?.data ?? "")).toMatchObject({
      kind: "client",
      message: {
        type: "act",
        matchId: "nearby-room",
        actionId: "discard:draw:5m",
      },
    });
  });
});
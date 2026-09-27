import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginListenerHandle } from "@capacitor/core";
import { useMatchStore } from "~/game/client/store";
import type { RoomState } from "~/game/protocol/messages";
import type { MatchState } from "~/game/rules/state";
import {
  MatchProcess,
  setDelayAfterDiscardMs,
  setNextHandDelayMs,
  setReadyCheckMs,
} from "~/game/server/src/match";
import {
  createMemoryMobileMatchRepository,
  type MobileMatchRepositoryHandle,
} from "../persistence/mobileMatchRepository";
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
  NearbyPermissionState,
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
  permissionState: NearbyPermissionState = { granted: true, missing: [] };
  requestedPermissionState: NearbyPermissionState | null = null;
  settingsOpenCount = 0;

  async getState() {
    return {
      available: true,
      advertising: false,
      discovering: false,
      connected: [],
      permissions: this.permissionState,
    };
  }

  async requestNearbyPermissions() {
    if (this.requestedPermissionState !== null) {
      this.permissionState = this.requestedPermissionState;
    }
    return this.permissionState;
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

  async openAppSettings() {
    this.settingsOpenCount += 1;
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
  const { repository, replayStore } = createMemoryMobileMatchRepository();
  return {
    repository,
    eventJournalStore: repository,
    replayStore,
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
  it("tracks permissions and opens app settings when a request remains denied", async () => {
    const transport = new FakeNearbyTransport();
    transport.permissionState = {
      granted: false,
      missing: ["bluetooth"],
    };
    const controller = new NearbyMatchController(
      memoryPersistence(),
      transport
    );

    await controller.initialize();
    expect(controller.getState().permissions).toEqual({
      granted: false,
      missing: ["bluetooth"],
    });

    await controller.requestPermissions();
    expect(transport.settingsOpenCount).toBe(1);

    transport.requestedPermissionState = { granted: true, missing: [] };
    await controller.requestPermissions();
    expect(transport.settingsOpenCount).toBe(1);
    expect(controller.getState().permissions).toEqual({
      granted: true,
      missing: [],
    });
  });

  it("discovers a saved host without restoring or advertising it", async () => {
    const persistence = memoryPersistence();
    await persistence.setActiveMatch({
      matchId: "nearby-saved",
      owner: "nearby-host",
    });
    const transport = new FakeNearbyTransport();
    const controller = new NearbyMatchController(persistence, transport);

    await controller.discoverSavedHost();

    expect(controller.getState()).toMatchObject({
      role: "host",
      status: "paused",
      matchId: "nearby-saved",
    });
    expect(transport.advertisingName).toBeNull();
    expect(useMatchStore.getState().matchId).toBeNull();
  });

  it("waits for active command work and closes intake before pausing", async () => {
    const controller = new NearbyMatchController(
      memoryPersistence(),
      new FakeNearbyTransport()
    );
    let releaseCommand!: () => void;
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const internals = controller as unknown as {
      enqueueCommand(operation: () => Promise<void>): Promise<void>;
    };
    let activeStarted = false;
    const active = internals.enqueueCommand(async () => {
      activeStarted = true;
      await commandGate;
    });
    await Promise.resolve();
    expect(activeStarted).toBe(true);

    let pauseFinished = false;
    const pausing = controller.pause().then(() => {
      pauseFinished = true;
    });
    let lateCommandRan = false;
    await internals.enqueueCommand(async () => {
      lateCommandRan = true;
    });
    await Promise.resolve();
    expect(pauseFinished).toBe(false);
    expect(lateCommandRan).toBe(false);

    releaseCommand();
    await active;
    await pausing;
    expect(pauseFinished).toBe(true);
  });

  afterEach(() => {
    useMatchStore.getState().reset();
    setReadyCheckMs(0);
    setDelayAfterDiscardMs(350);
    setNextHandDelayMs(5_000);
  });

  it("auto-accepts a guest and keeps its callback through seat randomization", async () => {
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
    await controller.waitForIdle();
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
    expect(waitingRoom?.canStart).toBe(false);

    await controller.setWaitingRoomReady(true);
    transport.emit("message", {
      endpointId: "remote-endpoint",
      data: encodeNearbyFrame({
        version: NEARBY_PROTOCOL_VERSION,
        kind: "client",
        message: {
          type: "set_room_ready",
          matchId: waitingRoom?.matchId ?? "",
          ready: true,
        },
      }),
    });
    await controller.waitForIdle();
    expect(controller.getState().roomState?.canStart).toBe(true);

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

    transport.emit("disconnected", { endpointId: "remote-endpoint" });
    expect(controller.getState().status).toBe("playing");
    transport.emit("connectionInitiated", {
      endpointId: "rejoined-endpoint",
      endpointName: "Guest",
      authenticationDigits: "9999",
      incoming: true,
    });
    await controller.waitForIdle();
    expect(transport.accepted).toEqual([
      "remote-endpoint",
      "rejoined-endpoint",
    ]);
    expect(controller.getState().status).toBe("playing");
    transport.emit("connectionResult", {
      endpointId: "rejoined-endpoint",
      endpointName: "Guest",
      status: "connected",
    });
    transport.emit("message", {
      endpointId: "rejoined-endpoint",
      data: encodeNearbyFrame({
        version: NEARBY_PROTOCOL_VERSION,
        kind: "hello",
        deviceId: "mobile:guest",
        displayName: "Guest",
      }),
    });
    await controller.waitForIdle();

    const rejoinFrames = serverFrames(transport, "rejoined-endpoint").map(
      (frame) => frame.message
    );
    expect(rejoinFrames).toContainEqual(
      expect.objectContaining({
        type: "room_state",
        status: "playing",
        mySeat: guestSeat,
      })
    );
    expect(rejoinFrames).toContainEqual(
      expect.objectContaining({ type: "snapshot" })
    );
    expect(controller.getState().status).toBe("playing");
  });

  it("keeps a post-hand ready gate open until the Nearby host confirms", async () => {
    setReadyCheckMs(0);
    setDelayAfterDiscardMs(0);
    setNextHandDelayMs(60_000);
    const transport = new FakeNearbyTransport();
    const controller = new NearbyMatchController(
      memoryPersistence(),
      transport
    );
    await controller.host({
      deviceId: "mobile:host",
      displayName: "Host",
    });
    transport.emit("connectionInitiated", {
      endpointId: "remote-endpoint",
      endpointName: "Guest",
      authenticationDigits: "3141",
      incoming: true,
    });
    await controller.waitForIdle();
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

    const matchId = controller.getState().matchId;
    if (matchId === null) {
      throw new Error("expected an active Nearby room");
    }
    await controller.setWaitingRoomReady(true);
    transport.emit("message", {
      endpointId: "remote-endpoint",
      data: encodeNearbyFrame({
        version: NEARBY_PROTOCOL_VERSION,
        kind: "client",
        message: {
          type: "set_room_ready",
          matchId,
          ready: true,
        },
      }),
    });
    await controller.waitForIdle();
    await controller.startMatch();
    await controller.waitForIdle();

    const controllerInternals = controller as unknown as {
      match: MatchProcess | null;
      enqueueCommand(operation: () => Promise<void>): Promise<void>;
    };
    const match = controllerInternals.match;
    if (match === null) {
      throw new Error("expected the host match process");
    }
    const matchInternals = match as unknown as {
      state: MatchState;
      afterHandEnd(): Promise<void>;
    };
    matchInternals.state.phase = "hand_ended";
    matchInternals.state.lastHandResult = {
      reason: "exhaustive_draw",
      winner: null,
      loser: null,
      delta: [0, 0, 0, 0],
      tenpai: [false, false, false, false],
      abortKind: null,
      winHan: null,
      winYakuman: null,
    };

    const advancing = controllerInternals.enqueueCommand(() =>
      matchInternals.afterHandEnd()
    );
    await vi.waitFor(() => {
      expect(useMatchStore.getState().readyCheck).not.toBeNull();
    });

    const hostSeat = useMatchStore.getState().mySeat;
    const guestSeat = controller
      .getState()
      .roomState?.seats.find(
        ({ occupant }) =>
          occupant.kind === "human" && occupant.userId === "mobile:guest"
      )?.seat;
    if (hostSeat === null || guestSeat === undefined) {
      throw new Error("expected host and guest seat assignments");
    }
    expect(useMatchStore.getState().readyCheck?.acked[hostSeat]).toBe(false);

    transport.emit("message", {
      endpointId: "remote-endpoint",
      data: encodeNearbyFrame({
        version: NEARBY_PROTOCOL_VERSION,
        kind: "client",
        message: {
          type: "ready",
          matchId,
        },
      }),
    });
    await vi.waitFor(() => {
      expect(useMatchStore.getState().readyCheck?.acked[guestSeat]).toBe(true);
    });
    expect(useMatchStore.getState().readyCheck?.acked[hostSeat]).toBe(false);
    expect(match.createCheckpoint()).toMatchObject({
      checkpointKind: "ready_check",
      readyContinuation: "next_hand",
    });

    await controller.ready();
    await advancing;

    expect(useMatchStore.getState().readyCheck).toBeNull();
    expect(match.createCheckpoint()).not.toMatchObject({
      checkpointKind: "ready_check",
    });
    await controller.pause();
  });

  it("discovers, auto-accepts, handshakes, and sends validated guest commands", async () => {
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
    await controller.waitForIdle();
    expect(transport.accepted).toEqual(["host-endpoint"]);
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
      hostSeat: 0,
      canStart: false,
      seats: [
        {
          seat: 0,
          occupant: {
            kind: "human",
            userId: "mobile:host",
            displayName: "Host",
            connected: true,
          },
          ready: false,
        },
        {
          seat: 1,
          occupant: {
            kind: "human",
            userId: "mobile:guest",
            displayName: "Guest",
            connected: true,
          },
          ready: false,
        },
        { seat: 2, occupant: { kind: "empty" }, ready: false },
        { seat: 3, occupant: { kind: "empty" }, ready: false },
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

    transport.emit("message", {
      endpointId: "host-endpoint",
      data: encodeNearbyFrame({
        version: NEARBY_PROTOCOL_VERSION,
        kind: "server",
        message: { type: "room_kicked", matchId: "nearby-room" },
      }),
    });
    await controller.waitForIdle();
    expect(controller.getState()).toMatchObject({
      role: "idle",
      matchId: null,
      roomState: null,
    });
  });

  it("closes the table and kicks guests when the transport host leaves", async () => {
    const transport = new FakeNearbyTransport();
    const persistence = memoryPersistence();
    const controller = new NearbyMatchController(persistence, transport);
    await controller.host({
      deviceId: "mobile:host",
      displayName: "Host",
    });
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

    await controller.leave();
    await controller.waitForIdle();

    expect(controller.getState()).toMatchObject({
      role: "idle",
      matchId: null,
      roomState: null,
    });
    expect(await persistence.getActiveMatch()).toBeNull();
    expect(transport.advertisingName).toBeNull();
    expect(
      serverFrames(transport, "remote-endpoint").some(
        (frame) => frame.message.type === "room_kicked"
      )
    ).toBe(true);
  });
});

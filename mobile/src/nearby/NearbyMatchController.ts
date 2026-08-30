import type { PluginListenerHandle } from "@capacitor/core";
import { dispatchServerMessage } from "~/game/client/dispatchServerMessage";
import { useMatchStore } from "~/game/client/store";
import {
  ClientMessageSchema,
  type ClientMessage,
  type RoomState,
  type ServerMessage,
} from "~/game/protocol/messages";
import { MatchProcess } from "~/game/server/src/match";
import { createSystemMatchRuntime } from "~/game/server/src/runtime";
import type { MobileMatchRepositoryHandle } from "../persistence/mobileMatchRepository";
import {
  NearbyConnections,
  type NearbyConnectionInitiated,
  type NearbyConnectionResult,
  type NearbyConnectionsPlugin,
  type NearbyEndpoint,
  type NearbyError,
  type NearbyMessage,
  type NearbyPermissionState,
  type NearbyState,
} from "./NearbyConnections";
import {
  encodeNearbyFrame,
  NEARBY_PROTOCOL_VERSION,
  parseNearbyFrame,
  type NearbyFrame,
} from "./protocol";

export interface NearbyIdentity {
  deviceId: string;
  displayName: string;
}

export interface NearbyMatchControllerState {
  role: "idle" | "host" | "guest";
  status:
    | "idle"
    | "opening"
    | "advertising"
    | "discovering"
    | "pairing"
    | "connecting"
    | "lobby"
    | "playing"
    | "paused"
    | "disconnected"
    | "finished"
    | "error";
  available: boolean;
  matchId: string | null;
  roomState: RoomState | null;
  discovered: NearbyEndpoint[];
  pairings: NearbyConnectionInitiated[];
  connected: NearbyEndpoint[];
  error: string | null;
}

type NearbyEventMap = {
  endpointFound: NearbyEndpoint;
  endpointLost: { endpointId: string };
  connectionInitiated: NearbyConnectionInitiated;
  connectionResult: NearbyConnectionResult;
  disconnected: { endpointId: string };
  message: NearbyMessage;
  nearbyError: NearbyError;
};

export interface NearbyTransport {
  getState(): Promise<NearbyState>;
  requestNearbyPermissions(): Promise<NearbyPermissionState>;
  startAdvertising(options: { endpointName: string }): Promise<void>;
  stopAdvertising(): Promise<void>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  requestConnection(options: {
    endpointId: string;
    endpointName: string;
  }): Promise<void>;
  acceptConnection(options: { endpointId: string }): Promise<void>;
  rejectConnection(options: { endpointId: string }): Promise<void>;
  disconnect(options: { endpointId: string }): Promise<void>;
  send(options: { endpointIds: string[]; data: string }): Promise<void>;
  stopAll(): Promise<void>;
  addListener<EventName extends keyof NearbyEventMap>(
    eventName: EventName,
    listener: (event: NearbyEventMap[EventName]) => void
  ): Promise<PluginListenerHandle>;
}

type MatchSend = (message: ServerMessage) => void;
type StateListener = (state: NearbyMatchControllerState) => void;

export const INITIAL_NEARBY_MATCH_STATE: NearbyMatchControllerState = {
  role: "idle",
  status: "idle",
  available: false,
  matchId: null,
  roomState: null,
  discovered: [],
  pairings: [],
  connected: [],
  error: null,
};

function randomUint32(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}

function replaceEndpoint(
  endpoints: NearbyEndpoint[],
  endpoint: NearbyEndpoint
): NearbyEndpoint[] {
  return [
    ...endpoints.filter(
      (candidate) => candidate.endpointId !== endpoint.endpointId
    ),
    endpoint,
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Nearby operation failed";
}

export class NearbyMatchController {
  private readonly listeners = new Set<StateListener>();
  private readonly listenerHandles: PluginListenerHandle[] = [];
  private readonly remoteSends = new Map<string, MatchSend>();
  private readonly remoteIdentities = new Map<string, NearbyIdentity>();
  private readonly outbound = new Map<string, Promise<void>>();
  private match: MatchProcess | null = null;
  private identity: NearbyIdentity | null = null;
  private hostEndpointId: string | null = null;
  private initializePromise: Promise<void> | null = null;
  private controlQueue: Promise<void> = Promise.resolve();
  private commandQueue: Promise<void> = Promise.resolve();
  private commandIntakeOpen = true;
  private matchStartPromise: Promise<void> | null = null;
  private state: NearbyMatchControllerState = INITIAL_NEARBY_MATCH_STATE;

  private readonly localSend: MatchSend = (message) => {
    this.handleServerMessage(message);
  };

  constructor(
    private readonly persistence: MobileMatchRepositoryHandle,
    private readonly transport: NearbyTransport = NearbyConnections as unknown as NearbyTransport
  ) {}

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): NearbyMatchControllerState {
    return this.state;
  }

  initialize(): Promise<void> {
    if (this.initializePromise !== null) {
      return this.initializePromise;
    }
    this.initializePromise = this.installListeners();
    return this.initializePromise;
  }

  host(identity: NearbyIdentity): Promise<void> {
    return this.enqueueControl(async () => {
      await this.initialize();
      await this.stopTransportAndDetachRemotes();
      await this.requirePermissions();
      this.identity = identity;
      this.hostEndpointId = null;
      this.update({
        role: "host",
        status: "opening",
        matchId: null,
        roomState: null,
        discovered: [],
        pairings: [],
        connected: [],
        error: null,
      });

      const seed = randomUint32();
      const matchId = `nearby-${Date.now().toString(36)}-${seed.toString(36)}`;
      const room = MatchProcess.createWaitingRoom(
        matchId,
        seed,
        {
          repository: this.persistence.repository,
          eventJournalStore: this.persistence.eventJournalStore,
          runtime: createSystemMatchRuntime(seed),
        },
        undefined,
        undefined,
        "tenhou-hanchan"
      );
      const seat = room.claimSeat(identity.deviceId, identity.displayName);
      if (seat === null) {
        throw new Error("Could not claim the host seat");
      }
      await room.pauseAndSaveCheckpoint();
      const restored = await MatchProcess.restoreSavedCheckpoint(matchId, {
        repository: this.persistence.repository,
        eventJournalStore: this.persistence.eventJournalStore,
        runtime: createSystemMatchRuntime(seed),
      });
      if (restored === null) {
        throw new Error("Could not establish the Nearby recovery point");
      }
      this.installHostMatch(restored, identity);
      await restored.deleteSavedCheckpoint();
      await this.persistence.setActiveMatch({
        matchId,
        owner: "nearby-host",
      });
      await this.transport.startAdvertising({
        endpointName: `${identity.displayName}'s table`,
      });
      this.commandIntakeOpen = true;
      this.update({ status: "lobby", matchId, error: null });
    });
  }

  restoreHost(identity: NearbyIdentity): Promise<void> {
    return this.enqueueControl(async () => {
      await this.initialize();
      const activeMatch = await this.persistence.getActiveMatch();
      if (activeMatch === null || activeMatch.owner !== "nearby-host") {
        return;
      }
      await this.stopTransportAndDetachRemotes();
      await this.requirePermissions();
      this.identity = identity;
      this.update({
        role: "host",
        status: "opening",
        matchId: activeMatch.matchId,
        discovered: [],
        pairings: [],
        connected: [],
        error: null,
      });
      const restored = await MatchProcess.restoreSavedCheckpoint(
        activeMatch.matchId,
        {
          repository: this.persistence.repository,
          eventJournalStore: this.persistence.eventJournalStore,
          runtime: createSystemMatchRuntime(0),
        }
      );
      if (restored === null) {
        await this.persistence.setActiveMatch(null);
        this.resetSessionState();
        return;
      }
      this.installHostMatch(restored, identity);
      await restored.deleteSavedCheckpoint();
      await this.transport.startAdvertising({
        endpointName: `${identity.displayName}'s table`,
      });
      this.commandIntakeOpen = true;
      this.update({
        status: restored.status === "waiting" ? "lobby" : "playing",
        matchId: restored.matchId,
        error: null,
      });
    });
  }

  discover(identity: NearbyIdentity): Promise<void> {
    return this.enqueueControl(async () => {
      await this.initialize();
      await this.stopTransportAndDetachRemotes();
      await this.requirePermissions();
      this.identity = identity;
      this.hostEndpointId = null;
      this.match = null;
      useMatchStore.getState().reset();
      await this.transport.startDiscovery();
      this.commandIntakeOpen = true;
      this.update({
        role: "guest",
        status: "discovering",
        matchId: null,
        roomState: null,
        discovered: [],
        pairings: [],
        connected: [],
        error: null,
      });
    });
  }

  requestConnection(endpointId: string): Promise<void> {
    return this.enqueueControl(async () => {
      if (this.state.role !== "guest" || this.identity === null) {
        throw new Error("Start Nearby discovery before connecting");
      }
      const endpoint = this.state.discovered.find(
        (candidate) => candidate.endpointId === endpointId
      );
      if (endpoint === undefined) {
        throw new Error("That Nearby table is no longer available");
      }
      await this.transport.requestConnection({
        endpointId,
        endpointName: this.identity.displayName,
      });
      this.update({ status: "connecting", error: null });
    });
  }

  confirmPairing(endpointId: string): Promise<void> {
    return this.enqueueControl(async () => {
      if (
        !this.state.pairings.some(
          (pairing) => pairing.endpointId === endpointId
        )
      ) {
        throw new Error("That pairing request is no longer active");
      }
      await this.transport.acceptConnection({ endpointId });
      this.update({ status: "connecting", error: null });
    });
  }

  rejectPairing(endpointId: string): Promise<void> {
    return this.enqueueControl(async () => {
      await this.transport.rejectConnection({ endpointId });
      this.update({
        pairings: this.state.pairings.filter(
          (pairing) => pairing.endpointId !== endpointId
        ),
        status: this.state.role === "host" ? "lobby" : "discovering",
      });
    });
  }

  startMatch(): Promise<void> {
    return this.sendClientMessage({
      type: "start_match",
      matchId: this.requireMatchId(),
    });
  }

  setWaitingRoomReady(ready: boolean): Promise<void> {
    return this.sendClientMessage({
      type: "set_room_ready",
      matchId: this.requireMatchId(),
      ready,
    });
  }

  addWaitingRoomBot(): Promise<void> {
    return this.sendClientMessage({
      type: "add_bot",
      matchId: this.requireMatchId(),
    });
  }

  kickWaitingRoomSeat(seat: 0 | 1 | 2 | 3): Promise<void> {
    return this.sendClientMessage({
      type: "kick_seat",
      matchId: this.requireMatchId(),
      seat,
    });
  }

  act(actionId: string): Promise<void> {
    return this.sendClientMessage({
      type: "act",
      matchId: this.requireMatchId(),
      actionId,
    });
  }

  ready(): Promise<void> {
    return this.sendClientMessage({
      type: "ready",
      matchId: this.requireMatchId(),
    });
  }

  setAfk(afk: boolean): Promise<void> {
    return this.sendClientMessage({
      type: "afk",
      matchId: this.requireMatchId(),
      afk,
    });
  }

  voteContinue(vote: "yes" | "no"): Promise<void> {
    return this.sendClientMessage({
      type: "vote_continue",
      matchId: this.requireMatchId(),
      vote,
    });
  }

  leave(): Promise<void> {
    this.commandIntakeOpen = false;
    return this.enqueueControl(async () => {
      await this.commandQueue;
      if (this.state.role === "guest" && this.state.matchId !== null) {
        await this.sendClientMessage({
          type: "leave_seat",
          matchId: this.state.matchId,
        });
      } else if (this.state.role === "host") {
        if (this.match?.status === "waiting" || this.match === null) {
          await this.closeHostWaitingRoom();
        } else {
          await this.pauseHost();
        }
      }
      await this.stopTransportAndDetachRemotes();
      this.match = null;
      this.hostEndpointId = null;
      useMatchStore.getState().reset();
      this.resetSessionState();
    });
  }

  pause(): Promise<void> {
    this.commandIntakeOpen = false;
    return this.enqueueControl(async () => {
      await this.commandQueue;
      try {
        if (this.state.role === "host") {
          if (this.match?.status === "waiting") {
            await this.closeHostWaitingRoom();
          } else {
            await this.pauseHost();
          }
        }
        await this.stopTransportAndDetachRemotes();
        if (this.state.role === "guest") {
          useMatchStore.getState().setConn("closed");
          this.update({ status: "disconnected" });
        }
      } catch (error) {
        if (this.match !== null) {
          this.commandIntakeOpen = true;
        }
        throw error;
      }
    });
  }

  async dispose(): Promise<void> {
    await this.pause();
    for (const handle of this.listenerHandles.splice(0)) {
      await handle.remove();
    }
    this.listeners.clear();
  }

  async waitForIdle(): Promise<void> {
    await this.controlQueue;
    await this.commandQueue;
    if (this.matchStartPromise !== null) {
      await this.matchStartPromise;
    }
    await Promise.all(this.outbound.values());
  }

  private async installListeners(): Promise<void> {
    const nativeState = await this.transport.getState();
    this.update({ available: nativeState.available });
    const handles = await Promise.all([
      this.transport.addListener("endpointFound", (event) => {
        this.update({
          discovered: replaceEndpoint(this.state.discovered, event),
        });
      }),
      this.transport.addListener("endpointLost", ({ endpointId }) => {
        this.update({
          discovered: this.state.discovered.filter(
            (endpoint) => endpoint.endpointId !== endpointId
          ),
        });
      }),
      this.transport.addListener("connectionInitiated", (event) => {
        this.update({
          status: "pairing",
          pairings: [
            ...this.state.pairings.filter(
              (pairing) => pairing.endpointId !== event.endpointId
            ),
            event,
          ],
          error: null,
        });
      }),
      this.transport.addListener("connectionResult", (event) => {
        this.handleConnectionResult(event);
      }),
      this.transport.addListener("disconnected", ({ endpointId }) => {
        this.handleDisconnected(endpointId);
      }),
      this.transport.addListener("message", (event) => {
        void this.enqueueCommand(async () => {
          await this.handleIncomingMessage(event);
        });
      }),
      this.transport.addListener("nearbyError", (event) => {
        this.update({
          status: "error",
          error: `${event.operation}: ${event.message}`,
        });
      }),
    ]);
    this.listenerHandles.push(...handles);
  }

  private async requirePermissions(): Promise<void> {
    const permissions = await this.transport.requestNearbyPermissions();
    if (!permissions.granted) {
      throw new Error(
        `Nearby permissions are required: ${permissions.missing.join(", ")}`
      );
    }
  }

  private installHostMatch(
    match: MatchProcess,
    identity: NearbyIdentity
  ): void {
    const seat = match.claimSeat(identity.deviceId, identity.displayName);
    if (seat === null) {
      throw new Error("The saved host seat is unavailable");
    }
    this.match = match;
    useMatchStore.getState().setMatch(match.matchId, seat);
    useMatchStore.getState().setConn("open");
    match.attachHuman(seat, this.localSend, async () => true);
    this.localSend(match.buildRoomState(seat));
    if (match.status === "playing" || match.status === "finished") {
      this.localSend(match.buildSnapshotForSeat(seat));
    }
  }

  private handleConnectionResult(event: NearbyConnectionResult): void {
    const pairings = this.state.pairings.filter(
      (pairing) => pairing.endpointId !== event.endpointId
    );
    if (event.status !== "connected") {
      this.update({
        pairings,
        status: this.state.role === "host" ? "lobby" : "discovering",
        error:
          event.status === "rejected"
            ? "The pairing request was rejected"
            : "The Nearby connection failed",
      });
      return;
    }
    const connected = replaceEndpoint(this.state.connected, event);
    this.update({ connected, pairings, error: null });
    if (this.state.role === "guest" && this.identity !== null) {
      this.hostEndpointId = event.endpointId;
      void this.transport.stopDiscovery();
      void this.queueFrame(event.endpointId, {
        version: NEARBY_PROTOCOL_VERSION,
        kind: "hello",
        deviceId: this.identity.deviceId,
        displayName: this.identity.displayName,
      });
      this.update({ status: "connecting" });
      return;
    }
    if (this.state.role === "host") {
      this.update({
        status: this.match?.status === "waiting" ? "lobby" : "playing",
      });
    }
  }

  private handleDisconnected(endpointId: string): void {
    const send = this.remoteSends.get(endpointId);
    if (this.match !== null && send !== undefined) {
      const seat = this.match.humanSeatFor(send);
      if (seat !== null) {
        this.match.detachHuman(seat, send);
      }
    }
    this.remoteSends.delete(endpointId);
    this.remoteIdentities.delete(endpointId);
    this.outbound.delete(endpointId);
    const connected = this.state.connected.filter(
      (endpoint) => endpoint.endpointId !== endpointId
    );
    if (this.state.role === "guest" && this.hostEndpointId === endpointId) {
      this.hostEndpointId = null;
      useMatchStore.getState().reset();
      this.resetSessionState();
      void this.transport.stopAll();
      return;
    }
    this.update({ connected });
  }

  private async handleIncomingMessage(event: NearbyMessage): Promise<void> {
    let frame: NearbyFrame;
    try {
      frame = parseNearbyFrame(event.data);
    } catch (error) {
      if (this.state.role === "host") {
        await this.sendError(
          event.endpointId,
          "validation_error",
          errorMessage(error)
        );
      } else {
        this.update({ status: "error", error: errorMessage(error) });
      }
      return;
    }
    if (this.state.role === "host") {
      await this.handleHostFrame(event.endpointId, frame);
      return;
    }
    if (
      this.state.role === "guest" &&
      event.endpointId === this.hostEndpointId &&
      frame.kind === "server"
    ) {
      this.handleServerMessage(frame.message);
    }
  }

  private async handleHostFrame(
    endpointId: string,
    frame: NearbyFrame
  ): Promise<void> {
    if (frame.kind === "hello") {
      await this.attachRemote(endpointId, {
        deviceId: frame.deviceId,
        displayName: frame.displayName,
      });
      return;
    }
    if (frame.kind !== "client") {
      await this.sendError(
        endpointId,
        "unexpected_frame",
        "The host only accepts hello and client frames"
      );
      return;
    }
    const send = this.remoteSends.get(endpointId);
    const match = this.match;
    const seat =
      send === undefined ? null : (match?.humanSeatFor(send) ?? null);
    if (match === null || send === undefined || seat === null) {
      await this.sendError(
        endpointId,
        "hello_required",
        "Complete the Nearby session handshake first"
      );
      return;
    }
    await this.applyClientMessage(match, seat, frame.message, send);
  }

  private async attachRemote(
    endpointId: string,
    identity: NearbyIdentity
  ): Promise<void> {
    const match = this.match;
    if (match === null) {
      await this.sendError(
        endpointId,
        "host_unavailable",
        "The host has no active room"
      );
      return;
    }
    for (const [otherEndpointId, otherIdentity] of this.remoteIdentities) {
      if (
        otherEndpointId !== endpointId &&
        otherIdentity.deviceId === identity.deviceId
      ) {
        this.detachRemote(otherEndpointId);
        void this.transport.disconnect({ endpointId: otherEndpointId });
      }
    }
    const existingSend = this.remoteSends.get(endpointId);
    if (existingSend !== undefined) {
      const existingSeat = match.humanSeatFor(existingSend);
      if (existingSeat !== null) {
        this.queueServerMessage(endpointId, match.buildRoomState(existingSeat));
        if (match.status !== "waiting") {
          this.queueServerMessage(
            endpointId,
            match.buildSnapshotForSeat(existingSeat)
          );
        }
        return;
      }
    }
    const seat = match.claimSeat(identity.deviceId, identity.displayName);
    if (seat === null) {
      await this.sendError(endpointId, "room_full", "This Nearby room is full");
      return;
    }
    const send: MatchSend = (message) => {
      this.queueServerMessage(endpointId, message);
    };
    this.remoteSends.set(endpointId, send);
    this.remoteIdentities.set(endpointId, identity);
    match.attachHuman(seat, send, async () => true);
    if (match.status !== "waiting") {
      this.queueServerMessage(endpointId, match.buildSnapshotForSeat(seat));
    }
  }

  private detachRemote(endpointId: string): void {
    const send = this.remoteSends.get(endpointId);
    if (send !== undefined && this.match !== null) {
      const seat = this.match.humanSeatFor(send);
      if (seat !== null) {
        this.match.detachHuman(seat, send);
      }
    }
    this.remoteSends.delete(endpointId);
    this.remoteIdentities.delete(endpointId);
    this.outbound.delete(endpointId);
  }

  private handleServerMessage(message: ServerMessage): void {
    if (message.type === "room_kicked") {
      this.hostEndpointId = null;
      this.match = null;
      useMatchStore.getState().reset();
      this.resetSessionState();
      void this.transport.stopAll();
      return;
    }
    if (message.type === "room_state") {
      if (useMatchStore.getState().matchId !== message.matchId) {
        useMatchStore.getState().setMatch(message.matchId, message.mySeat);
      }
      useMatchStore.getState().setConn("open");
      this.update({
        matchId: message.matchId,
        roomState: message,
        status:
          message.status === "waiting"
            ? "lobby"
            : message.status === "finished"
              ? "finished"
              : "playing",
      });
    }
    dispatchServerMessage(message, {
      onError: (code, text) => {
        this.update({ error: `${code}: ${text}` });
      },
    });
    if (
      message.type === "event" &&
      message.events.some((event) => event.type === "session_end")
    ) {
      if (this.state.role === "host") {
        void this.persistence.setActiveMatch(null);
      }
      this.update({ status: "finished", error: null });
    }
  }

  private sendClientMessage(message: ClientMessage): Promise<void> {
    const parsed = ClientMessageSchema.parse(message);
    return this.enqueueCommand(async () => {
      if (this.state.role === "guest") {
        if (this.hostEndpointId === null) {
          throw new Error("The Nearby host is not connected");
        }
        await this.queueFrame(this.hostEndpointId, {
          version: NEARBY_PROTOCOL_VERSION,
          kind: "client",
          message: parsed,
        });
        return;
      }
      if (this.state.role !== "host" || this.match === null) {
        throw new Error("No Nearby match is active");
      }
      const seat = this.match.humanSeatFor(this.localSend);
      if (seat === null) {
        throw new Error("The host seat is not attached");
      }
      await this.applyClientMessage(this.match, seat, parsed, this.localSend);
    });
  }

  private async applyClientMessage(
    match: MatchProcess,
    seat: 0 | 1 | 2 | 3,
    message: ClientMessage,
    send: MatchSend
  ): Promise<void> {
    if (message.matchId !== match.matchId) {
      send({
        type: "error",
        code: "matchid_mismatch",
        message: "The client frame targets a different match",
      });
      return;
    }
    switch (message.type) {
      case "act": {
        await match.handleAct(seat, message.actionId);
        return;
      }
      case "ready": {
        await match.handleReady(seat);
        return;
      }
      case "set_room_ready": {
        try {
          match.setWaitingRoomReady(seat, message.ready);
        } catch (error) {
          send({
            type: "error",
            code: "ready_rejected",
            message: errorMessage(error),
          });
        }
        return;
      }
      case "resync": {
        send(match.buildSnapshotForSeat(seat));
        return;
      }
      case "start_match": {
        if (match.status !== "waiting") {
          send({
            type: "error",
            code: "start_rejected",
            message: `Cannot start match in status "${match.status}"`,
          });
          return;
        }
        const starting = match.startWaitingRoom(seat);
        this.matchStartPromise = starting;
        void starting
          .catch((error: unknown) => {
            send({
              type: "error",
              code: "start_failed",
              message: errorMessage(error),
            });
          })
          .finally(() => {
            if (this.matchStartPromise === starting) {
              this.matchStartPromise = null;
            }
          });
        return;
      }
      case "add_bot": {
        try {
          match.addWaitingRoomBot(seat);
        } catch (error) {
          send({
            type: "error",
            code: "add_bot_rejected",
            message: errorMessage(error),
          });
        }
        return;
      }
      case "kick_seat": {
        try {
          match.kickWaitingRoomSeat(seat, message.seat);
        } catch (error) {
          send({
            type: "error",
            code: "kick_rejected",
            message: errorMessage(error),
          });
        }
        return;
      }
      case "leave_seat": {
        if (match.status !== "waiting") {
          send({
            type: "error",
            code: "leave_rejected",
            message: "Cannot leave once the match has started",
          });
          return;
        }
        match.releaseSeat(seat);
        return;
      }
      case "afk": {
        await match.handleAfk(seat, message.afk);
        return;
      }
      case "vote_continue": {
        await match.handleVoteContinue(seat, message.vote);
        return;
      }
      case "hello": {
        send({
          type: "error",
          code: "unexpected_hello",
          message: "Use the Nearby session handshake",
        });
      }
    }
  }

  private queueServerMessage(endpointId: string, message: ServerMessage): void {
    void this.queueFrame(endpointId, {
      version: NEARBY_PROTOCOL_VERSION,
      kind: "server",
      message,
    });
  }

  private sendError(
    endpointId: string,
    code: string,
    message: string
  ): Promise<void> {
    return this.queueFrame(endpointId, {
      version: NEARBY_PROTOCOL_VERSION,
      kind: "server",
      message: { type: "error", code, message },
    });
  }

  private queueFrame(endpointId: string, frame: NearbyFrame): Promise<void> {
    const data = encodeNearbyFrame(frame);
    const previous = this.outbound.get(endpointId) ?? Promise.resolve();
    const sending = previous
      .catch(() => undefined)
      .then(() => this.transport.send({ endpointIds: [endpointId], data }));
    const tracked = sending.catch((error: unknown) => {
      this.update({ status: "error", error: errorMessage(error) });
    });
    this.outbound.set(endpointId, tracked);
    void tracked.then(() => {
      if (this.outbound.get(endpointId) === tracked) {
        this.outbound.delete(endpointId);
      }
    });
    return tracked;
  }

  private async pauseHost(): Promise<void> {
    const match = this.match;
    if (match === null || match.status === "finished" || match.isPaused) {
      return;
    }
    await match.pauseAndSaveCheckpoint();
    const localSeat = match.humanSeatFor(this.localSend);
    if (localSeat !== null) {
      match.detachHuman(localSeat, this.localSend);
    }
    for (const endpointId of [...this.remoteSends.keys()]) {
      this.detachRemote(endpointId);
    }
    this.match = null;
    useMatchStore.getState().setConn("closed");
    this.update({ status: "paused" });
  }

  private async closeHostWaitingRoom(): Promise<void> {
    const match = this.match;
    if (match !== null && match.status === "waiting") {
      const hostSeat = match.humanSeatFor(this.localSend);
      if (hostSeat !== null) {
        for (const send of this.remoteSends.values()) {
          const targetSeat = match.humanSeatFor(send);
          if (targetSeat !== null) {
            match.kickWaitingRoomSeat(hostSeat, targetSeat);
          }
        }
        await Promise.all(this.outbound.values());
        match.releaseSeat(hostSeat);
      }
      await match.deleteSavedCheckpoint();
    } else {
      const activeMatch = await this.persistence.getActiveMatch();
      if (activeMatch?.owner === "nearby-host") {
        await this.persistence.repository.deleteCheckpoint(activeMatch.matchId);
      }
    }
    await this.persistence.setActiveMatch(null);
    this.match = null;
    this.hostEndpointId = null;
    useMatchStore.getState().reset();
    this.resetSessionState();
  }

  private async stopTransportAndDetachRemotes(): Promise<void> {
    for (const endpointId of [...this.remoteSends.keys()]) {
      this.detachRemote(endpointId);
    }
    await this.transport.stopAll();
    this.update({ discovered: [], pairings: [], connected: [] });
  }

  private requireMatchId(): string {
    if (this.state.matchId === null) {
      throw new Error("No Nearby match is active");
    }
    return this.state.matchId;
  }

  private enqueueControl(operation: () => Promise<void>): Promise<void> {
    const running = this.controlQueue.then(operation, operation);
    this.controlQueue = running.catch((error: unknown) => {
      this.update({ status: "error", error: errorMessage(error) });
    });
    return running;
  }

  private enqueueCommand(operation: () => Promise<void>): Promise<void> {
    if (!this.commandIntakeOpen) {
      return Promise.resolve();
    }
    const running = this.commandQueue.then(operation, operation);
    this.commandQueue = running.catch((error: unknown) => {
      this.update({ error: errorMessage(error) });
    });
    return running;
  }

  private resetSessionState(): void {
    this.identity = null;
    this.state = {
      ...INITIAL_NEARBY_MATCH_STATE,
      available: this.state.available,
    };
    this.emitState();
  }

  private update(next: Partial<NearbyMatchControllerState>): void {
    this.state = { ...this.state, ...next };
    this.emitState();
  }

  private emitState(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const nativeNearbyTransport =
  NearbyConnections as NearbyConnectionsPlugin;

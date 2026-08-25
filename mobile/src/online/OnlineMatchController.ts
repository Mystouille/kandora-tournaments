import {
  GameWS,
  GameWSConnectionDetailsError,
  type GameWSConnectionDetails,
  type GameWSOptions,
} from "~/game/client/ws";
import { useMatchStore } from "~/game/client/store";
import type {
  RoomState,
  Seat,
  ServerMessage,
} from "~/game/protocol/messages";
import type { MobileAuthSession } from "../auth/mobileAuth";
import {
  createOnlineRoom,
  getOnlineGameConnectionDetails,
  OnlineGameHttpError,
} from "./onlineGameApi";

export type OnlineMatchStatus =
  | "idle"
  | "creating"
  | "connecting"
  | "waiting"
  | "playing"
  | "spectating"
  | "finished"
  | "error";

export interface OnlineMatchControllerState {
  status: OnlineMatchStatus;
  mode: "player" | "spectator" | null;
  matchId: string | null;
  roomState: RoomState | null;
  error: string | null;
}

export const INITIAL_ONLINE_MATCH_STATE: OnlineMatchControllerState = {
  status: "idle",
  mode: null,
  matchId: null,
  roomState: null,
  error: null,
};

interface OnlineSocket {
  connect(): void;
  close(): void;
  forceReconnect(): void;
  act(actionId: string): void;
  ready(): void;
  setWaitingRoomReady(ready: boolean): void;
  addWaitingRoomBot(): void;
  kickWaitingRoomSeat(seat: Seat): void;
  startMatch(): void;
  leaveSeat(): void;
  voteContinue(vote: "yes" | "no"): void;
}

interface OnlineMatchControllerDependencies {
  createRoom: typeof createOnlineRoom;
  getConnectionDetails: typeof getOnlineGameConnectionDetails;
  createSocket: (options: GameWSOptions) => OnlineSocket;
  waitForLeave: () => Promise<void>;
}

const DEFAULT_DEPENDENCIES: OnlineMatchControllerDependencies = {
  createRoom: createOnlineRoom,
  getConnectionDetails: getOnlineGameConnectionDetails,
  createSocket: (options) => new GameWS(options),
  waitForLeave: () =>
    new Promise((resolve) => globalThis.setTimeout(resolve, 50)),
};

type StateListener = (state: OnlineMatchControllerState) => void;

export class OnlineMatchController {
  private state = INITIAL_ONLINE_MATCH_STATE;
  private readonly listeners = new Set<StateListener>();
  private socket: OnlineSocket | null = null;
  private baseUrl: string | null = null;
  private session: MobileAuthSession | null = null;

  constructor(
    private readonly dependencies: OnlineMatchControllerDependencies =
      DEFAULT_DEPENDENCIES
  ) {}

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): OnlineMatchControllerState {
    return this.state;
  }

  async create(
    baseUrl: string,
    session: MobileAuthSession,
    preset: string
  ): Promise<void> {
    this.setState({
      status: "creating",
      mode: "player",
      matchId: null,
      roomState: null,
      error: null,
    });
    try {
      const matchId = await this.dependencies.createRoom(
        baseUrl,
        session,
        preset
      );
      this.attach(baseUrl, session, matchId, "player");
    } catch (error) {
      this.fail(error);
    }
  }

  join(baseUrl: string, session: MobileAuthSession, matchId: string): void {
    this.attach(baseUrl, session, matchId, "player");
  }

  watch(baseUrl: string, session: MobileAuthSession, matchId: string): void {
    this.attach(baseUrl, session, matchId, "spectator");
  }

  setWaitingRoomReady(ready: boolean): void {
    this.socket?.setWaitingRoomReady(ready);
  }

  addWaitingRoomBot(): void {
    this.socket?.addWaitingRoomBot();
  }

  kickWaitingRoomSeat(seat: Seat): void {
    this.socket?.kickWaitingRoomSeat(seat);
  }

  startMatch(): void {
    this.socket?.startMatch();
  }

  act(actionId: string): void {
    this.socket?.act(actionId);
  }

  ready(): void {
    this.socket?.ready();
  }

  voteContinue(vote: "yes" | "no"): void {
    this.socket?.voteContinue(vote);
  }

  reconnect(): void {
    this.socket?.forceReconnect();
  }

  async leave(): Promise<void> {
    const socket = this.socket;
    if (socket !== null && this.state.status === "waiting") {
      socket.leaveSeat();
      await this.dependencies.waitForLeave();
    }
    if (this.socket === socket) {
      this.disconnect();
    }
  }

  dispose(): void {
    this.disconnect();
    this.listeners.clear();
  }

  private attach(
    baseUrl: string,
    session: MobileAuthSession,
    matchId: string,
    mode: "player" | "spectator"
  ): void {
    this.socket?.close();
    this.baseUrl = baseUrl;
    this.session = session;
    useMatchStore.getState().setMatch(matchId);
    this.setState({
      status: "connecting",
      mode,
      matchId,
      roomState: null,
      error: null,
    });
    const socket = this.dependencies.createSocket({
      matchId,
      spectate: mode === "spectator",
      getConnectionDetails: () => this.connectionDetails(matchId),
      onMessage: (message) => this.handleMessage(message),
      onError: (_code, message) => this.handleError(message),
    });
    this.socket = socket;
    socket.connect();
  }

  private async connectionDetails(
    matchId: string
  ): Promise<GameWSConnectionDetails> {
    if (this.baseUrl === null || this.session === null) {
      throw new GameWSConnectionDetailsError(
        "The online session is unavailable.",
        false
      );
    }
    try {
      return await this.dependencies.getConnectionDetails(
        this.baseUrl,
        this.session,
        matchId
      );
    } catch (error) {
      const retryable =
        !(error instanceof OnlineGameHttpError) || error.status >= 500;
      if (!retryable) {
        this.fail(error);
      }
      throw new GameWSConnectionDetailsError(
        error instanceof Error ? error.message : "Connection failed",
        retryable
      );
    }
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "room_state") {
      const status =
        message.status === "waiting"
          ? "waiting"
          : message.status === "finished"
            ? "finished"
            : this.state.mode === "spectator"
              ? "spectating"
              : "playing";
      this.setState({ ...this.state, status, roomState: message, error: null });
      return;
    }
    if (message.type === "snapshot" || message.type === "event") {
      this.setState({
        ...this.state,
        status: this.state.mode === "spectator" ? "spectating" : "playing",
        error: null,
      });
      return;
    }
    if (message.type === "room_kicked") {
      this.disconnect("You were removed from the room.");
      return;
    }
    if (message.type === "spectate_redirect") {
      const { baseUrl, session } = this;
      if (baseUrl !== null && session !== null) {
        queueMicrotask(() => {
          this.attach(baseUrl, session, message.matchId, "spectator");
        });
      }
    }
  }

  private handleError(message: string): void {
    this.setState({ ...this.state, error: message });
  }

  private fail(error: unknown): void {
    this.socket?.close();
    this.socket = null;
    useMatchStore.getState().reset();
    this.setState({
      status: "error",
      mode: this.state.mode,
      matchId: this.state.matchId,
      roomState: null,
      error: error instanceof Error ? error.message : "Online game failed",
    });
  }

  private disconnect(error: string | null = null): void {
    this.socket?.close();
    this.socket = null;
    this.baseUrl = null;
    this.session = null;
    useMatchStore.getState().reset();
    this.setState(
      error === null
        ? INITIAL_ONLINE_MATCH_STATE
        : { ...INITIAL_ONLINE_MATCH_STATE, status: "error", error }
    );
  }

  private setState(state: OnlineMatchControllerState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
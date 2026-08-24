import { dispatchServerMessage } from "~/game/client/dispatchServerMessage";
import { useMatchStore } from "~/game/client/store";
import type { Seat, ServerMessage } from "~/game/protocol/messages";
import { MatchProcess } from "~/game/server/src/match";
import { createSystemMatchRuntime } from "~/game/server/src/runtime";
import type { MobileMatchRepositoryHandle } from "../persistence/mobileMatchRepository";

const LOCAL_USER_ID = "mobile:local-player";
const LOCAL_DISPLAY_NAME = "You";

export interface LocalMatchControllerState {
  status:
    | "idle"
    | "starting"
    | "playing"
    | "pausing"
    | "paused"
    | "finished"
    | "error";
  matchId: string | null;
  error: string | null;
}

export type LocalMatchControllerListener = (
  state: LocalMatchControllerState
) => void;

function randomUint32(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}

export class LocalMatchController {
  private match: MatchProcess | null = null;
  private humanSeat: Seat | null = null;
  private listener: LocalMatchControllerListener | null = null;
  private operation: Promise<void> = Promise.resolve();
  private state: LocalMatchControllerState = {
    status: "idle",
    matchId: null,
    error: null,
  };

  private readonly send = (message: ServerMessage): void => {
    dispatchServerMessage(message, {
      onError: (code, text) => {
        this.update({ status: "error", error: `${code}: ${text}` });
      },
    });
    if (message.type === "room_state" && message.mySeat !== null) {
      this.humanSeat = message.mySeat;
    }
    if (
      message.type === "event" &&
      message.events.some((event) => event.type === "session_end")
    ) {
      void this.persistence.setActiveMatch(null);
      this.update({ status: "finished", error: null });
    }
  };

  constructor(private readonly persistence: MobileMatchRepositoryHandle) {}

  subscribe(listener: LocalMatchControllerListener): () => void {
    this.listener = listener;
    listener(this.state);
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  getState(): LocalMatchControllerState {
    return this.state;
  }

  restore(): Promise<void> {
    return this.enqueue(async () => {
      if (this.match !== null) {
        return;
      }
      const activeMatch = await this.persistence.getActiveMatch();
      if (activeMatch === null || activeMatch.owner !== "solo") {
        return;
      }
      const { matchId } = activeMatch;
      this.update({ status: "starting", matchId, error: null });
      const restored = await MatchProcess.restoreSavedCheckpoint(matchId, {
        repository: this.persistence.repository,
        runtime: createSystemMatchRuntime(0),
      });
      if (restored === null) {
        await this.persistence.setActiveMatch(null);
        this.update({ status: "idle", matchId: null, error: null });
        return;
      }
      const seat = restored.claimSeat(LOCAL_USER_ID, LOCAL_DISPLAY_NAME);
      if (seat === null) {
        throw new Error("The saved local player seat is unavailable");
      }
      this.replaceMatch(restored, seat);
      if (restored.status === "waiting") {
        const starting = restored.fillBotsAndStart();
        await this.completeStartup(restored, starting);
        this.syncSnapshot();
      }
      this.update({ status: "playing", matchId, error: null });
    });
  }

  startSolo(): Promise<void> {
    return this.enqueue(async () => {
      if (this.match !== null) {
        await this.pauseCurrentMatch();
      }
      const seed = randomUint32();
      const matchId = `local-${Date.now().toString(36)}-${seed.toString(36)}`;
      this.update({ status: "starting", matchId, error: null });
      const match = MatchProcess.createWaitingRoom(
        matchId,
        seed,
        {
          repository: this.persistence.repository,
          runtime: createSystemMatchRuntime(seed),
        },
        undefined,
        undefined,
        "tenhou-hanchan"
      );
      const seat = match.claimSeat(LOCAL_USER_ID, LOCAL_DISPLAY_NAME);
      if (seat === null) {
        throw new Error("Could not claim the local player seat");
      }
      this.replaceMatch(match, seat);
      await match.pauseAndSaveCheckpoint();
      const restorable = await MatchProcess.restoreSavedCheckpoint(matchId, {
        repository: this.persistence.repository,
        runtime: createSystemMatchRuntime(seed),
      });
      if (restorable === null) {
        throw new Error("Could not establish the initial local recovery point");
      }
      const restoredSeat = restorable.claimSeat(
        LOCAL_USER_ID,
        LOCAL_DISPLAY_NAME
      );
      if (restoredSeat === null) {
        throw new Error("Could not restore the local player seat");
      }
      this.replaceMatch(restorable, restoredSeat);
      await this.persistence.setActiveMatch({ matchId, owner: "solo" });
      const starting = restorable.fillBotsAndStart();
      await this.completeStartup(restorable, starting);
      this.syncSnapshot();
      this.update({ status: "playing", matchId, error: null });
    });
  }

  act(actionId: string): Promise<void> {
    return this.enqueue(async () => {
      const { match, seat } = this.requireActiveMatch();
      await match.handleAct(seat, actionId);
      this.syncSnapshot();
    });
  }

  ready(): Promise<void> {
    return this.readyDirect().then(() => {
      this.syncSnapshot();
    });
  }

  setAfk(afk: boolean): Promise<void> {
    return this.enqueue(async () => {
      const { match, seat } = this.requireActiveMatch();
      await match.handleAfk(seat, afk);
      this.syncSnapshot();
    });
  }

  pause(): Promise<void> {
    return this.enqueue(async () => {
      await this.pauseCurrentMatch();
    });
  }

  dispose(): Promise<void> {
    return this.enqueue(async () => {
      if (this.match !== null && !this.match.isPaused) {
        await this.pauseCurrentMatch();
      }
      this.detachCurrentMatch();
      useMatchStore.getState().reset();
      this.update({ status: "idle", matchId: null, error: null });
    });
  }

  private async readyDirect(): Promise<void> {
    const { match, seat } = this.requireActiveMatch();
    await match.handleReady(seat);
  }

  private async completeStartup(
    match: MatchProcess,
    starting: Promise<void>
  ): Promise<void> {
    for (let attempt = 0; attempt < 1_200; attempt += 1) {
      try {
        const checkpoint = match.createCheckpoint();
        if (
          checkpoint.status === "playing" &&
          checkpoint.checkpointKind === "ready_check"
        ) {
          const seat = this.humanSeat;
          if (seat === null) {
            throw new Error("Local player seat was lost during startup");
          }
          await match.handleReady(seat);
        }
      } catch {
        // Match startup is between checkpointable boundaries.
      }
      const outcome = await Promise.race([
        starting.then(() => "complete" as const),
        new Promise<"pending">((resolve) => {
          globalThis.setTimeout(() => resolve("pending"), 25);
        }),
      ]);
      if (outcome === "complete") {
        return;
      }
    }
    throw new Error("Local match startup did not complete");
  }

  private async pauseCurrentMatch(): Promise<void> {
    const match = this.match;
    if (match === null || match.status === "finished" || match.isPaused) {
      return;
    }
    this.update({ status: "pausing", error: null });
    await match.pauseAndSaveCheckpoint();
    this.detachCurrentMatch();
    this.update({ status: "paused", matchId: match.matchId, error: null });
  }

  private replaceMatch(match: MatchProcess, seat: Seat): void {
    this.detachCurrentMatch();
    this.match = match;
    this.humanSeat = seat;
    useMatchStore.getState().setMatch(match.matchId, seat);
    useMatchStore.getState().setConn("open");
    match.attachHuman(seat, this.send, async () => true);
    this.syncSnapshot();
  }

  private detachCurrentMatch(): void {
    if (this.match !== null && this.humanSeat !== null) {
      this.match.detachHuman(this.humanSeat, this.send);
    }
    this.match = null;
    this.humanSeat = null;
  }

  private syncSnapshot(): void {
    if (this.match === null || this.humanSeat === null) {
      return;
    }
    this.send(this.match.buildRoomState(this.humanSeat));
    if (this.match.status === "playing") {
      this.send(this.match.buildSnapshotForSeat(this.humanSeat));
    }
  }

  private requireActiveMatch(): { match: MatchProcess; seat: Seat } {
    if (this.match === null || this.humanSeat === null) {
      throw new Error("No local match is active");
    }
    return { match: this.match, seat: this.humanSeat };
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const running = this.operation.then(operation, operation);
    this.operation = running.catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Local match operation failed";
      this.update({ status: "error", error: message });
    });
    return running;
  }

  private update(next: Partial<LocalMatchControllerState>): void {
    this.state = { ...this.state, ...next };
    this.listener?.(this.state);
  }
}

import { dispatchServerMessage } from "~/game/client/dispatchServerMessage";
import { useMatchStore } from "~/game/client/store";
import type { Seat, ServerMessage } from "~/game/protocol/messages";
import { MatchProcess } from "~/game/server/src/match";
import { createSystemMatchRuntime } from "~/game/server/src/runtime";
import { createAuthorityClock } from "~/game/server/src/timing/authorityClock";
import type {
  ActionIntentContext,
  PromptIntentContext,
} from "~/game/protocol/timing";
import { bindLiveClock, releaseLiveClock } from "~/game/client/time/liveClock";
import { refreshScheduledWindow } from "~/game/client/time/liveTimingBinding";
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
  private readonly authorityClock = createAuthorityClock();
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
    if ("clock" in message && message.clock) {
      const epoch = message.clock.clockEpoch;
      bindLiveClock(this, {
        now: () => this.match?.authorityNow() ?? null,
        quality: () => ({
          clockEpoch: epoch,
          roundTripMs: 0,
          uncertaintyMs: 0,
          sampledAt: performance.now(),
        }),
      });
    }
    dispatchServerMessage(message, {
      onError: (code, text) => {
        this.update({ status: "error", error: `${code}: ${text}` });
      },
    });
    refreshScheduledWindow();
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

  discoverSavedMatch(): Promise<void> {
    return this.enqueue(async () => {
      if (this.match !== null) {
        return;
      }
      const activeMatch = await this.persistence.getActiveMatch();
      if (activeMatch?.owner === "solo") {
        this.update({
          status: "paused",
          matchId: activeMatch.matchId,
          error: null,
        });
      }
    });
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
        eventJournalStore: this.persistence.eventJournalStore,
        runtime: createSystemMatchRuntime(0, this.authorityClock),
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
      await restored.deleteSavedCheckpoint();
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
          eventJournalStore: this.persistence.eventJournalStore,
          runtime: createSystemMatchRuntime(seed, this.authorityClock),
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
        eventJournalStore: this.persistence.eventJournalStore,
        runtime: createSystemMatchRuntime(seed, this.authorityClock),
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
      await restorable.deleteSavedCheckpoint();
      this.syncSnapshot();
      this.update({ status: "playing", matchId, error: null });
    });
  }

  async act(actionId: string, intent?: ActionIntentContext): Promise<void> {
    const active = this.requireActiveMatch();
    const receipt = {
      ...active.match.actionReceipt(active.seat, active.match.authorityNow()),
      ...(intent ?? {}),
    };
    active.match.reserveAction(active.seat, actionId, receipt);
    return this.enqueue(async () => {
      const { match, seat } = this.requireActiveMatch();
      if (match !== active.match || seat !== active.seat) {
        throw new Error("The local action belongs to a replaced match");
      }
      await match.handleAct(seat, actionId, receipt);
      this.syncSnapshot();
    });
  }

  ready(intent?: PromptIntentContext): Promise<void> {
    return this.readyDirect(intent).then(() => {
      this.syncSnapshot();
    });
  }

  async voteContinue(
    vote: "yes" | "no",
    intent?: PromptIntentContext
  ): Promise<void> {
    const { match, seat } = this.requireActiveMatch();
    const receipt = {
      ...match.promptReceipt(seat, match.authorityNow()),
      ...(intent ?? {}),
    };
    match.reservePrompt(seat, vote, receipt);
    await this.enqueue(async () => {
      if (this.match !== match || this.humanSeat !== seat) {
        throw new Error("The vote belongs to a replaced local match");
      }
      await match.handleVoteContinue(seat, vote, receipt);
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
      releaseLiveClock(this);
      useMatchStore.getState().reset();
      this.update({ status: "idle", matchId: null, error: null });
    });
  }

  private async readyDirect(intent?: PromptIntentContext): Promise<void> {
    const { match, seat } = this.requireActiveMatch();
    const receipt = {
      ...match.promptReceipt(seat, match.authorityNow()),
      ...(intent ?? {}),
    };
    await match.handleReady(seat, receipt);
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
          await match.handleReady(
            seat,
            match.promptReceipt(seat, match.authorityNow())
          );
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
    match.configurePlayerTiming(seat, "direct", () => null);
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

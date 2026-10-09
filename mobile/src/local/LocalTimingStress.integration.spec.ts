import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMatchStore } from "~/game/client/store";
import { liveServerNow } from "~/game/client/time/liveClock";
import { intentForWindow } from "~/game/client/time/actionWindowViewModel";
import {
  setDelayAfterDiscardMs,
  setReadyCheckMs,
} from "~/game/server/src/match";
import { LocalMatchController } from "./LocalMatchController";
import {
  createMemoryMobileMatchRepository,
  type MobileMatchRepositoryHandle,
} from "../persistence/mobileMatchRepository";

const ownedControllers = new Set<LocalMatchController>();

function persistence(): MobileMatchRepositoryHandle {
  const { repository, replayStore } = createMemoryMobileMatchRepository();
  let active: Awaited<
    ReturnType<MobileMatchRepositoryHandle["getActiveMatch"]>
  > = null;
  return {
    repository,
    eventJournalStore: repository,
    replayStore,
    storage: "memory",
    getActiveMatch: async () => active,
    setActiveMatch: async (next) => {
      active = next;
    },
    close: async () => undefined,
  };
}

function controller(
  storage: MobileMatchRepositoryHandle
): LocalMatchController {
  const host = new LocalMatchController(storage);
  ownedControllers.add(host);
  return host;
}

async function settle<T>(operation: Promise<T>): Promise<T> {
  let completed = false;
  void operation.then(
    () => {
      completed = true;
    },
    () => {
      completed = true;
    }
  );
  await vi.advanceTimersByTimeAsync(0);
  for (let tick = 0; tick < 800 && !completed; tick += 1) {
    await vi.advanceTimersByTimeAsync(25);
  }
  if (!completed) {
    throw new Error(
      "The owned local-host operation did not settle within 20 seconds of simulated time"
    );
  }
  return operation;
}

async function close(host: LocalMatchController): Promise<void> {
  await settle(host.dispose());
  ownedControllers.delete(host);
}

async function drawnDecision(host: LocalMatchController) {
  for (let transition = 0; transition < 100; transition += 1) {
    const view = useMatchStore.getState();
    const window = view.actionWindow;
    const now = liveServerNow();
    if (!window || now === null) {
      throw new Error("The local host did not publish a synchronized decision");
    }
    await vi.advanceTimersByTimeAsync(Math.max(0, window.opensAt - now));
    const discard = view.legalActions.find(
      (action) => action.type === "discard"
    );
    if (discard) {
      return { view: useMatchStore.getState(), window, action: discard };
    }
    const pass = view.legalActions.find((action) => action.type === "pass");
    if (!pass) {
      throw new Error(
        "Expected a discard or pass while reaching the local draw"
      );
    }
    await settle(host.act(pass.id, intentForWindow(window, view.lastSeq)));
  }
  throw new Error("The real local host did not reach a discard decision");
}

async function advanceTo(authorityAt: number): Promise<void> {
  const now = liveServerNow();
  if (now === null || authorityAt < now) {
    throw new Error("Invalid local authority advancement");
  }
  await vi.advanceTimersByTimeAsync(authorityAt - now);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
  vi.setSystemTime(1_000_000);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
    if (!(array instanceof Uint32Array) || array.length !== 1) {
      throw new Error(
        "Unexpected random request in the isolated local-host fixture"
      );
    }
    array[0] = 42;
    return array;
  });
  setReadyCheckMs(5_000);
  setDelayAfterDiscardMs(500);
});

afterEach(async () => {
  for (const host of [...ownedControllers]) {
    await close(host);
  }
  useMatchStore.getState().reset();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setReadyCheckMs(0);
  setDelayAfterDiscardMs(350);
});

describe("real local-controller timing without native-hardware claims", () => {
  it("keeps solo play unlimited across wall steps and accepts a late receipt once", async () => {
    const host = controller(persistence());
    await settle(host.startSolo());
    const { view, window, action } = await drawnDecision(host);
    expect(window.deadlineMode).toBe("unlimited");
    expect(window.allowanceMs).toBe(0);
    expect(window.bankAtOpenMs).toBe(0);
    expect(window.baseEndsAt - window.opensAt).toBe(5_000);
    const before = liveServerNow();
    vi.setSystemTime(Date.now() + 300_000);
    expect(liveServerNow()).toBe(before);
    vi.setSystemTime(Date.now() - 600_000);
    expect(liveServerNow()).toBe(before);
    await advanceTo(window.baseEndsAt + 100);
    const intent = intentForWindow(window, view.lastSeq);
    const first = host.act(action.id, intent);
    const retry = host.act(action.id, intent);
    const outcomes = await settle(Promise.allSettled([first, retry]));
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(useMatchStore.getState().actionBufferMs).toBe(20_000);
    expect(useMatchStore.getState().totalDiscards).toBeGreaterThanOrEqual(1);
    expect(useMatchStore.getState().actionWindow?.id).not.toBe(window.id);
  });

  it("rejects stale window/epoch intents before they can enter the host operation queue", async () => {
    const host = controller(persistence());
    await settle(host.startSolo());
    const { view, window, action } = await drawnDecision(host);
    const before = {
      seq: view.lastSeq,
      bank: view.actionBufferMs,
      discards: view.totalDiscards,
    };
    await expect(
      host.act(action.id, {
        ...intentForWindow(window, view.lastSeq),
        windowId: `${window.id}:retired`,
      })
    ).rejects.toThrow(/stale|window/i);
    await expect(
      host.act(action.id, {
        ...intentForWindow(window, view.lastSeq),
        clockEpoch: "retired-clock-epoch",
      })
    ).rejects.toThrow(/stale|epoch/i);
    expect(useMatchStore.getState().lastSeq).toBe(before.seq);
    expect(useMatchStore.getState().actionBufferMs).toBe(before.bank);
    expect(useMatchStore.getState().totalDiscards).toBe(before.discards);
    expect(useMatchStore.getState().actionWindow?.expiresAt).toBe(
      window.expiresAt
    );
  });

  it("persists and rebases an unlimited solo window across long suspension", async () => {
    const storage = persistence();
    const original = controller(storage);
    await settle(original.startSolo());
    const source = await drawnDecision(original);
    await advanceTo(source.window.baseEndsAt + 777);
    const sourceNow = liveServerNow();
    if (sourceNow === null || !original.getState().matchId) {
      throw new Error("No active local match to checkpoint");
    }
    const matchId = original.getState().matchId;
    if (!matchId) {
      throw new Error("Missing local match identity");
    }
    await settle(original.pause());
    const stored = await storage.repository.loadRecoveryRecord(matchId);
    expect(stored?.pendingCommand).toBeNull();
    expect(stored?.checkpoint.status).toBe("playing");
    await close(original);
    await vi.advanceTimersByTimeAsync(60_000);
    const first = controller(storage);
    await settle(first.discoverSavedMatch());
    await settle(first.restore());
    const firstWindow = useMatchStore.getState().actionWindow;
    expect(firstWindow?.id).toBe(source.window.id);
    expect(firstWindow?.clockEpoch).not.toBe(source.window.clockEpoch);
    expect(firstWindow?.deadlineMode).toBe("unlimited");
    expect(firstWindow?.allowanceMs).toBe(source.window.allowanceMs);
    expect((firstWindow?.baseEndsAt ?? NaN) - (liveServerNow() ?? NaN)).toBe(
      -777
    );
    expect((firstWindow?.expiresAt ?? NaN) - (liveServerNow() ?? NaN)).toBe(
      source.window.expiresAt - sourceNow
    );
    await settle(first.pause());
    await close(first);
    await vi.advanceTimersByTimeAsync(60_000);
    const second = controller(storage);
    await settle(second.restore());
    const restored = useMatchStore.getState();
    const window = restored.actionWindow;
    if (!window) {
      throw new Error("The outstanding local window was lost during rebase");
    }
    expect(window.id).toBe(source.window.id);
    expect(window.clockEpoch).not.toBe(firstWindow?.clockEpoch);
    expect(window.deadlineMode).toBe("unlimited");
    expect(window.bankAtOpenMs).toBe(0);
    expect(window.allowanceMs).toBe(0);
    expect(window.baseEndsAt - (liveServerNow() ?? NaN)).toBe(-777);
    await vi.advanceTimersByTimeAsync(123);
    const action = restored.legalActions.find(
      (candidate) => candidate.id === source.action.id
    );
    if (!action) {
      throw new Error("The original legal discard was lost during recovery");
    }
    await settle(
      second.act(action.id, intentForWindow(window, restored.lastSeq))
    );
    expect(useMatchStore.getState().actionBufferMs).toBe(20_000);
    expect(await storage.repository.loadRecoveryRecord(matchId)).toBeNull();
  });
});

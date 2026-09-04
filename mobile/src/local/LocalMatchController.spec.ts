import { afterEach, describe, expect, it } from "vitest";
import { useMatchStore } from "~/game/client/store";
import {
  setDelayAfterDiscardMs,
  setReadyCheckMs,
} from "~/game/server/src/match";
import { createMemoryMatchRepository } from "~/game/server/src/repository";
import { LocalMatchController } from "./LocalMatchController";
import type { MobileMatchRepositoryHandle } from "../persistence/mobileMatchRepository";

function memoryPersistence(): MobileMatchRepositoryHandle {
  let activeMatch: Awaited<
    ReturnType<MobileMatchRepositoryHandle["getActiveMatch"]>
  > = null;
  const repository = createMemoryMatchRepository();
  return {
    repository,
    eventJournalStore: repository,
    storage: "memory",
    getActiveMatch: async () => activeMatch,
    setActiveMatch: async (nextActiveMatch) => {
      activeMatch = nextActiveMatch;
    },
    close: async () => undefined,
  };
}

async function reachDrawDiscardWindow(
  controller: LocalMatchController
): Promise<ReturnType<typeof useMatchStore.getState>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const view = useMatchStore.getState();
    if (view.legalActions.some((action) => action.type === "discard")) {
      return view;
    }
    const pass = view.legalActions.find((action) => action.type === "pass");
    if (pass === undefined) {
      throw new Error("expected a discard or pass action");
    }
    await controller.act(pass.id);
  }
  throw new Error("local player did not reach a discard window");
}

describe("local mobile match controller", () => {
  afterEach(() => {
    useMatchStore.getState().reset();
    setReadyCheckMs(0);
    setDelayAfterDiscardMs(350);
  });

  it("starts, plays, pauses, and restores one local solo match", async () => {
    setReadyCheckMs(5_000);
    setDelayAfterDiscardMs(0);
    const persistence = memoryPersistence();
    const controller = new LocalMatchController(persistence);

    await controller.startSolo();

    const started = controller.getState();
    const initialView = useMatchStore.getState();
    expect(started.status).toBe("playing");
    expect(started.matchId).not.toBeNull();
    expect(await persistence.getActiveMatch()).toEqual({
      matchId: started.matchId,
      owner: "solo",
    });
    expect(initialView.conn).toBe("open");
    expect(initialView.mySeat).not.toBeNull();
    expect(initialView.legalActions.length).toBeGreaterThan(0);

    const action =
      initialView.legalActions.find((action) => action.type === "discard") ??
      initialView.legalActions.find((candidate) => candidate.type === "pass");
    if (action === undefined) {
      throw new Error("expected a safe local action");
    }
    const beforeSeq = initialView.lastSeq;
    await controller.act(action.id);

    const advancedView = useMatchStore.getState();
    expect(advancedView.lastSeq).toBeGreaterThan(beforeSeq);
    expect(advancedView.legalActions.length).toBeGreaterThan(0);

    await controller.pause();
    expect(controller.getState()).toMatchObject({
      status: "paused",
      matchId: started.matchId,
    });
    const saved = await persistence.repository.loadRecoveryRecord(
      started.matchId as string
    );
    expect(saved?.checkpoint.status).toBe("playing");
    if (saved?.checkpoint.status !== "playing") {
      throw new Error("expected a playing local checkpoint");
    }
    expect(["action_window", "call_window"]).toContain(
      saved.checkpoint.checkpointKind
    );
    expect(saved.pendingCommand).toBeNull();

    const restored = new LocalMatchController(persistence);
    await restored.restore();

    const restoredView = useMatchStore.getState();
    expect(restored.getState()).toMatchObject({
      status: "playing",
      matchId: started.matchId,
    });
    expect(restoredView.matchId).toBe(started.matchId);
    expect(restoredView.lastSeq).toBe(advancedView.lastSeq);
    expect(restoredView.scores).toEqual(advancedView.scores);
    expect(restoredView.discards).toEqual(advancedView.discards);
    expect(restoredView.legalActions).toEqual(advancedView.legalActions);

    await restored.pause();
  });

  it("keeps the drawn tile separate after the local safety snapshot", async () => {
    setReadyCheckMs(5_000);
    setDelayAfterDiscardMs(0);
    const controller = new LocalMatchController(memoryPersistence());

    await controller.startSolo();
    const view = await reachDrawDiscardWindow(controller);

    expect(view.mySeat).not.toBeNull();
    expect(view.freshlyDrawnSeat).toBe(view.mySeat);
    expect(view.hands[view.mySeat as 0 | 1 | 2 | 3]).toHaveLength(14);

    await controller.pause();
  });
});

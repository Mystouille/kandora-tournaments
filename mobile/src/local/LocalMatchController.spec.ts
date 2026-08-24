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

    const action = initialView.legalActions.find(
      (action) => action.type === "discard"
    ) ?? initialView.legalActions.find((candidate) => candidate.type === "pass");
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
 });

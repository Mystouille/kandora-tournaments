import { afterEach, describe, expect, it } from "vitest";
import { useMatchStore } from "~/game/client/store";
import { liveServerNow } from "~/game/client/time/liveClock";
import { GameSetupSchema } from "~/game/rules/gameSetup";
import { duplicateMatchSeed } from "~/game/server/src/match-drivers/duplicatePlan";
import {
  setDelayAfterDiscardMs,
  setReadyCheckMs,
} from "~/game/server/src/match";
import { LocalMatchController } from "./LocalMatchController";
import {
  createMemoryMobileMatchRepository,
  type MobileMatchRepositoryHandle,
} from "../persistence/mobileMatchRepository";

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

async function waitUntilWindowOpens(
  view: ReturnType<typeof useMatchStore.getState>
): Promise<void> {
  const window = view.actionWindow;
  const now = liveServerNow();
  if (window === undefined || window === null || now === null) {
    throw new Error("expected a synchronized local action window");
  }
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, window.opensAt - now) + 10)
  );
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
    await waitUntilWindowOpens(view);
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

  it.each(
    (["online", "kansai"] as const).flatMap((sanmaType) =>
      [false, true].map((duplicate) => ({ sanmaType, duplicate }))
    )
  )(
    "starts and resumes $sanmaType solo, Duplicate=$duplicate",
    async ({ sanmaType, duplicate }) => {
      setReadyCheckMs(5_000);
      setDelayAfterDiscardMs(0);
      const persistence = memoryPersistence();
      const controller = new LocalMatchController(persistence);
      const setup = GameSetupSchema.parse({
        preset: "m-league",
        playerCount: 3,
        sanmaType,
        mode: duplicate
          ? { type: "duplicate", seed: "Solo board", generationVersion: 1 }
          : { type: "normal" },
      });
      try {
        await controller.startSolo(setup);
        expect(controller.getState().status).toBe("playing");
        expect(useMatchStore.getState()).toMatchObject({
          playerCount: 3,
          sanmaType,
        });
        expect(useMatchStore.getState().scores).toHaveLength(3);
        expect(useMatchStore.getState().roomState?.seats).toHaveLength(3);
      } finally {
        await controller.pause();
      }
      const matchId = controller.getState().matchId as string;
      const saved = await persistence.repository.loadRecoveryRecord(matchId);
      expect(saved?.checkpoint).toMatchObject({
        presetId: "m-league",
        mode: setup.mode,
        state: {
          ruleSet: {
            playerCount: 3,
            sanmaType,
            buuMode: false,
            atamahane: false,
          },
        },
      });
      expect(saved?.checkpoint.seats).toHaveLength(3);
      if (setup.mode.type === "duplicate") {
        expect(saved?.checkpoint.seed).toBe(duplicateMatchSeed(setup.mode));
      }
      const restored = new LocalMatchController(persistence);
      try {
        await restored.restore();
        expect(restored.getState()).toMatchObject({
          status: "playing",
          matchId,
        });
        expect(useMatchStore.getState()).toMatchObject({
          playerCount: 3,
          sanmaType,
        });
        expect(useMatchStore.getState().roomState?.seats).toHaveLength(3);
      } finally {
        await restored.pause();
      }
      const resumed = await persistence.repository.loadRecoveryRecord(matchId);
      expect(resumed?.checkpoint).toMatchObject({
        presetId: "m-league",
        seed: saved?.checkpoint.seed,
        mode: setup.mode,
        state: { ruleSet: { playerCount: 3, sanmaType } },
      });
    },
    10_000
  );

  it("rejects Sanma+Buu and empty Duplicate seeds before saving a match", async () => {
    const persistence = memoryPersistence();
    const controller = new LocalMatchController(persistence);
    await expect(
      controller.startSolo({ playerCount: 3, preset: "buu-east" })
    ).rejects.toThrow();
    await expect(
      controller.startSolo({
        playerCount: 3,
        mode: { type: "duplicate", seed: " ", generationVersion: 1 },
      })
    ).rejects.toThrow();
    expect(await persistence.getActiveMatch()).toBeNull();
    expect(controller.getState().matchId).toBeNull();
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
    await waitUntilWindowOpens(initialView);
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
    expect(saved.checkpoint.presetId).toBe("tenhou-hanchan");
    expect(saved.checkpoint.mode).toEqual({ type: "normal" });
    expect(saved.checkpoint.state.ruleSet.playerCount).toBe(4);
    expect(saved.checkpoint.seats).toHaveLength(4);
    expect(["action_window", "call_window"]).toContain(
      saved.checkpoint.checkpointKind
    );
    expect(saved.pendingCommand).toBeNull();

    const restored = new LocalMatchController(persistence);
    useMatchStore.getState().reset();
    await restored.discoverSavedMatch();
    expect(restored.getState()).toMatchObject({
      status: "paused",
      matchId: started.matchId,
    });
    expect(useMatchStore.getState().matchId).toBeNull();

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

  it("starts and persists an MCR solo match", async () => {
    setReadyCheckMs(0);
    setDelayAfterDiscardMs(0);
    const persistence = memoryPersistence();
    const controller = new LocalMatchController(persistence);
    const setup = GameSetupSchema.parse({
      preset: "mcr-ema",
      rulesFamily: "mcr",
      playerCount: 4,
      sanmaType: "online",
      mode: { type: "normal" },
    });

    await controller.startSolo(setup);
    expect(useMatchStore.getState()).toMatchObject({
      rulesFamily: "mcr",
      scores: [0, 0, 0, 0],
    });
    expect(useMatchStore.getState().flowerTiles).toHaveLength(4);

    await controller.pause();
    const matchId = controller.getState().matchId;
    const saved = await persistence.repository.loadRecoveryRecord(
      matchId as string
    );
    expect(saved?.checkpoint).toMatchObject({
      presetId: "mcr-ema",
      state: {
        ruleSet: { rulesFamily: "mcr" },
        scores: [0, 0, 0, 0],
      },
    });
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

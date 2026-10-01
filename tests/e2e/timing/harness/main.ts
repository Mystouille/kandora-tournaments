import { ServerClock } from "~/game/client/time/serverClock";
import { ClockSampleSchema } from "~/game/protocol/timing";
import { GameWS } from "~/game/client/ws";
import { useMatchStore } from "~/game/client/store";
import { actionTimerView } from "~/game/client/time/actionWindowViewModel";
import { liveServerNow } from "~/game/client/time/liveClock";
import { TableRenderer } from "~/game/client/pixi/TableRenderer";
import { findTileAction } from "~/game/client/discardActions";
import type { ActionIntentContext } from "~/game/protocol/timing";
import { degradedReasons } from "~/game/testing/timing/fairnessProfiles";
import {
  DEGRADED_BROWSER_PROFILES,
  NORMAL_FRAME_RATE_BROWSER_PROFILES,
} from "../browserProfiles";
import type {
  BrowserTimingEvidence,
  ReadyFrameEvidence,
  RoomEvidence,
  SubmittedInputEvidence,
  TimingHarness,
} from "./evidence";

const status = document.querySelector<HTMLOutputElement>(
  'output[aria-label="Clock status"]'
);
const value = document.querySelector<HTMLOutputElement>(
  'output[aria-label="Authority clock"]'
);
const skew = document.querySelector<HTMLButtonElement>("#skew");
const refresh = document.querySelector<HTMLButtonElement>("#refresh");
if (!status || !value || !skew || !refresh) {
  throw new Error("Timing harness elements are missing");
}
const clock = new ServerClock();
const socket = new WebSocket(`ws://${window.location.host}/timing/clock`);
let probe = 0;
const sample = (): void => {
  const id = `probe-${++probe}`;
  clock.createProbe(id);
  socket.send(
    JSON.stringify({
      type: "clock_probe",
      matchId: "browser-test",
      probeId: id,
    })
  );
};
socket.addEventListener("open", sample);
socket.addEventListener("message", (event) => {
  const result = clock.observe(ClockSampleSchema.parse(JSON.parse(event.data)));
  if (!result.accepted) {
    throw new Error(`Clock sample rejected: ${result.reason}`);
  }
  status.value = "Synchronized";
});
socket.addEventListener("error", () => {
  status.value = "Clock connection failed";
});
skew.addEventListener("click", () => {
  const original = Date.now.bind(Date);
  Date.now = () => original() + 300_000;
  status.value = "Device clock skewed";
});
refresh.addEventListener("click", sample);
const timer = window.setInterval(() => {
  const now = clock.now();
  value.value = now === null ? "" : String(now);
}, 10);
window.addEventListener("pagehide", () => {
  window.clearInterval(timer);
  socket.close();
});

if (new URLSearchParams(window.location.search).has("game")) {
  void startGame();
}

async function startGame(): Promise<void> {
  const table = document.querySelector<HTMLDivElement>("#table");
  const decision = document.querySelector<HTMLOutputElement>(
    'output[aria-label="Decision status"]'
  );
  const remaining = document.querySelector<HTMLOutputElement>(
    'output[aria-label="Decision remaining"]'
  );
  const firstReady = document.querySelector<HTMLOutputElement>(
    'output[aria-label="Budget at readiness"]'
  );
  const bank = document.querySelector<HTMLOutputElement>(
    'output[aria-label="Time bank"]'
  );
  const discards = document.querySelector<HTMLOutputElement>(
    'output[aria-label="Accepted discards"]'
  );
  const reconnect = document.querySelector<HTMLButtonElement>("#reconnect");
  const nearDeadline =
    document.querySelector<HTMLButtonElement>("#near-deadline");
  if (
    !table ||
    !decision ||
    !remaining ||
    !firstReady ||
    !bank ||
    !discards ||
    !reconnect ||
    !nearDeadline
  ) {
    throw new Error("Game harness elements are missing");
  }
  const parameters = new URLSearchParams(location.search);
  const profileName =
    parameters.get("profile") ?? NORMAL_FRAME_RATE_BROWSER_PROFILES[0].name;
  const profile = [
    ...NORMAL_FRAME_RATE_BROWSER_PROFILES,
    ...DEGRADED_BROWSER_PROFILES,
  ].find((candidate) => candidate.name === profileName);
  if (!profile) {
    throw new Error(`Unknown isolated timing profile: ${profileName}`);
  }
  const response = await fetch("/timing/rooms", { method: "POST" });
  if (!response.ok) {
    throw new Error(
      `Isolated room creation failed: ${response.status} ${await response.text()}`
    );
  }
  const room: { matchId: string } = await response.json();
  useMatchStore.getState().setMatch(room.matchId);
  const renderer = new TableRenderer();
  await renderer.mount(table);
  renderer.setMinimumDrawToDiscardDelayEnabled(true);
  let transportError: string | null = null;
  let infoVisibleAt: number | null = null;
  let drawLandAt: number | null = null;
  let drawLandingCount = 0;
  let readyFrame: ReadyFrameEvidence | null = null;
  let submitted: SubmittedInputEvidence | null = null;
  let frameNumber = 0;
  let probing = false;
  let disposed = false;
  let suspended = false;
  let lastFrameAt: number | null = null;
  let nextFrameAt = performance.now();
  let frameHandle = 0;
  let stallScheduled = false;
  let renderedWindowEpoch: string | null = null;
  const frameIntervalsMs: number[] = [];
  const presentedFrames: Array<{ frame: number; performanceAt: number }> = [];
  let renderPending = true;
  const ownedTimers = new Set<number>();
  const waiters = new Set<{
    read: () => boolean;
    resolve: () => void;
    reject: (error: Error) => void;
  }>();
  const waitFor = (read: () => boolean): Promise<void> => {
    if (transportError) {
      return Promise.reject(new Error(transportError));
    }
    if (read()) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = { read, resolve, reject };
      waiters.add(waiter);
    });
  };
  const notify = (): void => {
    for (const waiter of waiters) {
      if (transportError) {
        waiters.delete(waiter);
        waiter.reject(new Error(transportError));
      } else if (waiter.read()) {
        waiters.delete(waiter);
        waiter.resolve();
      }
    }
  };
  const schedule = (callback: () => void, delayMs: number): void => {
    const handle = window.setTimeout(() => {
      ownedTimers.delete(handle);
      if (!disposed) {
        callback();
      }
    }, delayMs);
    ownedTimers.add(handle);
  };
  renderer.setDrawSequencing(true, {
    onDiscardLand: () => undefined,
    onDrawLand: (seat) => {
      if (seat === useMatchStore.getState().mySeat) {
        drawLandingCount += 1;
        drawLandAt ??= performance.now();
        infoVisibleAt ??= drawLandAt;
      }
    },
  });
  const ws = new GameWS({
    matchId: room.matchId,
    getConnectionDetails: async () => ({
      wsUrl: `ws://${window.location.host}/timing/game/${room.matchId}`,
      token: new URLSearchParams(location.search).has("badAuth")
        ? "invalid-test-token"
        : "isolated-test-token",
    }),
    onMessage: (message) => {
      if (message.type === "clock_sample") {
        renderPending = true;
      }
    },
    onError: (code, message) => {
      transportError = `${code}: ${message}`;
      notify();
    },
  });
  const input = (actionId: string, intent?: ActionIntentContext): void => {
    const view = useMatchStore.getState();
    const now = liveServerNow();
    if (!view.actionWindow || now === null || !intent) {
      throw new Error("The real Pixi input has no synchronized window intent");
    }
    if (probing) {
      if (!readyFrame && drawLandAt !== null && infoVisibleAt !== null) {
        readyFrame = {
          performanceAt: performance.now(),
          authorityAt: now,
          baseRemainingMs: actionTimerView(view.actionWindow, now)
            .baseRemainingMs,
          window: {
            ...view.actionWindow,
            legalActionIds: [...view.actionWindow.legalActionIds],
          },
          frame: frameNumber,
        };
        firstReady.value = String(readyFrame.baseRemainingMs);
        notify();
      }
      return;
    }
    submitted = {
      performanceAt: performance.now(),
      authorityAt: now,
      actionId,
      intent,
    };
    ws.act(actionId, intent);
  };
  renderer.setOnTileClick(({ tile, discardSource, intent }) => {
    const action = findTileAction(
      useMatchStore.getState().legalActions,
      "discard",
      tile,
      discardSource
    );
    if (action) {
      input(action.id, intent);
    }
  });
  renderer.setOnActionClick(({ action, intent }) => {
    input(action.id, intent);
  });
  renderer.setOnRenderRequest(() => {
    renderPending = true;
  });
  const clickCanvas = (): void => {
    const canvas = table.querySelector("canvas");
    if (!canvas) {
      throw new Error("Game canvas is missing");
    }
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 2, bubbles: true })
    );
  };
  const evidence = (): BrowserTimingEvidence => {
    const view = useMatchStore.getState();
    const now = liveServerNow();
    return {
      matchId: room.matchId,
      ready: readyFrame,
      infoVisibleAt,
      drawLandAt,
      submitted,
      currentWindow: view.actionWindow
        ? {
            ...view.actionWindow,
            legalActionIds: [...view.actionWindow.legalActionIds],
          }
        : null,
      currentRemainingMs:
        view.actionWindow && now !== null
          ? actionTimerView(view.actionWindow, now).baseRemainingMs
          : null,
      bankMs: view.actionBufferMs ?? null,
      frameIntervalsMs: [...frameIntervalsMs],
      presentedFrames: [...presentedFrames],
      drawLandingCount,
      requestedFramesPerSecond: profile.framesPerSecond,
      degradedReasons: degradedReasons(profile),
    };
  };
  const render = (): void => {
    if (disposed) {
      return;
    }
    frameHandle = requestAnimationFrame(render);
    const frameAt = performance.now();
    if (suspended || frameAt + 0.5 < nextFrameAt) {
      return;
    }
    const period = 1_000 / profile.framesPerSecond;
    nextFrameAt = Math.max(nextFrameAt + period, frameAt - period + 0.5);
    const view = useMatchStore.getState();
    if (view.actionWindow) {
      if (lastFrameAt !== null) {
        frameIntervalsMs.push(frameAt - lastFrameAt);
      }
      lastFrameAt = frameAt;
    }
    frameNumber += 1;
    if (renderPending) {
      renderPending = false;
      renderer.render(view);
      renderedWindowEpoch = view.actionWindow?.clockEpoch ?? null;
    }
    if (!readyFrame && view.actionWindow) {
      // Observe the actual semantic control callback, without sending a command.
      probing = true;
      clickCanvas();
      probing = false;
    }
    presentedFrames.push({
      frame: frameNumber,
      performanceAt: performance.now(),
    });
    discards.value = String(view.totalDiscards);
    bank.value = String(view.actionBufferMs ?? "");
    const now = liveServerNow();
    const stallMs = profile.stallMs;
    if (!stallScheduled && stallMs && view.actionWindow && now !== null) {
      stallScheduled = true;
      schedule(
        () => {
          const endsAt = performance.now() + stallMs;
          while (performance.now() < endsAt) {
            // Deliberate, bounded browser-main-thread stress; authority is in Node.
          }
        },
        Math.max(0, view.actionWindow.opensAt - now - 40)
      );
    }
    if (transportError) {
      decision.value = transportError;
    } else if (view.actionWindow && now !== null) {
      const timer = actionTimerView(view.actionWindow, now);
      decision.value = timer.ready && readyFrame ? "Ready" : "Waiting";
      remaining.value = String(timer.baseRemainingMs);
    } else {
      decision.value = "Synchronizing";
    }
    notify();
  };
  frameHandle = requestAnimationFrame(render);
  const unsubscribe = useMatchStore.subscribe(() => {
    renderPending = true;
    notify();
  });
  reconnect.addEventListener("click", () => ws.forceReconnect());
  nearDeadline.addEventListener("click", () => {
    const activeWindow = useMatchStore.getState().actionWindow;
    const now = liveServerNow();
    if (!activeWindow || now === null) {
      throw new Error("There is no active decision");
    }
    schedule(clickCanvas, Math.max(0, activeWindow.baseEndsAt - now - 25));
  });
  const fetchAuthority = async (
    suffix = "",
    method = "GET"
  ): Promise<RoomEvidence> => {
    const response = await fetch(`/timing/rooms/${room.matchId}${suffix}`, {
      method,
    });
    if (!response.ok) {
      throw new Error(
        `Isolated authority request failed: ${response.status} ${await response.text()}`
      );
    }
    return response.json();
  };
  const discardNow = async (): Promise<BrowserTimingEvidence> => {
    const before = useMatchStore.getState().totalDiscards;
    const previous = submitted;
    clickCanvas();
    if (submitted === previous) {
      throw new Error(
        "The real Pixi control did not accept the requested input"
      );
    }
    await waitFor(() => useMatchStore.getState().totalDiscards > before);
    return evidence();
  };
  const originalWallNow = Date.now.bind(Date);
  const harness: TimingHarness = {
    ready: async () => {
      await waitFor(() => readyFrame !== null);
      if (!readyFrame) {
        throw new Error("No real ready frame was observed");
      }
      return readyFrame;
    },
    evidence,
    authority: () => fetchAuthority(),
    discardAfterReady: async (elapsedMs) => {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        throw new RangeError("Invalid usable-input interval");
      }
      const ready = await harness.ready();
      await new Promise<void>((resolve) =>
        schedule(
          resolve,
          Math.max(0, ready.performanceAt + elapsedMs - performance.now())
        )
      );
      return discardNow();
    },
    discardNow,
    clockError: async () => {
      const before = performance.now();
      const authority = await fetchAuthority();
      const after = performance.now();
      const now = liveServerNow();
      if (now === null) {
        throw new Error("The game clock is not synchronized");
      }
      return {
        errorMs: now - (after - before) / 2 - authority.authorityNow,
        referenceRoundTripMs: after - before,
      };
    },
    stepWallClock: (deltaMs) => {
      if (!Number.isFinite(deltaMs)) {
        throw new RangeError("Invalid wall-clock step");
      }
      const startedAt = performance.now();
      const before = evidence();
      Date.now = () => originalWallNow() + deltaMs;
      const after = evidence();
      return { before, after, elapsedMs: performance.now() - startedAt };
    },
    foregroundGap: async (durationMs) => {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError("Invalid foreground gap");
      }
      const descriptor = Object.getOwnPropertyDescriptor(
        document,
        "visibilityState"
      );
      suspended = true;
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise<void>((resolve) => schedule(resolve, durationMs));
      if (descriptor) {
        Object.defineProperty(document, "visibilityState", descriptor);
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
      suspended = false;
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => {
        const active = useMatchStore.getState().actionWindow;
        return (
          liveServerNow() !== null && active?.clockEpoch === renderedWindowEpoch
        );
      });
      return evidence();
    },
    restoreEpoch: async () => {
      const epoch = useMatchStore.getState().actionWindow?.clockEpoch;
      await fetchAuthority("/restore", "POST");
      await waitFor(() => {
        const active = useMatchStore.getState().actionWindow;
        if (!active) {
          return false;
        }
        return (
          active.clockEpoch !== epoch &&
          renderedWindowEpoch === active.clockEpoch &&
          ws.serverClock.quality()?.clockEpoch === active.clockEpoch
        );
      });
      return evidence();
    },
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelAnimationFrame(frameHandle);
      for (const timer of ownedTimers) {
        clearTimeout(timer);
      }
      ownedTimers.clear();
      for (const waiter of waiters) {
        waiter.reject(new Error("The isolated timing harness was disposed"));
      }
      waiters.clear();
      unsubscribe();
      ws.close();
      renderer.destroy();
      const response = await fetch(`/timing/rooms/${room.matchId}`, {
        method: "DELETE",
        keepalive: true,
      });
      if (!response.ok) {
        throw new Error(`Isolated room cleanup failed: ${response.status}`);
      }
    },
  };
  window.timingHarness = harness;
  ws.connect();
  window.addEventListener("pagehide", () => {
    void harness
      .dispose()
      .catch((error: unknown) =>
        console.error("Isolated game cleanup failed:", error)
      );
  });
}

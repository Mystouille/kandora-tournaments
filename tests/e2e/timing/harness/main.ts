import { ServerClock } from "~/game/client/time/serverClock";
import { ClockSampleSchema } from "~/game/protocol/timing";
import { GameWS } from "~/game/client/ws";
import { useMatchStore } from "~/game/client/store";
import { actionTimerView } from "~/game/client/time/actionWindowViewModel";
import { liveServerNow } from "~/game/client/time/liveClock";
import { TableRenderer } from "~/game/client/pixi/TableRenderer";
import { findTileAction } from "~/game/client/discardActions";

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
  const response = await fetch("/timing/rooms", { method: "POST" });
  const room: { matchId: string } = await response.json();
  useMatchStore.getState().setMatch(room.matchId);
  const renderer = new TableRenderer();
  await renderer.mount(table);
  renderer.setMinimumDrawToDiscardDelayEnabled(true);
  renderer.setDrawSequencing(true);
  let transportError: string | null = null;
  const ws = new GameWS({
    matchId: room.matchId,
    getConnectionDetails: async () => ({
      wsUrl: `ws://${window.location.host}/timing/game/${room.matchId}`,
      token: new URLSearchParams(location.search).has("badAuth")
        ? "invalid-test-token"
        : "isolated-test-token",
    }),
    onError: (code, message) => {
      transportError = `${code}: ${message}`;
    },
  });
  renderer.setOnTileClick(({ tile, discardSource, intent }) => {
    const action = findTileAction(
      useMatchStore.getState().legalActions,
      "discard",
      tile,
      discardSource
    );
    if (action) {
      ws.act(action.id, intent);
    }
  });
  renderer.setOnActionClick(({ action, intent }) => {
    ws.act(action.id, intent);
  });
  let renderPending = true;
  renderer.setOnRenderRequest(() => {
    renderPending = true;
  });
  const render = (): void => {
    const view = useMatchStore.getState();
    if (renderPending) {
      renderPending = false;
      renderer.render(view);
    }
    discards.value = String(view.totalDiscards);
    bank.value = String(view.actionBufferMs ?? "");
    const now = liveServerNow();
    if (transportError) {
      decision.value = transportError;
    } else if (view.actionWindow && now !== null) {
      const timer = actionTimerView(view.actionWindow, now);
      if (timer.ready && firstReady.value === "") {
        firstReady.value = String(timer.baseRemainingMs);
      }
      decision.value = timer.ready ? "Ready" : "Waiting";
      remaining.value = String(timer.baseRemainingMs);
    } else {
      decision.value = "Synchronizing";
    }
  };
  const unsubscribe = useMatchStore.subscribe(() => {
    renderPending = true;
  });
  const tick = window.setInterval(render, 16);
  reconnect.addEventListener("click", () => ws.forceReconnect());
  nearDeadline.addEventListener("click", () => {
    const window = useMatchStore.getState().actionWindow;
    const now = liveServerNow();
    if (!window || now === null) {
      throw new Error("There is no active decision");
    }
    setTimeout(
      () => {
        const canvas = table.querySelector("canvas");
        if (!canvas) {
          throw new Error("Game canvas is missing");
        }
        canvas.dispatchEvent(
          new MouseEvent("mousedown", { button: 2, bubbles: true })
        );
      },
      Math.max(0, window.baseEndsAt - now - 25)
    );
  });
  ws.connect();
  window.addEventListener("pagehide", () => {
    window.clearInterval(tick);
    unsubscribe();
    ws.close();
    renderer.destroy();
  });
}

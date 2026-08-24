import { App as NativeApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import {
  Cloud,
  History,
  LoaderCircle,
  Radio,
  RotateCcw,
  Upload,
  Users,
  Wifi,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { z } from "zod";
import {
  GameEventSchema,
  type GameEvent,
  type Seat,
} from "~/game/protocol/messages";
import {
  applyReplayEvent,
  initialView,
  replayViewToMatchView,
} from "~/game/replay/player";
import type { MatchView } from "~/game/client/store";
import type { TableRenderer } from "~/game/client/pixi/TableRenderer";
import { DEMO_EVENTS, DEMO_SEAT_NAMES } from "./demoReplay";
import {
  openMobileMatchRepository,
  type MobileMatchRepositoryHandle,
} from "./persistence/mobileMatchRepository";

type AppMode = "online" | "nearby" | "replays";

interface LoadedReplay {
  id: string;
  events: GameEvent[];
  seatNames: [string, string, string, string];
}

const SeatSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const ImportedReplaySchema = z
  .object({
    source: z.string().optional(),
    sourceGameId: z.string().optional(),
    seats: z
      .array(
        z
          .object({
            seat: SeatSchema,
            displayName: z.string(),
          })
          .passthrough()
      )
      .length(4),
    events: z.array(GameEventSchema).min(1),
  })
  .passthrough();

const DEMO_REPLAY: LoadedReplay = {
  id: "Demo table",
  events: DEMO_EVENTS,
  seatNames: DEMO_SEAT_NAMES,
};

const MODES = [
  { id: "online" as const, label: "Online", Icon: Cloud },
  { id: "nearby" as const, label: "Nearby", Icon: Radio },
  { id: "replays" as const, label: "Replays", Icon: History },
];

function replayToMatchView(replay: LoadedReplay): MatchView {
  let view = initialView();
  for (const event of replay.events) {
    view = applyReplayEvent(view, event);
  }
  return replayViewToMatchView(view, {
    index: replay.events.length - 1,
    matchId: replay.id,
    seatNames: replay.seatNames,
  });
}

export function App() {
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<TableRenderer | null>(null);
  const repositoryRef = useRef<MobileMatchRepositoryHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<AppMode>("replays");
  const [replay, setReplay] = useState<LoadedReplay>(DEMO_REPLAY);
  const [rendererState, setRendererState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [importError, setImportError] = useState<string | null>(null);
  const [storageState, setStorageState] = useState<
    "loading" | "sqlite" | "memory" | "error"
  >("loading");
  const matchView = useMemo(() => replayToMatchView(replay), [replay]);
  const latestViewRef = useRef(matchView);
  latestViewRef.current = matchView;

  useEffect(() => {
    let disposed = false;
    void openMobileMatchRepository()
      .then(async (handle) => {
        if (disposed) {
          await handle.close();
          return;
        }
        repositoryRef.current = handle;
        setStorageState(handle.storage);
      })
      .catch(() => {
        if (!disposed) {
          setStorageState("error");
        }
      });
    return () => {
      disposed = true;
      const handle = repositoryRef.current;
      repositoryRef.current = null;
      if (handle !== null) {
        void handle.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    void StatusBar.setStyle({ style: Style.Light });
    if (Capacitor.getPlatform() === "android") {
      void StatusBar.setBackgroundColor({ color: "#0b1210" });
    }
    let listener: PluginListenerHandle | null = null;
    void NativeApp.addListener("appStateChange", ({ isActive }) => {
      document.documentElement.dataset.appState = isActive
        ? "active"
        : "background";
    }).then((handle) => {
      listener = handle;
    });
    return () => {
      void listener?.remove();
    };
  }, []);

  useEffect(() => {
    const container = tableContainerRef.current;
    if (container === null) {
      return;
    }
    let disposed = false;
    let renderer: TableRenderer | null = null;
    void import("~/game/client/pixi/TableRenderer")
      .then(async ({ TableRenderer: Renderer }) => {
        renderer = new Renderer();
        await renderer.mount(container);
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.render(latestViewRef.current);
        setRendererState("ready");
        if (Capacitor.isNativePlatform()) {
          await SplashScreen.hide();
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error("Kandora table renderer failed to mount", error);
          setRendererState("error");
          if (Capacitor.isNativePlatform()) {
            void SplashScreen.hide();
          }
        }
      });
    return () => {
      disposed = true;
      rendererRef.current = null;
      renderer?.destroy();
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.render(matchView);
  }, [matchView]);

  const importReplay = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    try {
      const parsed = ImportedReplaySchema.parse(
        JSON.parse(await file.text()) as unknown
      );
      const seatNames: [string, string, string, string] = [
        "East",
        "South",
        "West",
        "North",
      ];
      for (const seat of parsed.seats) {
        seatNames[seat.seat as Seat] = seat.displayName;
      }
      setReplay({
        id: parsed.sourceGameId ?? file.name,
        events: parsed.events,
        seatNames,
      });
      setImportError(null);
      setMode("replays");
    } catch {
      setImportError("This file is not a valid Kandora replay.");
    }
  };

  return (
    <main className="mobile-app">
      <section className="table-stage" aria-label="Mahjong table preview">
        <div ref={tableContainerRef} className="table-canvas" />
        <header className="app-header">
          <div>
            <strong>Kandora</strong>
            <span>{replay.id}</span>
          </div>
          <div className={`renderer-state renderer-state-${rendererState}`}>
            {rendererState === "loading" ? (
              <LoaderCircle aria-hidden="true" className="spin" />
            ) : rendererState === "ready" ? (
              <Wifi aria-hidden="true" />
            ) : (
              <Radio aria-hidden="true" />
            )}
            <span>
              {rendererState === "loading"
                ? "Loading table"
                : rendererState === "ready"
                  ? "Table ready"
                  : "Renderer unavailable"}
            </span>
          </div>
        </header>
      </section>

      <section className="control-dock" aria-label="Game mode controls">
        <nav className="mode-switcher" aria-label="Game mode">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={mode === id ? "active" : undefined}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="mode-actions">
          {mode === "replays" ? (
            <>
              <div className="mode-copy">
                <strong>{replay.events.length} events</strong>
                <span>
                  {importError ??
                    (storageState === "sqlite"
                      ? "Saved on device"
                      : storageState === "memory"
                        ? "Browser preview"
                        : storageState === "error"
                          ? "Storage unavailable"
                          : "Opening storage")}
                </span>
              </div>
              <div className="action-row">
                <button
                  type="button"
                  className="command-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload aria-hidden="true" />
                  <span>Import</span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Restore demo table"
                  title="Restore demo table"
                  onClick={() => {
                    setReplay(DEMO_REPLAY);
                    setImportError(null);
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                </button>
              </div>
              <input
                ref={fileInputRef}
                className="file-input"
                type="file"
                accept="application/json,.json"
                onChange={(event) => void importReplay(event)}
              />
            </>
          ) : mode === "online" ? (
            <>
              <div className="mode-copy">
                <strong>Cloud tables</strong>
                <span>Account connection not configured</span>
              </div>
              <button type="button" className="command-button" disabled>
                <Cloud aria-hidden="true" />
                <span>Connect</span>
              </button>
            </>
          ) : (
            <>
              <div className="mode-copy">
                <strong>Private network</strong>
                <span>Nearby transport not installed</span>
              </div>
              <div className="action-row">
                <button type="button" className="command-button" disabled>
                  <Users aria-hidden="true" />
                  <span>Host</span>
                </button>
                <button type="button" className="command-button" disabled>
                  <Radio aria-hidden="true" />
                  <span>Join</span>
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
import { App as NativeApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import {
  Cloud,
  History,
  LoaderCircle,
  LogOut,
  Pause,
  Radio,
  RotateCcw,
  Upload,
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
  rotateMatchView,
} from "~/game/replay/player";
import type { MatchView } from "~/game/client/store";
import { useMatchStore } from "~/game/client/store";
import { findTileAction } from "~/game/client/discardActions";
import type { TableRenderer } from "~/game/client/pixi/TableRenderer";
import { mobileTableLayout } from "~/game/client/pixi/layouts/mobileTableLayout";
import { DEMO_EVENTS, DEMO_SEAT_NAMES } from "./demoReplay";
import {
  openMobileMatchRepository,
  type MobileMatchRepositoryHandle,
} from "./persistence/mobileMatchRepository";
import {
  LocalMatchController,
  type LocalMatchControllerState,
} from "./local/LocalMatchController";
import {
  INITIAL_NEARBY_MATCH_STATE,
  NearbyMatchController,
  type NearbyIdentity,
} from "./nearby/NearbyMatchController";
import { NearbyLobbyPanel } from "./nearby/NearbyLobbyPanel";
import {
  loadNearbyIdentity,
  updateNearbyDisplayName,
} from "./nearby/identity";

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

const INITIAL_LOCAL_STATE: LocalMatchControllerState = {
  status: "idle",
  matchId: null,
  error: null,
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
  const localControllerRef = useRef<LocalMatchController | null>(null);
  const nearbyControllerRef = useRef<NearbyMatchController | null>(null);
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
  const [localState, setLocalState] = useState(INITIAL_LOCAL_STATE);
  const [nearbyState, setNearbyState] = useState(
    INITIAL_NEARBY_MATCH_STATE
  );
  const [nearbyIdentity, setNearbyIdentity] = useState<NearbyIdentity>(() =>
    loadNearbyIdentity()
  );
  const nearbyIdentityRef = useRef(nearbyIdentity);
  nearbyIdentityRef.current = nearbyIdentity;
  const liveView = useMatchStore();
  const replayView = useMemo(() => replayToMatchView(replay), [replay]);
  const showingLocalMatch = localState.matchId !== null;
  const showingNearbyMatch = nearbyState.matchId !== null;
  const showingLiveMatch =
    mode === "nearby" && (showingLocalMatch || showingNearbyMatch);
  const isPlayingMatch =
    showingLiveMatch &&
    (localState.status === "playing" || nearbyState.status === "playing");
  const renderedLiveView = useMemo(
    () =>
      liveView.mySeat !== null && liveView.mySeat !== 0
        ? rotateMatchView(liveView, liveView.mySeat)
        : liveView,
    [liveView]
  );
  const matchView = showingLiveMatch ? renderedLiveView : replayView;
  const latestViewRef = useRef(matchView);
  latestViewRef.current = matchView;

  useEffect(() => {
    let disposed = false;
    let unsubscribeLocal = (): void => undefined;
    let unsubscribeNearby = (): void => undefined;
    void openMobileMatchRepository()
      .then(async (handle) => {
        if (disposed) {
          await handle.close();
          return;
        }
        repositoryRef.current = handle;
        const controller = new LocalMatchController(handle);
        localControllerRef.current = controller;
        unsubscribeLocal = controller.subscribe(setLocalState);
        const nearbyController = new NearbyMatchController(handle);
        nearbyControllerRef.current = nearbyController;
        unsubscribeNearby = nearbyController.subscribe(setNearbyState);
        setStorageState(handle.storage);
        await nearbyController.initialize();
        const activeMatch = await handle.getActiveMatch();
        if (activeMatch?.owner === "nearby-host") {
          await nearbyController.restoreHost(nearbyIdentityRef.current);
        } else {
          await controller.restore();
        }
        if (
          controller.getState().matchId !== null ||
          nearbyController.getState().matchId !== null
        ) {
          setMode("nearby");
        }
      })
      .catch(() => {
        if (!disposed) {
          setStorageState("error");
        }
      });
    return () => {
      disposed = true;
      unsubscribeLocal();
      unsubscribeNearby();
      const controller = localControllerRef.current;
      localControllerRef.current = null;
      const nearbyController = nearbyControllerRef.current;
      nearbyControllerRef.current = null;
      const handle = repositoryRef.current;
      repositoryRef.current = null;
      const cleanup = [
        controller?.pause() ?? Promise.resolve(),
        nearbyController?.dispose() ?? Promise.resolve(),
      ];
      void Promise.allSettled(cleanup).finally(() => handle?.close());
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
      const controller = localControllerRef.current;
      const nearbyController = nearbyControllerRef.current;
      if (!isActive) {
        void Promise.allSettled([
          controller?.pause() ?? Promise.resolve(),
          nearbyController?.pause() ?? Promise.resolve(),
        ]);
        return;
      }
      if (nearbyController?.getState().role === "host") {
        void nearbyController
          .restoreHost(nearbyIdentityRef.current)
          .catch(() => undefined);
      } else if (nearbyController?.getState().role !== "guest") {
        void controller?.restore().catch(() => undefined);
      }
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
        renderer = new Renderer({
          layoutConfig: mobileTableLayout,
          presentation: "mobile",
        });
        renderer.setConnectionDiagnosticsVisible(false);
        await renderer.mount(container);
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.setOnTileClick(({ tile, discardSource }) => {
          const store = useMatchStore.getState();
          if (store.mySeat === null) {
            return;
          }
          const action = findTileAction(
            store.legalActions,
            "discard",
            tile,
            discardSource
          );
          if (action === undefined) {
            return;
          }
          store.setPendingDiscard({ seat: store.mySeat, tile });
          const nearbyController = nearbyControllerRef.current;
          if (nearbyController?.getState().matchId === store.matchId) {
            void nearbyController.act(action.id).catch(() => undefined);
          } else {
            void localControllerRef.current?.act(action.id);
          }
        });
        renderer.setOnActionClick(({ action }) => {
          const store = useMatchStore.getState();
          const nearbyController = nearbyControllerRef.current;
          if (nearbyController?.getState().matchId === store.matchId) {
            void nearbyController.act(action.id).catch(() => undefined);
          } else {
            void localControllerRef.current?.act(action.id);
          }
          useMatchStore.getState().setLegalActions([]);
        });
        renderer.setOnRenderRequest(() => {
          renderer?.render(latestViewRef.current);
        });
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

  const readyDeadline = liveView.readyCheck?.deadline ?? null;
  const readySeat = liveView.mySeat;
  useEffect(() => {
    if (
      (localState.status !== "playing" &&
        nearbyState.status !== "playing") ||
      readyDeadline === null ||
      readySeat === null ||
      liveView.readyCheck?.acked[readySeat]
    ) {
      return;
    }
    if (nearbyControllerRef.current?.getState().matchId === liveView.matchId) {
      void nearbyControllerRef.current.ready().catch(() => undefined);
    } else {
      void localControllerRef.current?.ready();
    }
  }, [
    liveView.readyCheck,
    localState.status,
    nearbyState.status,
    readyDeadline,
    readySeat,
  ]);

  const nearbyBusy =
    localState.status === "starting" ||
    localState.status === "pausing" ||
    nearbyState.status === "opening" ||
    nearbyState.status === "connecting";

  const currentNearbyIdentity = (): NearbyIdentity => {
    const identity = updateNearbyDisplayName(
      nearbyIdentityRef.current,
      nearbyIdentityRef.current.displayName
    );
    nearbyIdentityRef.current = identity;
    setNearbyIdentity(identity);
    return identity;
  };

  const playSolo = async (): Promise<void> => {
    const nearbyController = nearbyControllerRef.current;
    if (nearbyController !== null && nearbyController.getState().role !== "idle") {
      await nearbyController.leave();
    }
    const controller = localControllerRef.current;
    if (controller === null) {
      return;
    }
    const activeMatch = await repositoryRef.current?.getActiveMatch();
    if (
      controller.getState().status === "paused" &&
      activeMatch?.owner === "solo"
    ) {
      await controller.restore();
    } else {
      await controller.startSolo();
    }
  };

  const hostNearby = async (): Promise<void> => {
    await localControllerRef.current?.pause();
    await nearbyControllerRef.current?.host(currentNearbyIdentity());
  };

  const discoverNearby = async (): Promise<void> => {
    await localControllerRef.current?.pause();
    await nearbyControllerRef.current?.discover(currentNearbyIdentity());
  };

  const pauseOrLeaveMatch = (): void => {
    if (nearbyState.status === "playing") {
      const operation =
        nearbyState.role === "host"
          ? nearbyControllerRef.current?.pause()
          : nearbyControllerRef.current?.leave();
      void operation?.catch(() => undefined);
      return;
    }
    void localControllerRef.current?.pause();
  };

  const showNearbyLobby =
    mode === "nearby" &&
    localState.status !== "playing" &&
    nearbyState.status !== "playing" &&
    nearbyState.status !== "finished";

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
    <main className={`mobile-app${isPlayingMatch ? " mobile-app-ingame" : ""}`}>
      <section className="table-stage" aria-label="Mahjong table preview">
        <div ref={tableContainerRef} className="table-canvas" />
        <header className="app-header">
          <div>
            <strong>Kandora</strong>
            <span>
              {showingNearbyMatch
                ? "Nearby table"
                : showingLocalMatch
                  ? "Local table"
                  : replay.id}
            </span>
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
        {isPlayingMatch && (
          <button
            type="button"
            className="ingame-exit-button"
            aria-label={
              nearbyState.role === "guest" ? "Leave match" : "Pause match"
            }
            title={
              nearbyState.role === "guest" ? "Leave match" : "Pause match"
            }
            disabled={nearbyBusy}
            onClick={pauseOrLeaveMatch}
          >
            {nearbyState.role === "guest" ? (
              <LogOut aria-hidden="true" />
            ) : (
              <Pause aria-hidden="true" />
            )}
          </button>
        )}
        {showNearbyLobby && (
          <NearbyLobbyPanel
            state={nearbyState}
            localState={localState}
            identity={nearbyIdentity}
            busy={nearbyBusy}
            onDisplayNameChange={(displayName) => {
              const identity = { ...nearbyIdentityRef.current, displayName };
              nearbyIdentityRef.current = identity;
              setNearbyIdentity(identity);
              if (displayName.trim() !== "") {
                updateNearbyDisplayName(identity, displayName);
              }
            }}
            onPlaySolo={() => {
              void playSolo().catch(() => undefined);
            }}
            onHost={() => {
              void hostNearby().catch(() => undefined);
            }}
            onDiscover={() => {
              void discoverNearby().catch(() => undefined);
            }}
            onResumeHost={() => {
              void nearbyControllerRef.current
                ?.restoreHost(currentNearbyIdentity())
                .catch(() => undefined);
            }}
            onConnect={(endpointId) => {
              void nearbyControllerRef.current
                ?.requestConnection(endpointId)
                .catch(() => undefined);
            }}
            onConfirmPairing={(endpointId) => {
              void nearbyControllerRef.current
                ?.confirmPairing(endpointId)
                .catch(() => undefined);
            }}
            onRejectPairing={(endpointId) => {
              void nearbyControllerRef.current
                ?.rejectPairing(endpointId)
                .catch(() => undefined);
            }}
            onReadyChange={(ready) => {
              void nearbyControllerRef.current
                ?.setWaitingRoomReady(ready)
                .catch(() => undefined);
            }}
            onAddBot={() => {
              void nearbyControllerRef.current
                ?.addWaitingRoomBot()
                .catch(() => undefined);
            }}
            onKick={(seat) => {
              void nearbyControllerRef.current
                ?.kickWaitingRoomSeat(seat)
                .catch(() => undefined);
            }}
            onStartMatch={() => {
              void nearbyControllerRef.current
                ?.startMatch()
                .catch(() => undefined);
            }}
            onLeave={() => {
              void nearbyControllerRef.current?.leave().catch(() => undefined);
            }}
          />
        )}
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
                <strong>
                  {nearbyState.status === "playing"
                    ? "Nearby match"
                    : nearbyState.status === "lobby"
                      ? "Nearby lobby"
                      : localState.status === "playing"
                    ? "Local match"
                    : localState.status === "paused"
                      ? "Match saved"
                      : localState.status === "finished"
                        ? "Match complete"
                        : "Solo table"}
                </strong>
                <span>
                  {nearbyState.error ??
                    localState.error ??
                    (nearbyState.status === "playing"
                      ? `${nearbyState.connected.length + 1} devices connected`
                      : nearbyState.status === "lobby"
                        ? "Pair friends or start with bots"
                        : localState.status === "playing"
                          ? `${liveView.wallRemaining} tiles remain`
                          : localState.status === "paused"
                            ? "Ready to resume"
                            : "Host, join, or play solo")}
                </span>
              </div>
              <div className="action-row">
                {(localState.status === "playing" ||
                  nearbyState.status === "playing") && (
                  <button
                    type="button"
                    className="command-button"
                    disabled={nearbyBusy}
                    onClick={pauseOrLeaveMatch}
                  >
                    {nearbyState.role === "guest" &&
                    nearbyState.status === "playing" ? (
                      <LogOut aria-hidden="true" />
                    ) : (
                      <Pause aria-hidden="true" />
                    )}
                    <span>
                      {nearbyState.role === "guest" &&
                      nearbyState.status === "playing"
                        ? "Leave"
                        : "Pause"}
                    </span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
import { App as NativeApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import {
  ArrowLeft,
  ChevronRight,
  Cloud,
  DoorOpen,
  History,
  LoaderCircle,
  LogIn,
  LogOut,
  Radio,
  RotateCcw,
  Upload,
  UserRound,
  Wifi,
  WifiOff,
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
import {
  hasPlayingMatch,
  nearbyPageAvailable,
  normalizeWebAppUrl,
  retryTransientPause,
  webAppPath,
  type MobileShellPage,
  type MobileStorageState,
} from "./shell";

type AuthChoice = "undecided" | "offline" | "web";

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
  const [page, setPage] = useState<MobileShellPage>("home");
  const [authChoice, setAuthChoice] = useState<AuthChoice>("undecided");
  const [controllersReady, setControllersReady] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const [replay, setReplay] = useState<LoadedReplay>(DEMO_REPLAY);
  const [rendererState, setRendererState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [importError, setImportError] = useState<string | null>(null);
  const [storageState, setStorageState] =
    useState<MobileStorageState>("loading");
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
  const isPlayingMatch = hasPlayingMatch(
    localState.status,
    nearbyState.status
  );
  const showsTable = page === "game" || page === "replays";
  const renderedLiveView = useMemo(
    () =>
      liveView.mySeat !== null && liveView.mySeat !== 0
        ? rotateMatchView(liveView, liveView.mySeat)
        : liveView,
    [liveView]
  );
  const matchView = page === "game" ? renderedLiveView : replayView;
  const latestViewRef = useRef(matchView);
  latestViewRef.current = matchView;
  const webAppBaseUrl = normalizeWebAppUrl(
    import.meta.env.VITE_APP_BASE_URL
  );
  const discordLoginUrl =
    webAppBaseUrl === null
      ? null
      : webAppPath(webAppBaseUrl, "/sign-in?returnTo=%2Flobby");
  const onlineLobbyUrl =
    webAppBaseUrl === null ? null : webAppPath(webAppBaseUrl, "/lobby");
  const canOpenNearby = nearbyPageAvailable(controllersReady, storageState);

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
        setControllersReady(true);
        const activeMatch = await handle.getActiveMatch();
        if (activeMatch?.owner === "nearby-host") {
          await nearbyController.restoreHost(nearbyIdentityRef.current);
        } else {
          await controller.restore();
        }
        if (
          hasPlayingMatch(
            controller.getState().status,
            nearbyController.getState().status
          )
        ) {
          setPage("game");
        } else if (
          controller.getState().matchId !== null ||
          nearbyController.getState().matchId !== null
        ) {
          setPage("nearby");
        }
      })
      .catch(() => {
        if (!disposed) {
          setControllersReady(false);
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
    void SplashScreen.hide();
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
    if (!showsTable) {
      return;
    }
    const container = tableContainerRef.current;
    if (container === null) {
      return;
    }
    let disposed = false;
    let renderer: TableRenderer | null = null;
    setRendererState("loading");
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
  }, [showsTable]);

  useEffect(() => {
    rendererRef.current?.render(matchView);
  }, [matchView]);

  useEffect(() => {
    if (isPlayingMatch) {
      setPage("game");
    }
  }, [isPlayingMatch]);

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
    shellBusy ||
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

  const quitGame = async (): Promise<void> => {
    if (shellBusy) {
      return;
    }
    setShellBusy(true);
    try {
      if (nearbyState.status === "playing") {
        if (nearbyState.role === "guest") {
          await nearbyControllerRef.current?.leave();
        } else {
          await retryTransientPause(
            () => nearbyControllerRef.current?.pause() ?? Promise.resolve(),
            () => new Promise((resolve) => window.setTimeout(resolve, 50))
          );
        }
      } else {
        await retryTransientPause(
          () => localControllerRef.current?.pause() ?? Promise.resolve(),
          () => new Promise((resolve) => window.setTimeout(resolve, 50))
        );
      }
      setPage("nearby");
    } finally {
      setShellBusy(false);
    }
  };

  const leaveNearbyPage = async (): Promise<void> => {
    if (nearbyState.role !== "idle") {
      setShellBusy(true);
      try {
        await nearbyControllerRef.current?.leave();
      } finally {
        setShellBusy(false);
      }
    }
    setPage("home");
  };

  const openWebPage = (url: string): void => {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened === null) {
      window.location.assign(url);
    }
  };

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
      setPage("replays");
    } catch {
      setImportError("This file is not a valid Kandora replay.");
    }
  };

  if (page === "game") {
    return (
      <main className="mobile-game-view">
        <section className="table-stage" aria-label="Mahjong game">
          <div ref={tableContainerRef} className="table-canvas" />
          <button
            type="button"
            className="ingame-exit-button"
            aria-label="Quit game"
            title="Quit game"
            disabled={nearbyBusy}
            onClick={() => void quitGame().catch(() => undefined)}
          >
            <LogOut aria-hidden="true" />
          </button>
          {rendererState !== "ready" && (
            <div className="renderer-loading" aria-live="polite">
              <LoaderCircle aria-hidden="true" className="spin" />
              <span>
                {rendererState === "error" ? "Table unavailable" : "Loading"}
              </span>
            </div>
          )}
        </section>
      </main>
    );
  }

  if (page === "nearby") {
    return (
      <main className="mobile-shell mobile-shell-nearby">
        <header className="shell-topbar">
          <button
            type="button"
            className="shell-icon-button"
            aria-label="Back to home"
            title="Back to home"
            disabled={nearbyBusy}
            onClick={() => void leaveNearbyPage().catch(() => undefined)}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <div>
            <strong>Nearby</strong>
            <span>{nearbyState.available ? "Device play" : "Solo play"}</span>
          </div>
        </header>
        <section className="shell-nearby-content">
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
            onPlaySolo={() => void playSolo().catch(() => undefined)}
            onHost={() => void hostNearby().catch(() => undefined)}
            onDiscover={() => void discoverNearby().catch(() => undefined)}
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
        </section>
      </main>
    );
  }

  if (page === "replays") {
    return (
      <main className="mobile-shell mobile-replay-shell">
        <header className="shell-topbar">
          <button
            type="button"
            className="shell-icon-button"
            aria-label="Back to home"
            title="Back to home"
            onClick={() => setPage("home")}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <div>
            <strong>Replays</strong>
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
            <span>{rendererState === "ready" ? "Ready" : rendererState}</span>
          </div>
        </header>
        <section className="replay-workspace">
          <div className="replay-table-stage">
            <div ref={tableContainerRef} className="table-canvas" />
          </div>
          <aside className="replay-tools">
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
                <span>Import replay</span>
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
          </aside>
        </section>
      </main>
    );
  }

  const onlineSelected = authChoice === "web";
  const offlineSelected = authChoice === "offline";
  return (
    <main className="mobile-shell mobile-home">
      <header className="shell-brand">
        <span>K</span>
        <div>
          <h1>Kandora</h1>
          <p>Mahjong, wherever the table is.</p>
        </div>
      </header>

      <section className="home-account" aria-labelledby="account-heading">
        <div className="home-section-heading">
          <UserRound aria-hidden="true" />
          <div>
            <h2 id="account-heading">Player access</h2>
            <span>
              {offlineSelected
                ? "Offline"
                : onlineSelected
                  ? "Discord web access selected"
                  : "Choose how to continue"}
            </span>
          </div>
        </div>
        <div className="home-account-actions">
          <button
            type="button"
            className="home-primary-action"
            disabled={discordLoginUrl === null}
            onClick={() => {
              if (discordLoginUrl !== null) {
                setAuthChoice("web");
                openWebPage(discordLoginUrl);
              }
            }}
          >
            <LogIn aria-hidden="true" />
            <span>Login with Discord</span>
          </button>
          <button
            type="button"
            className="home-secondary-action"
            aria-pressed={offlineSelected}
            onClick={() => setAuthChoice("offline")}
          >
            <WifiOff aria-hidden="true" />
            <span>Stay offline</span>
          </button>
        </div>
      </section>

      <nav className="home-destinations" aria-label="Kandora destinations">
        <button
          type="button"
          disabled={!onlineSelected || onlineLobbyUrl === null}
          onClick={() => {
            if (onlineLobbyUrl !== null) {
              openWebPage(onlineLobbyUrl);
            }
          }}
        >
          <Cloud aria-hidden="true" />
          <span>
            <strong>Go to lobby</strong>
            <small>{offlineSelected ? "Unavailable offline" : "Online games"}</small>
          </span>
          <DoorOpen aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setPage("replays")}>
          <History aria-hidden="true" />
          <span>
            <strong>Replays</strong>
            <small>Import and review saved games</small>
          </span>
          <ChevronRight aria-hidden="true" className="destination-arrow" />
        </button>
        <button
          type="button"
          disabled={!canOpenNearby}
          onClick={() => setPage("nearby")}
        >
          <Radio aria-hidden="true" />
          <span>
            <strong>Nearby</strong>
            <small>
              {canOpenNearby
                ? nearbyState.available
                  ? "Solo, host, or join"
                  : "Solo available"
                : "Checking device"}
            </small>
          </span>
          <ChevronRight aria-hidden="true" className="destination-arrow" />
        </button>
      </nav>
    </main>
  );
}
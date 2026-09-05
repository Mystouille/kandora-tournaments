import { App as NativeApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
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
  Settings,
  Upload,
  UserRound,
  Volume2,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
import { findNoCallAutoPass } from "~/game/client/callPrompt";
import { findTileAction } from "~/game/client/discardActions";
import {
  installGameSoundBindings,
  isGameSoundEnabled,
  playGameSound,
  setGameSoundEnabled,
} from "~/game/client/sound";
import {
  buildInitialLivePlayMenuFlags,
  resetEphemeralFlags,
  writePersistedAutoSort,
  type LivePlayMenuFlags,
  type LivePlayMenuOptionKey,
} from "~/game/client/LivePlayMenu";
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
import { loadNearbyIdentity, updateNearbyDisplayName } from "./nearby/identity";
import { MobileLobby } from "./online/MobileLobby";
import { MobileOnlineRoom } from "./online/MobileOnlineRoom";
import { MobileGameMenu } from "./game/MobileGameMenu";
import {
  INITIAL_ONLINE_MATCH_STATE,
  OnlineMatchController,
} from "./online/OnlineMatchController";
import {
  clearMobileAuthSession,
  clearPendingMobileAuth,
  createMobileAuthRequest,
  exchangeMobileAuthCode,
  loadMobileAuthSession,
  loadPendingMobileAuthVerifier,
  MobileAuthHttpError,
  saveMobileAuthSession,
  savePendingMobileAuth,
  verifyMobileAuthSession,
  type MobileAuthSession,
} from "./auth/mobileAuth";
import {
  hasPlayingMatch,
  mobileAuthCallbackResult,
  nearbyPageAvailable,
  normalizeWebAppUrl,
  retryTransientPause,
  webAppPath,
  type MobileShellPage,
  type MobileStorageState,
} from "./shell";

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

const DRAW_TO_DISCARD_DELAY_MS = 700;

type MobileAuthStatus =
  | "checking"
  | "signed_out"
  | "opening"
  | "exchanging"
  | "authenticated"
  | "error";

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
  const onlineControllerRef = useRef<OnlineMatchController | null>(null);
  const liveActionDispatcherRef = useRef<(actionId: string) => void>(
    () => undefined
  );
  const lastAutoActedIdRef = useRef<string | null>(null);
  const autoDiscardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const authGenerationRef = useRef(0);
  const handledAuthCallbackRef = useRef<string | null>(null);
  const pendingVerifierRef = useRef<string | null>(null);
  const homeSettingsRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<MobileShellPage>("home");
  const pageRef = useRef(page);
  pageRef.current = page;
  const [authStatus, setAuthStatus] = useState<MobileAuthStatus>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [mobileAuthSession, setMobileAuthSession] =
    useState<MobileAuthSession | null>(null);
  const [controllersReady, setControllersReady] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const [gameMenuExpanded, setGameMenuExpanded] = useState(false);
  const [gameMenuLeft, setGameMenuLeft] = useState<number | null>(null);
  const [focusedHandTop, setFocusedHandTop] = useState<number | null>(null);
  const [homeSettingsOpen, setHomeSettingsOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(isGameSoundEnabled);
  const [liveMenuFlags, setLiveMenuFlags] = useState<LivePlayMenuFlags>(
    buildInitialLivePlayMenuFlags
  );
  const liveMenuFlagsRef = useRef(liveMenuFlags);
  liveMenuFlagsRef.current = liveMenuFlags;
  const [replay, setReplay] = useState<LoadedReplay>(DEMO_REPLAY);
  const [rendererState, setRendererState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [importError, setImportError] = useState<string | null>(null);
  const [storageState, setStorageState] =
    useState<MobileStorageState>("loading");
  const [localState, setLocalState] = useState(INITIAL_LOCAL_STATE);
  const [nearbyState, setNearbyState] = useState(INITIAL_NEARBY_MATCH_STATE);
  const [onlineState, setOnlineState] = useState(INITIAL_ONLINE_MATCH_STATE);
  const [nearbyIdentity, setNearbyIdentity] = useState<NearbyIdentity>(() =>
    loadNearbyIdentity()
  );
  const nearbyIdentityRef = useRef(nearbyIdentity);
  nearbyIdentityRef.current = nearbyIdentity;
  const liveView = useMatchStore();
  const replayView = useMemo(() => replayToMatchView(replay), [replay]);
  const isPlayingMatch =
    hasPlayingMatch(localState.status, nearbyState.status) ||
    onlineState.status === "playing" ||
    onlineState.status === "spectating" ||
    onlineState.status === "finished";
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
  liveActionDispatcherRef.current = (actionId) => {
    const matchId = useMatchStore.getState().matchId;
    const onlineController = onlineControllerRef.current;
    if (onlineController?.getState().matchId === matchId) {
      onlineController.act(actionId);
      return;
    }
    const nearbyController = nearbyControllerRef.current;
    if (nearbyController?.getState().matchId === matchId) {
      void nearbyController.act(actionId).catch(() => undefined);
      return;
    }
    void localControllerRef.current?.act(actionId);
  };
  const webAppBaseUrl = normalizeWebAppUrl(import.meta.env.VITE_APP_BASE_URL, {
    allowLoopback: !Capacitor.isNativePlatform(),
  });
  const canOpenNearby = nearbyPageAvailable(controllersReady, storageState);

  useEffect(() => {
    return installGameSoundBindings({
      isNoCallEnabled: () => liveMenuFlagsRef.current.noCall,
    });
  }, []);

  useEffect(() => {
    if (!homeSettingsOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !homeSettingsRef.current?.contains(event.target)
      ) {
        setHomeSettingsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setHomeSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [homeSettingsOpen]);

  useEffect(() => {
    window.localStorage.removeItem("kandora_mobile_auth_choice_v1");
    const generation = ++authGenerationRef.current;
    if (webAppBaseUrl === null) {
      setAuthStatus("signed_out");
      return;
    }
    const stored = loadMobileAuthSession(window.localStorage);
    if (stored === null) {
      setAuthStatus("signed_out");
      return;
    }
    setAuthStatus("checking");
    void verifyMobileAuthSession(webAppBaseUrl, stored)
      .then((verified) => {
        if (authGenerationRef.current !== generation) {
          return;
        }
        saveMobileAuthSession(window.localStorage, verified);
        setMobileAuthSession(verified);
        setAuthError(null);
        setAuthStatus("authenticated");
      })
      .catch((error: unknown) => {
        if (authGenerationRef.current !== generation) {
          return;
        }
        if (error instanceof MobileAuthHttpError && error.status === 401) {
          clearMobileAuthSession(window.localStorage);
        }
        setMobileAuthSession(null);
        setAuthError("Could not verify your Discord session.");
        setAuthStatus("error");
      });
  }, [webAppBaseUrl]);

  useEffect(() => {
    if (authStatus !== "authenticated" || mobileAuthSession === null) {
      return;
    }
    const remaining = mobileAuthSession.expiresAt - Date.now();
    if (remaining <= 0) {
      clearMobileAuthSession(window.localStorage);
      void onlineControllerRef.current?.leave();
      setMobileAuthSession(null);
      setAuthStatus("signed_out");
      setPage("home");
      return;
    }
    const timer = window.setTimeout(
      () => {
        clearMobileAuthSession(window.localStorage);
        void onlineControllerRef.current?.leave();
        setMobileAuthSession(null);
        setAuthStatus("signed_out");
        setPage("home");
      },
      Math.min(remaining, 2_147_483_647)
    );
    return () => window.clearTimeout(timer);
  }, [authStatus, mobileAuthSession]);

  useEffect(() => {
    const controller = new OnlineMatchController();
    onlineControllerRef.current = controller;
    const unsubscribe = controller.subscribe(setOnlineState);
    return () => {
      unsubscribe();
      controller.dispose();
      if (onlineControllerRef.current === controller) {
        onlineControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated" || mobileAuthSession === null) {
      return;
    }
    const displayName = mobileAuthSession.username.trim().slice(0, 40);
    if (
      displayName === "" ||
      nearbyIdentityRef.current.displayName === displayName
    ) {
      return;
    }
    const identity = updateNearbyDisplayName(
      nearbyIdentityRef.current,
      displayName
    );
    nearbyIdentityRef.current = identity;
    setNearbyIdentity(identity);
  }, [authStatus, mobileAuthSession]);

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
    void StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === "android") {
      void StatusBar.setBackgroundColor({ color: "#0b1210" });
    }
    void SplashScreen.hide();
    let stateListener: PluginListenerHandle | null = null;
    let urlListener: PluginListenerHandle | null = null;
    const handleUrl = (url: string): void => {
      const callback = mobileAuthCallbackResult(url);
      if (callback === null || handledAuthCallbackRef.current === url) {
        return;
      }
      handledAuthCallbackRef.current = url;
      void Browser.close().catch(() => undefined);
      const generation = ++authGenerationRef.current;
      const verifier =
        pendingVerifierRef.current ??
        loadPendingMobileAuthVerifier(window.localStorage);
      pendingVerifierRef.current = null;
      clearPendingMobileAuth(window.localStorage);
      if (
        callback.error !== null ||
        callback.code === null ||
        verifier === null ||
        webAppBaseUrl === null
      ) {
        setMobileAuthSession(null);
        setAuthError("Discord login could not be completed.");
        setAuthStatus("error");
        setPage("home");
        return;
      }
      setAuthError(null);
      setAuthStatus("exchanging");
      void exchangeMobileAuthCode(webAppBaseUrl, callback.code, verifier)
        .then((session) => {
          if (authGenerationRef.current !== generation) {
            return;
          }
          saveMobileAuthSession(window.localStorage, session);
          setMobileAuthSession(session);
          setAuthStatus("authenticated");
          setPage("lobby");
        })
        .catch(() => {
          if (authGenerationRef.current !== generation) {
            return;
          }
          clearMobileAuthSession(window.localStorage);
          setMobileAuthSession(null);
          setAuthError("Discord login could not be completed.");
          setAuthStatus("error");
          setPage("home");
        });
    };
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
      stateListener = handle;
    });
    void NativeApp.addListener("appUrlOpen", ({ url }) => {
      handleUrl(url);
    }).then((handle) => {
      urlListener = handle;
    });
    void NativeApp.getLaunchUrl().then((launch) => {
      if (launch?.url) {
        handleUrl(launch.url);
      }
    });
    return () => {
      void stateListener?.remove();
      void urlListener?.remove();
    };
  }, [webAppBaseUrl]);

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
        renderer.setMinimumDrawToDiscardDelayEnabled(
          pageRef.current === "game"
        );
        renderer.setConnectionDiagnosticsVisible(false);
        await renderer.mount(container);
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.setBottomHandBoundsListener((bounds) => {
          setFocusedHandTop(bounds?.y ?? null);
        });
        renderer.setOnAutoSortChange((autoSort) => {
          writePersistedAutoSort(autoSort);
          setLiveMenuFlags((current) =>
            current.autoSort === autoSort ? current : { ...current, autoSort }
          );
        });
        renderer.setAutoSort(liveMenuFlags.autoSort);
        renderer.setAutoWinEnabled(liveMenuFlags.autoWin);
        renderer.setNoCallEnabled(liveMenuFlags.noCall);
        renderer.setOnTileClick(({ index, tile, discardSource }) => {
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
          store.setPendingDiscard({
            seat: store.mySeat,
            tile,
            displayIndex: index,
          });
          liveActionDispatcherRef.current(action.id);
        });
        renderer.setOnActionClick(({ action }) => {
          liveActionDispatcherRef.current(action.id);
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
      renderer?.setBottomHandBoundsListener(null);
      renderer?.setOnAutoSortChange(null);
      renderer?.destroy();
      setFocusedHandTop(null);
    };
  }, [showsTable]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const canvas = tableContainerRef.current?.querySelector("canvas") ?? null;
    if (
      renderer === null ||
      canvas === null ||
      page !== "game" ||
      liveView.mySeat === null ||
      gameMenuLeft === null
    ) {
      renderer?.setMobileActionButtonRightBoundary(null);
      return;
    }
    renderer.setMobileActionButtonRightBoundary(
      gameMenuLeft - canvas.getBoundingClientRect().left
    );
  }, [gameMenuLeft, liveView.mySeat, page, rendererState]);

  useEffect(() => {
    const renderer = rendererRef.current;
    renderer?.setMinimumDrawToDiscardDelayEnabled(page === "game");
    renderer?.render(matchView);
  }, [matchView, page]);

  useEffect(() => {
    rendererRef.current?.setAutoSort(liveMenuFlags.autoSort);
  }, [liveMenuFlags.autoSort]);

  useEffect(() => {
    rendererRef.current?.setAutoWinEnabled(liveMenuFlags.autoWin);
  }, [liveMenuFlags.autoWin]);

  useEffect(() => {
    rendererRef.current?.setNoCallEnabled(liveMenuFlags.noCall);
  }, [liveMenuFlags.noCall]);

  const handKey = `${liveView.matchId ?? "none"}:${liveView.roundWind}:${liveView.roundNumber}:${liveView.honba}:${liveView.dealer}`;
  useEffect(() => {
    setLiveMenuFlags((current) => resetEphemeralFlags(current));
  }, [handKey]);

  useEffect(() => {
    if (page !== "game") {
      setGameMenuExpanded(false);
    }
  }, [page]);

  useEffect(() => {
    if (page !== "game" || liveView.mySeat === null) {
      return;
    }
    const actions = liveView.legalActions;
    if (actions.length === 0) {
      lastAutoActedIdRef.current = null;
      if (autoDiscardTimerRef.current !== null) {
        clearTimeout(autoDiscardTimerRef.current);
        autoDiscardTimerRef.current = null;
      }
      return;
    }
    const fire = (actionId: string): void => {
      if (lastAutoActedIdRef.current === actionId) {
        return;
      }
      lastAutoActedIdRef.current = actionId;
      liveActionDispatcherRef.current(actionId);
    };
    const hasWin = actions.some(
      (action) => action.type === "ron" || action.type === "tsumo"
    );
    if (liveMenuFlags.autoWin) {
      const win = actions.find(
        (action) => action.type === "ron" || action.type === "tsumo"
      );
      if (win !== undefined) {
        fire(win.id);
        return;
      }
    }
    const noCallPass = findNoCallAutoPass(actions, liveMenuFlags.noCall);
    if (noCallPass !== undefined) {
      fire(noCallPass.id);
      return;
    }
    const mySeat = liveView.mySeat;
    const inRiichi = liveView.riichiDeclared[mySeat];
    const hasAnkan = actions.some(
      (action) => action.type === "kan" && action.kanKind === "ankan"
    );
    if (
      (!liveMenuFlags.autoDiscard && !inRiichi) ||
      hasWin ||
      hasAnkan ||
      liveView.freshlyDrawnSeat !== mySeat
    ) {
      return;
    }
    const hand = liveView.hands[mySeat] ?? [];
    const drawn = hand[hand.length - 1];
    if (drawn === null || drawn === undefined) {
      return;
    }
    const discard = findTileAction(actions, "discard", drawn, "draw");
    if (discard === undefined || lastAutoActedIdRef.current === discard.id) {
      return;
    }
    if (autoDiscardTimerRef.current !== null) {
      clearTimeout(autoDiscardTimerRef.current);
    }
    autoDiscardTimerRef.current = setTimeout(() => {
      autoDiscardTimerRef.current = null;
      const current = useMatchStore.getState();
      if (
        current.mySeat !== mySeat ||
        !current.legalActions.some((action) => action.id === discard.id)
      ) {
        return;
      }
      current.setPendingDiscard({
        seat: mySeat,
        tile: drawn,
        displayIndex: hand.length - 1,
      });
      fire(discard.id);
    }, DRAW_TO_DISCARD_DELAY_MS);
    return () => {
      if (autoDiscardTimerRef.current !== null) {
        clearTimeout(autoDiscardTimerRef.current);
        autoDiscardTimerRef.current = null;
      }
    };
  }, [
    page,
    liveView.legalActions,
    liveView.mySeat,
    liveView.hands,
    liveView.freshlyDrawnSeat,
    liveView.riichiDeclared,
    liveMenuFlags.autoWin,
    liveMenuFlags.noCall,
    liveMenuFlags.autoDiscard,
  ]);

  useEffect(() => {
    return () => {
      if (autoDiscardTimerRef.current !== null) {
        clearTimeout(autoDiscardTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isPlayingMatch) {
      setPage("game");
    }
  }, [isPlayingMatch]);

  useEffect(() => {
    if (
      onlineState.status === "creating" ||
      onlineState.status === "connecting" ||
      onlineState.status === "waiting" ||
      onlineState.status === "error"
    ) {
      setPage("online-room");
    }
  }, [onlineState.status]);

  const readyDeadline = liveView.readyCheck?.deadline ?? null;
  const readySeat = liveView.mySeat;
  useEffect(() => {
    if (
      (localState.status !== "playing" &&
        nearbyState.status !== "playing" &&
        onlineState.status !== "playing") ||
      readyDeadline === null ||
      readySeat === null ||
      liveView.readyCheck?.acked[readySeat]
    ) {
      return;
    }
    if (onlineControllerRef.current?.getState().matchId === liveView.matchId) {
      onlineControllerRef.current.ready();
    } else if (
      nearbyControllerRef.current?.getState().matchId === liveView.matchId
    ) {
      void nearbyControllerRef.current.ready().catch(() => undefined);
    } else {
      void localControllerRef.current?.ready();
    }
  }, [
    liveView.readyCheck,
    localState.status,
    nearbyState.status,
    onlineState.status,
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
    if (
      nearbyController !== null &&
      nearbyController.getState().role !== "idle"
    ) {
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

  const prepareOnlineMatch = async (): Promise<void> => {
    if (nearbyControllerRef.current?.getState().role !== "idle") {
      await nearbyControllerRef.current?.leave();
    }
    await retryTransientPause(
      () => localControllerRef.current?.pause() ?? Promise.resolve(),
      () => new Promise((resolve) => window.setTimeout(resolve, 50))
    );
  };

  const createOnlineGame = async (preset: string): Promise<void> => {
    if (
      webAppBaseUrl === null ||
      mobileAuthSession === null ||
      onlineControllerRef.current === null
    ) {
      return;
    }
    setPage("online-room");
    await prepareOnlineMatch();
    await onlineControllerRef.current.create(
      webAppBaseUrl,
      mobileAuthSession,
      preset
    );
  };

  const joinOnlineGame = async (matchId: string): Promise<void> => {
    if (
      webAppBaseUrl === null ||
      mobileAuthSession === null ||
      onlineControllerRef.current === null
    ) {
      return;
    }
    setPage("online-room");
    await prepareOnlineMatch();
    onlineControllerRef.current.join(webAppBaseUrl, mobileAuthSession, matchId);
  };

  const watchOnlineGame = async (matchId: string): Promise<void> => {
    if (
      webAppBaseUrl === null ||
      mobileAuthSession === null ||
      onlineControllerRef.current === null
    ) {
      return;
    }
    setPage("online-room");
    await prepareOnlineMatch();
    onlineControllerRef.current.watch(
      webAppBaseUrl,
      mobileAuthSession,
      matchId
    );
  };

  const leaveOnlineRoom = async (): Promise<void> => {
    if (shellBusy) {
      return;
    }
    setShellBusy(true);
    try {
      await onlineControllerRef.current?.leave();
      setPage("lobby");
    } finally {
      setShellBusy(false);
    }
  };

  const quitGame = async (): Promise<void> => {
    if (shellBusy) {
      return;
    }
    setShellBusy(true);
    try {
      if (
        onlineState.status === "playing" ||
        onlineState.status === "spectating" ||
        onlineState.status === "finished"
      ) {
        await onlineControllerRef.current?.leave();
        setPage("lobby");
      } else if (nearbyState.status === "playing") {
        if (nearbyState.role === "guest") {
          await nearbyControllerRef.current?.leave();
        } else {
          await retryTransientPause(
            () => nearbyControllerRef.current?.pause() ?? Promise.resolve(),
            () => new Promise((resolve) => window.setTimeout(resolve, 50))
          );
        }
      } else if (localState.status === "playing") {
        await retryTransientPause(
          () => localControllerRef.current?.pause() ?? Promise.resolve(),
          () => new Promise((resolve) => window.setTimeout(resolve, 50))
        );
      }
      if (onlineState.mode === null) {
        setPage("nearby");
      }
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

  const openWebPage = async (url: string): Promise<void> => {
    if (Capacitor.isNativePlatform()) {
      await Browser.open({
        url,
        toolbarColor: "#0b1210",
        presentationStyle: "fullscreen",
      });
      return;
    }
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened === null) {
      window.location.assign(url);
    }
  };

  const startDiscordLogin = async (): Promise<void> => {
    if (webAppBaseUrl === null) {
      return;
    }
    const generation = ++authGenerationRef.current;
    setAuthError(null);
    setAuthStatus("opening");
    try {
      const request = await createMobileAuthRequest();
      if (authGenerationRef.current !== generation) {
        return;
      }
      pendingVerifierRef.current = request.verifier;
      savePendingMobileAuth(window.localStorage, request.verifier);
      const startUrl = webAppPath(
        webAppBaseUrl,
        `/mobile-auth/start?challenge=${encodeURIComponent(request.challenge)}`
      );
      await openWebPage(startUrl);
    } catch {
      if (authGenerationRef.current !== generation) {
        return;
      }
      pendingVerifierRef.current = null;
      clearPendingMobileAuth(window.localStorage);
      setAuthError("Discord login could not be opened.");
      setAuthStatus("error");
    }
  };

  const toggleLiveMenuOption = (key: LivePlayMenuOptionKey): void => {
    setLiveMenuFlags((current) => {
      const next = { ...current, [key]: !current[key] };
      if (key === "autoSort") {
        writePersistedAutoSort(next.autoSort);
      }
      return next;
    });
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
          {liveView.mySeat !== null && (
            <MobileGameMenu
              expanded={gameMenuExpanded}
              flags={liveMenuFlags}
              handTop={focusedHandTop}
              onExpandedChange={setGameMenuExpanded}
              onLeftChange={setGameMenuLeft}
              onToggle={toggleLiveMenuOption}
            />
          )}
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

  if (page === "online-room") {
    return (
      <MobileOnlineRoom
        state={onlineState}
        onBack={() => void leaveOnlineRoom()}
        onReconnect={() => onlineControllerRef.current?.reconnect()}
        onReadyChange={(ready) =>
          onlineControllerRef.current?.setWaitingRoomReady(ready)
        }
        onAddBot={() => onlineControllerRef.current?.addWaitingRoomBot()}
        onKick={(seat) =>
          onlineControllerRef.current?.kickWaitingRoomSeat(seat)
        }
        onStart={() => onlineControllerRef.current?.startMatch()}
      />
    );
  }

  if (page === "lobby" && webAppBaseUrl !== null) {
    return (
      <MobileLobby
        webAppBaseUrl={webAppBaseUrl}
        onBack={() => setPage("home")}
        onCreateGame={(preset) =>
          void createOnlineGame(preset).catch(() => setPage("lobby"))
        }
        onJoinGame={(matchId) =>
          void joinOnlineGame(matchId).catch(() => setPage("lobby"))
        }
        onWatchGame={(matchId) =>
          void watchOnlineGame(matchId).catch(() => setPage("lobby"))
        }
      />
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

  const onlineSelected =
    authStatus === "authenticated" && mobileAuthSession !== null;
  const authBusy = authStatus === "checking" || authStatus === "exchanging";
  const accountStatus = onlineSelected
    ? `Signed in as ${mobileAuthSession.username}`
    : authStatus === "checking"
      ? "Checking Discord session"
      : authStatus === "opening"
        ? "Complete sign-in in Discord"
        : authStatus === "exchanging"
          ? "Verifying Discord login"
          : (authError ?? "Sign in for online games");
  return (
    <main className="mobile-shell mobile-home">
      <header className="shell-brand">
        <span>K</span>
        <div>
          <h1>Kandora</h1>
          <p>Mahjong, wherever the table is.</p>
        </div>
        <div ref={homeSettingsRef} className="home-settings">
          <button
            type="button"
            className="shell-icon-button home-settings-button"
            aria-label="Settings"
            aria-expanded={homeSettingsOpen}
            aria-controls="home-settings-panel"
            title="Settings"
            onClick={() => setHomeSettingsOpen((open) => !open)}
          >
            <Settings aria-hidden="true" />
          </button>
          <div
            id="home-settings-panel"
            className="home-settings-panel"
            role="group"
            aria-label="Settings"
            hidden={!homeSettingsOpen}
          >
            <button
              type="button"
              className="home-setting-toggle"
              role="switch"
              aria-checked={soundEnabled}
              onClick={() => {
                const next = !soundEnabled;
                setGameSoundEnabled(next);
                setSoundEnabled(next);
                if (next) {
                  playGameSound("draw");
                }
              }}
            >
              <span className="home-setting-label">
                <Volume2 aria-hidden="true" />
                <span>Sound</span>
              </span>
              <span
                className={`home-setting-switch ${soundEnabled ? "enabled" : ""}`}
                aria-hidden="true"
              >
                <span />
              </span>
            </button>
          </div>
        </div>
      </header>

      <section className="home-account" aria-labelledby="account-heading">
        <div className="home-section-heading">
          <UserRound aria-hidden="true" />
          <div>
            <h2 id="account-heading">Player access</h2>
            <span>{accountStatus}</span>
          </div>
        </div>
        {!onlineSelected && (
          <div className="home-account-actions">
            <button
              type="button"
              className="home-primary-action"
              disabled={webAppBaseUrl === null || authBusy}
              onClick={() => void startDiscordLogin()}
            >
              {authBusy ? (
                <LoaderCircle aria-hidden="true" className="spin" />
              ) : (
                <LogIn aria-hidden="true" />
              )}
              <span>
                {authStatus === "opening"
                  ? "Open Discord again"
                  : "Login with Discord"}
              </span>
            </button>
          </div>
        )}
      </section>

      <nav className="home-destinations" aria-label="Kandora destinations">
        <button
          type="button"
          disabled={!onlineSelected || webAppBaseUrl === null}
          onClick={() => {
            setPage("lobby");
          }}
        >
          <Cloud aria-hidden="true" />
          <span>
            <strong>Go to lobby</strong>
            <small>Online games</small>
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

import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Menu,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Seat } from "~/game/protocol/messages";
import {
  replayBounds,
  replayReducer,
  replayViewToMatchView,
  roundBoundaries,
} from "~/game/replay/player";
import type { ReplayLog } from "~/game/replay/types";
import { waitsForReplayView } from "~/game/replay/waits";
import type { TableRenderer } from "~/game/client/pixi/TableRenderer";
import { mobileTableLayout } from "~/game/client/pixi/layouts/mobileTableLayout";

export interface MobileReplayDisplayOptions {
  showWaits: boolean;
  showHands: boolean;
  showTsumogiri: boolean;
  showNames: boolean;
}

export const DEFAULT_MOBILE_REPLAY_DISPLAY_OPTIONS: MobileReplayDisplayOptions =
  {
    showWaits: false,
    showHands: false,
    showTsumogiri: false,
    showNames: true,
  };

const DISPLAY_OPTIONS: Array<{
  key: keyof MobileReplayDisplayOptions;
  label: string;
}> = [
  { key: "showWaits", label: "Waits" },
  { key: "showHands", label: "Hands" },
  { key: "showTsumogiri", label: "Tsumogiri" },
  { key: "showNames", label: "Names" },
];

export interface ReplayNavigationState {
  currentRoundIndex: number;
  previousRound: number | null;
  nextRound: number | null;
}

export function replayNavigationState(
  rounds: number[],
  index: number
): ReplayNavigationState {
  let currentRoundIndex = -1;
  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    if (rounds[roundIndex] <= index) {
      currentRoundIndex = roundIndex;
    }
  }
  return {
    currentRoundIndex,
    previousRound: currentRoundIndex > 0 ? rounds[currentRoundIndex - 1] : null,
    nextRound:
      currentRoundIndex >= 0 && currentRoundIndex < rounds.length - 1
        ? rounds[currentRoundIndex + 1]
        : null,
  };
}

interface MobileReplayNavigationMenuProps {
  expanded: boolean;
  handTop: number | null;
  log: ReplayLog;
  index: number;
  focusSeat: Seat;
  rounds: number[];
  bounds: { min: number; max: number };
  onExpandedChange: (expanded: boolean) => void;
  onFocusSeatChange: (seat: Seat) => void;
  onGoTo: (index: number) => void;
  onStep: (delta: -1 | 1) => void;
}

export function MobileReplayNavigationMenu({
  expanded,
  handTop,
  log,
  index,
  focusSeat,
  rounds,
  bounds,
  onExpandedChange,
  onFocusSeatChange,
  onGoTo,
  onStep,
}: MobileReplayNavigationMenuProps) {
  const navigation = replayNavigationState(rounds, index);
  return (
    <aside
      className="mobile-replay-navigation-menu"
      aria-label="Replay navigation"
      style={
        handTop === null ? undefined : { bottom: `calc(100% - ${handTop}px)` }
      }
    >
      {expanded && (
        <div className="mobile-replay-navigation-panel">
          <div className="mobile-replay-navigation-selectors">
            <label>
              <span>Player</span>
              <select
                aria-label="Focus player"
                value={focusSeat}
                onChange={(event) =>
                  onFocusSeatChange(Number(event.target.value) as Seat)
                }
              >
                {([0, 1, 2, 3] as const).map((seat) => (
                  <option key={seat} value={seat}>
                    {log.seats[seat]?.displayName || `Seat ${seat + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Round</span>
              <select
                aria-label="Round"
                disabled={rounds.length === 0}
                value={
                  navigation.currentRoundIndex < 0
                    ? ""
                    : rounds[navigation.currentRoundIndex]
                }
                onChange={(event) => onGoTo(Number(event.target.value))}
              >
                <option value="" disabled>
                  Before first hand
                </option>
                {rounds.map((eventIndex, roundIndex) => {
                  const event = log.events[eventIndex];
                  const label =
                    event.type === "hand_start"
                      ? `${event.roundWind}${event.roundNumber}`
                      : `Round ${roundIndex + 1}`;
                  return (
                    <option key={eventIndex} value={eventIndex}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
          <div className="mobile-replay-navigation-buttons">
            <button
              type="button"
              aria-label="Previous round"
              title="Previous round"
              disabled={navigation.previousRound === null}
              onClick={() => {
                if (navigation.previousRound !== null) {
                  onGoTo(navigation.previousRound);
                }
              }}
            >
              <ChevronsLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Previous event"
              title="Previous event"
              disabled={index <= bounds.min}
              onClick={() => onStep(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next event"
              title="Next event"
              disabled={index >= bounds.max}
              onClick={() => onStep(1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next round"
              title="Next round"
              disabled={navigation.nextRound === null}
              onClick={() => {
                if (navigation.nextRound !== null) {
                  onGoTo(navigation.nextRound);
                }
              }}
            >
              <ChevronsRight aria-hidden="true" />
            </button>
          </div>
          <output className="mobile-replay-event-count">
            {index + 1} / {log.events.length}
          </output>
        </div>
      )}
      <button
        type="button"
        className="mobile-replay-menu-toggle"
        aria-label={
          expanded ? "Close replay navigation" : "Open replay navigation"
        }
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
    </aside>
  );
}

interface MobileReplayDisplayMenuProps {
  expanded: boolean;
  handTop: number | null;
  options: MobileReplayDisplayOptions;
  onExpandedChange: (expanded: boolean) => void;
  onToggle: (key: keyof MobileReplayDisplayOptions) => void;
}

export function MobileReplayDisplayMenu({
  expanded,
  handTop,
  options,
  onExpandedChange,
  onToggle,
}: MobileReplayDisplayMenuProps) {
  return (
    <aside
      className="mobile-replay-display-menu"
      aria-label="Replay display options"
      style={
        handTop === null ? undefined : { bottom: `calc(100% - ${handTop}px)` }
      }
    >
      <button
        type="button"
        className="mobile-replay-menu-toggle"
        aria-label={expanded ? "Hide display options" : "Show display options"}
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
      {expanded && (
        <div className="mobile-replay-display-options">
          {DISPLAY_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="mobile-replay-display-option"
              aria-label={label}
              title={label}
              aria-pressed={options[key]}
              onClick={() => onToggle(key)}
            >
              <span>{label}</span>
              <i aria-hidden="true">{options[key] && <Check />}</i>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

interface MobileReplayViewerProps {
  log: ReplayLog | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export function MobileReplayViewer(props: MobileReplayViewerProps) {
  if (props.log === null) {
    return (
      <main className="mobile-game-view mobile-replay-viewer">
        <button
          type="button"
          className="ingame-exit-button"
          aria-label="Back to replays"
          title="Back to replays"
          onClick={props.onClose}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <div className="renderer-loading" aria-live="polite">
          {props.loading ? (
            <LoaderCircle aria-hidden="true" className="spin" />
          ) : (
            <RotateCcw aria-hidden="true" />
          )}
          <span>{props.error ?? "Loading replay"}</span>
          {!props.loading && props.error !== null && (
            <button type="button" onClick={props.onRetry}>
              Try again
            </button>
          )}
        </div>
      </main>
    );
  }
  return <LoadedMobileReplayViewer {...props} log={props.log} />;
}

function LoadedMobileReplayViewer({
  log,
  onClose,
}: MobileReplayViewerProps & { log: ReplayLog }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<TableRenderer | null>(null);
  const latestViewRef = useRef<ReturnType<typeof replayViewToMatchView> | null>(
    null
  );
  const bounds = useMemo(() => replayBounds(log), [log]);
  const rounds = useMemo(() => roundBoundaries(log), [log]);
  const [index, setIndex] = useState(rounds[0] ?? bounds.min);
  const [focusSeat, setFocusSeat] = useState<Seat>(0);
  const [displayOptions, setDisplayOptions] =
    useState<MobileReplayDisplayOptions>(DEFAULT_MOBILE_REPLAY_DISPLAY_OPTIONS);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [handTop, setHandTop] = useState<number | null>(null);
  const [rendererState, setRendererState] = useState<
    "loading" | "ready" | "error"
  >("loading");

  const replayView = useMemo(() => replayReducer(log, index), [index, log]);
  const matchView = useMemo(
    () =>
      replayViewToMatchView(replayView, {
        index,
        mySeat: focusSeat,
        matchId: log.sourceGameId,
        seatNames: [
          log.seats[0]?.displayName ?? "",
          log.seats[1]?.displayName ?? "",
          log.seats[2]?.displayName ?? "",
          log.seats[3]?.displayName ?? "",
        ],
        currentWaits: displayOptions.showWaits
          ? waitsForReplayView(replayView)
          : null,
      }),
    [displayOptions.showWaits, focusSeat, index, log, replayView]
  );
  latestViewRef.current = matchView;

  useEffect(() => {
    const container = containerRef.current;
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
        renderer.setMinimumDrawToDiscardDelayEnabled(false);
        renderer.setStagedRevealEnabled(false);
        renderer.setOnRenderRequest(() => {
          const current = latestViewRef.current;
          if (current !== null) {
            renderer?.render(current);
          }
        });
        renderer.setBottomHandBoundsListener((bounds) => {
          setHandTop(bounds?.y ?? null);
        });
        await renderer.mount(container);
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.render(latestViewRef.current!);
        setRendererState("ready");
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          console.error("Kandora mobile replay renderer failed", reason);
          setRendererState("error");
        }
      });
    return () => {
      disposed = true;
      rendererRef.current = null;
      renderer?.setBottomHandBoundsListener(null);
      renderer?.destroy();
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) {
      return;
    }
    renderer.setShowWaits(displayOptions.showWaits);
    renderer.setShowHands(displayOptions.showHands);
    renderer.setShowTsumogiri(displayOptions.showTsumogiri);
    renderer.setShowNames(displayOptions.showNames);
    renderer.render(matchView);
  }, [displayOptions, matchView, rendererState]);

  const goTo = (nextIndex: number): void => {
    rendererRef.current?.snapNextAnimation();
    setIndex(Math.max(bounds.min, Math.min(nextIndex, bounds.max)));
  };

  const step = (delta: -1 | 1): void => {
    setIndex((current) =>
      Math.max(bounds.min, Math.min(current + delta, bounds.max))
    );
  };

  return (
    <main className="mobile-game-view mobile-replay-viewer">
      <section className="table-stage" aria-label="Mahjong replay">
        <div ref={containerRef} className="table-canvas" />
        <button
          type="button"
          className="ingame-exit-button"
          aria-label="Back to replays"
          title="Back to replays"
          onClick={onClose}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <MobileReplayDisplayMenu
          expanded={displayOpen}
          handTop={handTop}
          options={displayOptions}
          onExpandedChange={(expanded) => {
            setDisplayOpen(expanded);
            if (expanded) {
              setNavigationOpen(false);
            }
          }}
          onToggle={(key) =>
            setDisplayOptions((current) => ({
              ...current,
              [key]: !current[key],
            }))
          }
        />
        <MobileReplayNavigationMenu
          expanded={navigationOpen}
          handTop={handTop}
          log={log}
          index={index}
          focusSeat={focusSeat}
          rounds={rounds}
          bounds={bounds}
          onExpandedChange={(expanded) => {
            setNavigationOpen(expanded);
            if (expanded) {
              setDisplayOpen(false);
            }
          }}
          onFocusSeatChange={(seat) => {
            rendererRef.current?.snapNextAnimation();
            setFocusSeat(seat);
          }}
          onGoTo={goTo}
          onStep={step}
        />
        {rendererState !== "ready" && (
          <div className="renderer-loading" aria-live="polite">
            <LoaderCircle aria-hidden="true" className="spin" />
            <span>
              {rendererState === "error" ? "Replay unavailable" : "Loading"}
            </span>
          </div>
        )}
      </section>
    </main>
  );
}

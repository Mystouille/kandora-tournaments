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
  MessageSquareText,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Seat } from "~/game/protocol/messages";
import {
  base64ToBytes,
  decodeDrawing,
  reviewerColor,
  smoothDrawingForDisplay,
  type Stroke,
} from "~/game/replay/reviewDrawing";
import {
  replayBounds,
  replayReducer,
  replayViewToMatchView,
  rotateSeatValues,
  roundBoundaries,
} from "~/game/replay/player";
import type { ReplayLog } from "~/game/replay/types";
import { waitsForReplayView } from "~/game/replay/waits";
import type { TableRenderer } from "~/game/client/pixi/TableRenderer";
import { mobileTableLayout } from "~/game/client/pixi/layouts/mobileTableLayout";
import { ReplayDrawingOverlay } from "~/game/routes/ReplayDrawingOverlay";
import { MobileReviewContent } from "./MobileReviewContent";
import type { MyReplayLogDetails } from "./myReplaysApi";

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

export interface ReplayCommentNavigationState {
  previousComment: number | null;
  nextComment: number | null;
}

export function reviewCommentIndices(
  review: MyReplayLogDetails["review"]
): number[] {
  if (review === null) {
    return [];
  }
  return [
    ...new Set(
      review.edits
        .filter(
          (edit) => edit.text.trim().length > 0 || edit.drawingBase64 !== null
        )
        .map((edit) => edit.eventIndex)
    ),
  ].sort((left, right) => left - right);
}

export function replayCommentNavigationState(
  commentIndices: number[],
  index: number
): ReplayCommentNavigationState {
  let previousComment: number | null = null;
  let nextComment: number | null = null;
  for (const commentIndex of commentIndices) {
    if (commentIndex < index) {
      previousComment = commentIndex;
    } else if (commentIndex > index) {
      nextComment = commentIndex;
      break;
    }
  }
  return { previousComment, nextComment };
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

export function replaySeatEnrichmentForFocus(
  seatEnrichment: MyReplayLogDetails["seatEnrichment"],
  focusSeat: Seat
) {
  return rotateSeatValues(seatEnrichment, focusSeat);
}

interface MobileReplayNavigationMenuProps {
  expanded: boolean;
  handTop: number | null;
  log: ReplayLog;
  index: number;
  focusSeat: Seat;
  rounds: number[];
  bounds: { min: number; max: number };
  commentIndices?: number[];
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
  commentIndices,
  onExpandedChange,
  onFocusSeatChange,
  onGoTo,
  onStep,
}: MobileReplayNavigationMenuProps) {
  const navigation = replayNavigationState(rounds, index);
  const commentNavigation = replayCommentNavigationState(
    commentIndices ?? [],
    index
  );
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
              aria-label="Previous move"
              title="Previous move"
              disabled={index <= bounds.min}
              onClick={() => onStep(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next move"
              title="Next move"
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
          {commentIndices !== undefined && (
            <div className="mobile-replay-comment-buttons">
              <button
                type="button"
                aria-label="Previous comment"
                title="Previous comment"
                disabled={commentNavigation.previousComment === null}
                onClick={() => {
                  if (commentNavigation.previousComment !== null) {
                    onGoTo(commentNavigation.previousComment);
                  }
                }}
              >
                <ChevronLeft aria-hidden="true" />
                <MessageSquareText aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next comment"
                title="Next comment"
                disabled={commentNavigation.nextComment === null}
                onClick={() => {
                  if (commentNavigation.nextComment !== null) {
                    onGoTo(commentNavigation.nextComment);
                  }
                }}
              >
                <MessageSquareText aria-hidden="true" />
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          )}
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
  reviewAvailable?: boolean;
  commentsVisible?: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onToggle: (key: keyof MobileReplayDisplayOptions) => void;
  onCommentsVisibleChange?: (visible: boolean) => void;
}

export function MobileReplayDisplayMenu({
  expanded,
  handTop,
  options,
  reviewAvailable = false,
  commentsVisible = false,
  onExpandedChange,
  onToggle,
  onCommentsVisibleChange,
}: MobileReplayDisplayMenuProps) {
  return (
    <aside
      className="mobile-replay-display-menu"
      aria-label="Replay display options"
      style={
        handTop === null ? undefined : { bottom: `calc(100% - ${handTop}px)` }
      }
    >
      <div className="mobile-replay-left-controls">
        <button
          type="button"
          className="mobile-replay-menu-toggle"
          aria-label={
            expanded ? "Hide display options" : "Show display options"
          }
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? (
            <EyeOff aria-hidden="true" />
          ) : (
            <Eye aria-hidden="true" />
          )}
        </button>
        {reviewAvailable && (
          <button
            type="button"
            className="mobile-replay-menu-toggle mobile-replay-comment-toggle"
            aria-label={
              commentsVisible ? "Hide review comments" : "Show review comments"
            }
            aria-controls="mobile-replay-comments"
            aria-pressed={commentsVisible}
            onClick={() => onCommentsVisibleChange?.(!commentsVisible)}
          >
            <MessageSquareText aria-hidden="true" />
          </button>
        )}
      </div>
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

type MobileReplayReviewEdit = NonNullable<
  MyReplayLogDetails["review"]
>["edits"][number];

const REVIEW_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function reviewTimestamp(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : REVIEW_TIMESTAMP_FORMATTER.format(date);
}

export function MobileReplayCommentsOverlay({
  edits,
  targetName,
}: {
  edits: MobileReplayReviewEdit[];
  targetName: string | null;
}) {
  return (
    <section
      id="mobile-replay-comments"
      className="mobile-replay-comments-overlay"
      aria-label="Review comments"
    >
      <div className="mobile-replay-comments-content">
        <header className="mobile-replay-comments-heading">
          <MessageSquareText aria-hidden="true" />
          <strong>
            {targetName ? `Review of ${targetName}` : "Review comments"}
          </strong>
        </header>
        {edits.length === 0 ? (
          <p className="mobile-replay-comments-empty">
            No text comments at this move.
          </p>
        ) : (
          edits.map((edit) => {
            const color = reviewerColor(edit.colorIndex);
            const timestamp = reviewTimestamp(edit.updatedAt);
            return (
              <article
                key={`${edit.colorIndex}:${edit.authorName}:${edit.updatedAt}`}
                className="mobile-replay-comment"
                style={{ borderLeftColor: color }}
              >
                <header>
                  <strong style={{ color }}>
                    {edit.authorName || "Reviewer"}
                  </strong>
                  {timestamp !== null && (
                    <time dateTime={edit.updatedAt}>{timestamp}</time>
                  )}
                </header>
                <div className="mobile-replay-comment-body">
                  <MobileReviewContent html={edit.text} />
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

interface MobileReplayViewerProps {
  log: ReplayLog | null;
  seatEnrichment: MyReplayLogDetails["seatEnrichment"];
  review: MyReplayLogDetails["review"];
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
  seatEnrichment,
  review,
  onClose,
}: MobileReplayViewerProps & { log: ReplayLog }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<TableRenderer | null>(null);
  const latestViewRef = useRef<ReturnType<typeof replayViewToMatchView> | null>(
    null
  );
  const bounds = useMemo(() => replayBounds(log), [log]);
  const rounds = useMemo(() => roundBoundaries(log), [log]);
  const commentIndices = useMemo(
    () =>
      reviewCommentIndices(review).filter(
        (eventIndex) => eventIndex >= bounds.min && eventIndex <= bounds.max
      ),
    [bounds.max, bounds.min, review]
  );
  const [index, setIndex] = useState(
    commentIndices[0] ?? rounds[0] ?? bounds.min
  );
  const [focusSeat, setFocusSeat] = useState<Seat>(
    review?.seat === 0 ||
      review?.seat === 1 ||
      review?.seat === 2 ||
      review?.seat === 3
      ? review.seat
      : 0
  );
  const [displayOptions, setDisplayOptions] =
    useState<MobileReplayDisplayOptions>(DEFAULT_MOBILE_REPLAY_DISPLAY_OPTIONS);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(review !== null);
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

  const textEditsAtIndex = useMemo(
    () =>
      review?.edits
        .filter(
          (edit) => edit.eventIndex === index && edit.text.trim().length > 0
        )
        .sort((left, right) => left.colorIndex - right.colorIndex) ?? [],
    [index, review]
  );
  const drawingLayers = useMemo(() => {
    if (
      review === null ||
      (review.seat !== null && review.seat !== focusSeat)
    ) {
      return [];
    }
    const layers: Array<{ key: string; color: string; strokes: Stroke[] }> = [];
    for (const edit of review.edits) {
      if (edit.eventIndex !== index || edit.drawingBase64 === null) {
        continue;
      }
      try {
        const drawing = smoothDrawingForDisplay(
          decodeDrawing(base64ToBytes(edit.drawingBase64))
        );
        if (drawing.strokes.length > 0) {
          layers.push({
            key: `${edit.colorIndex}:${edit.updatedAt}`,
            color: reviewerColor(edit.colorIndex),
            strokes: drawing.strokes,
          });
        }
      } catch {}
    }
    return layers;
  }, [focusSeat, index, review]);

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
        renderer.setSeatEnrichment(
          replaySeatEnrichmentForFocus(seatEnrichment, focusSeat)
        );
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
    renderer.setSeatEnrichment(
      replaySeatEnrichmentForFocus(seatEnrichment, focusSeat)
    );
    renderer.render(matchView);
  }, [displayOptions, focusSeat, matchView, rendererState, seatEnrichment]);

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
        <div className="mobile-replay-drawing-layers" aria-hidden="true">
          {drawingLayers.map((layer) => (
            <ReplayDrawingOverlay
              key={layer.key}
              strokes={layer.strokes}
              drawing={false}
              color={layer.color}
              aspectRatio={
                mobileTableLayout.viewport.w / mobileTableLayout.viewport.h
              }
              onStrokesChange={() => undefined}
            />
          ))}
        </div>
        {commentsVisible && review !== null && (
          <MobileReplayCommentsOverlay
            edits={textEditsAtIndex}
            targetName={review.targetName}
          />
        )}
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
          reviewAvailable={review !== null}
          commentsVisible={commentsVisible}
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
          onCommentsVisibleChange={setCommentsVisible}
        />
        <MobileReplayNavigationMenu
          expanded={navigationOpen}
          handTop={handTop}
          log={log}
          index={index}
          focusSeat={focusSeat}
          rounds={rounds}
          bounds={bounds}
          commentIndices={review === null ? undefined : commentIndices}
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

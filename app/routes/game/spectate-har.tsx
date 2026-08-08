import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CaretRightOutlined,
  EyeOutlined,
  PauseOutlined,
  ReloadOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { parseTenhouSpectateHar } from "~/api/tenhou/spectateHarAdapter";
import type { TableRenderer } from "~/game/client/pixi/TableRenderer";
import type { MatchView } from "~/game/client/store";
import type { Seat } from "~/game/protocol/messages";
import {
  replayReducer,
  replayViewToMatchView,
} from "~/game/replay/player";
import { annotateWaits } from "~/services/annotateWaits";
import type { Route } from "./+types/spectate-har";

const SPEEDS = [1, 4, 16] as const;

export function meta(): Route.MetaDescriptors {
  return [{ title: "Tenhou HAR Spectator | Kandora" }];
}

export async function loader() {
  if (process.env.NODE_ENV === "production") {
    throw new Response("Not found", { status: 404 });
  }
  const harPath = resolve(process.cwd(), "extract.har");
  if (!existsSync(harPath)) {
    throw new Response("extract.har was not found at the project root.", {
      status: 404,
    });
  }
  const sessions = parseTenhouSpectateHar(readFileSync(harPath, "utf8"));
  if (sessions.length === 0) {
    throw new Response("No Tenhou spectator sessions were found in extract.har.", {
      status: 422,
    });
  }
  return {
    sessions: sessions.map((session) => ({
      watchId: session.watchId,
      startedAtMs: session.startedAtMs,
      complete: session.complete,
      replay: session.replay,
      eventDelaysMs: session.eventDelaysMs,
      waitsByIndex: annotateWaits(session.events),
    })),
  };
}

function seatNames(
  seats: Array<{ displayName: string }>
): [string, string, string, string] {
  return [
    seats[0]?.displayName ?? "East",
    seats[1]?.displayName ?? "South",
    seats[2]?.displayName ?? "West",
    seats[3]?.displayName ?? "North",
  ];
}

export default function TenhouHarSpectator({
  loaderData,
}: Route.ComponentProps) {
  const [sessionIndex, setSessionIndex] = useState(0);
  const [headIndex, setHeadIndex] = useState(-1);
  const [playheadIndex, setPlayheadIndex] = useState(-1);
  const [followLive, setFollowLive] = useState(true);
  const [feedPaused, setFeedPaused] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(16);
  const [focusSeat, setFocusSeat] = useState<Seat>(0);
  const [showHands, setShowHands] = useState(true);
  const [showWaits, setShowWaits] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<TableRenderer | null>(null);
  const latestRenderRef = useRef<MatchView | null>(null);
  // Dev-only: `?logos=1` overlays a dummy team logo/name on every seat to
  // eyeball the nameplate enrichment without a live relay.
  const [searchParams] = useSearchParams();
  const showLogos = searchParams.has("logos");
  // Dev-only: `?live=1` simulates the live-spectate wall (dead wall
  // only, fixed at the left of the bottom wall).
  const showLive = searchParams.has("live");

  const session = loaderData.sessions[sessionIndex];
  const { replay } = session;
  const maxIndex = replay.events.length - 1;

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, []);

  useEffect(() => {
    setHeadIndex(-1);
    setPlayheadIndex(-1);
    setFollowLive(true);
    setFeedPaused(false);
  }, [sessionIndex]);

  useEffect(() => {
    if (feedPaused || headIndex >= maxIndex) {
      return;
    }
    const nextIndex = headIndex + 1;
    const capturedDelay = session.eventDelaysMs[nextIndex] ?? 0;
    const playbackDelay = Math.max(16, Math.round(capturedDelay / speed));
    const timer = window.setTimeout(() => {
      setHeadIndex(nextIndex);
    }, playbackDelay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [feedPaused, headIndex, maxIndex, session.eventDelaysMs, speed]);

  useEffect(() => {
    if (followLive) {
      setPlayheadIndex(headIndex);
    }
  }, [followLive, headIndex]);

  const currentView = useMemo(
    () => replayReducer(replay, playheadIndex),
    [playheadIndex, replay]
  );

  const renderArgs = useMemo(
    () =>
      replayViewToMatchView(currentView, {
        index: playheadIndex,
        mySeat: focusSeat,
        matchId: replay.sourceGameId,
        seatNames: seatNames(replay.seats),
        currentWaits: session.waitsByIndex[playheadIndex] ?? null,
      }),
    [currentView, focusSeat, playheadIndex, replay, session.waitsByIndex]
  );
  latestRenderRef.current = renderArgs;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let cancelled = false;
    void import("~/game/client/pixi/TableRenderer").then(
      ({ TableRenderer }) => {
        if (cancelled) {
          return;
        }
        const renderer = new TableRenderer();
        renderer.setStagedRevealEnabled(false);
        renderer.setOnRenderRequest(() => {
          const latest = latestRenderRef.current;
          if (latest) {
            renderer.render(latest);
          }
        });
        void renderer.mount(container).then(() => {
          if (cancelled) {
            renderer.destroy();
            return;
          }
          rendererRef.current = renderer;
          const latest = latestRenderRef.current;
          if (latest) {
            renderer.render(latest);
          }
          requestAnimationFrame(() => {
            const next = latestRenderRef.current;
            if (!cancelled && next) {
              renderer.render(next);
            }
          });
        });
      }
    );
    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    renderer.setShowHands(showHands);
    renderer.setShowWaits(showWaits);
    renderer.setShowNames(true);
    renderer.setLiveSpectate(showLive);
    if (showLogos) {
      renderer.setSeatEnrichment([
        { teamName: "Red Hags", teamLogoUrl: "/hag.png" },
        { teamName: "Blue Hags", teamLogoUrl: "/hag.png" },
        { teamName: "Green Hags", teamLogoUrl: "/hag.png" },
        { teamName: "Gold Hags", teamLogoUrl: "/hag.png" },
      ]);
    }
    renderer.render(renderArgs);
  }, [renderArgs, showHands, showWaits, showLogos, showLive]);

  const pauseView = (): void => {
    setFollowLive(false);
  };
  const goLive = (): void => {
    setPlayheadIndex(headIndex);
    setFollowLive(true);
  };
  const seek = (index: number): void => {
    setFollowLive(false);
    setPlayheadIndex(Math.max(-1, Math.min(index, headIndex)));
  };
  const restart = (): void => {
    setHeadIndex(-1);
    setPlayheadIndex(-1);
    setFollowLive(true);
    setFeedPaused(false);
  };

  const event = replay.events[playheadIndex];
  const feedFinished = headIndex >= maxIndex;
  const buffered = Math.max(0, headIndex - playheadIndex);

  return (
    <main className="fixed inset-0 z-[9999] flex min-h-0 flex-col overflow-hidden bg-[#101412] text-[#edf1e9]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#39423b] bg-[#171c19] px-3 py-2 shadow-lg">
        <div className="mr-2 min-w-40">
          <div className="text-sm font-semibold">Tenhou capture</div>
          <div className="text-xs text-[#9eaaa1]">
            {session.watchId ?? "Unknown watch"} · {replay.events.length} events
          </div>
        </div>

        <select
          aria-label="Capture session"
          value={sessionIndex}
          onChange={(event) => {
            setSessionIndex(Number(event.target.value));
          }}
          className="h-9 rounded border border-[#4c5850] bg-[#222923] px-2 text-sm text-white"
        >
          {loaderData.sessions.map((candidate, index) => (
            <option key={`${candidate.startedAtMs}-${index}`} value={index}>
              Capture {index + 1}{candidate.complete ? " · complete" : ""}
            </option>
          ))}
        </select>

        <div className="flex h-9 overflow-hidden rounded border border-[#4c5850]">
          {SPEEDS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => {
                setSpeed(candidate);
              }}
              className={`min-w-11 px-2 text-xs font-semibold ${
                speed === candidate
                  ? "bg-[#d9a441] text-[#17130a]"
                  : "bg-[#222923] text-[#cbd3cc] hover:bg-[#303a32]"
              }`}
            >
              {candidate}×
            </button>
          ))}
        </div>

        <button
          type="button"
          title={feedPaused ? "Resume incoming feed" : "Pause incoming feed"}
          aria-label={feedPaused ? "Resume incoming feed" : "Pause incoming feed"}
          onClick={() => {
            setFeedPaused((paused) => !paused);
          }}
          className="flex size-9 items-center justify-center rounded border border-[#4c5850] bg-[#222923] text-base hover:bg-[#303a32]"
        >
          {feedPaused ? <CaretRightOutlined /> : <PauseOutlined />}
        </button>
        <button
          type="button"
          title="Restart capture"
          aria-label="Restart capture"
          onClick={restart}
          className="flex size-9 items-center justify-center rounded border border-[#4c5850] bg-[#222923] text-base hover:bg-[#303a32]"
        >
          <ReloadOutlined />
        </button>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <span
            className={`size-2 rounded-full ${
              feedPaused
                ? "bg-[#d9a441]"
                : feedFinished
                  ? "bg-[#7f8b82]"
                  : "animate-pulse bg-[#47c67a]"
            }`}
          />
          <span className="font-semibold uppercase text-[#b9c4bb]">
            {feedPaused ? "Feed paused" : feedFinished ? "Capture ended" : "Feeding"}
          </span>
        </div>
      </header>

      <section className="relative min-h-0 flex-1 bg-[#0b0e0c]">
        <div ref={containerRef} className="absolute inset-0" />
        {!followLive && buffered > 0 && (
          <button
            type="button"
            onClick={goLive}
            className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded border border-[#65cf8e] bg-[#13251a]/95 px-3 py-2 text-xs font-semibold text-[#8ee6ad] shadow-lg"
          >
            <EyeOutlined /> Go live · {buffered} buffered
          </button>
        )}
      </section>

      <footer className="shrink-0 border-t border-[#39423b] bg-[#171c19] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            title="Previous event"
            aria-label="Previous event"
            disabled={playheadIndex <= -1}
            onClick={() => {
              seek(playheadIndex - 1);
            }}
            className="flex size-9 shrink-0 items-center justify-center rounded border border-[#4c5850] bg-[#222923] disabled:opacity-35"
          >
            <StepBackwardOutlined />
          </button>
          <button
            type="button"
            title={followLive ? "Pause view" : "Follow live"}
            aria-label={followLive ? "Pause view" : "Follow live"}
            onClick={followLive ? pauseView : goLive}
            className="flex size-9 shrink-0 items-center justify-center rounded bg-[#d9a441] text-[#17130a]"
          >
            {followLive ? <PauseOutlined /> : <CaretRightOutlined />}
          </button>
          <button
            type="button"
            title="Next buffered event"
            aria-label="Next buffered event"
            disabled={playheadIndex >= headIndex}
            onClick={() => {
              seek(playheadIndex + 1);
            }}
            className="flex size-9 shrink-0 items-center justify-center rounded border border-[#4c5850] bg-[#222923] disabled:opacity-35"
          >
            <StepForwardOutlined />
          </button>

          <input
            aria-label="Buffered event timeline"
            type="range"
            min={-1}
            max={Math.max(-1, headIndex)}
            value={Math.min(playheadIndex, headIndex)}
            onChange={(event) => {
              seek(Number(event.target.value));
            }}
            className="min-w-20 flex-1 accent-[#d9a441]"
          />

          <div className="hidden min-w-36 text-right text-xs text-[#aeb9b0] sm:block">
            <div>{event?.type.replaceAll("_", " ") ?? "Waiting"}</div>
            <div>
              {Math.max(0, playheadIndex + 1)} / {Math.max(0, headIndex + 1)} / {replay.events.length}
            </div>
          </div>

          <select
            aria-label="Focused seat"
            value={focusSeat}
            onChange={(event) => {
              setFocusSeat(Number(event.target.value) as Seat);
            }}
            className="h-9 w-full min-w-0 rounded border border-[#4c5850] bg-[#222923] px-2 text-sm text-white sm:w-auto"
          >
            {seatNames(replay.seats).map((name, index) => (
              <option key={`${index}-${name}`} value={index}>
                {name}
              </option>
            ))}
          </select>

          <label className="hidden items-center gap-1.5 text-xs text-[#cbd3cc] md:flex">
            <input
              type="checkbox"
              checked={showHands}
              onChange={(event) => {
                setShowHands(event.target.checked);
              }}
              className="accent-[#d9a441]"
            />
            Hands
          </label>
          <label className="hidden items-center gap-1.5 text-xs text-[#cbd3cc] md:flex">
            <input
              type="checkbox"
              checked={showWaits}
              onChange={(event) => {
                setShowWaits(event.target.checked);
              }}
              className="accent-[#47c67a]"
            />
            Waits
          </label>
        </div>
      </footer>
    </main>
  );
}
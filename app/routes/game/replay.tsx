import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  redirect,
  useBlocker,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { connectToDatabase } from "~/utils/dbConnection.server";
import type { TableRenderer } from "~/game/client/pixi/TableRenderer";
import {
  applyReplayEvent,
  initialView,
  replayBounds,
  replayViewToMatchView,
  rotateSeatValues,
  roundBoundaries,
} from "~/game/replay/player";
import type { ReplayView } from "~/game/replay/player";
import type { GameEvent, Seat } from "~/game/protocol/messages";
import { ReplayLogModel, type DbReplayLog } from "~/core/models/game/ReplayLog";
import { ReplayReviewModel } from "~/core/models/game/ReplayReview";
import { inferReplaySource } from "~/game/replay/inferSource";
import { fetchOrphanReplayLog } from "~/services/fetchOrphanReplayLog.server";
import { resolveSeatEnrichmentForReplay } from "~/services/replayEnrichment.server";
import {
  resolveReviewersForDoc,
  serializeReview,
} from "~/services/replayReview.server";
import { annotateWallSchedule } from "~/game/replay/annotateWallSchedule";
import { annotateWaits } from "~/services/annotateWaits";
import {
  bytesToBase64,
  base64ToBytes,
  decodeDrawing,
  encodeDrawing,
  reviewerColor,
  smoothDrawingForDisplay,
  type Drawing,
  type Stroke,
} from "~/game/replay/reviewDrawing";
import {
  hasReviewDraftWork,
  moveReviewDraft,
  readReviewDraft,
  reconcileReviewDraft,
  removeReviewDraft,
  writeReviewDraft,
  type ReviewDraftIdentity,
  type ReviewDraftReconciliation,
  type ReviewDraftSnapshot,
  type StoredActiveReviewDraft,
} from "./reviewDraftStorage";
import type { ReplayLog, ReplaySource } from "~/game/replay/types";
import type {
  SerializedReview,
  SerializedReviewEdit,
  SerializedReviewer,
} from "~/types/replayReview";
import { getAuthenticatedUser } from "~/utils/jwt.server";
import { basePath } from "~/utils/basePath";
import {
  readWebTableLayoutMode,
  writeWebTableLayoutMode,
} from "~/game/client/webTableLayoutPreference";
import {
  WebTableTopControls,
  WEB_TABLE_TOP_CONTROL_CLASS,
} from "~/game/client/WebTableTopControls";
import type { Route } from "./+types/replay";
import {
  ReplayOverlayPanel,
  defaultReplayOverlayState,
  type ReplayOverlayState,
} from "~/game/routes/ReplayOverlayPanel";
import { ReplayDrawingOverlay } from "~/game/routes/ReplayDrawingOverlay";
import {
  ReplayReviewCartridge,
  type ReviewDraft,
} from "./ReplayReviewCartridge";
import { formatReviewEditTimestamp } from "./reviewEditTimestamp";
import { buildReplayViewerShareUrl } from "./replayShareUrl";
import { useLocale } from "~/contexts/LocaleContext";
import { useTelemetry } from "~/contexts/TelemetryContext";
import { FixedTileSetProvider } from "~/contexts/TileSetContext";
import { TileSetName } from "~/components/mahjong/handLayout";
import { ArticleContent } from "~/components/ArticleContent";
import { REPLAY_REVIEW_RICH_TEXT_CONFIG } from "~/components/editor/richTextConfig";
import { Button, Modal, Tooltip, message } from "antd";
import {
  DeleteOutlined,
  QuestionOutlined,
  SoundOutlined,
  AudioMutedOutlined,
} from "@ant-design/icons";
import {
  isGameSoundEnabled,
  setGameSoundEnabled,
  playSoundForEvent,
} from "~/game/client/sound";
import {
  replaySoundTarget,
  type ReplayNavigationKind,
  type ReplaySoundTarget,
} from "~/game/client/replaySound";

function normalizeReviewDraftText(html: string): string {
  const stripped = html.replace(/<[^>]+>/g, "").trim();
  const hasEmbeds = /<(img|mahjong-tile|mahjong-hand|video|iframe)\b/i.test(
    html
  );
  return stripped.length === 0 && !hasEmbeds ? "" : html;
}

interface ReviewRecoveryPrompt {
  snapshot: ReviewDraftSnapshot;
  reconciliation: ReviewDraftReconciliation;
}

/**
 * `/watch/replay/:gameId` — archived replay viewer.
 *
 * The platform is inferred from the `:gameId` shape via
 * `inferReplaySource`; when inference returns `null` we fall back to
 * a source-agnostic lookup so debug / hand-crafted ids still resolve
 * when a unique row exists.
 *
 * Loader path:
 *   1. Look up the `ReplayLog` row by `(source, sourceGameId)` (or
 *      `sourceGameId` alone when inference returned null).
 *   2. On miss, dispatch to `fetchOrphanReplayLog(source, gameId)`
 *      which talks to the right `*LeagueConnector` to fetch + parse
 *      the platform log and upserts it as an orphan row (no
 *      `Game.replayLogRef` link). This makes replays viewable even
 *      when no `Game` doc exists yet — useful for ad-hoc URLs and
 *      for closing the gap between play-time and the next
 *      hydration cycle.
 *   3. On miss with no inferable source (e.g. hand-crafted id we
 *      don't know how to fetch), throw a 404.
 *
 * The component holds `index` in component state, derives a
 * `ReplayView` via the incremental reducer, and renders the Pixi
 * `TableRenderer` with prev / next / first / last / round picker
 * controls.
 *
 * Not gated by `requireGameEnabled()` — replays are a viewer over
 * already-recorded games (Majsoul / Tenhou / Riichi City logs) and
 * don't touch the live game-server. They remain reachable in
 * environments where the in-app game subsystem is disabled.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const gameId = params.gameId ?? "";
  if (!gameId) {
    throw new Response("Missing replay id.", { status: 404 });
  }

  // Normalize platform-native viewer-link suffixes so that pasting
  // a raw majsoul / Riichi City URL fragment "just works":
  //
  //   - Majsoul appends `_a<accountId>` to its share URLs to mark
  //     which player generated the link. We strip the suffix from
  //     the id and — if the cached replay knows that accountId —
  //     surface the matching seat through the `?seat=` deeplink
  //     param so the viewer opens with that player at the bottom.
  //     Majsoul stashes the per-seat `accountId` (as a string) on
  //     the `match_start` event's `seats[].userId`.
  //   - Riichi City appends `@<n>` (0–3) to a log id to mark which
  //     seat that share link is from. The index is NOT the absolute
  //     seat in the data — it's the round-1 dealer-relative wind
  //     position (0=E, 1=S, 2=W, 3=N). RC's `position` field is
  //     shaped by player-join order, so the same `@n` maps to a
  //     different absolute seat per replay; we translate using the
  //     loaded log's first `hand_start.dealer` and surface the
  //     resolved absolute seat through the `?seat=` deeplink param.
  //
  // Either fixup issues a 302 to the canonical URL so the cleaned
  // form lands in the address bar and downstream caching keys
  // collapse onto a single canonical id.
  // React Router's `redirect()` prepends the configured
  // `basename` (e.g. `/kandora/` in REMOTE dev) to whatever path
  // we hand it, so we must hand it a basename-RELATIVE path —
  // never the raw `url.pathname`, which already includes the
  // basename and would otherwise produce `/kandora/kandora/...`.
  const url = new URL(request.url);
  const majsoulSuffix = /_a\d+$/.exec(gameId);
  if (majsoulSuffix) {
    // Majsoul appends `_a<obfuscated-sharer-id>` to its share
    // URLs. The number is the URL-sharer's account id passed
    // through Majsoul's private web-client encoding (it's NOT the
    // raw `account_id`, NOT a friend-id `searchAccountByPattern`
    // can decode, and in general not one of the seats in the
    // replay anyway — the sharer can be a spectator). So we
    // just strip it for a clean canonical URL and leave the
    // viewer to default to seat 0; the user can pick a seat from
    // the dropdown or pass `?seat=N` explicitly.
    const cleanId = gameId.slice(0, majsoulSuffix.index);
    const qs = url.searchParams.toString();
    throw redirect(`/watch/replay/${cleanId}${qs ? `?${qs}` : ""}`);
  }
  const rcSuffix = /@([0-3])$/.exec(gameId);
  const rcWind = rcSuffix ? Number(rcSuffix[1]) : null;
  const cleanGameId = rcSuffix ? gameId.slice(0, rcSuffix.index) : gameId;

  // Helper: translate the RC `@<n>` round-1 wind index to an
  // absolute seat using the first `hand_start` event's dealer.
  // Wind rotation around the table follows the absolute seat order
  // (`(dealer + wind) % 4`) — verified empirically by tracing the
  // first four `Draw` events of round 1, which always go E→S→W→N
  // starting from `dealer_pos`.
  const redirectToCanonicalRcUrl = (events: GameEvent[]): never => {
    const search = new URLSearchParams(url.searchParams);
    if (rcWind !== null && !search.has("seat")) {
      let seat = rcWind;
      const handStart = events.find((e) => e.type === "hand_start");
      if (handStart && "dealer" in handStart) {
        seat = ((handStart as { dealer: number }).dealer + rcWind) % 4;
      }
      search.set("seat", String(seat));
    }
    const qs = search.toString();
    throw redirect(`/watch/replay/${cleanGameId}${qs ? `?${qs}` : ""}`);
  };

  const source = inferReplaySource(cleanGameId);
  await connectToDatabase();

  // Optional ?review=<shortId>: load the review document so the
  // viewer can overlay the reviewer's notes and drawings. We only
  // honor it when the review actually belongs to this replay; this
  // makes the deeplink robust to URL tampering and prevents a stale
  // share-link from polluting an unrelated game.
  const reviewShortId = url.searchParams.get("review");
  let loadedReview: SerializedReview | null = null;
  if (reviewShortId) {
    const reviewDoc = await ReplayReviewModel.findOne({
      shortId: reviewShortId,
    }).lean();
    if (reviewDoc && reviewDoc.sourceGameId === cleanGameId) {
      const reviewers = await resolveReviewersForDoc(reviewDoc);
      loadedReview = serializeReview(reviewDoc, reviewers);
    }
  }

  // Identify the current user (if any) so the component can
  // enable the editing cartridge for the review owner. The
  // replay route itself does not require auth.
  let currentUserId: string | null = null;
  let currentUserName: string | null = null;
  try {
    const payload = await getAuthenticatedUser(request);
    if (payload?.sub) {
      currentUserId = String(payload.sub);
      currentUserName =
        typeof payload.username === "string" ? payload.username : null;
    }
  } catch {
    /* anonymous viewer */
  }

  const query: Record<string, string> = { sourceGameId: cleanGameId };
  if (source) {
    query.source = source;
  }
  const doc = await ReplayLogModel.findOne(query)
    .lean<DbReplayLog & { _id: unknown }>()
    .exec();

  // Cache hit: hand the persisted row straight to the component.
  if (doc) {
    if (rcWind !== null) {
      redirectToCanonicalRcUrl(doc.events as GameEvent[]);
    }
    const log: ReplayLog = {
      source: doc.source as ReplaySource,
      sourceGameId: doc.sourceGameId,
      ruleSet: doc.ruleSet,
      ruleSetDetails: doc.ruleSetDetails as Record<string, unknown> | undefined,
      startedAt: doc.startedAt,
      endedAt: doc.endedAt,
      seats: doc.seats as ReplayLog["seats"],
      events: annotateWallSchedule(doc.events as GameEvent[]),
      schemaVersion: doc.schemaVersion,
    };
    // Pre-compute per-event wait snapshots server-side so the
    // renderer never runs shanten on the client.
    const waitsByIndex = annotateWaits(log.events);
    const seatEnrichment = await resolveSeatEnrichmentForReplay(
      cleanGameId,
      log.seats
    );
    return {
      log,
      waitsByIndex,
      review: loadedReview,
      currentUserId,
      currentUserName,
      seatEnrichment,
    };
  }

  // Cache miss: try to fetch + parse from the platform on-demand
  // (Phase 4.5 follow-up — orphan logs are fine for now, no
  // `Game.replayLogRef` link is created). We need a source to know
  // which connector to talk to; inference returning `null` means
  // we can only 404.
  if (!source) {
    throw new Response(
      "Replay not yet available; it will appear after the next hydration cycle.",
      { status: 404 }
    );
  }
  const fetched = await fetchOrphanReplayLog(source, cleanGameId).catch(
    (error) => {
      console.error(
        `[replay loader] connector fetch failed for ${source}/${cleanGameId}`,
        error
      );
      return null;
    }
  );
  if (!fetched) {
    throw new Response(
      "Replay not yet available; it will appear after the next hydration cycle.",
      { status: 404 }
    );
  }
  if (rcWind !== null) {
    redirectToCanonicalRcUrl(fetched.events);
  }
  const annotatedLog = {
    ...fetched,
    events: annotateWallSchedule(fetched.events),
  };
  return {
    log: annotatedLog,
    waitsByIndex: annotateWaits(annotatedLog.events),
    review: loadedReview,
    currentUserId,
    currentUserName,
    seatEnrichment: await resolveSeatEnrichmentForReplay(
      cleanGameId,
      annotatedLog.seats
    ),
  };
}

const SOURCE_LABEL: Record<ReplaySource, string> = {
  ingame: "Kandora",
  majsoul: "Mahjong Soul",
  tenhou: "Tenhou",
  riichicity: "Riichi City",
};

export function meta({ data }: Route.MetaArgs) {
  if (!data?.log) {
    return [{ title: "Replay — TNT Paris Mahjong" }];
  }
  const { log, review } = data;
  const sourceLabel = SOURCE_LABEL[log.source] ?? "Replay";
  const dateLabel = new Date(log.startedAt).toISOString().slice(0, 10);
  const standings = [...log.seats]
    .sort((a, b) => a.place - b.place)
    .map((s) => `${s.place}. ${s.displayName} (${s.finalScore})`)
    .join(" · ");
  // The reviewed player is the seat the review is locked to (the
  // player it focuses on, not the reviewer). `seat` stays null until
  // the first edit locks it.
  const reviewedName =
    review && typeof review.seat === "number"
      ? log.seats[review.seat]?.displayName
      : undefined;
  const commentCount = review
    ? review.edits.filter((e) => e.text.length > 0 || e.drawingBase64).length
    : 0;
  const titleBase =
    review && reviewedName
      ? `Game review of ${reviewedName} — ${dateLabel}`
      : review
        ? `${sourceLabel} replay review — ${dateLabel}`
        : `${sourceLabel} replay — ${dateLabel}`;
  const description = review
    ? `${sourceLabel}, ${commentCount} comment${commentCount === 1 ? "" : "s"}, ${standings}`
    : standings;
  return [
    { title: `${titleBase} — TNT Paris Mahjong` },
    { name: "description", content: description },
    { property: "og:title", content: titleBase },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "TNT Paris Mahjong" },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: titleBase },
    { name: "twitter:description", content: description },
  ];
}

export default function ReplayRoute({ loaderData }: Route.ComponentProps) {
  const {
    log,
    waitsByIndex,
    review: initialReview,
    currentUserId,
    currentUserName,
    seatEnrichment,
  } = loaderData;
  const { t, locale } = useLocale();
  const { track } = useTelemetry();
  // Spectating telemetry: replay open + leave (with dwell time).
  useEffect(() => {
    const openedAt = Date.now();
    track("replay_open", { gameId: log.sourceGameId, source: log.source });
    return () => {
      track("replay_leave", {
        gameId: log.sourceGameId,
        source: log.source,
        durationMs: Date.now() - openedAt,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.sourceGameId]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<TableRenderer | null>(null);
  // Mirrors the latest `MatchView` rendered so the renderer's
  // resize callback (mount-time-only closure) always has fresh
  // state to re-render with.
  const latestRenderRef = useRef<ReturnType<
    typeof replayViewToMatchView
  > | null>(null);

  const bounds = useMemo(() => replayBounds(log), [log]);
  const rounds = useMemo(() => roundBoundaries(log), [log]);

  // URL deeplink state. Three optional search params, all
  // independently set so a partial URL still makes sense:
  //   ?seat=N      focused player (0–3)
  //   ?round=N     1-based round ordinal (matches the round
  //                picker). When `event` is absent we jump to
  //                that round's `hand_start`.
  //   ?event=N     absolute event index. When present it is
  //                authoritative for the playhead and `round`
  //                is purely informational.
  // We read these once at mount to seed the initial playhead /
  // focus seat and then stop touching the URL. Syncing on every
  // step was creating a history entry per click which inflated
  // `history.length` and confused the browser back button. The
  // Share button below rebuilds a fresh deeplink on demand from
  // the current state, so users can still copy a precise URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const hasInAppHistory = location.key !== "default";
  // Opener-supplied close fallback (e.g. the statistics page's
  // watch-replay button via `?from=`). Only an app-relative path is
  // honoured so a crafted value can't drive an open redirect.
  const fromRaw = searchParams.get("from");
  const fromPath =
    fromRaw && fromRaw.startsWith("/") && !fromRaw.startsWith("//")
      ? fromRaw
      : null;
  const handleClose = () => {
    if (hasInAppHistory) {
      navigate(-1);
    } else if (fromPath) {
      navigate(fromPath);
    } else {
      navigate("/");
    }
  };

  const clampSeat = (n: number): Seat => {
    if (n === 1 || n === 2 || n === 3) {
      return n;
    }
    return 0;
  };
  const clampToBounds = (n: number): number => {
    return Math.max(bounds.min, Math.min(n, bounds.max));
  };

  // Resolve the initial playhead + seat from the URL exactly
  // once at mount; subsequent navigation flows through
  // component state.
  const initial = useMemo(() => {
    const seatRaw = Number(searchParams.get("seat"));
    let seat: Seat = Number.isFinite(seatRaw) ? clampSeat(seatRaw) : 0;
    // When the URL points at a published review that's already
    // bound to a seat, the seat URL param is ignored: a review is
    // a single-perspective document, so viewers always land on
    // the reviewed seat regardless of any `?seat=` they might
    // have inherited from a previous deeplink.
    if (initialReview && typeof initialReview.seat === "number") {
      seat = clampSeat(initialReview.seat);
    }

    const eventRaw = searchParams.get("event");
    if (eventRaw !== null && eventRaw !== "") {
      const n = Number(eventRaw);
      if (Number.isFinite(n)) {
        return { seat, index: clampToBounds(Math.trunc(n)) };
      }
    }
    const roundRaw = searchParams.get("round");
    if (roundRaw !== null && roundRaw !== "") {
      const n = Number(roundRaw);
      if (Number.isFinite(n)) {
        const ord = Math.trunc(n) - 1;
        const r = rounds[ord];
        if (r !== undefined) {
          return { seat, index: clampToBounds(r) };
        }
      }
    }
    // When the URL points at a published review but doesn't
    // pin a specific frame, jump to the first event that
    // actually carries an annotation. Without this the viewer
    // would land on event 0 (or the first hand_start) and see
    // a blank canvas, even though the review has a drawing on
    // some later event.
    if (initialReview && initialReview.edits.length > 0) {
      const firstEdit = initialReview.edits.reduce(
        (min, e) => (e.eventIndex < min ? e.eventIndex : min),
        initialReview.edits[0].eventIndex
      );
      return { seat, index: clampToBounds(firstEdit) };
    }
    // Open one event past the first hand_start when available
    // so the viewer doesn't greet the user with an empty table.
    return { seat, index: rounds[0] ?? bounds.min };
    // Snapshot-only: deliberately ignore later searchParams /
    // bounds / rounds changes here — the playhead is driven by
    // component state from this point on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [index, setIndex] = useState<number>(initial.index);
  const indexRef = useRef(initial.index);
  const [overlays, setOverlays] = useState<ReplayOverlayState>(() => ({
    ...defaultReplayOverlayState,
    compactLayout: readWebTableLayoutMode() === "compact",
  }));
  const handleOverlayChange = (next: ReplayOverlayState): void => {
    if (next.compactLayout !== overlays.compactLayout) {
      const mode = next.compactLayout ? "compact" : "standard";
      writeWebTableLayoutMode(mode);
      rendererRef.current?.setWebTableLayoutMode(mode);
    }
    setOverlays(next);
  };
  const [focusSeat, setFocusSeat] = useState<Seat>(initial.seat);
  const [copied, setCopied] = useState<boolean>(false);
  // Audio toggle: persisted via the same `kandora.game.sound.enabled`
  // localStorage key that the live-game UI uses, so the user's mute
  // preference carries across both surfaces.
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() =>
    isGameSoundEnabled()
  );
  // Navigation explicitly arms one event target for sound. Numerical
  // adjacency is not sufficient: a round/slider/comment jump may land
  // one index ahead but must remain silent.
  const pendingSoundTargetRef = useRef<ReplaySoundTarget | null>(null);
  useEffect(() => {
    indexRef.current = index;
    const target = pendingSoundTargetRef.current;
    pendingSoundTargetRef.current = null;
    if (!soundEnabled) {
      return;
    }
    if (!target || target.playIndex !== index) {
      return;
    }
    const ev = log.events[target.eventIndex];
    if (!ev) {
      return;
    }
    playSoundForEvent(ev, focusSeat);
  }, [index, soundEnabled, log.events, focusSeat]);

  // ── Review state ────────────────────────────────────────────────
  // `review` mirrors what the server returned at load time and is
  // updated when we successfully publish edits. `localEdits` holds
  // *unpublished* per-event changes:
  //   * `{ text, drawingBase64 }` — replaces the server edit at
  //     this index when published.
  //   * `null`                    — pending delete of an existing
  //                                 server-side edit at this index.
  // Per-event Save buttons only mutate `localEdits`; nothing hits
  // the network until the user clicks "Publish" in the cartridge.
  // `draft` is the currently-being-composed text/drawing for the
  // playhead; it is discarded whenever the playhead moves.
  const [review, setReview] = useState<SerializedReview | null>(
    initialReview ?? null
  );
  type LocalEditPatch = {
    text: string;
    drawingBase64: string | null;
  } | null;
  interface LocalReviewState {
    edits: Record<number, LocalEditPatch>;
    baselines: Record<number, string | null>;
  }
  const [localReviewState, setLocalReviewState] = useState<LocalReviewState>({
    edits: {},
    baselines: {},
  });
  const localEdits = localReviewState.edits;
  const localEditBaselines = localReviewState.baselines;
  const [publishing, setPublishing] = useState<boolean>(false);
  const publishConflictRef = useRef(false);
  const reviewDraftIdentity = useMemo<ReviewDraftIdentity | null>(() => {
    if (currentUserId === null) {
      return null;
    }
    return {
      userId: currentUserId,
      source: log.source,
      sourceGameId: log.sourceGameId,
      reviewShortId: review?.shortId ?? null,
    };
  }, [currentUserId, log.source, log.sourceGameId, review?.shortId]);
  const [recoveryPrompt, setRecoveryPrompt] =
    useState<ReviewRecoveryPrompt | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(
    currentUserId === null
  );
  const recoveryStartedRef = useRef(false);
  const latestReviewDraftSnapshotRef = useRef<ReviewDraftSnapshot | null>(null);
  const storageWarningShownRef = useRef(false);
  const [draft, setDraft] = useState<ReviewDraft>({
    mode: null,
    text: "",
    strokes: [],
  });
  const [draftDrawingTouched, setDraftDrawingTouched] =
    useState<boolean>(false);
  const [draftBaseUpdatedAt, setDraftBaseUpdatedAt] = useState<string | null>(
    null
  );
  const preserveDraftForIndexRef = useRef<number | null>(null);
  // Discard in-progress edits whenever the playhead moves.
  useEffect(() => {
    if (preserveDraftForIndexRef.current === index) {
      preserveDraftForIndexRef.current = null;
      return;
    }
    setDraft({ mode: null, text: "", strokes: [] });
    setDraftDrawingTouched(false);
    setDraftBaseUpdatedAt(null);
  }, [index]);
  const canContributeToReview = currentUserId !== null;
  const pendingCount = useMemo(
    () => Object.keys(localEdits).length,
    [localEdits]
  );
  // The current user's stable color slot in this review. Reviewers are
  // colored by first-contribution order; someone who hasn't
  // contributed yet takes the next free slot so their live draft
  // already renders in the color they'll eventually own.
  const myColorIndex = useMemo<number>(() => {
    if (currentUserId === null) {
      return 0;
    }
    const existing = review
      ? review.reviewers.findIndex((r) => r.user === currentUserId)
      : -1;
    return existing >= 0 ? existing : (review?.reviewers.length ?? 0);
  }, [review, currentUserId]);
  const myColor = reviewerColor(myColorIndex);
  const myName = currentUserName ?? "";

  // ── Seat lock ──────────────────────────────────────────────
  // A review is bound to a single seat: every annotation in it
  // is "about" the same player. We derive the effective lock
  // from two sources:
  //   1. `review.seat` once any edit has been persisted (server
  //      authoritative).
  //   2. `localFirstEditSeat` while the author has unpublished
  //      local edits but no published edits yet \u2014 captured at
  //      the moment of the first local edit so the seat selector
  //      can't drift before publish.
  const [localFirstEditSeat, setLocalFirstEditSeat] = useState<Seat | null>(
    null
  );
  // Viewer-side toggle for the saved annotation frame. Pressing the
  // comment stack flips this on mouse-down so readers can peek at the
  // board behind a long note without losing it permanently; it
  // restores on mouse-up (see the global listener below).
  const [savedTextVisible, setSavedTextVisible] = useState<boolean>(true);
  const [textEditorHeight, setTextEditorHeight] = useState(0);
  // Canvas-pixel bounds of the focused seat's (bottom) hand strip,
  // reported by `TableRenderer.setBottomHandBoundsListener`. Used to
  // lift the saved-text annotation bubble so its bottom edge sits
  // just above the player's tiles instead of overlapping them.
  const [bottomHandBounds, setBottomHandBounds] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  // Global mouseup/touchend listener: while the user presses the
  // comment stack the annotation is hidden, but the moment they
  // release the mouse *anywhere* on the page we show it again.
  // Attaching the listener unconditionally is cheap (it does a
  // single `setState` only when the visible flag is already
  // false) and avoids the bookkeeping of add/remove on press.
  useEffect(() => {
    if (savedTextVisible) {
      return;
    }
    const restore = () => setSavedTextVisible(true);
    window.addEventListener("mouseup", restore);
    window.addEventListener("touchend", restore);
    window.addEventListener("touchcancel", restore);
    return () => {
      window.removeEventListener("mouseup", restore);
      window.removeEventListener("touchend", restore);
      window.removeEventListener("touchcancel", restore);
    };
  }, [savedTextVisible]);
  // Clear the local-first-seat marker the moment all local edits
  // are gone *and* the server has no edits either \u2014 the author
  // is free to re-target the review at a different seat.
  useEffect(() => {
    const serverHasEdits = review !== null && review.edits.length > 0;
    const hasLocal = Object.keys(localEdits).length > 0;
    if (!serverHasEdits && !hasLocal && localFirstEditSeat !== null) {
      setLocalFirstEditSeat(null);
    }
  }, [review, localEdits, localFirstEditSeat]);
  const effectiveReviewSeat: Seat | null = (() => {
    if (review && typeof review.seat === "number") {
      return clampSeat(review.seat);
    }
    return localFirstEditSeat;
  })();
  // Anonymous viewers are locked to the review's seat. Signed-in
  // contributors may inspect another perspective, but edit controls go
  // disabled whenever `focusSeat !== effectiveReviewSeat`.
  const seatLockedForViewer =
    review !== null && !canContributeToReview && effectiveReviewSeat !== null;
  const seatMismatch =
    effectiveReviewSeat !== null && focusSeat !== effectiveReviewSeat;
  // The current user's OWN effective edit at this event (their local
  // unpublished override wins over their server-side edit). Drives the
  // cartridge's saved text/drawing and the user's editable overlay.
  const currentUserEdit = useMemo<SerializedReviewEdit | null>(() => {
    const own =
      review && currentUserId !== null
        ? (review.edits.find(
            (e) => e.eventIndex === index && e.author === currentUserId
          ) ?? null)
        : null;
    if (Object.prototype.hasOwnProperty.call(localEdits, index)) {
      const local = localEdits[index];
      if (local === null) {
        return null;
      }
      return {
        eventIndex: index,
        author: currentUserId ?? "",
        authorName: myName,
        colorIndex: myColorIndex,
        text: local.text,
        drawingBase64: local.drawingBase64,
        updatedAt: new Date().toISOString(),
      };
    }
    return own;
  }, [review, index, localEdits, currentUserId, myName, myColorIndex]);
  const currentServerEdit = useMemo<SerializedReviewEdit | null>(() => {
    if (!review || currentUserId === null) {
      return null;
    }
    return (
      review.edits.find(
        (edit) =>
          edit.eventIndex === index && edit.author === currentUserId
      ) ?? null
    );
  }, [review, currentUserId, index]);
  const currentDraftBaseline = Object.prototype.hasOwnProperty.call(
    localEdits,
    index
  )
    ? (localEditBaselines[index] ?? null)
    : (currentServerEdit?.updatedAt ?? null);
  const handleDraftChange = (next: ReviewDraft): void => {
    if (next.mode === null) {
      setDraftDrawingTouched(false);
      setDraftBaseUpdatedAt(null);
    } else {
      if (draft.mode === null) {
        setDraftBaseUpdatedAt(currentDraftBaseline);
      }
      if (
        draft.mode === "pen" &&
        next.mode === "pen" &&
        next.strokes !== draft.strokes
      ) {
        setDraftDrawingTouched(true);
      }
    }
    setDraft(next);
  };
  const activeReviewDraft = useMemo<StoredActiveReviewDraft | null>(() => {
    if (draft.mode === null) {
      return null;
    }
    const active: StoredActiveReviewDraft = {
      eventIndex: index,
      mode: draft.mode,
      baseUpdatedAt: draftBaseUpdatedAt,
    };
    const normalizedText = normalizeReviewDraftText(draft.text);
    if (normalizedText !== (currentUserEdit?.text ?? "")) {
      active.text = normalizedText;
    }
    if (draftDrawingTouched) {
      const drawingBase64 =
        draft.strokes.length > 0
          ? bytesToBase64(encodeDrawing({ strokes: draft.strokes }))
          : null;
      if (drawingBase64 !== (currentUserEdit?.drawingBase64 ?? null)) {
        active.drawingBase64 = drawingBase64;
      }
    }
    const hasText = Object.prototype.hasOwnProperty.call(active, "text");
    const hasDrawing = Object.prototype.hasOwnProperty.call(
      active,
      "drawingBase64"
    );
    return hasText || hasDrawing ? active : null;
  }, [
    currentUserEdit,
    draft.mode,
    draft.strokes,
    draft.text,
    draftBaseUpdatedAt,
    draftDrawingTouched,
    index,
  ]);
  const unpublishedItemCount = useMemo(() => {
    const eventIndices = new Set(Object.keys(localEdits).map(Number));
    if (activeReviewDraft) {
      eventIndices.add(activeReviewDraft.eventIndex);
    }
    return eventIndices.size;
  }, [activeReviewDraft, localEdits]);
  const hasUnpublishedWork = unpublishedItemCount > 0;
  // Keep navigation protection even though a local recovery copy is
  // available: leaving still abandons the current editing context and
  // the work remains unpublished.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnpublishedWork &&
      currentLocation.pathname !== nextLocation.pathname
  );
  useEffect(() => {
    if (!hasUnpublishedWork) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hasUnpublishedWork]);
  const reviewDraftSnapshot = useMemo<ReviewDraftSnapshot | null>(() => {
    if (!reviewDraftIdentity) {
      return null;
    }
    const pending = Object.keys(localEdits)
      .map(Number)
      .sort((left, right) => left - right)
      .map((eventIndex) => ({
        eventIndex,
        patch: localEdits[eventIndex],
        baseUpdatedAt: localEditBaselines[eventIndex] ?? null,
      }));
    return {
      version: 1,
      identity: reviewDraftIdentity,
      seat: effectiveReviewSeat ?? focusSeat,
      updatedAt: 0,
      pending,
      active: activeReviewDraft,
    };
  }, [
    activeReviewDraft,
    effectiveReviewSeat,
    focusSeat,
    localEditBaselines,
    localEdits,
    reviewDraftIdentity,
  ]);
  const persistReviewDraftSnapshot = useCallback(
    (snapshot: ReviewDraftSnapshot): void => {
      const result = writeReviewDraft(snapshot);
      if (
        result === "unavailable" &&
        hasReviewDraftWork(snapshot) &&
        !storageWarningShownRef.current
      ) {
        storageWarningShownRef.current = true;
        message.warning(t.review.recovery.storageUnavailable);
      }
    },
    [t.review.recovery.storageUnavailable]
  );

  // Check storage before enabling autosave. Otherwise the initial empty
  // React state would remove a recoverable snapshot during hydration.
  useEffect(() => {
    if (recoveryStartedRef.current) {
      return;
    }
    recoveryStartedRef.current = true;
    if (!reviewDraftIdentity || currentUserId === null) {
      setRecoveryReady(true);
      return;
    }
    const stored = readReviewDraft(reviewDraftIdentity);
    if (!stored) {
      setRecoveryReady(true);
      return;
    }
    const reconciliation = reconcileReviewDraft(
      stored,
      review,
      currentUserId,
      log.events.length
    );
    const needsDecision =
      reconciliation.pending.length > 0 ||
      reconciliation.active !== null ||
      reconciliation.conflictEventIndices.length > 0 ||
      reconciliation.invalidEventIndices.length > 0 ||
      reconciliation.seatConflict;
    if (!needsDecision) {
      removeReviewDraft(reviewDraftIdentity);
      setRecoveryReady(true);
      return;
    }
    setRecoveryPrompt({ snapshot: stored, reconciliation });
  }, [currentUserId, log.events.length, review, reviewDraftIdentity]);

  useEffect(() => {
    if (!recoveryReady || !reviewDraftSnapshot) {
      return;
    }
    const snapshot = {
      ...reviewDraftSnapshot,
      updatedAt: Date.now(),
    };
    latestReviewDraftSnapshotRef.current = snapshot;
    const delay =
      snapshot.active &&
      Object.prototype.hasOwnProperty.call(snapshot.active, "text")
        ? 300
        : 0;
    const timeout = window.setTimeout(() => {
      if (latestReviewDraftSnapshotRef.current === snapshot) {
        persistReviewDraftSnapshot(snapshot);
      }
    }, delay);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [persistReviewDraftSnapshot, recoveryReady, reviewDraftSnapshot]);

  useEffect(() => {
    const flush = (): void => {
      const snapshot = latestReviewDraftSnapshotRef.current;
      if (snapshot) {
        persistReviewDraftSnapshot(snapshot);
      }
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [persistReviewDraftSnapshot]);

  const restoreLocalReviewDraft = (): void => {
    if (!recoveryPrompt || !reviewDraftIdentity) {
      return;
    }
    const { snapshot, reconciliation } = recoveryPrompt;
    const edits: Record<number, LocalEditPatch> = {};
    const baselines: Record<number, string | null> = {};
    for (const stored of reconciliation.pending) {
      edits[stored.eventIndex] = stored.patch;
      baselines[stored.eventIndex] = stored.baseUpdatedAt;
    }
    setLocalReviewState({ edits, baselines });
    if (
      reconciliation.pending.length > 0 &&
      typeof review?.seat !== "number" &&
      snapshot.seat !== null
    ) {
      setLocalFirstEditSeat(clampSeat(snapshot.seat));
    }
    if (snapshot.seat !== null) {
      setFocusSeat(clampSeat(snapshot.seat));
    }

    const active = reconciliation.active;
    if (active) {
      const restoredPending = reconciliation.pending.find(
        (stored) => stored.eventIndex === active.eventIndex
      );
      const serverEdit =
        review && currentUserId !== null
          ? (review.edits.find(
              (edit) =>
                edit.eventIndex === active.eventIndex &&
                edit.author === currentUserId
            ) ?? null)
          : null;
      const effectivePatch = restoredPending
        ? restoredPending.patch
        : serverEdit
          ? {
              text: serverEdit.text,
              drawingBase64: serverEdit.drawingBase64,
            }
          : null;
      const hasActiveText = Object.prototype.hasOwnProperty.call(
        active,
        "text"
      );
      const hasActiveDrawing = Object.prototype.hasOwnProperty.call(
        active,
        "drawingBase64"
      );
      const text = hasActiveText
        ? (active.text ?? "")
        : (effectivePatch?.text ?? "");
      const drawingBase64 = hasActiveDrawing
        ? (active.drawingBase64 ?? null)
        : (effectivePatch?.drawingBase64 ?? null);
      let strokes: Stroke[] = [];
      if (drawingBase64) {
        try {
          strokes = decodeDrawing(base64ToBytes(drawingBase64)).strokes;
        } catch {
          strokes = [];
        }
      }
      if (active.eventIndex !== index) {
        preserveDraftForIndexRef.current = active.eventIndex;
        indexRef.current = active.eventIndex;
        pendingSoundTargetRef.current = null;
        setIndex(active.eventIndex);
      }
      setDraft({ mode: active.mode, text, strokes });
      setDraftDrawingTouched(hasActiveDrawing);
      setDraftBaseUpdatedAt(active.baseUpdatedAt);
    }

    removeReviewDraft(reviewDraftIdentity);
    latestReviewDraftSnapshotRef.current = null;
    setRecoveryPrompt(null);
    setRecoveryReady(true);
    message.success(t.review.recovery.restored);
  };

  const discardLocalReviewDraft = (): void => {
    if (reviewDraftIdentity) {
      removeReviewDraft(reviewDraftIdentity);
    }
    latestReviewDraftSnapshotRef.current = null;
    setRecoveryPrompt(null);
    setRecoveryReady(true);
    message.info(t.review.recovery.discarded);
  };
  const recoverableItemCount = (() => {
    if (!recoveryPrompt) {
      return 0;
    }
    const eventIndices = new Set(
      recoveryPrompt.reconciliation.pending.map((item) => item.eventIndex)
    );
    if (recoveryPrompt.reconciliation.active) {
      eventIndices.add(recoveryPrompt.reconciliation.active.eventIndex);
    }
    return eventIndices.size;
  })();
  // Every reviewer's edit at this event (the current user's own
  // reflects their local override), ordered by color slot. Drives the
  // read-only drawings of other reviewers and the stacked bubbles.
  const editsAtIndex = useMemo<SerializedReviewEdit[]>(() => {
    const list: SerializedReviewEdit[] = [];
    if (review) {
      for (const e of review.edits) {
        if (e.eventIndex !== index) {
          continue;
        }
        // The current user's own edit is represented by
        // `currentUserEdit` (which folds in unpublished changes).
        if (currentUserId !== null && e.author === currentUserId) {
          continue;
        }
        list.push(e);
      }
    }
    if (currentUserEdit) {
      list.push(currentUserEdit);
    }
    list.sort((a, b) => a.colorIndex - b.colorIndex);
    return list;
  }, [review, index, currentUserId, currentUserEdit]);
  // Sorted list of event indices that carry an effective comment
  // (text or drawing) after applying local overrides over the
  // server-side review. Drives the "previous/next comment"
  // navigation buttons; empty when no comment exists yet, in which
  // case the buttons hide entirely.
  const commentIndices = useMemo<number[]>(() => {
    // Track which authors have content at each index so a local
    // delete of the current user's own edit doesn't hide an index
    // another reviewer still annotates.
    const authorsByIdx = new Map<number, Set<string>>();
    const add = (idx: number, author: string) => {
      let set = authorsByIdx.get(idx);
      if (!set) {
        set = new Set<string>();
        authorsByIdx.set(idx, set);
      }
      set.add(author);
    };
    const remove = (idx: number, author: string) => {
      const set = authorsByIdx.get(idx);
      if (set) {
        set.delete(author);
        if (set.size === 0) {
          authorsByIdx.delete(idx);
        }
      }
    };
    if (review) {
      for (const e of review.edits) {
        if (e.text.length > 0 || e.drawingBase64) {
          add(e.eventIndex, e.author);
        }
      }
    }
    if (currentUserId !== null) {
      for (const key of Object.keys(localEdits)) {
        const idx = Number(key);
        const patch = localEdits[idx];
        if (
          patch === null ||
          (patch.text.length === 0 && !patch.drawingBase64)
        ) {
          remove(idx, currentUserId);
        } else {
          add(idx, currentUserId);
        }
      }
    }
    return [...authorsByIdx.keys()].sort((a, b) => a - b);
  }, [review, localEdits, currentUserId]);
  // Decode the saved drawing once per (review,index) pair. Legacy v1
  // drawings are smoothed on the way out to round off their coarse
  // quantization grid; dense high-precision drawings pass through
  // `smoothDrawingForDisplay` untouched.
  const savedDrawing = useMemo<Drawing | null>(() => {
    if (!currentUserEdit?.drawingBase64) {
      return null;
    }
    try {
      const decoded = decodeDrawing(
        base64ToBytes(currentUserEdit.drawingBase64)
      );
      return smoothDrawingForDisplay(decoded);
    } catch {
      return null;
    }
  }, [currentUserEdit]);
  // Strokes to render in the overlay: while drawing, show the
  // user's in-progress strokes; otherwise show the saved drawing
  // \u2014 but only when the focused seat matches the seat the
  // review is bound to. When the owner browses a different seat
  // the drawing is hidden (and a "?" hint is shown next to the
  // text bubble) so the annotation isn't displayed out of
  // context.
  const myOverlayStrokes: Stroke[] = useMemo(() => {
    if (draft.mode === "pen") {
      return draft.strokes;
    }
    if (seatMismatch) {
      return [];
    }
    return savedDrawing?.strokes ?? [];
  }, [draft.mode, draft.strokes, savedDrawing, seatMismatch]);
  // Read-only drawings authored by *other* reviewers at this event,
  // each rendered in that reviewer's color. Hidden (like the user's
  // own) when the focused seat differs from the review's locked seat.
  const otherAuthorDrawings = useMemo<
    Array<{ author: string; color: string; strokes: Stroke[] }>
  >(() => {
    if (seatMismatch) {
      return [];
    }
    const out: Array<{ author: string; color: string; strokes: Stroke[] }> = [];
    for (const e of editsAtIndex) {
      if (e.author === currentUserId || !e.drawingBase64) {
        continue;
      }
      try {
        const strokes = smoothDrawingForDisplay(
          decodeDrawing(base64ToBytes(e.drawingBase64))
        ).strokes;
        if (strokes.length > 0) {
          out.push({
            author: e.author,
            color: reviewerColor(e.colorIndex),
            strokes,
          });
        }
      } catch {
        /* skip undecodable drawing */
      }
    }
    return out;
  }, [editsAtIndex, currentUserId, seatMismatch]);

  /**
   * Lazily create the review document on the first publish. We do
   * NOT call this until the user explicitly publishes, so an
   * accidental edit doesn't pollute the database with empty
   * reviews. Returns the resulting `shortId` and updates the URL
   * with `?review=...` via `replace` so the back button stays
   * clean.
   */
  const ensureReview = async (): Promise<string | null> => {
    if (review) {
      return review.shortId;
    }
    if (currentUserId === null) {
      return null;
    }
    const res = await fetch(`${basePath}/api/replay-reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: log.source,
        sourceGameId: log.sourceGameId,
      }),
    });
    if (!res.ok) {
      let errBody: unknown = null;
      try {
        errBody = await res.json();
      } catch {
        /* non-JSON */
      }
      console.error("[replay-review] ensureReview failed", res.status, errBody);
      return null;
    }
    const data = (await res.json()) as { ok: boolean; shortId?: string };
    if (!data.ok || !data.shortId) {
      return null;
    }
    const currentSnapshot = latestReviewDraftSnapshotRef.current;
    if (
      currentSnapshot &&
      currentUserId !== null &&
      currentSnapshot.identity.reviewShortId === null
    ) {
      const nextIdentity: ReviewDraftIdentity = {
        ...currentSnapshot.identity,
        reviewShortId: data.shortId,
      };
      const nextSnapshot: ReviewDraftSnapshot = {
        ...currentSnapshot,
        identity: nextIdentity,
      };
      const moveResult = moveReviewDraft(currentSnapshot, nextIdentity);
      latestReviewDraftSnapshotRef.current = nextSnapshot;
      if (
        moveResult === "unavailable" &&
        hasReviewDraftWork(currentSnapshot) &&
        !storageWarningShownRef.current
      ) {
        storageWarningShownRef.current = true;
        message.warning(t.review.recovery.storageUnavailable);
      }
    }
    const created: SerializedReview = {
      shortId: data.shortId,
      source: log.source,
      sourceGameId: log.sourceGameId,
      createdBy: currentUserId,
      seat: null,
      reviewers: [],
      edits: [],
    };
    setReview(created);
    const next = new URLSearchParams(searchParams);
    next.set("review", data.shortId);
    setSearchParams(next, { replace: true });
    return data.shortId;
  };

  /**
   * Stage an edit at the current event in local state. Nothing is
   * sent over the network — call `publish()` to push everything.
   */
  const commitEditLocally = (patch: {
    text?: string;
    drawingBase64?: string | null;
    delete?: boolean;
  }): void => {
    // Capture the first-edit seat client-side so the cartridge
    // can lock the seat selector before publish. Only meaningful
    // when there's no server-side lock yet.
    const serverLock =
      review && typeof review.seat === "number" ? review.seat : null;
    if (
      serverLock === null &&
      localFirstEditSeat === null &&
      patch.delete !== true &&
      ((typeof patch.text === "string" && patch.text.length > 0) ||
        (typeof patch.drawingBase64 === "string" &&
          patch.drawingBase64.length > 0))
    ) {
      setLocalFirstEditSeat(focusSeat);
    }
    setLocalReviewState((prev) => {
      const nextEdits: Record<number, LocalEditPatch> = { ...prev.edits };
      const nextBaselines = { ...prev.baselines };
      // Resolve the "current effective edit" so a partial patch
      // preserves the field we aren't touching.
      const hasExistingLocal = Object.prototype.hasOwnProperty.call(
        prev.edits,
        index
      );
      const existingLocal = hasExistingLocal
        ? prev.edits[index]
        : undefined;
      // Only the CURRENT user's own edit is a valid base — otherwise a
      // partial patch (e.g. adding text) would absorb another
      // reviewer's drawing/text at this event and re-attribute it to
      // us (rendered in our color, and saved under our author).
      const serverEdit =
        currentUserId !== null
          ? (review?.edits.find(
              (e) => e.eventIndex === index && e.author === currentUserId
            ) ?? null)
          : null;
      const baseText =
        existingLocal === null
          ? ""
          : (existingLocal?.text ?? serverEdit?.text ?? "");
      const baseDrawing =
        existingLocal === null
          ? null
          : (existingLocal?.drawingBase64 ?? serverEdit?.drawingBase64 ?? null);
      const baseUpdatedAt = hasExistingLocal
        ? (prev.baselines[index] ?? null)
        : (serverEdit?.updatedAt ?? null);

      const dropLocalEdit = (): LocalReviewState => {
        delete nextEdits[index];
        delete nextBaselines[index];
        return { edits: nextEdits, baselines: nextBaselines };
      };

      const keepLocalEdit = (nextPatch: LocalEditPatch): LocalReviewState => {
        nextEdits[index] = nextPatch;
        nextBaselines[index] = baseUpdatedAt;
        return { edits: nextEdits, baselines: nextBaselines };
      };

      if (patch.delete) {
        if (serverEdit) {
          // Server has something to remove → mark as pending delete.
          return keepLocalEdit(null);
        }
        // No server edit — just drop any local override.
        return dropLocalEdit();
      }

      const nextText = patch.text !== undefined ? patch.text : baseText;
      let nextDrawing: string | null;
      if (patch.drawingBase64 === undefined) {
        nextDrawing = baseDrawing;
      } else if (patch.drawingBase64 === null || patch.drawingBase64 === "") {
        nextDrawing = null;
      } else {
        nextDrawing = patch.drawingBase64;
      }

      // If the resulting edit matches the server-side edit exactly,
      // drop the local override (no need to publish a no-op).
      const matchesServer =
        (serverEdit?.text ?? "") === nextText &&
        (serverEdit?.drawingBase64 ?? null) === nextDrawing;
      if (matchesServer) {
        return dropLocalEdit();
      }

      // If the resulting edit is empty AND there is nothing on the
      // server, just drop the local entry.
      if ((!nextText || nextText.length === 0) && !nextDrawing) {
        if (serverEdit) {
          return keepLocalEdit(null);
        }
        return dropLocalEdit();
      }

      return keepLocalEdit({ text: nextText, drawingBase64: nextDrawing });
    });
  };

  /**
   * Build a share URL for a given `shortId`, pinned to the
   * current playhead. Returns `""` when the URL cannot be built
   * (SSR, or no `shortId` available). Used both by the post-
   * publish flow (where the caller already knows the fresh
   * `shortId`) and by the cartridge's pre-publish path.
   */
  const buildShareUrlFor = (shortId: string | null): string => {
    if (typeof window === "undefined" || !shortId) {
      return "";
    }
    // Pin the share link to the current playhead so the viewer
    // lands on the same frame the author was looking at when they
    // hit Publish. Drawings/text are attached to a specific event
    // index — without this the viewer would have to scrub to find
    // them.
    return buildReplayViewerShareUrl(window.location.href, {
      event: index,
      review: shortId,
    });
  };

  /**
   * Push every staged edit in `localEdits` to the server. On
   * success, returns the share URL for the published review. On
   * failure, returns `null`. The share URL is built from the
   * freshly-resolved `shortId` so callers don't need to wait for
   * the parent to re-render with the new `review` state — a wait
   * that previously caused the publish modal to require two
   * confirmations on first publish.
   */
  const publish = async (): Promise<string | null> => {
    publishConflictRef.current = false;
    const entries = Object.entries(localEdits);
    if (entries.length === 0) {
      // Nothing staged — either the review is already published
      // and up to date, or there is no review at all. Build a URL
      // from whatever the parent currently knows so the cartridge
      // can still surface a copyable link.
      return buildShareUrlFor(review?.shortId ?? null);
    }
    const hasPublishedAnnotation = entries.some(([, patch]) => patch !== null);
    setPublishing(true);
    try {
      const shortId = await ensureReview();
      if (!shortId) {
        return null;
      }
      // Track per-index server responses so we can merge them at
      // the end without partial UI flicker.
      const applied: Array<
        | { eventIndex: number; kind: "delete" }
        | { eventIndex: number; kind: "upsert"; edit: SerializedReviewEdit }
      > = [];
      // The server echoes back the locked seat on every response;
      // hold the latest so we can persist it into `review.seat`.
      let lockedSeat: number | null | undefined;
      // … and the reviewer roster (with color order), refreshed so a
      // brand-new contributor immediately shows in their color.
      let latestReviewers: SerializedReviewer[] | null = null;
      for (const [entryPosition, [idxStr, patch]] of entries.entries()) {
        const eventIndex = Number(idxStr);
        const completesPublish =
          hasPublishedAnnotation && entryPosition === entries.length - 1;
        const notificationFields = completesPublish
          ? { notifyReviewers: true, notificationEventIndex: index }
          : {};
        const body =
          patch === null
            ? { eventIndex, delete: true, ...notificationFields }
            : {
                eventIndex,
                text: patch.text,
                drawingBase64: patch.drawingBase64,
                // The server uses this only the *first* time an
                // edit lands on the document (to lock the review
                // to a single seat). Subsequent PUTs simply echo
                // it back; the locked seat wins.
                seat: effectiveReviewSeat ?? focusSeat,
                expectedUpdatedAt: localEditBaselines[eventIndex] ?? null,
                ...notificationFields,
              };
        if (patch === null) {
          Object.assign(body, {
            expectedUpdatedAt: localEditBaselines[eventIndex] ?? null,
          });
        }
        const res = await fetch(
          `${basePath}/api/replay-reviews/${encodeURIComponent(shortId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          let errBody: unknown = null;
          try {
            errBody = await res.json();
          } catch {
            /* non-JSON */
          }
          console.error(
            "[replay-review] publish failed for event",
            eventIndex,
            res.status,
            errBody
          );
          if (
            res.status === 409 &&
            errBody !== null &&
            typeof errBody === "object" &&
            "error" in errBody &&
            errBody.error === "edit-conflict"
          ) {
            publishConflictRef.current = true;
            message.error(t.review.recovery.publishConflict);
          }
          return null;
        }
        if (patch === null) {
          applied.push({ eventIndex, kind: "delete" });
          try {
            const data = (await res.json()) as {
              ok: boolean;
              seat?: number | null;
              reviewers?: SerializedReviewer[];
            };
            if (typeof data.seat === "number" || data.seat === null) {
              lockedSeat = data.seat;
            }
            if (Array.isArray(data.reviewers)) {
              latestReviewers = data.reviewers;
            }
          } catch {
            /* response had no body */
          }
        } else {
          let serverEdit: SerializedReviewEdit | null = null;
          try {
            const data = (await res.json()) as {
              ok: boolean;
              edit?: SerializedReviewEdit | null;
              seat?: number | null;
              reviewers?: SerializedReviewer[];
            };
            serverEdit = data.edit ?? null;
            if (typeof data.seat === "number" || data.seat === null) {
              lockedSeat = data.seat;
            }
            if (Array.isArray(data.reviewers)) {
              latestReviewers = data.reviewers;
            }
          } catch {
            /* response had no body */
          }
          if (serverEdit) {
            applied.push({ eventIndex, kind: "upsert", edit: serverEdit });
          }
        }
      }
      // Merge applied responses into review state.
      setReview((prev) => {
        if (!prev) {
          return prev;
        }
        // Edits are keyed by (eventIndex, author) so one reviewer's
        // publish never clobbers another's annotation on the same
        // event.
        const keyOf = (e: { eventIndex: number; author: string }) =>
          `${e.eventIndex}:${e.author}`;
        const byKey = new Map<string, SerializedReviewEdit>();
        for (const e of prev.edits) {
          byKey.set(keyOf(e), e);
        }
        for (const a of applied) {
          if (a.kind === "delete") {
            // Publishing only ever deletes the current user's own edit.
            if (currentUserId !== null) {
              byKey.delete(`${a.eventIndex}:${currentUserId}`);
            }
          } else {
            byKey.set(keyOf(a.edit), a.edit);
          }
        }
        return {
          ...prev,
          seat: lockedSeat !== undefined ? lockedSeat : prev.seat,
          reviewers: latestReviewers ?? prev.reviewers,
          edits: Array.from(byKey.values()),
        };
      });
      if (draft.mode !== null) {
        const activeApplied = applied.find(
          (entry) => entry.eventIndex === index
        );
        if (activeApplied) {
          setDraftBaseUpdatedAt(
            activeApplied.kind === "upsert"
              ? activeApplied.edit.updatedAt
              : null
          );
        }
      }
      setLocalReviewState({ edits: {}, baselines: {} });
      // Resolve the share URL synchronously from the freshly-known
      // shortId so the caller doesn't have to wait for the parent
      // to re-render with the updated `review` state.
      return buildShareUrlFor(shortId);
    } finally {
      setPublishing(false);
    }
  };

  // Incremental fold: we keep prefix views in a ref so a "next"
  // click is O(1) instead of O(index). Whole-fold path on seek.
  const viewCacheRef = useRef<{
    builtTo: number;
    view: ReplayView;
  } | null>(null);

  const currentView = useMemo<ReplayView>(() => {
    const cache = viewCacheRef.current;
    if (cache && cache.builtTo === index) {
      return cache.view;
    }
    if (cache && index === cache.builtTo + 1) {
      const next = applyReplayEvent(cache.view, log.events[index]);
      viewCacheRef.current = { builtTo: index, view: next };
      return next;
    }
    // Cache miss / backward jump / arbitrary seek — re-fold.
    let v = initialView();
    for (let i = 0; i <= index && i < log.events.length; i++) {
      v = applyReplayEvent(v, log.events[i]);
    }
    viewCacheRef.current = { builtTo: index, view: v };
    return v;
  }, [log, index]);

  // Mount Pixi once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let cancelled = false;
    // Pixi.js touches `navigator` at module-eval time, so it must
    // only load in the browser. Dynamic-import keeps it out of the
    // SSR bundle.
    void import("~/game/client/pixi/TableRenderer").then(
      ({ TableRenderer }) => {
        if (cancelled) {
          return;
        }
        const renderer = new TableRenderer({
          webTableLayoutMode: overlays.compactLayout ? "compact" : "standard",
        });
        // Wire the resize hook BEFORE mount so the
        // ResizeObserver / Pixi auto-resize installed inside
        // `mount()` can dispatch its first events into a live
        // callback. Previously this was set after `mount()`
        // resolved, which meant any layout shift happening while
        // tile textures were loading was dropped on the floor —
        // contributing to the first-paint dark-canvas race on
        // client-side navigation.
        renderer.setOnRenderRequest(() => {
          const r = rendererRef.current;
          const args = latestRenderRef.current;
          if (r && args) {
            r.render(args);
          }
        });
        renderer.setBottomHandBoundsListener((rect) => {
          setBottomHandBounds(rect);
        });
        // Replay playback should show the win-info panel fully
        // revealed on every seek — the staged per-yaku reveal is
        // only meaningful in live play, where the panel appears
        // exactly once per hand.
        renderer.setStagedRevealEnabled(false);
        void renderer.mount(container).then(() => {
          if (cancelled) {
            renderer.destroy();
            return;
          }
          rendererRef.current = renderer;
          renderer.setSeatEnrichment(
            rotateSeatValues(seatEnrichment, focusSeat)
          );
          const initialArgs = replayViewToMatchView(currentView, {
            index,
            mySeat: focusSeat,
            matchId: log.sourceGameId,
            seatNames: [
              log.seats[0]?.displayName ?? "",
              log.seats[1]?.displayName ?? "",
              log.seats[2]?.displayName ?? "",
              log.seats[3]?.displayName ?? "",
            ],
            currentWaits: waitsByIndex[index] ?? null,
          });
          latestRenderRef.current = initialArgs;
          renderer.render(initialArgs);
          // First-paint kicker: on client-side navigation the
          // canvas container can still have a zero-size box at
          // the moment Pixi's `Application` materializes (the
          // surrounding flex/grid hasn't fully laid out yet),
          // which leaves the first `render` drawing into an
          // empty viewport — the user sees a dark canvas until
          // they reload. Schedule one more render on the next
          // animation frame so we redraw against the post-layout
          // screen dims; cheap and idempotent.
          requestAnimationFrame(() => {
            if (cancelled) {
              return;
            }
            const r = rendererRef.current;
            const args = latestRenderRef.current;
            if (r && args) {
              r.render(args);
            }
          });
        });
      }
    );
    return () => {
      cancelled = true;
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
    // Mount-once: deliberately ignore `currentView`/`index` here;
    // the dedicated re-render effect below handles updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render on every step.
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setShowLayoutDebug(overlays.showLayoutDebug);
      rendererRef.current.setWebTableLayoutMode(
        overlays.compactLayout ? "compact" : "standard"
      );
      rendererRef.current.setShowWaits(overlays.showWaits);
      rendererRef.current.setShowHands(overlays.showHands);
      rendererRef.current.setShowTsumogiri(overlays.showTsumogiri);
      rendererRef.current.setShowWalls(overlays.showWalls);
      rendererRef.current.setShowNames(overlays.showNames);
      rendererRef.current.setSeatEnrichment(
        rotateSeatValues(seatEnrichment, focusSeat)
      );
      rendererRef.current.setCenterLabels({
        repeat: t.match.centerRepeat,
        riichi: t.match.centerRiichi,
        tiles: t.match.centerTiles,
      });
      rendererRef.current.setResultLabels({
        exhaustiveDraw: t.match.exhaustiveDraw,
        abortTitle: t.match.abortTitle,
        abortKinds: t.match.abortKinds,
        chomboTitle: t.match.chomboTitle,
        chomboReasons: t.match.chomboReasons,
      });
      const args = replayViewToMatchView(currentView, {
        index,
        mySeat: focusSeat,
        matchId: log.sourceGameId,
        seatNames: [
          log.seats[0]?.displayName ?? "",
          log.seats[1]?.displayName ?? "",
          log.seats[2]?.displayName ?? "",
          log.seats[3]?.displayName ?? "",
        ],
        currentWaits: waitsByIndex[index] ?? null,
      });
      latestRenderRef.current = args;
      rendererRef.current.render(args);
    }
  }, [
    currentView,
    index,
    log.sourceGameId,
    log.seats,
    waitsByIndex,
    focusSeat,
    seatEnrichment,
    overlays.showLayoutDebug,
    overlays.showWaits,
    overlays.showHands,
    overlays.showTsumogiri,
    overlays.showWalls,
    overlays.showNames,
    t,
  ]);

  const clamp = useCallback(
    (n: number): number => Math.max(bounds.min, Math.min(n, bounds.max)),
    [bounds.max, bounds.min]
  );
  const navigateReplay = useCallback(
    (n: number, kind: ReplayNavigationKind): void => {
      const next = clamp(n);
      pendingSoundTargetRef.current = replaySoundTarget(
        indexRef.current,
        next,
        kind
      );
      indexRef.current = next;
      setIndex(next);
    },
    [clamp]
  );
  const goto = useCallback(
    (n: number): void => {
      navigateReplay(n, "jump");
    },
    [navigateReplay]
  );
  const stepBy = useCallback(
    (delta: -1 | 1): void => {
      navigateReplay(indexRef.current + delta, "step");
    },
    [navigateReplay]
  );

  // Mouse-wheel scrubbing on the canvas container: scroll down →
  // advance one event, scroll up → rewind one event. Each wheel
  // tick is a single step; we throttle to avoid blasting through
  // a round on a high-resolution trackpad.
  const wheelAccumRef = useRef(0);
  const wheelLastRef = useRef(0);
  // Latest edit-mode flag, kept on a ref so the listener closures
  // below don't need to rebind every time `draft.mode` changes.
  // When the review cartridge is active (text input open or pen
  // mode on) we suppress the wheel / click scrub handlers so they
  // don't fight the user typing or drawing.
  const editingRef = useRef(false);
  editingRef.current = draft.mode !== null;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const onWheel = (e: WheelEvent): void => {
      if (editingRef.current) {
        return;
      }
      e.preventDefault();
      const now = Date.now();
      // Reset the accumulator when the gesture pauses, so an
      // intentional small flick doesn't get diluted by stale dy.
      if (now - wheelLastRef.current > 200) {
        wheelAccumRef.current = 0;
      }
      wheelLastRef.current = now;
      wheelAccumRef.current += e.deltaY;
      const threshold = 30;
      // Snap to the next/previous `discard` or `hand_end` event
      // per tick: draws, melds and dora reveals come in clusters
      // between two discards, so stepping one raw event at a
      // time made the wheel feel like it "skipped" 3+ events per
      // notch without actually moving the picture. Jumping
      // discard-to-discard gives one visible turn change per
      // tick, and stopping on `hand_end` makes the result panel
      // a natural rest point at the end of each round. We cap at
      // *one* step per wheel event regardless of the accumulated
      // delta so a fat trackpad notch doesn't blow past several
      // turns at once.
      const isStop = (i: number): boolean => {
        const t = log.events[i]?.type;
        return t === "discard" || t === "hand_end";
      };
      const findNextDiscard = (i: number): number => {
        for (let j = i + 1; j <= bounds.max; j++) {
          if (isStop(j)) {
            return j;
          }
        }
        return bounds.max;
      };
      const findPrevDiscard = (i: number): number => {
        for (let j = i - 1; j >= bounds.min; j--) {
          if (isStop(j)) {
            return j;
          }
        }
        return bounds.min;
      };
      if (wheelAccumRef.current >= threshold) {
        wheelAccumRef.current = 0;
        // Wheel scrubs are discrete jumps to the next stop — we
        // suppress the discard slide animation for that frame so
        // the pond reads as a static board state rather than a
        // tile sliding in from a hand that didn't visibly exist
        // yet.
        rendererRef.current?.snapNextAnimation();
        goto(findNextDiscard(indexRef.current));
      } else if (wheelAccumRef.current <= -threshold) {
        wheelAccumRef.current = 0;
        rendererRef.current?.snapNextAnimation();
        goto(findPrevDiscard(indexRef.current));
      }
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
    };
  }, [bounds.min, bounds.max, goto, log]);

  // Click scrubbing on the canvas container: left-click → advance
  // one event, right-click → rewind one event. `contextmenu` is
  // suppressed so the right-click step doesn't pop the browser
  // menu. Listeners filter out clicks on overlay panel controls
  // (`button`, `input`, `label`, `select`) so the overlay HUD
  // remains usable.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) {
        return false;
      }
      // `[data-review-comments]` = the saved-comment stack (click-to-
      // hide); a press there must not also step to the next event.
      return (
        target.closest(
          "button, input, label, select, a, [role=button], [data-review-comments]"
        ) !== null
      );
    };
    const onMouseDown = (e: MouseEvent): void => {
      if (editingRef.current) {
        return;
      }
      if (e.button !== 0 && e.button !== 2) {
        return;
      }
      if (isInteractiveTarget(e.target)) {
        return;
      }
      e.preventDefault();
      stepBy(e.button === 0 ? 1 : -1);
    };
    const onContextMenu = (e: MouseEvent): void => {
      if (editingRef.current) {
        return;
      }
      if (isInteractiveTarget(e.target)) {
        return;
      }
      e.preventDefault();
    };
    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("contextmenu", onContextMenu);
    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("contextmenu", onContextMenu);
    };
  }, [stepBy]);

  // For the round picker label.
  const currentRound = (() => {
    if (index < 0) {
      return "—";
    }
    return `${currentView.roundWind}${currentView.roundNumber}`;
  })();

  // Vertical anchor for the review annotation controls.
  // Once the renderer reports the focused hand-strip bounds we pin
  // the bubble's bottom edge ~8px above the player's tiles so it
  // never overlaps them (it grows upward from there); otherwise fall
  // back to a fixed inset matching the old `bottom-20`.
  const annotationBottomCss = bottomHandBounds
    ? `calc(100% - ${Math.round(bottomHandBounds.y) - 8}px)`
    : "5rem";
  const commentListBottomCss =
    textEditorHeight > 0
      ? `calc(${annotationBottomCss} + ${Math.ceil(textEditorHeight) + 8}px)`
      : annotationBottomCss;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div
        ref={containerRef}
        className="relative w-full h-full bg-black overflow-hidden"
        style={{ touchAction: "none" }}
      >
        {/* Top-left: replay metadata label. */}
        <div className="pointer-events-none absolute top-2 left-2 z-30 font-mono text-xs text-emerald-100/80 px-2 py-1 rounded bg-black/40">
          replay · {log.source} · {log.sourceGameId} · {currentRound}
        </div>
        {/* Bottom-right: tile-art attribution. */}
        <div className="absolute bottom-2 right-2 z-30 font-mono text-[10px] text-emerald-100/70 px-2 py-1 rounded bg-black/40">
          Tile design copyright of{" "}
          <a
            href="https://tenhou.net/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-emerald-200"
          >
            Tenhou.net
          </a>
          , C-Egg
        </div>
        {/* Top-right: sound, share / publish, parameters, and quit.
            When the editor has unpublished local edits the same
            slot turns into a "Publish" button that pushes them
            to the server before copying the share link. */}
        <WebTableTopControls
          compactLayout={overlays.compactLayout}
          onCompactLayoutChange={(compactLayout) => {
            handleOverlayChange({ ...overlays, compactLayout });
          }}
          onQuit={handleClose}
          quitLabel="Close replay"
        >
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              setGameSoundEnabled(next);
            }}
            aria-label={soundEnabled ? "Mute sound" : "Unmute sound"}
            title={soundEnabled ? "Mute sound" : "Unmute sound"}
            className={`${WEB_TABLE_TOP_CONTROL_CLASS} w-11 text-xl`}
          >
            {soundEnabled ? <SoundOutlined /> : <AudioMutedOutlined />}
          </button>
          <button
            type="button"
            onClick={() => {
            const copyToClipboard = (url: string, done: () => void): void => {
              if (navigator.clipboard?.writeText) {
                void navigator.clipboard.writeText(url).then(done, done);
              } else {
                const ta = document.createElement("textarea");
                ta.value = url;
                ta.setAttribute("readonly", "");
                ta.style.position = "absolute";
                ta.style.left = "-9999px";
                document.body.appendChild(ta);
                ta.select();
                try {
                  document.execCommand("copy");
                } catch {
                  /* best-effort */
                }
                document.body.removeChild(ta);
                done();
              }
            };
            const flashCopied = (): void => {
              setCopied(true);
              window.setTimeout(() => {
                setCopied(false);
              }, 1500);
            };
            // Publish path: stage exists. Push edits, then copy
            // the freshly-built share URL.
            if (canContributeToReview && pendingCount > 0) {
              void publish().then((url) => {
                if (!url) {
                  if (!publishConflictRef.current) {
                    message.error(t.review.cartridge.publishFailed);
                  }
                  return;
                }
                message.success(t.review.cartridge.publishedToast);
                copyToClipboard(url, flashCopied);
              });
              return;
            }
            // Share path: build a fresh deeplink from current state.
            let roundOrdinal = 0;
            for (let i = 0; i < rounds.length; i++) {
              if (rounds[i] <= index) {
                roundOrdinal = i + 1;
              }
            }
            // Preserve the active review so the deeplink keeps
            // surfacing the author's annotations. Without this
            // the share button strips them and the recipient
            // sees a clean replay even though the URL bar still
            // shows `?review=…`.
            const url =
              typeof window !== "undefined"
                ? buildReplayViewerShareUrl(window.location.href, {
                    seat: focusSeat,
                    round: roundOrdinal > 0 ? roundOrdinal : undefined,
                    event: index,
                    review: review?.shortId,
                  })
                : "";
            copyToClipboard(url, flashCopied);
            }}
            disabled={publishing}
            aria-label={
              canContributeToReview && pendingCount > 0
                ? t.review.cartridge.publishTooltip
                : t.review.cartridge.copyShareLink
            }
            title={
              canContributeToReview && pendingCount > 0
                ? t.review.cartridge.publishTooltip
                : copied
                  ? t.review.cartridge.shareCopied
                  : t.review.cartridge.copyShareLink
            }
            className={`${WEB_TABLE_TOP_CONTROL_CLASS} min-w-[5.5rem] gap-1 px-4 disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {canContributeToReview && pendingCount > 0
              ? `${t.review.cartridge.publish} (${pendingCount})`
              : copied
                ? t.review.cartridge.shareCopied
                : t.review.cartridge.share}
          </button>
        </WebTableTopControls>
        {/* Right-side: seat / round selectors + nav buttons. */}
        <div className="absolute top-1/2 right-2 -translate-y-1/2 z-30 flex flex-col items-stretch gap-3 text-emerald-100 text-base">
          {/* Row 1: seat selection, then round selection. */}
          <div className="flex items-center gap-2">
            <select
              aria-label="Focus seat"
              value={String(focusSeat)}
              onChange={(e) => {
                setFocusSeat(Number(e.target.value) as Seat);
              }}
              disabled={seatLockedForViewer}
              title={
                seatLockedForViewer
                  ? t.review.cartridge.seatLockedViewer
                  : undefined
              }
              className="bg-black/60 border border-emerald-700 rounded px-3 py-2 text-base text-emerald-100 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {([0, 1, 2, 3] as const).map((s) => {
                const name = log.seats[s]?.displayName ?? `Seat ${s}`;
                return (
                  <option key={s} value={String(s)}>
                    {name}
                  </option>
                );
              })}
            </select>
            {rounds.length > 0 && (
              <select
                aria-label="Round"
                value={(() => {
                  let pick = -1;
                  for (const r of rounds) {
                    if (r <= index) {
                      pick = r;
                    }
                  }
                  return pick === -1 ? "" : String(pick);
                })()}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    return;
                  }
                  goto(Number(v));
                }}
                className="bg-black/60 border border-emerald-700 rounded px-3 py-2 text-base text-emerald-100"
              >
                {rounds.map((r, i) => {
                  const ev = log.events[r];
                  if (ev.type !== "hand_start") {
                    return null;
                  }
                  const label = `${ev.roundWind ?? "?"}${ev.roundNumber ?? i + 1}`;
                  return (
                    <option key={r} value={String(r)}>
                      {label}
                    </option>
                  );
                })}
              </select>
            )}
          </div>
          {/* Row 2: prev round, prev event, next event, next round. */}
          {(() => {
            // Find the current round's index in `rounds` (largest
            // boundary <= index). Prev/next round step through that
            // list; first/last are reachable by the bookends.
            let currentRoundIdx = -1;
            for (let i = 0; i < rounds.length; i++) {
              if (rounds[i] <= index) {
                currentRoundIdx = i;
              }
            }
            const prevRound =
              currentRoundIdx > 0 ? rounds[currentRoundIdx - 1] : null;
            const nextRound =
              currentRoundIdx >= 0 && currentRoundIdx < rounds.length - 1
                ? rounds[currentRoundIdx + 1]
                : null;
            return (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (prevRound !== null) {
                      goto(prevRound);
                    }
                  }}
                  disabled={prevRound === null}
                  className="px-3 py-2 text-lg rounded bg-black/60 hover:bg-emerald-800 disabled:opacity-40 border border-emerald-700 text-emerald-100"
                  aria-label="Previous round"
                  title="Previous round"
                >
                  ⏮
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stepBy(-1);
                  }}
                  disabled={index <= bounds.min}
                  className="px-3 py-2 text-lg rounded bg-black/60 hover:bg-emerald-800 disabled:opacity-40 border border-emerald-700 text-emerald-100"
                  aria-label="Previous event"
                  title="Previous event"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stepBy(1);
                  }}
                  disabled={index >= bounds.max}
                  className="px-3 py-2 text-lg rounded bg-black/60 hover:bg-emerald-800 disabled:opacity-40 border border-emerald-700 text-emerald-100"
                  aria-label="Next event"
                  title="Next event"
                >
                  ▶
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (nextRound !== null) {
                      goto(nextRound);
                    }
                  }}
                  disabled={nextRound === null}
                  className="px-3 py-2 text-lg rounded bg-black/60 hover:bg-emerald-800 disabled:opacity-40 border border-emerald-700 text-emerald-100"
                  aria-label="Next round"
                  title="Next round"
                >
                  ⏭
                </button>
              </div>
            );
          })()}
          {/* Row 3 (review-only): jump to previous / next event
              that has an annotation. Hidden when no annotation
              exists yet so non-review viewers don't see dead
              buttons. The reviewer's first edit will surface them
              the moment it lands in `localEdits`. */}
          {commentIndices.length > 0 &&
            (() => {
              // Strictly-previous / strictly-next comment index
              // relative to the current playhead. `null` at the
              // ends so the buttons disable cleanly.
              let prevComment: number | null = null;
              let nextComment: number | null = null;
              for (const c of commentIndices) {
                if (c < index) {
                  prevComment = c;
                } else if (c > index && nextComment === null) {
                  nextComment = c;
                }
              }
              return (
                <div className="flex items-center gap-1 justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (prevComment !== null) {
                        goto(prevComment);
                      }
                    }}
                    disabled={prevComment === null}
                    className="px-3 py-2 text-lg rounded bg-black/60 hover:bg-emerald-800 disabled:opacity-40 border border-emerald-700 text-emerald-100"
                    aria-label="Previous comment"
                    title="Previous comment"
                  >
                    ◀💬
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (nextComment !== null) {
                        goto(nextComment);
                      }
                    }}
                    disabled={nextComment === null}
                    className="px-3 py-2 text-lg rounded bg-black/60 hover:bg-emerald-800 disabled:opacity-40 border border-emerald-700 text-emerald-100"
                    aria-label="Next comment"
                    title="Next comment"
                  >
                    💬▶
                  </button>
                </div>
              );
            })()}
          <span className="font-mono text-sm text-emerald-100/80 text-center">
            {index + 1} / {log.events.length}
          </span>
        </div>
        <ReplayOverlayPanel
          overlays={overlays}
          onChange={handleOverlayChange}
          includeWallToggle
        />
        {/* Review annotations: one passive drawing overlay per other
            reviewer (each in that reviewer's color), then the current
            user's own overlay \u2014 editable while in pen mode, otherwise
            a passive render of their saved strokes \u2014 plus the cartridge
            that lets them edit their own text/freehand for this event. */}
        {otherAuthorDrawings.map((d) => (
          <ReplayDrawingOverlay
            key={`draw-${d.author}`}
            strokes={d.strokes}
            drawing={false}
            color={d.color}
            onStrokesChange={() => {}}
          />
        ))}
        <ReplayDrawingOverlay
          strokes={myOverlayStrokes}
          drawing={draft.mode === "pen"}
          color={myColor}
          onStrokesChange={(next) => {
            handleDraftChange({ ...draft, strokes: next });
          }}
        />
        {/* Saved-text bubbles: one stacked bubble per reviewer who
            left a text note at this event, each headed by the
            reviewer's name in bold in their assigned color. New
            reviewers stack below existing ones; the whole stack
            scrolls when it grows too tall. Rendered through the same
            `ArticleContent` pipeline as news articles so inline tiles,
            hands and links work, forced into the tenhou tile style for
            visual consistency. Pressing the stack hides it (press-to-peek). */}
        {(() => {
          // Show every reviewer's text note, except the current user's
          // own while they're actively editing it (their draft shows
          // in the cartridge instead of a stale bubble).
          const textEdits = editsAtIndex.filter(
            (e) =>
              e.text.length > 0 &&
              !(e.author === currentUserId && draft.mode === "text")
          );
          if (textEdits.length === 0) {
            return null;
          }
          return (
            <>
              {savedTextVisible ? (
                <div
                  data-review-comments
                  // Press-to-peek: mousedown hides the stack so the
                  // reader can see the board behind it (the global
                  // mouseup listener restores it). Links/buttons inside
                  // still work; stopPropagation keeps the press from
                  // reaching the board's "next event" handler.
                  onMouseDown={(e) => {
                    if (
                      (e.target as Element).closest("a, button, [role=button]")
                    ) {
                      return;
                    }
                    e.stopPropagation();
                    setSavedTextVisible(false);
                  }}
                  onTouchStart={(e) => {
                    if (
                      (e.target as Element).closest("a, button, [role=button]")
                    ) {
                      return;
                    }
                    e.stopPropagation();
                    setSavedTextVisible(false);
                  }}
                  className="absolute left-2 z-[46] flex flex-col gap-2 max-w-[min(820px,calc(100vw-16px))] overflow-y-auto cursor-pointer select-none"
                  style={{ bottom: commentListBottomCss, maxHeight: "60vh" }}
                >
                  {textEdits.map((e) => {
                    const color = reviewerColor(e.colorIndex);
                    const updatedAt = formatReviewEditTimestamp(
                      e.updatedAt,
                      locale
                    );
                    return (
                      <div
                        key={`bubble-${e.author}`}
                        className="relative rounded-lg shadow-lg overflow-hidden bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700"
                        style={{ borderLeft: `4px solid ${color}` }}
                      >
                        {e.authorName ||
                        updatedAt ||
                        (e.author === currentUserId &&
                          canContributeToReview) ? (
                          <div className="flex items-center gap-3 px-5 pt-3 pb-1">
                            <div
                              className="min-w-0 flex-1 truncate font-bold text-sm"
                              style={{ color }}
                            >
                              {e.authorName}
                            </div>
                            {updatedAt ? (
                              <time
                                dateTime={e.updatedAt}
                                className="shrink-0 whitespace-nowrap text-xs font-normal text-neutral-500 dark:text-neutral-400"
                              >
                                {updatedAt}
                              </time>
                            ) : null}
                            {e.author === currentUserId &&
                            canContributeToReview ? (
                              <Tooltip
                                title={t.review.cartridge.deleteTextTooltip}
                                zIndex={10001}
                              >
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  className="shrink-0"
                                  disabled={publishing}
                                  aria-label={
                                    t.review.cartridge.deleteTextTooltip
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    commitEditLocally({ text: "" });
                                  }}
                                  onMouseDown={(event) => {
                                    event.stopPropagation();
                                  }}
                                  onTouchStart={(event) => {
                                    event.stopPropagation();
                                  }}
                                />
                              </Tooltip>
                            ) : null}
                          </div>
                        ) : null}
                        <div
                          className="px-5 pb-4 pt-1 text-base text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap rich-text-content"
                          style={{
                            lineHeight: 1.6,
                          }}
                        >
                          <FixedTileSetProvider tileSet={TileSetName.Tenhou}>
                            <ArticleContent
                              html={e.text}
                              config={REPLAY_REVIEW_RICH_TEXT_CONFIG}
                            />
                          </FixedTileSetProvider>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          );
        })()}
        {/* Seat-mismatch hint: when the current event has a saved
            drawing but the owner is looking at a different seat,
            the overlay is hidden so the annotation isn't shown
            out of context. A "?" sitting just to the left of the
            bottom hand tells them which seat to focus on to see
            it. Uses an antd Tooltip with `mouseEnterDelay=0` for
            an instant hint instead of the native browser
            tooltip's ~500ms delay. */}
        {seatMismatch &&
          editsAtIndex.some((e) => e.drawingBase64) &&
          effectiveReviewSeat !== null && (
            <Tooltip
              title={t.review.cartridge.drawingHiddenTooltip.replace(
                "{name}",
                log.seats[effectiveReviewSeat]?.displayName ??
                  `Seat ${effectiveReviewSeat}`
              )}
              mouseEnterDelay={0}
              mouseLeaveDelay={0.1}
              placement="top"
              // Anchor above the page wrapper's stacking context
              // (`z-[9999]`) so the tooltip body isn't hidden.
              zIndex={10001}
              color="#7f1d1d"
            >
              <div
                className="absolute bottom-24 left-8 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-black/80 border-2 border-emerald-600 text-emerald-100 text-3xl font-bold shadow-lg cursor-help select-none pointer-events-auto"
                role="img"
                aria-label={t.review.cartridge.drawingHiddenTooltip.replace(
                  "{name}",
                  log.seats[effectiveReviewSeat]?.displayName ??
                    `Seat ${effectiveReviewSeat}`
                )}
              >
                <QuestionOutlined />
              </div>
            </Tooltip>
          )}
        <ReplayReviewCartridge
          canEdit={canContributeToReview}
          savedText={currentUserEdit?.text ?? ""}
          savedHasDrawing={Boolean(currentUserEdit?.drawingBase64)}
          savedStrokes={savedDrawing?.strokes ?? []}
          draft={draft}
          onDraftChange={handleDraftChange}
          onSubmitText={(text) => {
            commitEditLocally({ text });
          }}
          onSubmitDrawing={(strokes) => {
            const drawing: Drawing = { strokes };
            const bytes = encodeDrawing(drawing);
            commitEditLocally({ drawingBase64: bytesToBase64(bytes) });
          }}
          onRemoveDrawing={() => {
            commitEditLocally({ drawingBase64: null });
          }}
          publishing={publishing}
          seatMismatch={seatMismatch}
          reviewSeatName={
            effectiveReviewSeat !== null
              ? (log.seats[effectiveReviewSeat]?.displayName ??
                `Seat ${effectiveReviewSeat}`)
              : ""
          }
          annotationBottom={annotationBottomCss}
          onTextEditorHeightChange={setTextEditorHeight}
        />
        <Modal
          open={recoveryPrompt !== null}
          title={t.review.recovery.title}
          onOk={restoreLocalReviewDraft}
          onCancel={discardLocalReviewDraft}
          okText={t.review.recovery.restore}
          cancelText={t.review.recovery.discard}
          closable={false}
          mask={{ closable: false }}
          keyboard={false}
          centered
          zIndex={10060}
        >
          {recoveryPrompt ? (
            <div className="flex flex-col gap-3">
              <p className="m-0">
                {t.review.recovery.found.replace(
                  "{time}",
                  new Date(recoveryPrompt.snapshot.updatedAt).toLocaleString(
                    locale
                  )
                )}
              </p>
              <p className="m-0 font-medium">
                {t.review.recovery.recoverable.replace(
                  "{n}",
                  String(recoverableItemCount)
                )}
              </p>
              {recoveryPrompt.reconciliation.active &&
              Object.prototype.hasOwnProperty.call(
                recoveryPrompt.reconciliation.active,
                "text"
              ) ? (
                <p className="m-0">{t.review.recovery.openText}</p>
              ) : null}
              {recoveryPrompt.reconciliation.active &&
              Object.prototype.hasOwnProperty.call(
                recoveryPrompt.reconciliation.active,
                "drawingBase64"
              ) ? (
                <p className="m-0">{t.review.recovery.openDrawing}</p>
              ) : null}
              {recoveryPrompt.reconciliation.conflictEventIndices.length >
              0 ? (
                <p className="m-0 text-amber-700 dark:text-amber-300">
                  {t.review.recovery.conflicts.replace(
                    "{events}",
                    recoveryPrompt.reconciliation.conflictEventIndices
                      .map((eventIndex) => eventIndex + 1)
                      .join(", ")
                  )}
                </p>
              ) : null}
              {recoveryPrompt.reconciliation.invalidEventIndices.length > 0 ? (
                <p className="m-0 text-amber-700 dark:text-amber-300">
                  {t.review.recovery.invalidEvents.replace(
                    "{events}",
                    recoveryPrompt.reconciliation.invalidEventIndices
                      .map((eventIndex) => eventIndex + 1)
                      .join(", ")
                  )}
                </p>
              ) : null}
              <p className="m-0 text-sm text-neutral-500 dark:text-neutral-400">
                {t.review.recovery.localOnly}
              </p>
            </div>
          ) : null}
        </Modal>
        <Modal
          open={blocker.state === "blocked"}
          title={t.review.leaveGuard.title}
          onOk={() => blocker.proceed?.()}
          onCancel={() => blocker.reset?.()}
          okText={t.review.leaveGuard.leave}
          cancelText={t.review.leaveGuard.stay}
          okButtonProps={{ danger: true }}
          centered
          zIndex={10050}
        >
          <p className="m-0">
            {t.review.leaveGuard.body.replace(
              "{n}",
              String(unpublishedItemCount)
            )}
          </p>
        </Modal>
      </div>
    </div>
  );
}

import {
  ArrowLeft,
  LoaderCircle,
  LogIn,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MyReplayContextKind, MyReplayReason } from "~/types/myReplays";
import type { ReplaySource } from "~/game/replay/types";
import type { MobileAuthSession } from "../auth/mobileAuth";
import type {
  MobileReplayStore,
  MobileStoredReplaySummary,
} from "../persistence/mobileMatchRepository";
import type { MobileStorageState } from "../shell";
import {
  fetchMyReplays,
  MyReplaysHttpError,
  type MyReplayApiGroup,
} from "./myReplaysApi";
import {
  activeReplayFilterCount,
  EMPTY_REPLAY_LIBRARY_FILTERS,
  filterReplayLibraryRows,
  offlineReplayRows,
  onlineReplayRows,
  replayLibraryFilterOptions,
  type ReplayLibraryFilters,
  type ReplayLibraryMode,
  type ReplayLibraryRow,
} from "./replayLibrary";

type ReplayLoadState = "idle" | "loading" | "ready" | "error";

const SOURCE_LABELS: Record<ReplaySource, string> = {
  ingame: "Kandora",
  majsoul: "Mahjong Soul",
  tenhou: "Tenhou",
  riichicity: "Riichi City",
};

const CONTEXT_LABELS: Record<MyReplayContextKind, string> = {
  friendly: "Friendly",
  tournament: "Tournament",
  external: "External",
};

const REASON_LABELS: Record<MyReplayReason, string> = {
  created: "Created",
  played: "Played",
  commented: "Commented",
  reviewed: "Reviewed",
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
});
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const SCORE_FORMATTER = new Intl.NumberFormat();

function toggleValue<Value>(values: Value[], value: Value): Value[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function startOfLocalDate(value: string): number | null {
  if (value === "") {
    return null;
  }
  const timestamp = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function endOfLocalDate(value: string): number | null {
  if (value === "") {
    return null;
  }
  const timestamp = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function contextLabel(row: ReplayLibraryRow): string {
  return row.context.kind === "tournament" && row.context.tournamentName
    ? row.context.tournamentName
    : CONTEXT_LABELS[row.context.kind];
}

function browserIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function ReplayLibraryRowView({
  row,
  onOpenReplay,
}: {
  row: ReplayLibraryRow;
  onOpenReplay?: (row: ReplayLibraryRow) => void;
}) {
  const interactive = onOpenReplay !== undefined;
  const reviewLabel = row.reviewedPlayerName
    ? `Review of ${row.reviewedPlayerName}`
    : "Replay review";
  const open = (): void => {
    onOpenReplay?.(row);
  };
  return (
    <li
      className={`replay-library-row ${row.kind === "review" ? "is-review" : ""} ${interactive ? "is-interactive" : ""}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={
        interactive
          ? row.kind === "review"
            ? `Open ${reviewLabel}`
            : "Open replay"
          : undefined
      }
      onClick={interactive ? open : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open();
              }
            }
          : undefined
      }
    >
      <div className="replay-date-cell">
        {row.gameDate === null ? (
          <span>Unknown</span>
        ) : (
          <>
            <strong>{DATE_FORMATTER.format(row.gameDate)}</strong>
            <span>{TIME_FORMATTER.format(row.gameDate)}</span>
          </>
        )}
      </div>
      <div
        className={`replay-players-cell ${row.kind === "review" ? "is-review" : ""}`}
      >
        {row.kind === "review" ? (
          <>
            <span
              className={`replay-review-branch is-${row.treeBranch ?? "last"}`}
              aria-hidden="true"
            >
              <MessageSquareText />
            </span>
            <span className="replay-review-summary">
              <strong title={reviewLabel}>{reviewLabel}</strong>
              <small>
                {row.commentCount}{" "}
                {row.commentCount === 1 ? "comment" : "comments"}
              </small>
            </span>
          </>
        ) : row.seats.length === 0 ? (
          <span className="replay-metadata-unknown">Results unavailable</span>
        ) : (
          row.seats.map((seat) => (
            <div key={seat.seat} className="replay-player-result">
              <b>{seat.place}</b>
              <span title={seat.displayName}>{seat.displayName}</span>
              <small>{SCORE_FORMATTER.format(seat.finalScore)}</small>
            </div>
          ))
        )}
      </div>
      <div className="replay-context-cell">
        <strong title={contextLabel(row)}>{contextLabel(row)}</strong>
        <span>{SOURCE_LABELS[row.source]}</span>
      </div>
      <div className="replay-rules-cell" title={row.ruleset.label}>
        {row.ruleset.label}
      </div>
    </li>
  );
}

export function ReplayLibraryList({
  rows,
  onOpenReplay,
}: {
  rows: ReplayLibraryRow[];
  onOpenReplay?: (row: ReplayLibraryRow) => void;
}) {
  return (
    <ul className="replay-library-list" aria-label="Replays">
      {rows.map((row) => (
        <ReplayLibraryRowView
          key={row.key}
          row={row}
          onOpenReplay={onOpenReplay}
        />
      ))}
    </ul>
  );
}

interface MobileReplaysProps {
  replayStore: MobileReplayStore | null;
  storageState: MobileStorageState;
  webAppBaseUrl: string | null;
  authSession: MobileAuthSession | null;
  authPending: boolean;
  onBack: () => void;
  onSignIn: () => void | Promise<void>;
  onUnauthorized: () => void;
  onOpenReplay?: (row: ReplayLibraryRow) => void;
}

export function MobileReplays({
  replayStore,
  storageState,
  webAppBaseUrl,
  authSession,
  authPending,
  onBack,
  onSignIn,
  onUnauthorized,
  onOpenReplay,
}: MobileReplaysProps) {
  const filterRootRef = useRef<HTMLDivElement>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const [mode, setMode] = useState<ReplayLibraryMode>("offline");
  const [deviceOnline, setDeviceOnline] = useState(browserIsOnline);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<ReplayLibraryFilters>(
    EMPTY_REPLAY_LIBRARY_FILTERS
  );
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [offlineReplays, setOfflineReplays] = useState<
    MobileStoredReplaySummary[]
  >([]);
  const [onlineReplays, setOnlineReplays] = useState<MyReplayApiGroup[]>([]);
  const [offlineState, setOfflineState] = useState<ReplayLoadState>("idle");
  const [onlineState, setOnlineState] = useState<ReplayLoadState>("idle");
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [offlineRefresh, setOfflineRefresh] = useState(0);
  const [onlineRefresh, setOnlineRefresh] = useState(0);

  useEffect(() => {
    const handleOnline = (): void => {
      setDeviceOnline(true);
    };
    const handleOffline = (): void => {
      setDeviceOnline(false);
      setMode("offline");
      setFilterOpen(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!filterOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !filterRootRef.current?.contains(event.target)
      ) {
        setFilterOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setFilterOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (mode !== "offline" || replayStore === null) {
      return;
    }
    let cancelled = false;
    setOfflineState("loading");
    setOfflineError(null);
    void replayStore
      .listReplaySummaries()
      .then((replays) => {
        if (!cancelled) {
          setOfflineReplays(replays);
          setOfflineState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOfflineError("Saved replays could not be loaded.");
          setOfflineState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, offlineRefresh, replayStore]);

  useEffect(() => {
    if (
      mode !== "online" ||
      !deviceOnline ||
      webAppBaseUrl === null ||
      authSession === null
    ) {
      return;
    }
    let cancelled = false;
    setOnlineState("loading");
    setOnlineError(null);
    void fetchMyReplays(webAppBaseUrl, authSession)
      .then((replays) => {
        if (!cancelled) {
          setOnlineReplays(replays);
          setOnlineState("ready");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof MyReplaysHttpError && error.status === 401) {
          unauthorizedRef.current();
          return;
        }
        setOnlineError(
          error instanceof MyReplaysHttpError &&
            error.status === 404 &&
            error.code === null
            ? "Online replays are not available on this server."
            : "Online replays could not be loaded."
        );
        setOnlineState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [authSession, deviceOnline, mode, onlineRefresh, webAppBaseUrl]);

  const sourceRows = useMemo(
    () =>
      mode === "offline"
        ? offlineReplayRows(offlineReplays)
        : onlineReplayRows(onlineReplays),
    [mode, offlineReplays, onlineReplays]
  );
  const visibleRows = useMemo(
    () => filterReplayLibraryRows(sourceRows, mode, filters),
    [filters, mode, sourceRows]
  );
  const options = useMemo(
    () => replayLibraryFilterOptions(sourceRows),
    [sourceRows]
  );
  const activeFilters = activeReplayFilterCount(mode, filters);

  const updateDateRange = (nextFrom: string, nextTo: string): void => {
    setFromDate(nextFrom);
    setToDate(nextTo);
    const start = startOfLocalDate(nextFrom);
    const end = endOfLocalDate(nextTo);
    setFilters((current) => ({
      ...current,
      gameDateRange:
        start === null && end === null
          ? null
          : [start ?? Number.MIN_SAFE_INTEGER, end ?? Number.MAX_SAFE_INTEGER],
    }));
  };

  const resetFilters = (): void => {
    setFilters(EMPTY_REPLAY_LIBRARY_FILTERS);
    setFromDate("");
    setToDate("");
  };

  const state = mode === "offline" ? offlineState : onlineState;
  const error = mode === "offline" ? offlineError : onlineError;
  const sourceUnavailable =
    mode === "offline"
      ? replayStore === null
      : webAppBaseUrl === null || authSession === null;

  let body: React.ReactNode;
  if (mode === "offline" && storageState === "error") {
    body = <ReplayState message="Device storage is unavailable." />;
  } else if (mode === "offline" && replayStore === null) {
    body = <ReplayState loading message="Opening device storage" />;
  } else if (mode === "online" && authSession === null) {
    body = authPending ? (
      <ReplayState loading message="Checking account" />
    ) : (
      <ReplayState
        message="Sign in to see your online replays."
        action={
          <button type="button" onClick={() => void onSignIn()}>
            <LogIn aria-hidden="true" />
            <span>Login with Discord</span>
          </button>
        }
      />
    );
  } else if (mode === "online" && webAppBaseUrl === null) {
    body = <ReplayState message="Online replays are unavailable." />;
  } else if (state === "loading" || (state === "idle" && !sourceUnavailable)) {
    body = <ReplayState loading message="Loading replays" />;
  } else if (state === "error") {
    body = (
      <ReplayState
        message={error ?? "Replays could not be loaded."}
        error
        action={
          <button
            type="button"
            onClick={() => {
              if (mode === "offline") {
                setOfflineRefresh((value) => value + 1);
              } else {
                setOnlineRefresh((value) => value + 1);
              }
            }}
          >
            <RefreshCw aria-hidden="true" />
            <span>Try again</span>
          </button>
        }
      />
    );
  } else if (visibleRows.length === 0) {
    body = (
      <ReplayState
        message={
          sourceRows.length > 0
            ? "No replays match these filters."
            : mode === "offline"
              ? "No replays saved on this device."
              : "No account replays found."
        }
      />
    );
  } else {
    body = <ReplayLibraryList rows={visibleRows} onOpenReplay={onOpenReplay} />;
  }

  return (
    <main className="mobile-shell mobile-replays">
      <header className="shell-topbar replay-topbar">
        <button
          type="button"
          className="shell-icon-button"
          aria-label="Back to home"
          title="Back to home"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className="replay-heading">
          <strong>Replays</strong>
          <span>{visibleRows.length} shown</span>
        </div>
        <div className="replay-mode-control" aria-label="Replay source">
          <button
            type="button"
            aria-pressed={mode === "offline"}
            onClick={() => setMode("offline")}
          >
            Offline
          </button>
          <button
            type="button"
            aria-pressed={mode === "online"}
            disabled={!deviceOnline}
            title={
              deviceOnline
                ? undefined
                : "Online replays require an internet connection"
            }
            onClick={() => setMode("online")}
          >
            Online
          </button>
        </div>
        <div ref={filterRootRef} className="replay-filter-root">
          <button
            type="button"
            className="shell-icon-button replay-filter-button"
            aria-label="Filters"
            aria-expanded={filterOpen}
            aria-controls="replay-filter-panel"
            title="Filters"
            onClick={() => setFilterOpen((open) => !open)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {activeFilters > 0 && (
              <span className="replay-filter-count">{activeFilters}</span>
            )}
          </button>
          <ReplayFilterPanel
            open={filterOpen}
            mode={mode}
            filters={filters}
            fromDate={fromDate}
            toDate={toDate}
            options={options}
            onFiltersChange={setFilters}
            onDatesChange={updateDateRange}
            onReset={resetFilters}
          />
        </div>
      </header>
      <section className="replay-list-content" aria-live="polite">
        <div className="replay-list-header" aria-hidden="true">
          <span>Date</span>
          <span>Players / Result</span>
          <span>Context</span>
          <span>Rules</span>
        </div>
        {body}
      </section>
    </main>
  );
}

function ReplayState({
  message,
  loading = false,
  error = false,
  action,
}: {
  message: string;
  loading?: boolean;
  error?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className={`replay-list-state ${error ? "is-error" : ""}`}>
      {loading && <LoaderCircle aria-hidden="true" className="spin" />}
      <span>{message}</span>
      {action}
    </div>
  );
}

function ReplayFilterPanel({
  open,
  mode,
  filters,
  fromDate,
  toDate,
  options,
  onFiltersChange,
  onDatesChange,
  onReset,
}: {
  open: boolean;
  mode: ReplayLibraryMode;
  filters: ReplayLibraryFilters;
  fromDate: string;
  toDate: string;
  options: ReturnType<typeof replayLibraryFilterOptions>;
  onFiltersChange: React.Dispatch<React.SetStateAction<ReplayLibraryFilters>>;
  onDatesChange: (from: string, to: string) => void;
  onReset: () => void;
}) {
  return (
    <aside
      id="replay-filter-panel"
      className="replay-filter-panel"
      aria-label="Replay filters"
      hidden={!open}
    >
      <div className="replay-filter-toolbar">
        <strong>Filters</strong>
        <button type="button" onClick={onReset}>
          <RotateCcw aria-hidden="true" />
          <span>Reset</span>
        </button>
      </div>
      <label className="replay-filter-select">
        <span>Order</span>
        <select
          value={filters.sortOrder}
          onChange={(event) =>
            onFiltersChange((current) => ({
              ...current,
              sortOrder: event.target
                .value as ReplayLibraryFilters["sortOrder"],
            }))
          }
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </label>
      <fieldset>
        <legend>Game date</legend>
        <div className="replay-date-filters">
          <label>
            <span>From</span>
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => onDatesChange(event.target.value, toDate)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => onDatesChange(fromDate, event.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <ReplayCheckboxGroup
        label="Rules"
        options={options.rulesets.map((ruleset) => ({
          value: ruleset.id,
          label: ruleset.label,
        }))}
        selected={filters.rulesets}
        onToggle={(ruleset) =>
          onFiltersChange((current) => ({
            ...current,
            rulesets: toggleValue(current.rulesets, ruleset),
          }))
        }
      />
      {mode === "online" && (
        <>
          <ReplayCheckboxGroup
            label="Platform"
            options={options.sources.map((source) => ({
              value: source,
              label: SOURCE_LABELS[source],
            }))}
            selected={filters.sources}
            onToggle={(source) =>
              onFiltersChange((current) => ({
                ...current,
                sources: toggleValue(current.sources, source),
              }))
            }
          />
          <ReplayCheckboxGroup
            label="Context"
            options={options.contexts.map((context) => ({
              value: context,
              label: CONTEXT_LABELS[context],
            }))}
            selected={filters.contexts}
            onToggle={(context) =>
              onFiltersChange((current) => ({
                ...current,
                contexts: toggleValue(current.contexts, context),
              }))
            }
          />
          <ReplayCheckboxGroup
            label="Relationship"
            options={options.reasons.map((reason) => ({
              value: reason,
              label: REASON_LABELS[reason],
            }))}
            selected={filters.reasons}
            onToggle={(reason) =>
              onFiltersChange((current) => ({
                ...current,
                reasons: toggleValue(current.reasons, reason),
              }))
            }
          />
        </>
      )}
    </aside>
  );
}

function ReplayCheckboxGroup<Value extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Array<{ value: Value; label: string }>;
  selected: Value[];
  onToggle: (value: Value) => void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="replay-filter-options">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

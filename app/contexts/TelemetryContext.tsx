import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from "react";
import { useLocation } from "react-router";
import { v4 as uuidv4 } from "uuid";

interface TelemetryClient {
  /** Unique ID for this browser session (stable until page refresh). */
  sessionId: string;
  /** Track a named event with optional metadata. */
  track: (event: string, meta?: Record<string, unknown>) => void;
  /** Track an error caught on the client side. */
  trackError: (error: unknown, meta?: Record<string, unknown>) => void;
}

const TelemetryContext = createContext<TelemetryClient | undefined>(undefined);

export function useTelemetry(): TelemetryClient {
  const ctx = useContext(TelemetryContext);
  if (!ctx) {
    throw new Error("useTelemetry must be used within <TelemetryProvider>");
  }
  return ctx;
}

/** Batches client telemetry events and flushes them periodically. */
export function TelemetryProvider({
  children,
  endpoint = "/api/telemetry",
  flushInterval = 5_000,
}: {
  children: React.ReactNode;
  endpoint?: string;
  flushInterval?: number;
}) {
  // Stable session ID: generated once per mount (i.e. per page load)
  const sessionId = useMemo(() => uuidv4(), []);
  const buffer = useRef<Array<Record<string, unknown>>>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (buffer.current.length === 0) {
      return;
    }
    const events = buffer.current.splice(0);
    // Fire-and-forget beacon; navigator.sendBeacon keeps working on page unload
    const blob = new Blob([JSON.stringify({ events, sessionId })], {
      type: "application/json",
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, blob);
    } else {
      fetch(endpoint, { method: "POST", body: blob, keepalive: true }).catch(
        () => {}
      );
    }
  }, [endpoint]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) {
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, flushInterval);
  }, [flush, flushInterval]);

  const track = useCallback(
    (event: string, meta?: Record<string, unknown>) => {
      buffer.current.push({
        type: "client",
        event,
        path: window.location.pathname,
        meta,
        ts: Date.now(),
      });
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const trackError = useCallback(
    (error: unknown, meta?: Record<string, unknown>) => {
      const err = error instanceof Error ? error : new Error(String(error));
      buffer.current.push({
        type: "client",
        event: "error",
        path: window.location.pathname,
        error: err.message,
        stack: err.stack,
        meta,
        ts: Date.now(),
      });
      scheduleFlush();
    },
    [scheduleFlush]
  );

  // ── Automatic page view tracking ──────────────────────────────────
  const location = useLocation();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip duplicate fires for the same path (e.g. StrictMode double-mount)
    if (prevPathRef.current === location.pathname) {
      return;
    }
    prevPathRef.current = location.pathname;
    track("page_view", {
      referrer: document.referrer || undefined,
      search: location.search || undefined,
    });
  }, [location.pathname, location.search, track]);

  return (
    <TelemetryContext.Provider value={{ sessionId, track, trackError }}>
      {children}
    </TelemetryContext.Provider>
  );
}

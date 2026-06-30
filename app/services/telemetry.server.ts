import { AsyncLocalStorage } from "node:async_hooks";
import { connectToDatabase } from "../utils/dbConnection.server";
import { TelemetryEventModel } from "../db/TelemetryEvent";

// ── AsyncLocalStorage context (no prop drilling) ─────────────────────
interface TelemetryContext {
  userId?: string;
  sessionId?: string;
  path?: string;
  method?: string;
  startTime: number;
}

const als = new AsyncLocalStorage<TelemetryContext>();

/** Run a callback with telemetry context attached. */
export function withTelemetry<T>(
  ctx: Omit<TelemetryContext, "startTime">,
  fn: () => T
): T {
  return als.run({ ...ctx, startTime: Date.now() }, fn);
}

/** Get the current telemetry context (if inside withTelemetry). */
export function getTelemetryContext(): TelemetryContext | undefined {
  return als.getStore();
}

// ── Fire-and-forget event writing ────────────────────────────────────
type TelemetryInput = {
  type: string;
  env?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  sessionId?: string;
  error?: string;
  stack?: string;
  meta?: Record<string, unknown>;
};

/** Write a telemetry event (non-blocking, never throws). */
export function trackEvent(event: TelemetryInput): void {
  // Fire-and-forget — intentionally no await
  connectToDatabase()
    .then(() => TelemetryEventModel.create(event))
    .catch((err) => console.error("[telemetry] write failed:", err.message));
}

/**
 * Auto-track a request handled by a loader/action.
 * Call at the end of the handler with the Response status.
 * For non-2xx responses, pass `error`/`stack` to record the failure details.
 */
export function trackRequest(
  statusCode: number,
  meta?: Record<string, unknown>,
  errorInfo?: { error?: string; stack?: string }
): void {
  const ctx = als.getStore();
  trackEvent({
    type: "request",
    method: ctx?.method,
    path: ctx?.path,
    statusCode,
    durationMs: ctx ? Date.now() - ctx.startTime : undefined,
    userId: ctx?.userId,
    sessionId: ctx?.sessionId,
    error: errorInfo?.error,
    stack: errorInfo?.stack,
    meta,
  });
}

/**
 * Best-effort extraction of an error message from a non-2xx Response.
 * Reads a clone so the original body remains intact for the client.
 */
async function extractResponseError(
  response: Response
): Promise<string | undefined> {
  try {
    const clone = response.clone();
    const ct = clone.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const data = (await clone.json()) as Record<string, unknown> | unknown;
      if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        const candidate =
          obj.error ?? obj.message ?? obj.errorMessage ?? obj.detail;
        if (typeof candidate === "string") {
          return candidate;
        }
        // Fall back to stringified JSON, capped
        return JSON.stringify(obj).slice(0, 500);
      }
    } else if (ct.startsWith("text/")) {
      const text = await clone.text();
      return text.slice(0, 500);
    }
  } catch {
    // ignore — error extraction is best-effort
  }
  return undefined;
}

/** Track a caught error with optional context from ALS. */
export function trackError(err: unknown, meta?: Record<string, unknown>): void {
  const ctx = als.getStore();
  const error = err instanceof Error ? err : new Error(String(err));
  trackEvent({
    type: "error",
    method: ctx?.method,
    path: ctx?.path,
    userId: ctx?.userId,
    sessionId: ctx?.sessionId,
    error: error.message,
    stack: error.stack,
    meta,
  });
}

// ── Prebuilt query helpers (admin use) ───────────────────────────────

interface QueryOpts {
  since?: Date;
  limit?: number;
}

function defaultSince(opts?: QueryOpts): Date {
  return opts?.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h
}

/** Recent errors, newest first. */
export async function queryErrors(opts?: QueryOpts) {
  await connectToDatabase();
  return TelemetryEventModel.find({
    type: "error",
    createdAt: { $gte: defaultSince(opts) },
  })
    .sort({ createdAt: -1 })
    .limit(opts?.limit ?? 50)
    .lean();
}

/** Slowest requests in the period. */
export async function querySlowest(opts?: QueryOpts & { minMs?: number }) {
  await connectToDatabase();
  return TelemetryEventModel.find({
    type: "request",
    createdAt: { $gte: defaultSince(opts) },
    durationMs: { $gte: opts?.minMs ?? 500 },
  })
    .sort({ durationMs: -1 })
    .limit(opts?.limit ?? 50)
    .lean();
}

/** Requests grouped by path with count and avg duration. */
export async function queryByPath(opts?: QueryOpts) {
  await connectToDatabase();
  return TelemetryEventModel.aggregate([
    {
      $match: {
        type: "request",
        createdAt: { $gte: defaultSince(opts) },
      },
    },
    {
      $group: {
        _id: "$path",
        count: { $sum: 1 },
        avgDurationMs: { $avg: "$durationMs" },
        maxDurationMs: { $max: "$durationMs" },
        errorCount: {
          $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
        },
      },
    },
    { $sort: { count: -1 } },
    { $limit: opts?.limit ?? 100 },
  ]);
}

/** Error rate over time (hourly buckets). */
export async function queryErrorRate(opts?: QueryOpts) {
  await connectToDatabase();
  return TelemetryEventModel.aggregate([
    {
      $match: {
        type: "request",
        createdAt: { $gte: defaultSince(opts) },
      },
    },
    {
      $group: {
        _id: {
          $dateTrunc: { date: "$createdAt", unit: "hour" },
        },
        total: { $sum: 1 },
        errors: {
          $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

/** Activity for a specific user. */
export async function queryUserActivity(userId: string, opts?: QueryOpts) {
  await connectToDatabase();
  return TelemetryEventModel.find({
    userId,
    createdAt: { $gte: defaultSince(opts) },
  })
    .sort({ createdAt: -1 })
    .limit(opts?.limit ?? 100)
    .lean();
}

/** Client-side events (page views, clicks, etc.) */
export async function queryClientEvents(opts?: QueryOpts) {
  await connectToDatabase();
  return TelemetryEventModel.find({
    type: "client",
    createdAt: { $gte: defaultSince(opts) },
  })
    .sort({ createdAt: -1 })
    .limit(opts?.limit ?? 100)
    .lean();
}

/** All events for a given client session (linked by sessionId). */
export async function querySession(sessionId: string, opts?: QueryOpts) {
  await connectToDatabase();
  return TelemetryEventModel.find({
    sessionId,
    ...(opts?.since ? { createdAt: { $gte: opts.since } } : {}),
  })
    .sort({ createdAt: 1 })
    .limit(opts?.limit ?? 500)
    .lean();
}

// ── Opt-in loader/action wrapper (one-line per route) ────────────────

type LoaderOrAction = (args: {
  request: Request;
  params: any;
  context?: any;
}) => Promise<Response> | Response;

/**
 * Wrap a loader or action to auto-track request telemetry.
 * Usage: `export const loader = tracked(async ({ request }) => { ... })`
 */
export function tracked(fn: LoaderOrAction): LoaderOrAction {
  return async (args) => {
    const { request } = args;
    const url = new URL(request.url);
    const ctx: Omit<TelemetryContext, "startTime"> = {
      method: request.method,
      path: url.pathname,
    };
    const sessionId = request.headers.get("X-Telemetry-Session") ?? undefined;
    return withTelemetry({ ...ctx, sessionId }, async () => {
      try {
        const response = await fn(args);
        if (response.status >= 400) {
          const errMsg = await extractResponseError(response);
          trackRequest(
            response.status,
            undefined,
            errMsg ? { error: errMsg } : undefined
          );
        } else {
          trackRequest(response.status);
        }
        return response;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        // Record both an error event (with stack) and a 500 request event
        // so the failure shows up in request-based queries (by-path, etc.)
        trackError(err);
        trackRequest(500, undefined, {
          error: error.message,
          stack: error.stack,
        });
        throw err;
      }
    });
  };
}

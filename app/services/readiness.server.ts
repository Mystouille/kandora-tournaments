/**
 * Tracks readiness of all startup services.
 * The app is "ready" only once every registered service has signalled completion.
 */

const services = new Map<
  string,
  { ready: boolean; skipped: boolean; error?: string }
>();

/** Register a service that must become ready before healthcheck passes. */
export function registerService(name: string): void {
  if (!services.has(name)) {
    services.set(name, { ready: false, skipped: false });
  }
}

/** Mark a service as ready. */
export function markReady(name: string, message?: string): void {
  const svc = services.get(name);
  if (svc) {
    svc.ready = true;
    svc.error = undefined;
    console.log(`[Readiness] ${name}: ready${message ? ` — ${message}` : ""}`);
  }
}

/** Mark a service as skipped (missing config — not required for readiness). */
export function markSkipped(name: string): void {
  const svc = services.get(name);
  if (svc) {
    svc.skipped = true;
    svc.ready = true;
    console.log(`[Readiness] ${name}: skipped (not configured)`);
  }
}

/** Mark a service as failed. */
export function markFailed(name: string, error: string): void {
  const svc = services.get(name);
  if (svc) {
    svc.error = error;
    console.error(`[Readiness] ${name}: failed — ${error}`);
  }
}

/** Returns true when every registered service is ready (or skipped). */
export function isReady(): boolean {
  for (const svc of services.values()) {
    if (!svc.ready) {
      return false;
    }
  }
  return services.size > 0;
}

/** Detailed status for the health endpoint. */
export function getStatus(): Record<
  string,
  { ready: boolean; skipped: boolean; error?: string }
> {
  const result: Record<
    string,
    { ready: boolean; skipped: boolean; error?: string }
  > = {};
  for (const [name, svc] of services) {
    result[name] = { ...svc };
  }
  return result;
}

// Register all startup services upfront
registerService("league-queue");
registerService("league-worker");
registerService("discord");
registerService("nanikiru");
registerService("emojis");
registerService("tnt-membership");

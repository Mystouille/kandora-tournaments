/**
 * Server-side client for the SHARED game-server's relay-control API.
 *
 * Tournaments never runs a Tenhou socket itself — it asks the shared
 * game-server to open (or reuse) a live relay for a given Tenhou watch-id and
 * fan it out to spectators. This is a call to SHARED infra, not to the portal,
 * so it introduces no app→app dependency. The `RELAY_SECRET` is held
 * server-side and never reaches the browser.
 *
 * Env:
 *   GAME_SERVER_URL — http(s) base of the shared game-server
 *                     (e.g. `https://game.example.com`). Required to start relays.
 *   RELAY_SECRET    — shared secret matching the game-server's `RELAY_SECRET`.
 */
function resolveGameServerUrl(): string {
  const explicitUrl = process.env.GAME_SERVER_URL ?? process.env.GAME_HTTP_URL;
  if (explicitUrl) {
    return explicitUrl.replace(/\/$/, "");
  }
  const wsUrl = process.env.GAME_WS_URL;
  if (!wsUrl) {
    return "";
  }
  return wsUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:").replace(/\/$/, "");
}

const GAME_SERVER_URL = resolveGameServerUrl();
const RELAY_SECRET = process.env.RELAY_SECRET ?? "";

export type RelayErrorCode =
  | "relay_not_configured"
  | "relay_unauthorized"
  | "relay_endpoint_not_found"
  | "relay_unreachable"
  | "relay_invalid_response"
  | "relay_invalid_request"
  | "relay_capacity"
  | "game_server_disabled"
  | "relay_failed";

export class RelayError extends Error {
  constructor(public readonly code: RelayErrorCode, message: string) {
    super(message);
    this.name = "RelayError";
  }
}

export interface RelayHandle {
  matchId: string;
}

function relayHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-relay-secret": RELAY_SECRET,
  };
}

function assertConfigured(): void {
  if (!GAME_SERVER_URL) {
    throw new RelayError(
      "relay_not_configured",
      "GAME_SERVER_URL, GAME_HTTP_URL, or GAME_WS_URL is required"
    );
  }
  if (!RELAY_SECRET) {
    throw new RelayError(
      "relay_not_configured",
      "RELAY_SECRET is not configured"
    );
  }
}

/**
 * Start (or reuse) a live Tenhou relay for `watchId`; returns its matchId.
 * De-duplicated server-side: a second call for the same watch-id reuses the
 * running relay and returns the same matchId.
 */
export async function startRelay(watchId: string): Promise<RelayHandle> {
  assertConfigured();
  let res: Response;
  try {
    res = await fetch(`${GAME_SERVER_URL}/relay/start`, {
      method: "POST",
      headers: relayHeaders(),
      body: JSON.stringify({ watchId }),
    });
  } catch (error) {
    throw new RelayError(
      "relay_unreachable",
      error instanceof Error ? error.message : "Game server is unreachable"
    );
  }
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const serverError = errorBody?.error;
    const code: RelayErrorCode =
      serverError === "game_disabled"
        ? "game_server_disabled"
        : serverError === "relay_capacity"
          ? "relay_capacity"
          : res.status === 401
            ? "relay_unauthorized"
            : res.status === 404
              ? "relay_endpoint_not_found"
              : res.status === 400
                ? "relay_invalid_request"
                : "relay_failed";
    throw new RelayError(code, `relay start failed: ${res.status}`);
  }
  const body = (await res.json().catch(() => null)) as {
    matchId?: unknown;
  } | null;
  if (typeof body?.matchId !== "string" || body.matchId.length === 0) {
    throw new RelayError(
      "relay_invalid_response",
      "relay start: missing matchId in response"
    );
  }
  return { matchId: body.matchId };
}

/** Stop a live Tenhou relay by watch-id. Best-effort. */
export async function stopRelay(watchId: string): Promise<void> {
  assertConfigured();
  await fetch(`${GAME_SERVER_URL}/relay/stop`, {
    method: "POST",
    headers: relayHeaders(),
    body: JSON.stringify({ watchId }),
  });
}

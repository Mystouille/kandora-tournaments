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
const GAME_SERVER_URL = (process.env.GAME_SERVER_URL ?? "").replace(/\/$/, "");
const RELAY_SECRET = process.env.RELAY_SECRET ?? "";

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
    throw new Error("GAME_SERVER_URL is not configured");
  }
  if (!RELAY_SECRET) {
    throw new Error("RELAY_SECRET is not configured");
  }
}

/**
 * Start (or reuse) a live Tenhou relay for `watchId`; returns its matchId.
 * De-duplicated server-side: a second call for the same watch-id reuses the
 * running relay and returns the same matchId.
 */
export async function startRelay(watchId: string): Promise<RelayHandle> {
  assertConfigured();
  const res = await fetch(`${GAME_SERVER_URL}/relay/start`, {
    method: "POST",
    headers: relayHeaders(),
    body: JSON.stringify({ watchId }),
  });
  if (!res.ok) {
    throw new Error(`relay start failed: ${res.status}`);
  }
  const body = (await res.json()) as { matchId?: unknown };
  if (typeof body.matchId !== "string" || body.matchId.length === 0) {
    throw new Error("relay start: missing matchId in response");
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

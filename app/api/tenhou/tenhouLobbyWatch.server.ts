import { WebSocket, type RawData } from "ws";

/**
 * Read-only websocket probe for a Tenhou private lobby.
 *
 * Tenhou's `/cs/edit/` REST endpoints (cmd_get_players.cgi) only distinguish
 * `idle` vs `playing` players — they cannot tell how many players have *sat
 * down and are waiting for a table to fill* (the "ready" count). The lobby
 * game-server websocket (`wss://b-ww.mjv.jp/`) broadcasts that number in its
 * `LN` frames, so we open a short-lived, anonymous, read-only connection to
 * read it.
 *
 * The probe never joins a table (no `JOIN`), so it does not appear as a ready
 * player and does not affect the lobby. It requires no Tenhou account — an
 * anonymous guest `HELO` is accepted.
 */

const TENHOU_LOBBY_WS_URL = "wss://b-ww.mjv.jp/";

/** Tenhou rejects Node's default User-Agent; use a browser-like one. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * Hard cap on how long to wait for the lobby's `LN` frame. The subscribed
 * lobby `LN` is broadcast on subscribe and then roughly every ~10s, so this
 * comfortably catches at least one while bounding a background probe.
 */
const PROBE_TIMEOUT_MS = 12_000;

/** Interval for the `<Z/>` keepalive frames Tenhou's client sends. */
const KEEPALIVE_MS = 8_000;

/**
 * Converts a stored Tenhou lobby id into the form the game-server websocket
 * accepts.
 *
 * The "edit" id used by the REST endpoints (cmd_start / cmd_load /
 * cmd_get_players) is the public lobby number followed by an 8-digit
 * edit-auth code, e.g. `C1017682582799490` = public lobby `C10176825` +
 * auth `82799490`. The websocket `CS` subscribe only accepts the public
 * number and drops the connection for the long "edit" form.
 */
export function toTenhouWsLobbyId(rawId: string): string {
  const trimmed = rawId.trim();
  const match = /^C(\d+)$/.exec(trimmed);
  if (!match) {
    return trimmed;
  }
  const digits = match[1];
  // Strip the trailing 8-digit edit-auth code when present (long "edit" id).
  // Public lobby numbers are <= 8 digits, so a longer value carries the auth.
  return digits.length > 8 ? `C${digits.slice(0, -8)}` : `C${digits}`;
}

function toText(raw: RawData): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  return Buffer.from(raw as ArrayBuffer).toString("utf8");
}

/**
 * Opens a short-lived, anonymous, read-only websocket to Tenhou and returns
 * the live "ready" (seated) player count for the given private lobby.
 *
 * Resolves `undefined` on any error, timeout, or unreachable lobby so callers
 * can fall back gracefully — this is a best-effort enhancement.
 *
 * @param rawLobbyId The lobby id as stored on the league (long "edit" form is
 *                   accepted and normalised).
 * @param helloName  Optional Tenhou account ID to log in with, for lobbies
 *                   that refuse guests. Defaults to an anonymous guest login.
 */
export function fetchTenhouLobbyReady(
  rawLobbyId: string,
  helloName?: string
): Promise<number | undefined> {
  const lobby = toTenhouWsLobbyId(rawLobbyId);
  // Guest-refusing lobbies reject the anonymous "NoName" login; use the
  // configured Tenhou account ID when one is provided.
  const loginName = helloName?.trim() || "NoName";

  return new Promise<number | undefined>((resolve) => {
    let settled = false;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    // Snapshot from the `CS` reply; used as a fallback if the (authoritative)
    // lobby `LN` frame never arrives before the timeout.
    let csPlayers: number | undefined;

    const ws = new WebSocket(TENHOU_LOBBY_WS_URL, {
      headers: { "User-Agent": USER_AGENT, Origin: "https://tenhou.net" },
    });

    const finish = (result: number | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      if (keepAlive) {
        clearInterval(keepAlive);
      }
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // best-effort tear-down
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(csPlayers), PROBE_TIMEOUT_MS);
    timer.unref?.();

    ws.on("open", () => {
      ws.send(JSON.stringify({ tag: "HELO", name: loginName, sx: "M" }));
    });

    ws.on("message", (raw: RawData) => {
      const text = toText(raw).replace(/\0+$/, "").trim();
      if (!text.startsWith("{")) {
        return; // XML keepalive / echo frame — ignore
      }

      let msg: { tag?: string; players?: string; n?: string; j?: string };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      if (msg.tag === "HELO") {
        // Server greeted us back — subscribe to the lobby and start keepalives.
        ws.send(JSON.stringify({ tag: "CS", lobby }));
        keepAlive = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("<Z/>");
          }
        }, KEEPALIVE_MS);
        keepAlive.unref?.();
        return;
      }

      if (msg.tag === "CS" && msg.players !== undefined) {
        const players = Number.parseInt(msg.players, 10);
        if (Number.isFinite(players)) {
          csPlayers = players;
        }
        return;
      }

      if (msg.tag === "LN") {
        // Two `LN` shapes share the tag:
        //   • global broadcast: 4-field `n` with long, comma-separated `j`/`g`
        //     lists (ignore).
        //   • subscribed lobby: 3-field `n`
        //     ("<globalOnline>,<lobbyConns>,<lobbyConns>") with a scalar `j`
        //     (seated / ready players). This is the one we want.
        const n = String(msg.n ?? "").split(",");
        const j = String(msg.j ?? "");
        if (n.length === 3 && j.length > 0 && !j.includes(",")) {
          const ready = Number.parseInt(j, 10);
          if (Number.isFinite(ready)) {
            finish(ready);
          }
        }
      }
    });

    ws.on("error", () => finish(csPlayers));
    ws.on("close", () => finish(csPlayers));
  });
}

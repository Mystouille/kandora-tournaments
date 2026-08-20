import type { GameSummary, GameSummaryPlayer } from "~/types/GameSummary";

/**
 * Represents a single parsed line from the Tenhou lobby log listing.
 */
interface TenhouLogLine {
  /** Timestamp from the leading `[YYYY/MM/DD HH:mm:ss]` bracket. */
  timestamp: Date;
  /** Key-value pairs parsed from the `key=value&key=value` body. */
  params: Record<string, string>;
}

/**
 * Intermediate state while correlating START → result lines.
 */
interface PendingGame {
  logId: string;
  startTime: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tenhou timestamps are in JST (UTC+9). */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Parses a `[YYYY/MM/DD HH:mm:ss]` timestamp (JST) into a UTC Date.
 */
function parseJstTimestamp(raw: string): Date {
  // raw is like "2026/04/19 06:25:29"
  const iso = raw.replace(/\//g, "-").replace(" ", "T") + "+09:00";
  return new Date(iso);
}

/**
 * Parses the `&`-separated key=value body of a log line.
 * Values may be empty (e.g. `chip=`).
 */
function parseParams(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  // The body may contain XML-like cmd=<CHAT .../> which itself can have
  // `&` inside attribute values.  We only need params *before* `cmd=<`,
  // so split on that first.
  const cmdIdx = body.indexOf("&cmd=<");
  const paramsPart = cmdIdx >= 0 ? body.slice(0, cmdIdx) : body;

  for (const pair of paramsPart.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) {
      continue;
    }
    result[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return result;
}

/**
 * Parses a single raw log line into timestamp + params.
 * Returns null for unparseable lines.
 */
function parseLine(raw: string): TenhouLogLine | null {
  // Format: [YYYY/MM/DD HH:mm:ss] body…
  const match = raw.match(/^\[(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})\] (.+)$/);
  if (!match) {
    return null;
  }
  return {
    timestamp: parseJstTimestamp(match[1]),
    params: parseParams(match[2]),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses the raw text returned by Tenhou's `cmd_get_log.cgi` into an
 * array of {@link GameSummary} objects.
 *
 * The response contains three types of lines per game. Game rows include a
 * `type` bit field whose value varies with the lobby rules:
 *
 * 1. **START** — contains `log=<logId>` (the game replay identifier).
 * 2. **END**   — `#END` chat message with human-readable scores (ignored).
 * 3. **Result** — contains `un=<names>&sc=<scores>` with structured data.
 *
 * We correlate START → result lines sequentially to build summaries.
 *
 * @param rawText  The full response body from cmd_get_log.cgi.
 * @param knownGameIds  Optional set of game IDs to skip (already processed).
 */
export function parseTenhouLobbyLog(
  rawText: string,
  knownGameIds?: Set<string>
): GameSummary[] {
  // Tenhou returns \r\n line endings — strip \r so the regex anchors work.
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.length > 0);
  const summaries: GameSummary[] = [];
  let pending: PendingGame | null = null;

  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) {
      continue;
    }

    // START and result rows are typed; chat-only rows such as #END are not.
    // The type value is a rule bit field (for example 0001 or 0009), so it
    // must not be used as a fixed game-type discriminator.
    if (!line.params.type) {
      continue;
    }

    // START line — has `log=`
    if (line.params.log) {
      const logId = line.params.log;
      if (knownGameIds?.has(logId)) {
        // Skip known games — but still consume the pending slot so the
        // next result line doesn't accidentally pair with an older START.
        pending = null;
        continue;
      }
      pending = { logId, startTime: line.timestamp };
      continue;
    }

    // Result line — has `un=` and `sc=`
    if (line.params.un && line.params.sc !== undefined && pending) {
      const names = line.params.un.split(",").map((n) => decodeURIComponent(n));
      const platformDeltas = line.params.sc.split(",").map(Number);

      if (names.length !== platformDeltas.length || names.length === 0) {
        pending = null;
        continue;
      }

      const players: GameSummaryPlayer[] = names.map((name, i) => ({
        platformUserId: name,
        nickname: name,
        // Tenhou's lobby `sc=` field is already the platform's final delta
        // (raw points + its configured uma/oka). It must never enter Kandora's
        // raw-score field or the league rules would be applied a second time.
        rawScore: null,
        place: null,
        seat: i,
      }));

      summaries.push({
        gameId: pending.logId,
        platform: "tenhou",
        startTime: pending.startTime,
        endTime: line.timestamp,
        log: `https://tenhou.net/0/?log=${pending.logId}`,
        players,
      });

      pending = null;
    }
  }

  return summaries;
}

/**
 * Formats a JS Date as a JST timestamp string for the `T=` parameter.
 * Format: `YYYY/MM/DD HH:mm:ss`
 */
export function formatJstTimestamp(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const mi = String(jst.getUTCMinutes()).padStart(2, "0");
  const s = String(jst.getUTCSeconds()).padStart(2, "0");
  return `${y}/${mo}/${d} ${h}:${mi}:${s}`;
}

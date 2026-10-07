import { z } from "zod";
import type { RuleSet } from "~/game/rules/ruleSet";
import {
  assertTenhouRulesApplied,
  getTenhouRuleCode,
  ruleSetToTenhouConfig,
  TenhouRuleConversionError,
  type TenhouRuleConfig,
} from "./ruleSetToTenhouConfig";

/**
 * Parsed result of `cmd_load.cgi` — the full tournament configuration.
 * String values are already URL-decoded.
 */
export interface TenhouTournamentConfig {
  TITLE: string;
  RULE: string;
  RANKING: string;
  MEMBER: string;
  CHATMEMBER: string;
  ENABLEJOINSAMEIP: number;
  EDITAUTH: string;
  CSRULE?: string;
  JOINFEE?: string;
  /** Presence indicates an administration password, not the password itself. */
  PW?: unknown;
  DUPLICATABLESEED?: string;
  PREMIUMONLY?: number;
  CHATPREMIUMONLY?: number;
  DISABLEGUESTMATCH?: number;
  DISABLEGUESTID?: number;
  DISABLEENDANNOUNCE?: number;
}

const configFlag = z
  .union([z.literal(0), z.literal(1), z.literal("0"), z.literal("1")])
  .transform(Number);
const configString = z.union([z.string(), z.number()]).transform(String);
const tournamentConfigSchema = z
  .object({
    TITLE: z.string(),
    RULE: z
      .string()
      .regex(/^\d{12},\d{12},[\da-f]{4},\d+,\d+,\d+,\d+$/i),
    RANKING: configString.default(""),
    MEMBER: z.string(),
    CHATMEMBER: z.string(),
    ENABLEJOINSAMEIP: configFlag.default(1),
    EDITAUTH: z.string().min(1),
    CSRULE: z.string().optional(),
    JOINFEE: configString.optional(),
    PW: z.unknown().optional(),
    DUPLICATABLESEED: z.string().optional(),
    PREMIUMONLY: configFlag.optional(),
    CHATPREMIUMONLY: configFlag.optional(),
    DISABLEGUESTMATCH: configFlag.optional(),
    DISABLEGUESTID: configFlag.optional(),
    DISABLEENDANNOUNCE: configFlag.optional(),
  })
  .passthrough();

function validateTournamentConfig(value: unknown): TenhouTournamentConfig {
  const parsed = tournamentConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid Tenhou configuration fields: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`
    );
  }
  return parsed.data;
}

export function assertTenhouConfigEditable(
  config: TenhouTournamentConfig
): void {
  if (config.PW !== undefined && config.PW !== null) {
    throw new Error("Password-protected Tenhou lobby administration is not supported");
  }
}

function assertLobbySettingsPreserved(
  expected: TenhouTournamentConfig,
  actual: TenhouTournamentConfig
): void {
  const changed: string[] = [];
  const actualRule = actual.RULE.split(",");
  actualRule[2] = expected.RULE.split(",")[2];
  if (actualRule.join(",") !== expected.RULE) {
    changed.push("schedule/rating restrictions");
  }
  for (const field of ["MEMBER", "CHATMEMBER"] as const) {
    const names = (value: string) => value.split(",").sort().join(",");
    if (names(expected[field]) !== names(actual[field])) {
      changed.push(field);
    }
  }
  for (const field of ["TITLE", "RANKING", "JOINFEE"] as const) {
    if ((expected[field] ?? "") !== (actual[field] ?? "")) {
      changed.push(field);
    }
    assertTenhouConfigEditable(actual);
  }
  if (
    (expected.DUPLICATABLESEED ?? "default") !==
    (actual.DUPLICATABLESEED ?? "default")
  ) {
    changed.push("DUPLICATABLESEED");
  }
  for (const field of [
    "ENABLEJOINSAMEIP",
    "PREMIUMONLY",
    "CHATPREMIUMONLY",
    "DISABLEGUESTMATCH",
    "DISABLEGUESTID",
    "DISABLEENDANNOUNCE",
  ] as const) {
    const fallback = field === "ENABLEJOINSAMEIP" ? 1 : 0;
    if ((expected[field] ?? fallback) !== (actual[field] ?? fallback)) {
      changed.push(field);
    }
  }
  if (changed.length > 0) {
    throw new Error(`Tenhou did not preserve lobby settings: ${changed.join(", ")}`);
  }
}

/** One ongoing (watchable) game from `cmd_get_wg.cgi`. */
export interface TenhouWatchGame {
  /** Spectator watch id — the 8-hex value the kansen client sends as `WG.id`. */
  watchId: string;
  /** Seat-ordered player names (E, S, W, N), decoded from base64. */
  players: string[];
  /** Per-seat Tenhou rating (R), parallel to `players`. */
  ratings: number[];
}

/**
 * Parses a `cmd_get_wg.cgi` body. The response is a JSONP wrapper
 * `sw([ "<row>", … ]);` with one comma-separated row per ongoing game:
 * `watchId,meta,timer,meta,<b64name>,<games>,<rating>` repeated for 4 seats.
 * Player names are base64; the leading + per-seat count metadata is skipped.
 * Returns `[]` on any unexpected shape (best-effort).
 */
export function parseTenhouWatchGames(raw: string): TenhouWatchGame[] {
  const match = raw.trim().match(/^sw\((\[[\s\S]*\])\);?$/);
  if (!match) {
    return [];
  }
  let rows: unknown;
  try {
    rows = JSON.parse(match[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) {
    return [];
  }
  const games: TenhouWatchGame[] = [];
  for (const row of rows) {
    if (typeof row !== "string") {
      continue;
    }
    const f = row.split(",");
    // 4 header fields (watchId + 3 meta) + 4 players × 3 fields each = 16.
    if (f.length < 16) {
      continue;
    }
    const players: string[] = [];
    const ratings: number[] = [];
    for (let seat = 0; seat < 4; seat++) {
      const base = 4 + seat * 3;
      players.push(decodeBase64Utf8(f[base]));
      ratings.push(Number.parseFloat(f[base + 2]));
    }
    games.push({ watchId: f[0], players, ratings });
  }
  return games;
}

function decodeBase64Utf8(b64: string): string {
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return b64;
  }
}

/**
 * Low-level HTTP client for Tenhou private lobby (C-number) APIs.
 *
 * Singleton — access via `TenhouService.instance`.
 */
export class TenhouService {
  private static readonly GLOBAL_KEY = "__TenhouService__";

  private static readonly LOG_URL =
    "https://tenhou.net/cs/edit/cmd_get_log.cgi";

  private static readonly PLAYERS_URL =
    "https://tenhou.net/cs/edit/cmd_get_players.cgi";

  private static readonly GET_WG_URL =
    "https://tenhou.net/cs/edit/cmd_get_wg.cgi";

  private static readonly LOAD_URL = "https://tenhou.net/cs/edit/cmd_load.cgi";

  private static readonly UPDATE_URL =
    "https://tenhou.net/cs/edit/cmd_update.cgi";

  private static readonly GAME_LOG_BASE = "https://tenhou.net/0/log/?";

  /** Tenhou rejects Node's default User-Agent; use a browser-like one. */
  private static readonly USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

  static get instance(): TenhouService {
    if (!(globalThis as any)[TenhouService.GLOBAL_KEY]) {
      (globalThis as any)[TenhouService.GLOBAL_KEY] = new TenhouService();
    }
    return (globalThis as any)[TenhouService.GLOBAL_KEY];
  }

  private constructor() {}

  /**
   * Fetches the raw log listing for a Tenhou private lobby.
   *
   * @param lobbyId  The internal tournament ID, e.g. "C4853890996412598"
   * @param since    Optional lower-bound timestamp — only logs at or after
   *                 this time are returned.  Format: "YYYY/MM/DD HH:mm:ss"
   *                 in JST (Tenhou's server timezone).
   * @returns The raw text body (newline-separated log lines).
   */
  async fetchLobbyGameList(lobbyId: string, since?: string): Promise<string> {
    const body = since ? `L=${lobbyId}&T=${since}` : `L=${lobbyId}`;

    const res = await fetch(TenhouService.LOG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "User-Agent": TenhouService.USER_AGENT,
        Referer: `https://tenhou.net/cs/edit/?${lobbyId}`,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(
        `Tenhou cmd_get_log.cgi returned ${res.status} for ${lobbyId}`
      );
    }

    return res.text();
  }

  /**
   * Fetches the raw XML game log for a single Tenhou game.
   *
   * @param logId  The game log identifier, e.g. "2026041906gm-0001-14853-b8890fb3"
   * @returns The raw XML string.
   */
  async fetchGameLog(logId: string): Promise<string> {
    const url = `${TenhouService.GAME_LOG_BASE}${logId}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": TenhouService.USER_AGENT,
      },
    });

    if (!res.ok) {
      // Tenhou occasionally serves transient 404s for valid logs
      // (CDN propagation lag, especially for logs that were just
      // requested for the first time in a while). Dump the
      // response headers + body so we can tell apart "log really
      // doesn't exist" from "Tenhou is having a moment".
      let body = "";
      try {
        body = await res.text();
      } catch {
        body = "<failed to read body>";
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      console.warn(
        `Tenhou game log returned ${res.status} for ${logId}`,
        JSON.stringify({
          url,
          status: res.status,
          statusText: res.statusText,
          headers,
          bodyLength: body.length,
          bodyPreview: body.slice(0, 500),
        })
      );
      throw new Error(`Tenhou game log returned ${res.status} for ${logId}`);
    }

    return res.text();
  }

  /**
   * Fetches the current player status in a Tenhou private lobby.
   *
   * @param lobbyId  The internal tournament ID, e.g. "C4853890996412598"
   * @returns Parsed idle and playing player name arrays.
   */
  async fetchLobbyPlayers(
    lobbyId: string
  ): Promise<{ idle: string[]; playing: string[] }> {
    const res = await fetch(TenhouService.PLAYERS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "User-Agent": TenhouService.USER_AGENT,
        Referer: `https://tenhou.net/cs/edit/?${lobbyId}`,
      },
      body: `L=${lobbyId}`,
    });

    if (!res.ok) {
      throw new Error(
        `Tenhou cmd_get_players.cgi returned ${res.status} for ${lobbyId}`
      );
    }

    const text = await res.text();
    // Response format: IDLE=%42%65%6E%6F%69%74,%XX...&PLAY=%XX,...
    const params = new URLSearchParams(text.trim());

    const decodeNames = (raw: string | null): string[] => {
      if (!raw) {
        return [];
      }
      return raw
        .split(",")
        .map((n) => decodeURIComponent(n))
        .filter((n) => n.length > 0);
    };

    return {
      idle: decodeNames(params.get("IDLE")),
      playing: decodeNames(params.get("PLAY")),
    };
  }

  /**
   * Fetches the ongoing (watchable) games in a Tenhou private lobby, each with
   * its spectator watch-id and seat-ordered players, via `cmd_get_wg.cgi`.
   * Requires the full edit-auth lobby id (the long `C…` form). Returns `[]`
   * when no game is in progress.
   */
  async fetchLobbyWatchGames(lobbyId: string): Promise<TenhouWatchGame[]> {
    const res = await fetch(TenhouService.GET_WG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "User-Agent": TenhouService.USER_AGENT,
        Referer: `https://tenhou.net/cs/edit/?${lobbyId}`,
      },
      body: `L=${lobbyId}`,
    });

    if (!res.ok) {
      throw new Error(
        `Tenhou cmd_get_wg.cgi returned ${res.status} for ${lobbyId}`
      );
    }

    return parseTenhouWatchGames(await res.text());
  }

  /**
   * Starts a game in a Tenhou private lobby with the given players.
   *
   * @param lobbyId      The internal tournament ID, e.g. "C4853890996412598"
   * @param playerNames  Array of player usernames (exactly 4 for a standard game).
   * @param ruleCode     Optional override; otherwise use the current lobby rules.
   * @returns `ok: true` if the game was started, `ok: false` with missing player names otherwise.
   */
  async startLobbyGame(
    lobbyId: string,
    playerNames: string[],
    ruleCode?: string
  ): Promise<{ ok: boolean; missingPlayers: string[] }> {
    const resolvedRuleCode =
      ruleCode ?? getTenhouRuleCode(await this.fetchTournamentConfig(lobbyId));
    const memberList = playerNames
      .map((n) => encodeURIComponent(n))
      .join("%0A");
    const body = `L=${lobbyId}&R2=${resolvedRuleCode}&M=${memberList}&RND=default&WG=1&PW=`;

    const res = await fetch("https://tenhou.net/cs/edit/cmd_start.cgi", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "User-Agent": TenhouService.USER_AGENT,
        Referer: `https://tenhou.net/cs/edit/?${lobbyId}`,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(
        `Tenhou cmd_start.cgi returned ${res.status} for ${lobbyId}`
      );
    }

    const text = (await res.text()).replace(/\r/g, "").trim();
    if (text.startsWith("MEMBER NOT FOUND")) {
      const lines = text.split("\n").slice(1);
      const missingPlayers = lines
        .map((l) => decodeURIComponent(l.trim()))
        .filter((n) => n.length > 0);
      return { ok: false, missingPlayers };
    }

    return { ok: true, missingPlayers: [] };
  }

  /**
   * Fetches the full tournament configuration from Tenhou (cmd_load.cgi).
   *
   * The response is JSONP: `cs({...})` with percent-encoded string values.
   *
   * @param lobbyId  The internal tournament ID, e.g. "C4853890996412598"
   */
  async fetchTournamentConfig(
    lobbyId: string
  ): Promise<TenhouTournamentConfig> {
    const url = `${TenhouService.LOAD_URL}?${lobbyId}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": TenhouService.USER_AGENT,
        Referer: `https://tenhou.net/cs/edit/?${lobbyId}`,
      },
    });

    if (!res.ok) {
      throw new Error(
        `Tenhou cmd_load.cgi returned ${res.status}`
      );
    }

    const raw = (await res.text()).trim();

    // Strip JSONP wrapper: cs({...}); → {...}
    const match = raw.match(/^cs\((\{.*\})\);?$/s);
    if (!match) {
      throw new Error("Unexpected Tenhou cmd_load.cgi response format");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      throw new Error("Invalid JSON in Tenhou cmd_load.cgi response");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid Tenhou configuration object");
    }

    // Decode percent-encoded string values
    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        try {
          config[key] = decodeURIComponent(value);
        } catch (error) {
          if (!(error instanceof URIError)) {
            throw error;
          }
          throw new Error(`Invalid encoding in Tenhou configuration field ${key}`);
        }
      } else {
        config[key] = value;
      }
    }

    return validateTournamentConfig(config);
  }

  async configureTournamentLobbies(
    lobbyIds: readonly string[],
    rules: RuleSet
  ): Promise<void> {
    const ids = [...new Set(lobbyIds.map((id) => id.trim()))];
    if (ids.length === 0 || ids.some((id) => !/^C\d{16}$/.test(id))) {
      throw new TenhouRuleConversionError([
        "every Tenhou lobby requires its full C-number administration ID",
      ]);
    }
    // Validate every target before changing any lobby.
    const targets = await Promise.all(
      ids.map(async (lobbyId) => {
        const config = await this.fetchTournamentConfig(lobbyId);
        assertTenhouConfigEditable(config);
        return {
          lobbyId,
          config,
          rules: ruleSetToTenhouConfig(rules, config),
        };
      })
    );
    let updated = 0;
    try {
      for (const target of targets) {
        await this.updateTournamentConfig(
          target.lobbyId,
          target.config,
          target.rules
        );
        updated++;
        const actual = await this.fetchTournamentConfig(target.lobbyId);
        assertTenhouRulesApplied(target.rules, actual);
        assertLobbySettingsPreserved(target.config, actual);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected Tenhou update failure";
      throw new Error(
        `Tenhou configuration failed after ${updated} of ${targets.length} lobby updates: ${message}`
      );
    }
  }

  /**
   * Updates the tournament member list via cmd_update.cgi.
   *
   * Requires the full config from `fetchTournamentConfig` so that all
   * existing settings are preserved. Only the MEMBER field is changed.
   *
   * @param lobbyId   The internal tournament ID, e.g. "C4853890996412598"
   * @param config    The current config from `fetchTournamentConfig`
   * @param members   The full list of player usernames to set
   */
  async updateTournamentMembers(
    lobbyId: string,
    config: TenhouTournamentConfig,
    members: string[]
  ): Promise<void> {
    await this.updateTournamentConfig(lobbyId, {
      ...config,
      MEMBER: members.join(","),
    });
  }

  private async updateTournamentConfig(
    lobbyId: string,
    current: TenhouTournamentConfig,
    rules?: TenhouRuleConfig
  ): Promise<void> {
    const config = validateTournamentConfig(current);
    assertTenhouConfigEditable(config);
    // Parse RULE: "202604082100,202605252300,0001,0,0,0,0"
    const ruleParts = config.RULE.split(",");
    const r0 = ruleParts[0]?.slice(0, 8) ?? ""; // date start: 20260408
    const r0t = ruleParts[0]?.slice(8) ?? ""; // time start: 2100
    const r1 = ruleParts[1]?.slice(0, 8) ?? ""; // date end:   20260525
    const r1t = ruleParts[1]?.slice(8) ?? ""; // time end:   2300
    const r2 = rules?.R2 ?? getTenhouRuleCode(config);
    const dan0 = ruleParts[3] ?? "0";
    const dan1 = ruleParts[4] ?? "0";
    const rate0 = ruleParts[5] ?? "0";
    const rate1 = ruleParts[6] ?? "0";

    const memberList = config.MEMBER.split(",").join("\n");

    const params = new URLSearchParams();
    params.set("L", lobbyId);
    params.set("EDITAUTH", config.EDITAUTH);
    params.set("T", config.TITLE);
    params.set("R0", r0);
    params.set("R0T", r0t);
    params.set("R1", r1);
    params.set("R1T", r1t);
    params.set("R2", r2);
    params.set("DAN0", dan0);
    params.set("DAN1", dan1);
    params.set("RATE0", rate0);
    params.set("RATE1", rate1);
    params.set("CSRULE", rules?.CSRULE ?? config.CSRULE ?? "");
    params.set("JOINFEE", config.JOINFEE ?? "");
    params.set("RANKING", config.RANKING);
    params.set("M", memberList);
    params.set("CM", config.CHATMEMBER.split(",").join("\n"));
    params.set("PW", "");
    params.set("DUPLICATABLESEED", config.DUPLICATABLESEED ?? "default");
    params.set("PREMIUMONLY", String(config.PREMIUMONLY ?? 0));
    params.set("CHATPREMIUMONLY", String(config.CHATPREMIUMONLY ?? 0));
    params.set("ENABLEJOINSAMEIP", String(config.ENABLEJOINSAMEIP ?? 1));
    params.set("DISABLEGUESTMATCH", String(config.DISABLEGUESTMATCH ?? 0));
    params.set("DISABLEGUESTID", String(config.DISABLEGUESTID ?? 0));
    params.set("DISABLEENDANNOUNCE", String(config.DISABLEENDANNOUNCE ?? 0));

    const body = params.toString();

    const res = await fetch(TenhouService.UPDATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "User-Agent": TenhouService.USER_AGENT,
        Referer: `https://tenhou.net/cs/edit/?${lobbyId}`,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(
        `Tenhou cmd_update.cgi returned ${res.status}`
      );
    }
    if ((await res.text()).trim() !== "OK") {
      throw new Error("Tenhou cmd_update.cgi did not acknowledge the update");
    }
  }
}

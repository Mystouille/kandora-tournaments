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
   * Starts a game in a Tenhou private lobby with the given players.
   *
   * @param lobbyId      The internal tournament ID, e.g. "C4853890996412598"
   * @param playerNames  Array of player usernames (exactly 4 for a standard game).
   * @param ruleCode     Game rule code, e.g. "0001" (default: "0001").
   * @returns `ok: true` if the game was started, `ok: false` with missing player names otherwise.
   */
  async startLobbyGame(
    lobbyId: string,
    playerNames: string[],
    ruleCode = "0001"
  ): Promise<{ ok: boolean; missingPlayers: string[] }> {
    const memberList = playerNames
      .map((n) => encodeURIComponent(n))
      .join("%0A");
    const body = `L=${lobbyId}&R2=${ruleCode}&M=${memberList}&RND=default&WG=1&PW=`;

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
        `Tenhou cmd_load.cgi returned ${res.status} for ${lobbyId}`
      );
    }

    const raw = (await res.text()).trim();

    // Strip JSONP wrapper: cs({...}); → {...}
    const match = raw.match(/^cs\((\{.*\})\);?$/s);
    if (!match) {
      throw new Error(`Unexpected cmd_load.cgi response format for ${lobbyId}`);
    }

    const parsed = JSON.parse(match[1]) as Record<string, unknown>;

    // Decode percent-encoded string values
    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        config[key] = decodeURIComponent(value);
      } else {
        config[key] = value;
      }
    }

    return config as unknown as TenhouTournamentConfig;
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
    // Parse RULE: "202604082100,202605252300,0001,0,0,0,0"
    const ruleParts = config.RULE.split(",");
    const r0 = ruleParts[0]?.slice(0, 8) ?? ""; // date start: 20260408
    const r0t = ruleParts[0]?.slice(8) ?? ""; // time start: 2100
    const r1 = ruleParts[1]?.slice(0, 8) ?? ""; // date end:   20260525
    const r1t = ruleParts[1]?.slice(8) ?? ""; // time end:   2300
    const r2 = ruleParts[2] ?? "0001"; // rule code
    const dan0 = ruleParts[3] ?? "0";
    const dan1 = ruleParts[4] ?? "0";
    const rate0 = ruleParts[5] ?? "0";
    const rate1 = ruleParts[6] ?? "0";

    const memberList = members.join("\n");

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
    params.set("CSRULE", "");
    params.set("JOINFEE", "");
    params.set("RANKING", config.RANKING);
    params.set("M", memberList);
    params.set("CM", config.CHATMEMBER);
    params.set("PW", "");
    params.set("DUPLICATABLESEED", "default");
    params.set("PREMIUMONLY", "0");
    params.set("CHATPREMIUMONLY", "0");
    params.set("ENABLEJOINSAMEIP", String(config.ENABLEJOINSAMEIP ?? 1));
    params.set("DISABLEGUESTMATCH", "0");
    params.set("DISABLEGUESTID", "0");
    params.set("DISABLEENDANNOUNCE", "0");

    const body = params.toString();

    const res = await fetch(TenhouService.UPDATE_URL, {
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
        `Tenhou cmd_update.cgi returned ${res.status} for ${lobbyId}`
      );
    }
  }
}

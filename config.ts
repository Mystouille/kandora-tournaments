import dotenv from "dotenv";

dotenv.config();

// ---------------------------------------------------------------------------
// Deployment — self-hosters run the app at the domain root. `BASE_PATH` lets
// you mount it under a sub-path (e.g. behind a shared reverse proxy).
// ---------------------------------------------------------------------------
export const basePath = process.env.BASE_PATH ?? "";

// ---------------------------------------------------------------------------
// Uploads — team / player pictures are written to a local directory. In
// production mount a persistent volume at `UPLOAD_DIR`, otherwise uploaded
// files live on ephemeral container disk and disappear on every redeploy.
// ---------------------------------------------------------------------------
export const uploadDir =
  process.env.UPLOAD_DIR ??
  (process.env.NODE_ENV === "production" ? "/data/uploads" : ".data/uploads");

// ---------------------------------------------------------------------------
// Kill-switch — external game-platform connectors (Majsoul, Riichi City,
// Tenhou). Set `PLATFORM_CONNECTORS_DISABLED=true` to force-disable them
// even when their env vars are configured.
// ---------------------------------------------------------------------------
export const platformConnectorsDisabled =
  process.env.PLATFORM_CONNECTORS_DISABLED === "true";

// ---------------------------------------------------------------------------
// Group 1 — Core (REQUIRED: app will not start without these)
// ---------------------------------------------------------------------------
const { MONGODB_URI, APP_BASE_URL, JWT_SECRET } = process.env;

if (!MONGODB_URI || !APP_BASE_URL || !JWT_SECRET) {
  throw new Error(
    "Missing required environment variables: MONGODB_URI, APP_BASE_URL, JWT_SECRET"
  );
}

export const coreConfig = {
  MONGODB_URI,
  APP_BASE_URL,
  JWT_SECRET,
} as const;

// ---------------------------------------------------------------------------
// Lazy-init helper: logs once per group on first access
// ---------------------------------------------------------------------------
function lazyGroup<T>(
  name: string,
  init: () => T | null,
  options?: { disabledByKillSwitch?: boolean }
): () => T | null {
  let cached: T | null | undefined;
  let resolved = false;
  return () => {
    if (!resolved) {
      resolved = true;
      if (options?.disabledByKillSwitch) {
        cached = null;
        console.log(
          `[Config] ${name}: disabled (PLATFORM_CONNECTORS_DISABLED=true)`
        );
      } else {
        cached = init();
        if (cached) {
          console.log(`[Config] ${name}: enabled`);
        } else {
          console.log(`[Config] ${name}: disabled (missing env vars)`);
        }
      }
    }
    return cached ?? null;
  };
}

// ---------------------------------------------------------------------------
// Group 2 — Discord OAuth (login). Disabled when client id/secret are missing.
// ---------------------------------------------------------------------------
export interface DiscordOAuthConfig {
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_REDIRECT_URI: string;
}

export const discordOAuthConfig = lazyGroup<DiscordOAuthConfig>(
  "Discord OAuth",
  () => {
    const id = process.env.VITE_DISCORD_CLIENT_ID;
    const secret = process.env.DISCORD_CLIENT_SECRET;
    if (!id || !secret) {
      return null;
    }
    return {
      DISCORD_CLIENT_ID: id,
      DISCORD_CLIENT_SECRET: secret,
      DISCORD_REDIRECT_URI: basePath + "/auth/discord/callback",
    };
  }
);

// ---------------------------------------------------------------------------
// Group 3 — Discord Bot. Disabled when token/client id are missing.
// ---------------------------------------------------------------------------
export interface DiscordBotConfig {
  DISCORD_BOT_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  SERVERS_JSON: string;
}

export const discordBotConfig = lazyGroup<DiscordBotConfig>(
  "Discord Bot",
  () => {
    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId = process.env.VITE_DISCORD_CLIENT_ID;
    if (!token || !clientId) {
      return null;
    }
    return {
      DISCORD_BOT_TOKEN: token,
      DISCORD_CLIENT_ID: clientId,
      SERVERS_JSON: process.env.SERVERS_JSON || "",
    };
  }
);

// ---------------------------------------------------------------------------
// Group 4 — Majsoul (optional — disables the Majsoul league agent)
// ---------------------------------------------------------------------------
export interface MajsoulConfig {
  MAJSOUL_UID: string;
  MAJSOUL_TOKEN: string;
}

export const majsoulConfig = lazyGroup<MajsoulConfig>(
  "Majsoul",
  () => {
    const uid = process.env.MAJSOUL_UID;
    const token = process.env.MAJSOUL_TOKEN;
    if (!uid || !token) {
      return null;
    }
    return { MAJSOUL_UID: uid, MAJSOUL_TOKEN: token };
  },
  { disabledByKillSwitch: platformConnectorsDisabled }
);

// ---------------------------------------------------------------------------
// Group 5 — Riichi City (optional — disables the RC connector)
// ---------------------------------------------------------------------------
export interface RiichiCityConfig {
  RIICHICITY_EMAIL: string;
  RIICHICITY_PASSWD: string;
  RIICHICITY_GUID: string;
}

export const riichiCityConfig = lazyGroup<RiichiCityConfig>(
  "Riichi City",
  () => {
    const email = process.env.RIICHICITY_EMAIL;
    const passwd = process.env.RIICHICITY_PASSWD;
    const guid = process.env.RIICHICITY_GUID;
    if (!email || !passwd || !guid) {
      return null;
    }
    return {
      RIICHICITY_EMAIL: email,
      RIICHICITY_PASSWD: passwd,
      RIICHICITY_GUID: guid,
    };
  },
  { disabledByKillSwitch: platformConnectorsDisabled }
);

// ---------------------------------------------------------------------------
// Group 6 — Translation / DeepL (optional — disables auto-translation)
// ---------------------------------------------------------------------------
export interface TranslationConfig {
  DEEPL_API_KEY: string;
}

export const translationConfig = lazyGroup<TranslationConfig>(
  "Translation (DeepL)",
  () => {
    const key = process.env.DEEPL_API_KEY;
    if (!key) {
      return null;
    }
    return { DEEPL_API_KEY: key };
  }
);

// ---------------------------------------------------------------------------
// Backward-compatible flat export (deprecated — migrate consumers gradually)
// ---------------------------------------------------------------------------
export const config = {
  ...coreConfig,
  DISCORD_CLIENT_ID: process.env.VITE_DISCORD_CLIENT_ID || "",
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || "",
  DISCORD_REDIRECT_URI: basePath + "/auth/discord/callback",
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || "",
  MAJSOUL_UID: process.env.MAJSOUL_UID || "",
  MAJSOUL_TOKEN: process.env.MAJSOUL_TOKEN || "",
  RIICHICITY_EMAIL: process.env.RIICHICITY_EMAIL || "",
  RIICHICITY_PASSWD: process.env.RIICHICITY_PASSWD || "",
  RIICHICITY_GUID: process.env.RIICHICITY_GUID || "",
  SERVERS_JSON: process.env.SERVERS_JSON || "",
};

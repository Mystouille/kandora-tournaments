import { discordBotConfig } from "config";

const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Discord message component (action row, button, etc.) JSON payload.
 * Loosely typed to avoid pulling discord.js builders into server-side code
 * that just shuttles JSON; callers should compose using `ActionRowBuilder`/
 * `ButtonBuilder` and serialize with `.toJSON()`.
 */
export type DiscordMessageComponent = Record<string, unknown>;

/** Error thrown when Discord returns 404 for a message lookup/edit/delete. */
export class DiscordMessageNotFoundError extends Error {
  constructor(channelId: string, messageId: string) {
    super(`Discord message ${messageId} not found in channel ${channelId}`);
    this.name = "DiscordMessageNotFoundError";
  }
}

/** Max retries when Discord returns 429 (rate limited) before giving up. */
const MAX_RATE_LIMIT_RETRIES = 5;
/** Upper bound on how long we'll wait for a single Retry-After hint (ms). */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Converts a 429 response's `Retry-After` hint into a bounded millisecond
 * delay. Falls back to 1s when the header is missing or malformed, adds a small
 * buffer to land just past the reset, and clamps to MAX_RETRY_AFTER_MS so a bad
 * value can't stall the bot indefinitely.
 */
function resolveRetryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number.parseFloat(header) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : 1_000;
  return Math.min(ms + 250, MAX_RETRY_AFTER_MS);
}

async function discordFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const botCfg = discordBotConfig();
  if (!botCfg) {
    throw new Error("Discord Bot is not configured");
  }
  const url = `${DISCORD_API_BASE}${endpoint}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bot ${botCfg.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    // Discord rate limits (especially message DELETE) are common when many
    // messages are removed in a row. Honor Retry-After and retry instead of
    // surfacing the 429 as a hard failure to callers.
    if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) {
      return res;
    }

    const waitMs = resolveRetryAfterMs(res);
    // Drain the body so the connection can be reused before we wait/retry.
    await res.text().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export async function sendChannelMessage(
  channelId: string,
  content: string,
  components?: DiscordMessageComponent[]
): Promise<{ id: string }> {
  const body: Record<string, unknown> = { content };
  if (components !== undefined) {
    body.components = components;
  }
  const res = await discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(
      `Failed to send message to channel ${channelId}: ${res.status} ${errorBody}`
    );
  }
  return res.json() as Promise<{ id: string }>;
}

export async function editChannelMessage(
  channelId: string,
  messageId: string,
  content: string,
  components?: DiscordMessageComponent[]
): Promise<void> {
  const body: Record<string, unknown> = { content };
  if (components !== undefined) {
    body.components = components;
  }
  const res = await discordFetch(
    `/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    if (res.status === 404) {
      throw new DiscordMessageNotFoundError(channelId, messageId);
    }
    const errorBody = await res.text().catch(() => "");
    throw new Error(
      `Failed to edit message ${messageId} in channel ${channelId}: ${res.status} ${errorBody}`
    );
  }
}

export async function deleteChannelMessage(
  channelId: string,
  messageId: string
): Promise<void> {
  const res = await discordFetch(
    `/channels/${channelId}/messages/${messageId}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 404) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(
      `Failed to delete message ${messageId} in channel ${channelId}: ${res.status} ${errorBody}`
    );
  }
}

/**
 * Delete several channel messages, tolerating targets that are already gone.
 * `deleteChannelMessage` treats 404 as success, so any throw here is a genuine
 * failure (permissions, 5xx, or exhausted rate-limit retries). Those are
 * retried once after a short pause; IDs that still fail are returned so callers
 * can log or surface them rather than silently leaving messages behind.
 */
export async function deleteChannelMessages(
  channelId: string,
  messageIds: string[]
): Promise<{ failed: string[] }> {
  const unique = [...new Set(messageIds)];
  const failed: string[] = [];

  for (const messageId of unique) {
    try {
      await deleteChannelMessage(channelId, messageId);
    } catch (error) {
      console.error(
        `deleteChannelMessages: failed to delete ${messageId} in ${channelId}; will retry:`,
        error
      );
      failed.push(messageId);
    }
  }

  if (failed.length === 0) {
    return { failed };
  }

  // One more pass for transient errors (5xx / rate-limit edges).
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  const stillFailed: string[] = [];
  for (const messageId of failed) {
    try {
      await deleteChannelMessage(channelId, messageId);
    } catch (error) {
      console.error(
        `deleteChannelMessages: retry failed to delete ${messageId} in ${channelId}:`,
        error
      );
      stillFailed.push(messageId);
    }
  }

  return { failed: stillFailed };
}

export async function fetchChannelMessage(
  channelId: string,
  messageId: string
): Promise<{ id: string; content: string } | null> {
  const res = await discordFetch(
    `/channels/${channelId}/messages/${messageId}`
  );
  if (!res.ok) {
    if (res.status === 404) {
      return null;
    }
    const errorBody = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch message ${messageId} in channel ${channelId}: ${res.status} ${errorBody}`
    );
  }
  return res.json() as Promise<{ id: string; content: string }>;
}

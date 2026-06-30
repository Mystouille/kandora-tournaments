import { Queue } from "bullmq";
import { getRedisConnection } from "./redisConnection.server";

let _discordSyncQueue: Queue | null = null;

export function getDiscordSyncQueue(): Queue {
  if (!_discordSyncQueue) {
    _discordSyncQueue = new Queue("discord-sync", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    _discordSyncQueue.on("error", (err) => {
      console.error("Discord sync queue error:", err);
    });
  }
  return _discordSyncQueue;
}

/** Repeating job key — used so re-scheduling is idempotent. */
export const DISCORD_SYNC_JOB_NAME = "discord-display-name-refresh";

/** How often to refresh `discordIdentity.displayName` from Discord. */
export const DISCORD_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

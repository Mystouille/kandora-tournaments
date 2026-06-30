import { connectToDatabase } from "~/utils/dbConnection.server";
import { LeagueService } from "~/services/LeagueService.server";
import { initDiscordBot } from "~/bot/client.server";
import { majsoulConfig, riichiCityConfig } from "config";
import {
  markReady,
  markSkipped,
  markFailed,
} from "~/services/readiness.server";
import { MahjongSoulConnector } from "~/api/majsoul/data/MajsoulConnector";
import { RiichiCityLeagueConnector } from "~/services/connectors/RiichiCityLeagueConnector.server";

let initialized = false;
let workerInitialized = false;
let schedulingWorkerInitialized = false;
let discordSyncWorkerInitialized = false;

/**
 * Initialize the BullMQ worker for league update jobs.
 * Should ideally run in a separate process.
 */
async function initLeagueWorker(): Promise<void> {
  if (workerInitialized) {
    return;
  }
  workerInitialized = true;

  try {
    // Only initialize worker if not in dev mode or if explicitly enabled
    if (
      process.env.ENABLE_INLINE_WORKER === "true" ||
      process.env.NODE_ENV === "production"
    ) {
      // Dynamically import to avoid requiring BullMQ in dev mode if worker runs separately
      const { leagueWorker: _leagueWorker } =
        await import("~/services/leagueWorker.server");
      markReady("league-worker", "inline worker started");
    } else {
      markSkipped("league-worker");
      console.log(
        "League worker not initialized inline (run 'npm run worker:league' in a separate terminal)"
      );
    }
  } catch (error) {
    markFailed("league-worker", String(error));
    console.error("Failed to initialize league worker:", error);
    workerInitialized = false;
  }
}

/**
 * Initialize the BullMQ worker for scheduling status polling.
 */
async function initSchedulingWorker(): Promise<void> {
  if (schedulingWorkerInitialized) {
    return;
  }
  schedulingWorkerInitialized = true;

  try {
    if (
      process.env.ENABLE_INLINE_WORKER === "true" ||
      process.env.NODE_ENV === "production"
    ) {
      const { schedulingWorker: _schedulingWorker } =
        await import("~/services/schedulingWorker.server");
      markReady("scheduling-worker", "inline scheduling worker started");

      // Recover orphaned scheduling jobs after startup
      await recoverOrphanedSchedulingJobs();
    } else {
      markSkipped("scheduling-worker");
    }
  } catch (error) {
    markFailed("scheduling-worker", String(error));
    console.error("Failed to initialize scheduling worker:", error);
    schedulingWorkerInitialized = false;
  }
}

/**
 * Initialize the BullMQ worker for daily Discord display-name refresh.
 */
async function initDiscordSyncWorker(): Promise<void> {
  if (discordSyncWorkerInitialized) {
    return;
  }
  discordSyncWorkerInitialized = true;

  try {
    if (
      process.env.ENABLE_INLINE_WORKER === "true" ||
      process.env.NODE_ENV === "production"
    ) {
      const { discordSyncWorker: _discordSyncWorker } =
        await import("~/services/discordSyncWorker.server");
      markReady("discord-sync-worker", "inline discord sync worker started");
    } else {
      markSkipped("discord-sync-worker");
    }
  } catch (error) {
    markFailed("discord-sync-worker", String(error));
    console.error("Failed to initialize Discord sync worker:", error);
    discordSyncWorkerInitialized = false;
  }
}

/**
 * Ensure a single repeatable job is scheduled to refresh
 * `discordIdentity.displayName` once per day.
 */
async function scheduleDiscordSync(): Promise<void> {
  try {
    const {
      getDiscordSyncQueue,
      DISCORD_SYNC_JOB_NAME,
      DISCORD_SYNC_INTERVAL_MS,
    } = await import("~/services/discordSyncQueue.server");
    const queue = getDiscordSyncQueue();

    // Idempotent: BullMQ deduplicates repeatable jobs by `repeat` opts.
    await queue.add(
      DISCORD_SYNC_JOB_NAME,
      {},
      { repeat: { every: DISCORD_SYNC_INTERVAL_MS }, jobId: "discord-sync" }
    );
    markReady("discord-sync-queue", "daily Discord sync scheduled");
  } catch (error) {
    markFailed("discord-sync-queue", String(error));
    console.error("Failed to schedule Discord sync job:", error);
  }
}

/**
 * Re-enqueue polling jobs for scheduling messages that are not yet completed
 * but have no corresponding job in the queue. This covers the gap where the
 * app crashes after a job finishes but before re-enqueue.
 */
async function recoverOrphanedSchedulingJobs(): Promise<void> {
  try {
    const { SchedulingMessageModel } = await import("~/db/SchedulingMessage");
    const { getSchedulingQueue } =
      await import("~/services/schedulingQueue.server");

    // Find all non-completed scheduling message batches (grouped by messageId)
    const pendingMsgs = await SchedulingMessageModel.find({
      status: { $in: ["upcoming", "in_progress"] },
    }).lean();

    if (pendingMsgs.length === 0) {
      return;
    }

    // Group by messageId to get unique batches
    const batches = new Map<string, string>();
    for (const msg of pendingMsgs) {
      if (!batches.has(msg.messageId)) {
        batches.set(msg.messageId, msg.league.toString());
      }
    }

    // Check which batches already have a job in the queue
    const queue = getSchedulingQueue();
    const [delayed, waiting, active] = await Promise.all([
      queue.getDelayed(),
      queue.getWaiting(),
      queue.getActive(),
    ]);

    const existingMessageIds = new Set(
      [...delayed, ...waiting, ...active].map((j) => j.data.messageId)
    );

    let recovered = 0;
    for (const [messageId, leagueId] of batches) {
      if (!existingMessageIds.has(messageId)) {
        await queue.add(
          `scheduling-poll:${leagueId}:${messageId}`,
          { leagueId, messageId },
          { delay: 5_000 }
        );
        recovered++;
      }
    }

    if (recovered > 0) {
      console.log(
        `[Scheduling] Recovered ${recovered} orphaned scheduling job(s)`
      );
    }
  } catch (error) {
    console.error("[Scheduling] Failed to recover orphaned jobs:", error);
  }
}

/**
 * Initialize platform connectors, League Service, and Discord bot.
 * Safe to call multiple times — only runs once.
 */
export async function initLeagueAgent(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;

  try {
    // Ensure DB connection is active
    await connectToDatabase();

    // Start league job scheduling if configured. Majsoul login is handled by worker.
    const mjCfg = majsoulConfig();
    if (mjCfg) {
      // Initialize Majsoul connector (WebSocket + Contest REST API)
      try {
        await MahjongSoulConnector.instance.init();
        markReady("majsoul-connector", "Majsoul connector initialized");
      } catch (error) {
        markFailed("majsoul-connector", String(error));
        console.warn(
          "[Majsoul] Connector init deferred (will retry):",
          (error as Error).message
        );
      }

      // Start the league update job queue
      await LeagueService.instance.InitLeague();
      markReady("league-queue", "league job scheduling active");

      // Re-evaluate league schedulers every 5 minutes so that newly-started
      // (and newly-ended) leagues are picked up without a server restart.
      setInterval(
        () => {
          LeagueService.instance.InitLeague().catch((err) => {
            console.error("[InitLeague] periodic re-evaluation failed:", err);
          });
        },
        5 * 60 * 1000
      );

      // Initialize the job worker (ideally in a separate process)
      await initLeagueWorker();

      // Initialize the scheduling status polling worker
      await initSchedulingWorker();

      // Initialize the Discord display-name sync worker and schedule its
      // daily repeatable job.
      await initDiscordSyncWorker();
      await scheduleDiscordSync();
    } else {
      markSkipped("league-queue");
      markSkipped("league-worker");
      markSkipped("majsoul-connector");
      console.log(
        "MAJSOUL_UID / MAJSOUL_TOKEN not configured — league agent disabled."
      );
    }

    // Initialize Riichi City connector (independent of Majsoul)
    const rcCfg = riichiCityConfig();
    if (rcCfg) {
      try {
        // Accessing the singleton triggers construction + lazy login on first use
        RiichiCityLeagueConnector.instance;
        markReady("riichicity-connector", "Riichi City connector initialized");
      } catch (error) {
        markFailed("riichicity-connector", String(error));
        console.error("Failed to initialize Riichi City connector:", error);
      }
    } else {
      markSkipped("riichicity-connector");
    }
  } catch (error) {
    markFailed("league-queue", String(error));
    markFailed("league-worker", String(error));
    console.error("Failed to initialize Majsoul/League:", error);
  }

  // Initialize Discord bot independently so it starts even if Majsoul fails
  try {
    await initDiscordBot();
  } catch (error) {
    markFailed("discord", String(error));
    markFailed("nanikiru", String(error));
    markFailed("emojis", String(error));
    console.error("Failed to initialize Discord bot:", error);
    initialized = false;
  }
}

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
 * Initialize the Majsoul API connector, League Service, and Discord bot.
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

      // Initialize the job worker (ideally in a separate process)
      await initLeagueWorker();

      // Initialize the scheduling status polling worker
      await initSchedulingWorker();
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

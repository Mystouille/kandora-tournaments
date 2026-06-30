import { Worker, type Job } from "bullmq";
import { majsoulConfig } from "config";
import { MahjongSoulConnector } from "~/api/majsoul/data/MajsoulConnector";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { LeagueService } from "./LeagueService.server";
import { getRedisConnection } from "./redisConnection.server";
import { trackEvent, trackError } from "./telemetry.server";
import { reconcileSchedulingJobs } from "./schedulingReconcile.server";

interface LeagueUpdateJob {
  leagueId: string;
}

let workerInitPromise: Promise<void> | null = null;

async function ensureWorkerInitialized(): Promise<void> {
  if (!workerInitPromise) {
    workerInitPromise = (async () => {
      await connectToDatabase();

      if (!majsoulConfig()) {
        throw new Error(
          "MAJSOUL_UID / MAJSOUL_TOKEN not configured for league worker"
        );
      }

      // Initialize connector if not already done (e.g. separate worker process)
      if (!MahjongSoulConnector.instance.isInitialized) {
        await MahjongSoulConnector.instance.init();
      }
    })().catch((error) => {
      workerInitPromise = null;
      throw error;
    });
  }

  await workerInitPromise;
}

const env = process.env.NODE_ENV === "production" ? "prod" : "dev";

export const leagueWorker = new Worker(
  "league-updates",
  async (job: Job<LeagueUpdateJob>) => {
    await ensureWorkerInitialized();
    const start = Date.now();
    try {
      const name = await LeagueService.instance.updateGamesInLeagueById(
        job.data.leagueId
      );
      trackEvent({
        type: "worker",
        env,
        method: "updateGames",
        path: name,
        durationMs: Date.now() - start,
        meta: { leagueId: job.data.leagueId },
      });
    } catch (error) {
      trackError(error, {
        env,
        method: "updateGames",
        leagueId: job.data.leagueId,
        durationMs: Date.now() - start,
      });
      throw error;
    }

    // Reconcile the scheduling poll queue against the sources of truth. Runs on
    // this resilient recurring job (off the scheduling-updates queue) so a
    // wedged scheduling job can't block self-healing. Best-effort: never fail
    // the league update because of a reconcile hiccup.
    try {
      await reconcileSchedulingJobs(job.data.leagueId);
    } catch (error) {
      trackError(error, {
        env,
        source: "reconcileSchedulingJobs",
        leagueId: job.data.leagueId,
      });
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: 1,
  }
);

leagueWorker.on("error", (err) => {
  trackError(err, { env, source: "leagueWorker" });
});

// Eagerly initialize DB + Majsoul so the first job doesn't wait
ensureWorkerInitialized().catch(() => {});

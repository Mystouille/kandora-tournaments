import { Queue } from "bullmq";
import { getRedisConnection } from "./redisConnection.server";

let _leagueQueue: Queue | null = null;

export function getLeagueQueue(): Queue {
  if (!_leagueQueue) {
    const connection = getRedisConnection();
    _leagueQueue = new Queue("league-updates", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    _leagueQueue.on("error", (err) => {
      console.error("League queue error:", err);
    });
  }
  return _leagueQueue;
}

export { getRedisConnection };

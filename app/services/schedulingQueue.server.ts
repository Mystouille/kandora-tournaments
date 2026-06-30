import { Queue } from "bullmq";
import { getRedisConnection } from "./redisConnection.server";

let _schedulingQueue: Queue | null = null;

export function getSchedulingQueue(): Queue {
  if (!_schedulingQueue) {
    _schedulingQueue = new Queue("scheduling-updates", {
      connection: getRedisConnection(),
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

    _schedulingQueue.on("error", (err) => {
      console.error("Scheduling queue error:", err);
    });
  }
  return _schedulingQueue;
}

export interface SchedulingPollJob {
  leagueId: string;
  /** The shared Discord message ID linking all SchedulingMessage docs in this batch. */
  messageId: string;
}

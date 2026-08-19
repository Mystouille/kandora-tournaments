import type { Job, JobType, Queue } from "bullmq";
import { getLeagueQueue } from "./queue.server";
import { getSchedulingQueue } from "./schedulingQueue.server";

const CANCELLABLE_JOB_TYPES: JobType[] = [
  "wait",
  "delayed",
  "paused",
  "prioritized",
  "waiting-children",
];

function belongsToLeague(job: Job, leagueId: string) {
  const jobLeagueId = job.data?.leagueId;
  return jobLeagueId != null && String(jobLeagueId) === leagueId;
}

async function removeQueuedLeagueJobs(queue: Queue, leagueId: string) {
  const jobs = await queue.getJobs(CANCELLABLE_JOB_TYPES, 0, -1, true);
  const leagueJobs = jobs.filter((job) => belongsToLeague(job, leagueId));
  await Promise.all(leagueJobs.map((job) => job.remove()));
  return leagueJobs.length;
}

export interface CancelLeagueTasksResult {
  removedLeagueUpdateJobs: number;
  removedSchedulingJobs: number;
}

export async function cancelLeagueTasks(
  leagueId: string
): Promise<CancelLeagueTasksResult> {
  const leagueQueue = getLeagueQueue();
  const schedulingQueue = getSchedulingQueue();

  await leagueQueue.removeJobScheduler(`league-update-repeat-${leagueId}`);
  const [removedLeagueUpdateJobs, removedSchedulingJobs] = await Promise.all([
    removeQueuedLeagueJobs(leagueQueue, leagueId),
    removeQueuedLeagueJobs(schedulingQueue, leagueId),
  ]);

  return { removedLeagueUpdateJobs, removedSchedulingJobs };
}
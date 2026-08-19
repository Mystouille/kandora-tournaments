import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  leagueQueue: {
    getJobs: vi.fn(),
    removeJobScheduler: vi.fn(),
  },
  schedulingQueue: {
    getJobs: vi.fn(),
  },
}));

vi.mock("./queue.server", () => ({
  getLeagueQueue: () => mocks.leagueQueue,
}));

vi.mock("./schedulingQueue.server", () => ({
  getSchedulingQueue: () => mocks.schedulingQueue,
}));

import { cancelLeagueTasks } from "./cancelLeagueTasks.server";

function queuedJob(leagueId: string) {
  return {
    data: { leagueId },
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

describe("cancelLeagueTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.leagueQueue.removeJobScheduler.mockResolvedValue(true);
  });

  it("removes the recurring scheduler and queued jobs for only that league", async () => {
    const leagueUpdate = queuedJob("league-1");
    const schedulingPoll = queuedJob("league-1");
    const otherLeagueUpdate = queuedJob("league-2");
    const otherSchedulingPoll = queuedJob("league-2");
    mocks.leagueQueue.getJobs.mockResolvedValue([
      leagueUpdate,
      otherLeagueUpdate,
    ]);
    mocks.schedulingQueue.getJobs.mockResolvedValue([
      schedulingPoll,
      otherSchedulingPoll,
    ]);

    await expect(cancelLeagueTasks("league-1")).resolves.toEqual({
      removedLeagueUpdateJobs: 1,
      removedSchedulingJobs: 1,
    });

    expect(mocks.leagueQueue.removeJobScheduler).toHaveBeenCalledWith(
      "league-update-repeat-league-1"
    );
    expect(leagueUpdate.remove).toHaveBeenCalledOnce();
    expect(schedulingPoll.remove).toHaveBeenCalledOnce();
    expect(otherLeagueUpdate.remove).not.toHaveBeenCalled();
    expect(otherSchedulingPoll.remove).not.toHaveBeenCalled();
  });

  it("searches every cancellable non-active job state", async () => {
    mocks.leagueQueue.getJobs.mockResolvedValue([]);
    mocks.schedulingQueue.getJobs.mockResolvedValue([]);

    await cancelLeagueTasks("league-1");

    const expectedTypes = [
      "wait",
      "delayed",
      "paused",
      "prioritized",
      "waiting-children",
    ];
    expect(mocks.leagueQueue.getJobs).toHaveBeenCalledWith(
      expectedTypes,
      0,
      -1,
      true
    );
    expect(mocks.schedulingQueue.getJobs).toHaveBeenCalledWith(
      expectedTypes,
      0,
      -1,
      true
    );
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  leagueExists: vi.fn(),
  schedulingMessageExists: vi.fn(),
}));

vi.mock("../core/models/tournament/League", () => ({
  LeagueModel: { exists: mocks.leagueExists },
}));

vi.mock("../core/models/tournament/SchedulingMessage", () => ({
  SchedulingMessageModel: { exists: mocks.schedulingMessageExists },
}));

import {
  canContinueLeagueTask,
  canContinueSchedulingPoll,
} from "./leagueTaskLifecycle.server";

describe("league task lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops a league task after its league is deleted", async () => {
    mocks.leagueExists.mockResolvedValue(null);

    await expect(canContinueLeagueTask("league-1")).resolves.toBe(false);
    expect(mocks.leagueExists).toHaveBeenCalledWith({ _id: "league-1" });
  });

  it("continues a scheduling poll only while its league and batch exist", async () => {
    mocks.leagueExists.mockResolvedValue({ _id: "league-1" });
    mocks.schedulingMessageExists.mockResolvedValue({ _id: "message-row" });

    await expect(
      canContinueSchedulingPoll("league-1", "message-1")
    ).resolves.toBe(true);
    expect(mocks.schedulingMessageExists).toHaveBeenCalledWith({
      league: "league-1",
      messageId: "message-1",
      status: { $in: ["upcoming", "in_progress"] },
    });
  });

  it("stops a poll when its scheduling batch was deleted", async () => {
    mocks.leagueExists.mockResolvedValue({ _id: "league-1" });
    mocks.schedulingMessageExists.mockResolvedValue(null);

    await expect(
      canContinueSchedulingPoll("league-1", "message-1")
    ).resolves.toBe(false);
  });
});
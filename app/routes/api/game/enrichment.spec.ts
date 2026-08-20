import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  findLiveGame: vi.fn(),
  findTeams: vi.fn(),
  findUsers: vi.fn(),
}));

vi.mock("~/utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("~/game/feature-gate", () => ({ isGameEnabled: () => true }));
vi.mock("~/core/models/tournament/LiveGame", () => ({
  LiveGameModel: { findOne: mocks.findLiveGame },
}));
vi.mock("~/core/models/tournament/Team", () => ({
  TeamModel: { find: mocks.findTeams },
}));
vi.mock("~/core/models/shared/User", () => ({
  UserModel: { find: mocks.findUsers },
}));

import { loader } from "./enrichment";

function selectedLean(value: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value),
    }),
  };
}

describe("game enrichment loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
  });

  it("falls back from a stale live user and includes finals rosters", async () => {
    const leagueId = new mongoose.Types.ObjectId();
    const placeholderId = new mongoose.Types.ObjectId();
    const gornId = new mongoose.Types.ObjectId();
    const finalsId = new mongoose.Types.ObjectId();
    mocks.findLiveGame.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        league: leagueId,
        players: [
          { seat: 0, nickname: "Gorn", userId: placeholderId },
          { seat: 1, nickname: "FinalsPlayer" },
        ],
      }),
    });
    mocks.findTeams.mockReturnValue(
      selectedLean([
        {
          displayName: "XiaMiko",
          roster: { captain: gornId, members: [gornId], substitutes: [] },
          finalsRoster: {
            captain: finalsId,
            members: [finalsId],
            substitutes: [],
          },
          pictures: { croppedPicture: "/xiamiko.png" },
        },
      ])
    );
    mocks.findUsers.mockReturnValue(
      selectedLean([
        { _id: gornId, tenhouIdentity: { name: "Gorn" } },
        { _id: finalsId, tenhouIdentity: { name: "FinalsPlayer" } },
      ])
    );

    const response = await loader({
      request: new Request(
        "http://localhost/api/game/enrichment?matchId=relay-match"
      ),
    });

    expect(await response.json()).toEqual({
      seats: [
        {
          seat: 0,
          playerName: "Gorn",
          teamName: "XiaMiko",
          teamLogoUrl: "/xiamiko.png",
        },
        {
          seat: 1,
          playerName: "FinalsPlayer",
          teamName: "XiaMiko",
          teamLogoUrl: "/xiamiko.png",
        },
      ],
    });
  });
});

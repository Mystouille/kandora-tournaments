import { describe, expect, it } from "vitest";
import { Types } from "mongoose";

import type { PlayerRankingScore } from "./regularRankingStrategies";
import {
  buildFactionGroupedSeedOrder,
  computeFactionQualifiedUsers,
  includeMissingFactionMembers,
} from "./factionQualification";

function player(
  userId: string,
  rankingScore: number,
  factionTeamId?: string,
  totalGamesPlayed = 3
): PlayerRankingScore {
  return {
    userId,
    rankingScore,
    factionTeamId,
    totalGamesPlayed,
    gamesCounted: totalGamesPlayed,
  };
}

describe("faction qualification", () => {
  it("applies the minimum-games gate, score/game/id ties, and per-faction limits", () => {
    const players = [
      player("under", 100, "one", 1),
      player("b", 20, "one", 3),
      player("a", 20, "one", 4),
      player("c", 10, "two"),
      player("solo", 100),
    ];
    expect([...computeFactionQualifiedUsers(players, 1, 2)]).toEqual([
      "a",
      "c",
    ]);
    expect([...computeFactionQualifiedUsers(players, 0)]).toEqual([]);
  });

  it("groups qualified factions by their best score without mutating the input", () => {
    const players = [
      player("a", 10, "one"),
      player("b", 30, "two"),
      player("c", 20, "one"),
      player("solo", 40),
    ];
    const result = buildFactionGroupedSeedOrder(
      players,
      new Set(["a", "b", "c", "solo"])
    );
    expect(result.map((row) => row.userId)).toEqual(["b", "c", "a", "solo"]);
    expect(players.map((row) => row.userId)).toEqual(["a", "b", "c", "solo"]);
  });

  it("adds unseen members/substitutes once and preserves already ranked rows", () => {
    const first = new Types.ObjectId();
    const second = new Types.ObjectId();
    const teamId = new Types.ObjectId();
    const ranked = player(first.toString(), 10, teamId.toString());
    const result = includeMissingFactionMembers(
      [ranked],
      [
        {
          _id: teamId,
          roster: {
            captain: first,
            members: [first, second],
            substitutes: [second],
          },
        },
      ]
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(ranked);
    expect(result[1]).toMatchObject({
      userId: second.toString(),
      rankingScore: 0,
    });
  });
});

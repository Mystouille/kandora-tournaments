import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import {
  collectReferencedUserIds,
  partitionGamesByReview,
  standaloneUserDeletionFilter,
} from "./deleteLeague.server";

function objectId(value: number) {
  return new mongoose.Types.ObjectId(value.toString(16).padStart(24, "0"));
}

describe("partitionGamesByReview", () => {
  it("preserves a game when its platform game ID has a review", () => {
    const reviewedGameId = objectId(1);
    const unreviewedGameId = objectId(2);

    expect(
      partitionGamesByReview(
        [
          { _id: reviewedGameId, gameId: "platform-reviewed" },
          { _id: unreviewedGameId, gameId: "platform-unreviewed" },
        ],
        ["platform-reviewed"]
      )
    ).toEqual({
      deleteIds: [unreviewedGameId.toString()],
      preserveIds: [reviewedGameId.toString()],
    });
  });

  it("deletes games without a platform ID when no review can reference them", () => {
    const gameId = objectId(3);

    expect(partitionGamesByReview([{ _id: gameId }], [])).toEqual({
      deleteIds: [gameId.toString()],
      preserveIds: [],
    });
  });
});

describe("collectReferencedUserIds", () => {
  it("collects and deduplicates league, roster, and result users", () => {
    const captain = objectId(11);
    const member = objectId(12);
    const substitute = objectId(13);

    expect(
      collectReferencedUserIds([
        { officialSubstitutes: [substitute] },
        {
          roster: {
            captain,
            members: [captain, member],
            substitutes: [substitute],
          },
        },
        { results: [{ userId: member, subId: substitute }] },
      ])
    ).toEqual([
      substitute.toString(),
      captain.toString(),
      member.toString(),
    ]);
  });
});

describe("standaloneUserDeletionFilter", () => {
  it("excludes registered, privileged, and cross-league users without protecting platform-only imports", () => {
    expect(standaloneUserDeletionFilter(["one", "two"], ["two"])).toEqual({
      _id: { $in: ["one", "two"], $nin: ["two"] },
      discordIdentity: { $exists: false },
      email: { $exists: false },
      passwordHash: { $exists: false },
      isAdmin: { $ne: true },
      isEditor: { $ne: true },
      isTNTMember: { $ne: true },
    });
  });
});
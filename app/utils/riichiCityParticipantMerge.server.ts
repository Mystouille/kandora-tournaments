import mongoose from "mongoose";
import { UserModel } from "~/db/User";
import { TeamModel } from "~/db/Team";
import { GameModel } from "~/db/Game";
import { RankingModel } from "~/db/Ranking";
import { ClubSessionModel } from "~/db/ClubSession";

/**
 * Merges a placeholder user (created from CSV with only name) into a confirmed user
 * (one who just registered their Riichi City ID).
 *
 * This consolidates:
 * - Team memberships
 * - Game results
 * - Rankings
 * - Club session participation
 */
export async function mergePlaceholderParticipant(
  confirmedUserId: mongoose.Types.ObjectId,
  placeholderName: string
) {
  const placeholderUser = await UserModel.findOne({
    name: { $regex: `^${placeholderName}$`, $options: "i" },
    riichiCityIdentity: { $exists: false },
  }).lean();

  if (!placeholderUser) {
    // No placeholder to merge
    return;
  }

  if (placeholderUser._id.toString() === confirmedUserId.toString()) {
    // Already the same user
    return;
  }

  const srcId = placeholderUser._id;
  const tgtId = confirmedUserId;

  // Update Game results
  await GameModel.updateMany(
    { "results.userId": srcId },
    { $set: { "results.$[elem].userId": tgtId } },
    { arrayFilters: [{ "elem.userId": srcId }] }
  );

  // Update Game substitution references
  await GameModel.updateMany(
    { "results.subId": srcId },
    { $set: { "results.$[elem].subId": tgtId } },
    { arrayFilters: [{ "elem.subId": srcId }] }
  );

  // Update Team roster captain
  await TeamModel.updateMany(
    { "roster.captain": srcId },
    { $set: { "roster.captain": tgtId } }
  );

  // Update Team roster members
  await TeamModel.updateMany(
    { "roster.members": srcId },
    { $set: { "roster.members.$[elem]": tgtId } },
    { arrayFilters: [{ elem: srcId }] }
  );

  // Update Team roster substitutes
  await TeamModel.updateMany(
    { "roster.substitutes": srcId },
    { $set: { "roster.substitutes.$[elem]": tgtId } },
    { arrayFilters: [{ elem: srcId }] }
  );

  // Update Team finalsRoster captain
  await TeamModel.updateMany(
    { "finalsRoster.captain": srcId },
    { $set: { "finalsRoster.captain": tgtId } }
  );

  // Update Team finalsRoster members
  await TeamModel.updateMany(
    { "finalsRoster.members": srcId },
    { $set: { "finalsRoster.members.$[elem]": tgtId } },
    { arrayFilters: [{ elem: srcId }] }
  );

  // Update Team finalsRoster substitutes
  await TeamModel.updateMany(
    { "finalsRoster.substitutes": srcId },
    { $set: { "finalsRoster.substitutes.$[elem]": tgtId } },
    { arrayFilters: [{ elem: srcId }] }
  );

  // Update Rankings
  await RankingModel.updateMany({ userId: srcId }, { $set: { userId: tgtId } });

  // Update ClubSession participants
  await ClubSessionModel.updateMany(
    { "participants.userId": srcId },
    { $set: { "participants.$[elem].userId": tgtId } },
    { arrayFilters: [{ "elem.userId": srcId }] }
  );

  // Delete the placeholder user
  await UserModel.findByIdAndDelete(srcId);

  console.log(
    `Merged placeholder user ${srcId} into ${tgtId} (Riichi City ID confirmation)`
  );
}

import mongoose from "mongoose";
import { UserModel, type User } from "~/db/User";
import { GameModel } from "~/db/Game";
import { TeamModel } from "~/db/Team";
import { RankingModel } from "~/db/Ranking";
import { ClubSessionModel } from "~/db/ClubSession";
import { connectToDatabase } from "./dbConnection.server";

export class AuthService {
  static async findOrCreateDiscordUser(discordData: {
    id: string;
    username: string;
    displayName?: string;
    avatarUrl?: string;
    isAdmin?: boolean;
    isEditor?: boolean;
  }): Promise<{
    success: boolean;
    user?: User;
    error?: string;
    isNewUser?: boolean;
  }> {
    try {
      await connectToDatabase();

      // Try to find existing user by Discord ID
      let user = await UserModel.findOne({
        "discordIdentity.id": discordData.id,
      });

      if (user) {
        // Update Discord-sourced fields. `user.name` is recomputed by the
        // User pre-save hook from firstName/lastName/discordIdentity.
        if (user.discordIdentity) {
          user.discordIdentity.displayName =
            discordData.displayName ?? discordData.username;
        }
        user.avatarUrl = discordData.avatarUrl;
        user.isAdmin = discordData.isAdmin ?? false;
        user.isEditor = discordData.isEditor ?? false;
        user.lastLogin = new Date();
        await user.save();
        return { success: true, user: user.toJSON() };
      }

      // Create new user (Discord-only). To merge with an existing
      // email-registered account, the user must use the explicit
      // "Link Discord" flow on their account page.
      user = new UserModel({
        discordIdentity: {
          id: discordData.id,
          displayName: discordData.displayName ?? discordData.username,
        },
        avatarUrl: discordData.avatarUrl,
        emailVerified: false,
        isAdmin: discordData.isAdmin ?? false,
        isEditor: discordData.isEditor ?? false,
        lastLogin: new Date(),
      });

      await user.save();

      return { success: true, user: user.toJSON(), isNewUser: true };
    } catch (error: unknown) {
      console.error("Discord user creation error:", error);
      return {
        success: false,
        error: "Authentication failed. Please try again.",
      };
    }
  }

  /**
   * Link a Discord account to an existing authenticated user.
   *
   * If another user already holds this Discord ID (e.g. a Discord-only
   * placeholder), attempt to merge them — but only when there are no
   * conflicting mahjong-soul / riichi-city identities.
   */
  static async linkDiscordToUser(
    currentUserId: string,
    discordData: {
      id: string;
      username: string;
      displayName?: string;
      avatarUrl?: string;
    }
  ): Promise<{
    success: boolean;
    error?: string;
    merged?: boolean;
  }> {
    try {
      await connectToDatabase();

      const currentUser = await UserModel.findById(currentUserId);
      if (!currentUser) {
        return { success: false, error: "Current user not found." };
      }

      if (currentUser.discordIdentity?.id) {
        return {
          success: false,
          error: "Your account is already linked to a Discord account.",
        };
      }

      // Check if another user already has this Discord ID
      const existingDiscordUser = await UserModel.findOne({
        "discordIdentity.id": discordData.id,
      });

      if (existingDiscordUser) {
        const existingId = existingDiscordUser._id.toString();
        if (existingId === currentUserId) {
          // Same user — shouldn't happen, but handle gracefully
          return { success: true };
        }

        // Check for identity conflicts before merging
        const conflicts: string[] = [];

        if (
          currentUser.majsoulIdentity &&
          existingDiscordUser.majsoulIdentity
        ) {
          if (
            currentUser.majsoulIdentity.friendId !==
            existingDiscordUser.majsoulIdentity.friendId
          ) {
            conflicts.push(
              `Mahjong Soul ID conflict: your account has ${currentUser.majsoulIdentity.friendId}, ` +
                `but the Discord account has ${existingDiscordUser.majsoulIdentity.friendId}.`
            );
          }
        }

        if (
          currentUser.riichiCityIdentity &&
          existingDiscordUser.riichiCityIdentity
        ) {
          if (
            currentUser.riichiCityIdentity.id !==
            existingDiscordUser.riichiCityIdentity.id
          ) {
            conflicts.push(
              `Riichi City ID conflict: your account has ${currentUser.riichiCityIdentity.id}, ` +
                `but the Discord account has ${existingDiscordUser.riichiCityIdentity.id}.`
            );
          }
        }

        if (conflicts.length > 0) {
          return {
            success: false,
            error:
              "Cannot link this Discord account because another user is already " +
              "associated with it and has conflicting platform identities. " +
              conflicts.join(" ") +
              " Please contact an admin for assistance.",
          };
        }

        // No conflicts — merge the Discord-only user into the current user
        await this.mergeUsers(currentUser._id, existingDiscordUser._id);
      }

      // Link Discord identity to the current user
      currentUser.discordIdentity = {
        id: discordData.id,
        displayName: discordData.displayName ?? discordData.username,
      };
      currentUser.avatarUrl = discordData.avatarUrl ?? currentUser.avatarUrl;
      await currentUser.save();

      console.log(
        `Linked Discord ${discordData.id} to user ${currentUserId}` +
          (existingDiscordUser ? " (merged)" : "")
      );

      return { success: true, merged: !!existingDiscordUser };
    } catch (error: unknown) {
      console.error("Discord link error:", error);
      return {
        success: false,
        error: "Failed to link Discord account. Please try again.",
      };
    }
  }

  /**
   * Merge sourceUser into targetUser: transfer all references, copy missing
   * profile fields, then delete sourceUser.
   */
  public static async mergeUsers(
    targetUserId: mongoose.Types.ObjectId,
    sourceUserId: mongoose.Types.ObjectId
  ) {
    const sourceUser = await UserModel.findById(sourceUserId);
    const targetUser = await UserModel.findById(targetUserId);
    if (!sourceUser || !targetUser) {
      return;
    }

    // Copy profile fields the target doesn't have yet
    if (!targetUser.firstName && sourceUser.firstName) {
      targetUser.firstName = sourceUser.firstName;
    }
    if (!targetUser.lastName && sourceUser.lastName) {
      targetUser.lastName = sourceUser.lastName;
    }
    if (!targetUser.majsoulIdentity && sourceUser.majsoulIdentity) {
      targetUser.majsoulIdentity = sourceUser.majsoulIdentity;
    }
    if (!targetUser.tenhouIdentity && sourceUser.tenhouIdentity) {
      targetUser.tenhouIdentity = sourceUser.tenhouIdentity;
    }
    if (!targetUser.riichiCityIdentity && sourceUser.riichiCityIdentity) {
      targetUser.riichiCityIdentity = sourceUser.riichiCityIdentity;
    }
    if (!targetUser.discordIdentity && sourceUser.discordIdentity) {
      targetUser.discordIdentity = sourceUser.discordIdentity;
    }
    // Preserve the source user's password so the merged account can still
    // log in via email
    if (!targetUser.passwordHash && sourceUser.passwordHash) {
      targetUser.passwordHash = sourceUser.passwordHash;
    }
    if (sourceUser.isAdmin) {
      targetUser.isAdmin = true;
    }
    await targetUser.save();

    await this.transferUserReferences(targetUserId, sourceUserId);
    console.log(
      `Merged user ${sourceUserId} into ${targetUserId} (Discord login email conflict)`
    );
  }

  /**
   * Transfer all foreign-key references from sourceUser to targetUser and
   * delete the source user. Does NOT touch any fields on the target user.
   * Use this when the source is a placeholder/dummy and you only want its
   * references migrated, not its profile data.
   */
  public static async transferUserReferences(
    targetUserId: mongoose.Types.ObjectId,
    sourceUserId: mongoose.Types.ObjectId
  ) {
    const srcId = sourceUserId;
    const tgtId = targetUserId;

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
    await RankingModel.updateMany(
      { userId: srcId },
      { $set: { userId: tgtId } }
    );

    // Update ClubSession participants
    await ClubSessionModel.updateMany(
      { "participants.userId": srcId },
      { $set: { "participants.$[elem].userId": tgtId } },
      { arrayFilters: [{ "elem.userId": srcId }] }
    );

    // Delete the source user
    await UserModel.findByIdAndDelete(sourceUserId);
  }
}

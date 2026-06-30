import mongoose from "mongoose";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { getAuthenticatedUser } from "../../../utils/jwt.server";
import { UserModel } from "~/db/User";
import { mergePlaceholderParticipant } from "~/utils/riichiCityParticipantMerge.server";
import { RiichiCityLeagueConnector } from "~/services/connectors/RiichiCityLeagueConnector.server";
import { AuthService } from "~/utils/auth.server";

/**
 * A "dummy" user is a placeholder with no real owner: no Discord identity
 * linked and no email registered. When a logged-in user tries to claim a
 * platform ID currently held by a dummy, we transfer all references from
 * the dummy to them and delete the dummy.
 */
function isDummyUser(user: {
  discordIdentity?: { id?: string } | null;
  email?: string | null;
}): boolean {
  return !user.discordIdentity?.id && !user.email;
}

/**
 * POST /api/auth/link-identity
 * Links a platform identity (Mahjong Soul or Riichi City) to the current user.
 * Does NOT require or touch firstName / lastName.
 */
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const body = await request.json();
    const { type, id } = body;

    if (!type || !id || typeof id !== "string" || !id.trim()) {
      return Response.json(
        { error: "type and id are required" },
        { status: 400 }
      );
    }

    const currentUser = await UserModel.findById(jwtPayload.sub).exec();
    if (!currentUser) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const trimmedId = id.trim();
    const updateData: Record<string, unknown> = {};

    if (type === "mahjongsoulId") {
      if (!/^\d+$/.test(trimmedId)) {
        return Response.json(
          { error: "Mahjong Soul ID must be a number" },
          { status: 400 }
        );
      }
      // Check uniqueness
      const existing = await UserModel.findOne({
        "majsoulIdentity.friendId": trimmedId,
        _id: { $ne: currentUser._id },
      });
      if (existing) {
        if (!isDummyUser(existing)) {
          return Response.json(
            {
              error:
                "This Mahjong Soul ID is already linked to another account.",
            },
            { status: 409 }
          );
        }
        await AuthService.transferUserReferences(currentUser._id, existing._id);
      }

      updateData.majsoulIdentity = {
        friendId: trimmedId,
        name: currentUser.firstName || currentUser.name || "",
        userId: "",
      };
    } else if (type === "riichiCityId") {
      if (!/^\d+$/.test(trimmedId)) {
        return Response.json(
          { error: "Riichi City ID must be a number" },
          { status: 400 }
        );
      }

      let userBrief;
      try {
        const riichiCityService = RiichiCityLeagueConnector.instance.service;
        userBrief = await riichiCityService.getUserBrief(Number(trimmedId));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown Riichi City error";

        if (message.includes("Missing Riichi City credentials")) {
          return Response.json(
            {
              error:
                "Riichi City lookup is not configured on the server. Please contact an admin.",
            },
            { status: 503 }
          );
        }

        return Response.json(
          { error: `Failed to fetch Riichi City user info: ${message}` },
          { status: 500 }
        );
      }

      if (userBrief.code !== 0 || !userBrief.data?.userID) {
        return Response.json(
          { error: userBrief.message || "Riichi City user not found" },
          { status: 404 }
        );
      }

      // Check uniqueness
      const existingRC = await UserModel.findOne({
        "riichiCityIdentity.id": trimmedId,
        _id: { $ne: currentUser._id },
      });
      if (existingRC) {
        if (!isDummyUser(existingRC)) {
          return Response.json(
            {
              error:
                "This Riichi City ID is already linked to another account.",
            },
            { status: 409 }
          );
        }
        await AuthService.transferUserReferences(
          currentUser._id,
          existingRC._id
        );
      }

      updateData.riichiCityIdentity = {
        id: trimmedId,
        name: userBrief.data.nickname || "",
      };

      const isFirstRiichiCityLink = !currentUser.riichiCityIdentity;
      if (isFirstRiichiCityLink) {
        try {
          await mergePlaceholderParticipant(
            new mongoose.Types.ObjectId(jwtPayload.sub),
            currentUser.name
          );
        } catch (mergeError) {
          console.warn("Placeholder merge failed (non-critical):", mergeError);
        }
      }
    } else if (type === "tenhouId") {
      // Tenhou usernames are plain strings — no numeric validation needed
      // Check uniqueness
      const existingTenhou = await UserModel.findOne({
        "tenhouIdentity.name": trimmedId,
        _id: { $ne: currentUser._id },
      });
      if (existingTenhou) {
        if (!isDummyUser(existingTenhou)) {
          return Response.json(
            {
              error:
                "This Tenhou username is already linked to another account.",
            },
            { status: 409 }
          );
        }
        await AuthService.transferUserReferences(
          currentUser._id,
          existingTenhou._id
        );
      }

      updateData.tenhouIdentity = {
        name: trimmedId,
      };
    } else {
      return Response.json(
        { error: `Unknown identity type: ${type}` },
        { status: 400 }
      );
    }

    const updatedUser = await UserModel.findByIdAndUpdate(
      jwtPayload.sub,
      updateData,
      { new: true }
    );

    return Response.json({
      success: true,
      mahjongsoulId: updatedUser?.majsoulIdentity?.friendId,
      riichiCityId: updatedUser?.riichiCityIdentity?.id,
      riichiCityName: updatedUser?.riichiCityIdentity?.name,
      tenhouId: updatedUser?.tenhouIdentity?.name,
    });
  } catch (error) {
    console.error("Link identity error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

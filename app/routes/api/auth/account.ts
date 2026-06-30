import { connectToDatabase } from "~/utils/dbConnection.server";
import { getAuthenticatedUser } from "../../../utils/jwt.server";
import { UserModel } from "~/db/User";

/**
 * POST /api/auth/account
 * Updates the current user's profile (name fields only).
 * For platform identity linking, use /api/auth/link-identity instead.
 */
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const body = await request.json();
    const { firstName, lastName, preferences } = body;

    // Allow preferences-only update (no name fields required)
    const isPreferencesOnly =
      preferences && firstName === undefined && lastName === undefined;

    if (
      !isPreferencesOnly &&
      (!firstName ||
        typeof firstName !== "string" ||
        firstName.trim().length < 2)
    ) {
      return Response.json(
        { error: "First name is required (min 2 characters)" },
        { status: 400 }
      );
    }

    const NAME_MAX_LENGTH = 50;
    if (!isPreferencesOnly) {
      if (firstName.trim().length > NAME_MAX_LENGTH) {
        return Response.json(
          { error: `First name must be at most ${NAME_MAX_LENGTH} characters` },
          { status: 400 }
        );
      }
      if (
        typeof lastName === "string" &&
        lastName.trim().length > NAME_MAX_LENGTH
      ) {
        return Response.json(
          { error: `Last name must be at most ${NAME_MAX_LENGTH} characters` },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};

    if (!isPreferencesOnly) {
      const trimmedFirst = firstName.trim();
      const trimmedLast = (lastName || "").trim();
      const name = trimmedLast
        ? `${trimmedFirst} ${trimmedLast.charAt(0).toUpperCase()}.`
        : trimmedFirst;

      updateData.firstName = trimmedFirst;
      updateData.lastName = trimmedLast;
      updateData.name = name;
    }

    if (preferences && typeof preferences === "object") {
      const VALID_TILE_SETS = ["default", "tenhou", "trainer"];
      if (
        preferences.tileSet &&
        VALID_TILE_SETS.includes(preferences.tileSet)
      ) {
        updateData["preferences.tileSet"] = preferences.tileSet;
      }
    }

    const updatedUser = await UserModel.findByIdAndUpdate(
      jwtPayload.sub,
      updateData,
      { new: true }
    );

    return Response.json({
      success: true,
      name: updatedUser?.name,
      firstName: updatedUser?.firstName,
      lastName: updatedUser?.lastName,
      preferences: updatedUser?.preferences,
    });
  } catch (error) {
    console.error("Account update error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

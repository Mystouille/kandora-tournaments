import { connectToDatabase } from "~/utils/dbConnection.server";
import { getAuthenticatedUser } from "~/utils/jwt.server";
import { identityLinkDeps } from "~/services/identityLinkDeps.server";
import { validatePlatformIdentity } from "~/db/services/identityLinking";

/**
 * POST /api/auth/validate-identity
 * Validates and fetches platform info for identity linking, without persisting
 * anything. Supports Mahjong Soul (`majsoulfId`) and Riichi City
 * (`riichiCityId`).
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
    const { type, id } = await request.json();
    const { status, body } = await validatePlatformIdentity(
      type,
      id,
      identityLinkDeps
    );
    return Response.json(body, { status });
  } catch (error) {
    console.error("Validation error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

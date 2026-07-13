import { connectToDatabase } from "~/utils/dbConnection.server";
import { getAuthenticatedUser } from "~/utils/jwt.server";
import { identityLinkDeps } from "~/services/identityLinkDeps.server";
import { linkPlatformIdentity } from "~/db/services/identityLinking";

/**
 * POST /api/auth/link-identity
 * Links a platform identity (Mahjong Soul / Riichi City / Tenhou) to the
 * current user. Does NOT require or touch firstName / lastName.
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
    const { status, body } = await linkPlatformIdentity(
      jwtPayload.sub,
      type,
      id,
      identityLinkDeps
    );
    return Response.json(body, { status });
  } catch (error) {
    console.error("Link identity error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { connectToDatabase } from "../../../utils/dbConnection.server";
import { UserModel } from "../../../db/User";
import { getAuthenticatedUser } from "../../../utils/jwt.server";
import { getServers } from "../../../config/servers";
import { getGuildMember } from "../../../utils/discord-guilds.server";

async function requireAdmin(
  request: Request
): Promise<{ error: Response } | { userId: string | undefined }> {
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select(
    "isAdmin discordIdentity"
  );
  if (!user?.isAdmin) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId: user.discordIdentity?.id };
}

/** GET /api/admin/discord-servers — list configured Discord servers the user is in */
export async function loader({ request }: { request: Request }) {
  const result = await requireAdmin(request);
  if ("error" in result) {
    return result.error;
  }

  try {
    const allServers = getServers();

    // If the user has a linked Discord account, only show servers they belong to
    let visibleServers = allServers;
    const discordUserId = result.userId;
    if (discordUserId) {
      const memberChecks = await Promise.all(
        allServers.map(async (s) => ({
          server: s,
          isMember: (await getGuildMember(s.id, discordUserId)) !== null,
        }))
      );
      visibleServers = memberChecks
        .filter((c) => c.isMember)
        .map((c) => c.server);
    }

    const servers = visibleServers.map((s) => ({
      id: s.id,
      name: s.name,
    }));

    return Response.json({ servers });
  } catch (error) {
    console.error("Failed to load Discord servers:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

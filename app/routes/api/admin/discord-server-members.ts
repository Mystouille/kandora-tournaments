import { connectToDatabase } from "../../../utils/dbConnection.server";
import { UserModel } from "../../../db/User";
import { getAuthenticatedUser } from "../../../utils/jwt.server";
import { fetchGuildMembers } from "../../../utils/discord-guilds.server";

async function requireAdmin(request: Request): Promise<Response | null> {
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select("isAdmin");
  if (!user?.isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * GET /api/admin/discord-server-members?serverId=...&search=...
 *
 * Returns Discord guild members matching the search string.
 * Used by the team import UI to let admins pick Discord users for unlinked players.
 */
export async function loader({ request }: { request: Request }) {
  const forbidden = await requireAdmin(request);
  if (forbidden) {
    return forbidden;
  }

  const url = new URL(request.url);
  const serverId = url.searchParams.get("serverId");
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();

  if (!serverId) {
    return Response.json(
      { error: "Missing query param: serverId" },
      { status: 400 }
    );
  }

  try {
    const members = await fetchGuildMembers(serverId);

    const filtered = members
      .filter((member: any) => {
        if (!member.user || member.user.bot) {
          return false;
        }
        if (!search) {
          return true;
        }
        const nick = (member.nick ?? "").toLowerCase();
        const username = (member.user.username ?? "").toLowerCase();
        const globalName = (member.user.global_name ?? "").toLowerCase();
        return (
          nick.includes(search) ||
          username.includes(search) ||
          globalName.includes(search)
        );
      })
      .map((member: any) => {
        const userId = member.user.id;
        const avatarUrl = member.avatar
          ? `https://cdn.discordapp.com/guilds/${serverId}/users/${userId}/avatars/${member.avatar}.png?size=64`
          : member.user.avatar
            ? `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png?size=64`
            : null;

        return {
          discordId: userId,
          username: member.user.username,
          displayName:
            member.nick ?? member.user.global_name ?? member.user.username,
          avatarUrl,
        };
      });

    return Response.json({ members: filtered });
  } catch (error) {
    console.error("Failed to fetch Discord server members:", error);
    return Response.json(
      { error: "Failed to fetch Discord server members" },
      { status: 500 }
    );
  }
}

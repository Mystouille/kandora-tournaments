import { connectToDatabase } from "../../utils/dbConnection.server";
import { UserModel } from "../../db/User";
import { LeagueModel, type League } from "../../db/League";
import { getAuthenticatedUser } from "../../utils/jwt.server";
import { isDiscordGuildAdmin } from "../../utils/discord-guilds.server";

/**
 * GET /api/online-tournaments/:id/can-edit
 *
 * Returns { canEdit: boolean } indicating whether the current user
 * may edit this league (edit presentation, import roster, etc.).
 *
 * A user can edit if they are a global admin OR an ADMINISTRATOR
 * of the Discord server linked to the league.
 */
export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ canEdit: false });
  }

  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select(
    "isAdmin discordIdentity"
  );

  if (!user) {
    return Response.json({ canEdit: false });
  }

  if (user.isAdmin) {
    return Response.json({ canEdit: true });
  }

  const discordId = user.discordIdentity?.id;
  if (!discordId) {
    return Response.json({ canEdit: false });
  }

  const league = await LeagueModel.findById(params.id)
    .select("discordConfig")
    .lean<Pick<League, "discordConfig">>();
  const serverId = league?.discordConfig?.serverId;
  if (!serverId) {
    return Response.json({ canEdit: false });
  }

  const isGuildAdmin = await isDiscordGuildAdmin(serverId, discordId);
  return Response.json({ canEdit: isGuildAdmin });
}

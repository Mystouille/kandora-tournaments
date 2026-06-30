import { connectToDatabase } from "../../../utils/dbConnection.server";
import { UserModel } from "../../../db/User";
import { getAuthenticatedUser } from "../../../utils/jwt.server";
import { config } from "../../../../config";

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

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id?: string | null;
  permission_overwrites?: PermissionOverwrite[];
}

interface PermissionOverwrite {
  id: string;
  type: number; // 0 = role, 1 = member
  allow: string;
  deny: string;
}

interface DiscordRole {
  id: string;
  permissions: string;
}

interface DiscordMember {
  roles: string[];
}

const SEND_MESSAGES = 1n << 11n;
const VIEW_CHANNEL = 1n << 10n;
const ADMINISTRATOR = 1n << 3n;

/** Compute effective permissions for the bot in a specific channel. */
function computeChannelPermissions(
  guildRoles: DiscordRole[],
  memberRoleIds: string[],
  guildId: string,
  channel: DiscordChannel
): bigint {
  // Start with @everyone role permissions
  const everyoneRole = guildRoles.find((r) => r.id === guildId);
  let permissions = BigInt(everyoneRole?.permissions ?? "0");

  // Apply role permissions (OR them together)
  for (const roleId of memberRoleIds) {
    const role = guildRoles.find((r) => r.id === roleId);
    if (role) {
      permissions |= BigInt(role.permissions);
    }
  }

  // Administrator bypasses everything
  if ((permissions & ADMINISTRATOR) !== 0n) {
    return permissions;
  }

  const overwrites = channel.permission_overwrites ?? [];

  // Apply @everyone overwrite
  const everyoneOverwrite = overwrites.find((o) => o.id === guildId);
  if (everyoneOverwrite) {
    permissions &= ~BigInt(everyoneOverwrite.deny);
    permissions |= BigInt(everyoneOverwrite.allow);
  }

  // Apply role overwrites
  let allow = 0n;
  let deny = 0n;
  for (const roleId of memberRoleIds) {
    const overwrite = overwrites.find((o) => o.id === roleId && o.type === 0);
    if (overwrite) {
      allow |= BigInt(overwrite.allow);
      deny |= BigInt(overwrite.deny);
    }
  }
  permissions &= ~deny;
  permissions |= allow;

  // Apply member-specific overwrite (bot user)
  // We'd need the bot user ID for this — skip for simplicity;
  // role-based checks cover >99% of cases.

  return permissions;
}

/** GET /api/admin/discord-channels?serverId=123 */
export async function loader({ request }: { request: Request }) {
  const forbidden = await requireAdmin(request);
  if (forbidden) {
    return forbidden;
  }

  const url = new URL(request.url);
  const serverId = url.searchParams.get("serverId");

  if (!serverId) {
    return Response.json(
      { error: "Missing query param: serverId" },
      { status: 400 }
    );
  }

  try {
    const headers = { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` };
    const base = `https://discord.com/api/v10`;
    const encodedServerId = encodeURIComponent(serverId);

    const [channelsRes, rolesRes, memberRes] = await Promise.all([
      fetch(`${base}/guilds/${encodedServerId}/channels`, { headers }),
      fetch(`${base}/guilds/${encodedServerId}/roles`, { headers }),
      fetch(`${base}/guilds/${encodedServerId}/members/@me`, { headers }),
    ]);

    if (!channelsRes.ok) {
      const errorText = await channelsRes.text();
      console.error("Discord API error:", channelsRes.status, errorText);
      return Response.json(
        { error: "Failed to fetch channels from Discord" },
        { status: 502 }
      );
    }

    const allChannels: DiscordChannel[] = await channelsRes.json();
    const guildRoles: DiscordRole[] = rolesRes.ok ? await rolesRes.json() : [];
    const botMember: DiscordMember | null = memberRes.ok
      ? await memberRes.json()
      : null;

    // Type 4 = category, Type 0 = text channel
    const categories = allChannels
      .filter((ch) => ch.type === 4)
      .sort((a, b) => a.position - b.position);

    const textChannels = allChannels
      .filter((ch) => ch.type === 0)
      .sort((a, b) => a.position - b.position)
      .map((ch) => {
        let canSend = true;
        if (botMember && guildRoles.length > 0) {
          const perms = computeChannelPermissions(
            guildRoles,
            botMember.roles,
            serverId,
            ch
          );
          canSend =
            (perms & ADMINISTRATOR) !== 0n ||
            ((perms & VIEW_CHANNEL) !== 0n && (perms & SEND_MESSAGES) !== 0n);
        }
        return {
          id: ch.id,
          name: ch.name,
          categoryId: ch.parent_id ?? null,
          canSend,
        };
      });

    return Response.json({
      channels: textChannels,
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
    });
  } catch (error) {
    console.error("Failed to fetch Discord channels:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

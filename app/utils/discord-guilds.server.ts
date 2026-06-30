import { discordBotConfig } from "config";
import { getServers, getMainServer, getAllServerIds } from "~/config/servers";

const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Fetch helper for the Discord bot API.
 */
async function discordBotFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const botCfg = discordBotConfig();
  if (!botCfg) {
    throw new Error("Discord Bot is not configured");
  }
  const url = `${DISCORD_API_BASE}${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bot ${botCfg.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

/**
 * Fetch all members from a single Discord guild.
 * Paginates automatically (1000 per page).
 */
export async function fetchGuildMembers(guildId: string): Promise<any[]> {
  const allMembers: any[] = [];
  let after = "0";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await discordBotFetch(
      `/guilds/${guildId}/members?limit=1000&after=${after}`
    );
    if (!res.ok) {
      console.error(
        `Failed to fetch members for guild ${guildId}: ${res.status}`
      );
      break;
    }
    const batch: any[] = await res.json();
    if (batch.length === 0) {
      break;
    }
    allMembers.push(...batch);
    after = batch[batch.length - 1].user.id;
    if (batch.length < 1000) {
      break;
    }
  }

  return allMembers;
}

/**
 * Get all guild members from ALL configured servers, grouped by guild.
 * Main server is returned first.
 */
export async function getAllGuildMembersByServer(): Promise<
  Array<{ guildId: string; members: any[] }>
> {
  const servers = getServers();
  const mainServer = getMainServer();

  const mainMembers = await fetchGuildMembers(mainServer.id);
  const result: Array<{ guildId: string; members: any[] }> = [
    { guildId: mainServer.id, members: mainMembers },
  ];

  const otherServers = servers.filter((s) => !s.isMain);
  for (const server of otherServers) {
    const members = await fetchGuildMembers(server.id);
    result.push({ guildId: server.id, members });
  }

  return result;
}

/**
 * Get all guild members from ALL configured servers.
 * Returns a flat array of Discord member objects.
 * Main server members come first (so they take priority when building maps).
 */
export async function getAllGuildMembers(): Promise<any[]> {
  const groups = await getAllGuildMembersByServer();
  return groups.flatMap((g) => g.members);
}

/**
 * Check if a Discord user is a member of any configured server.
 * Returns the member data from the first server where they are found,
 * or null if not found in any.
 */
export async function getGuildMemberFromAnyServer(
  discordUserId: string
): Promise<{ member: any; guildId: string } | null> {
  const serverIds = getAllServerIds();

  for (const guildId of serverIds) {
    const res = await discordBotFetch(
      `/guilds/${guildId}/members/${discordUserId}`
    );
    if (res.ok) {
      const member = await res.json();
      return { member, guildId };
    }
  }

  return null;
}

/**
 * Check if a Discord user is a member of a specific guild.
 * Returns the member data or null.
 */
export async function getGuildMember(
  guildId: string,
  discordUserId: string
): Promise<any | null> {
  const res = await discordBotFetch(
    `/guilds/${guildId}/members/${discordUserId}`
  );
  if (!res.ok) {
    return null;
  }
  return res.json();
}

/** Discord permission bit for ADMINISTRATOR */
const ADMINISTRATOR_BIT = BigInt(0x8);

/**
 * Check if a Discord user has ADMINISTRATOR permission in a guild.
 * Fetches the member's roles, then the guild's role definitions,
 * and checks if any assigned role carries the ADMINISTRATOR bit.
 */
export async function isDiscordGuildAdmin(
  guildId: string,
  discordUserId: string
): Promise<boolean> {
  try {
    const member = await getGuildMember(guildId, discordUserId);
    if (!member) {
      return false;
    }

    const memberRoleIds: string[] = member.roles ?? [];
    if (memberRoleIds.length === 0) {
      return false;
    }

    const rolesRes = await discordBotFetch(`/guilds/${guildId}/roles`);
    if (!rolesRes.ok) {
      return false;
    }

    const guildRoles: Array<{ id: string; permissions: string }> =
      await rolesRes.json();

    for (const role of guildRoles) {
      if (!memberRoleIds.includes(role.id)) {
        continue;
      }
      if (BigInt(role.permissions) & ADMINISTRATOR_BIT) {
        return true;
      }
    }
  } catch (err) {
    console.error("Failed to check Discord guild admin:", err);
  }

  return false;
}

export { discordBotFetch };

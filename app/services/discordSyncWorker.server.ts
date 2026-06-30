import { Worker, type Job } from "bullmq";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { getRedisConnection } from "./redisConnection.server";
import { trackError } from "./telemetry.server";
import { computeUserName, UserModel, type User } from "~/db/User";
import { getAllGuildMembersByServer } from "~/utils/discord-guilds.server";

const env = process.env.NODE_ENV === "production" ? "prod" : "dev";

interface DiscordMember {
  user?: {
    id?: string;
    username?: string;
    global_name?: string | null;
    avatar?: string | null;
  };
  nick?: string | null;
}

/**
 * Build the CDN URL for a Discord user avatar hash. Returns null when the
 * user has no custom avatar set (Discord falls back to a default avatar in
 * that case, which we don't want to persist).
 */
function buildAvatarUrl(member: DiscordMember): string | null {
  const id = member.user?.id;
  const hash = member.user?.avatar;
  if (!id || !hash) {
    return null;
  }
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`;
}

/**
 * Resolve the preferred display name for a Discord guild member, matching
 * the priority used elsewhere in the app: server nickname → global_name →
 * username.
 */
function resolveMemberDisplayName(member: DiscordMember): string | null {
  return (
    member.nick ?? member.user?.global_name ?? member.user?.username ?? null
  );
}

let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = connectToDatabase().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
}

/**
 * Compare a Mongo-stored guild map (could be a Mongoose Map after a normal
 * find, a plain object after `.lean()`, or undefined) with a freshly-built
 * plain object. Returns true if they hold the same keys and values.
 */
function guildMapsEqual(
  existing: unknown,
  next: Record<string, string>
): boolean {
  const existingObj: Record<string, string> = {};
  if (existing instanceof Map) {
    for (const [k, v] of existing as Map<string, string>) {
      existingObj[k] = v;
    }
  } else if (existing && typeof existing === "object") {
    Object.assign(existingObj, existing as Record<string, string>);
  }
  const existingKeys = Object.keys(existingObj);
  const nextKeys = Object.keys(next);
  if (existingKeys.length !== nextKeys.length) {
    return false;
  }
  for (const k of nextKeys) {
    if (existingObj[k] !== next[k]) {
      return false;
    }
  }
  return true;
}

/**
 * Refresh `discordIdentity.displayName`, `discordIdentity.guildDisplayNames`,
 * and the derived `name` for every user with a linked Discord identity.
 * Emits a single summary log line.
 */
export async function runDiscordSync(): Promise<{
  scanned: number;
  updated: number;
  missing: number;
}> {
  await ensureInitialized();

  const guildGroups = await getAllGuildMembersByServer();

  // Per-discord-id: first-occurrence member (main server first → priority for
  // the global `displayName` field), plus a per-guild map of resolved names.
  const memberByDiscordId = new Map<string, DiscordMember>();
  const guildNamesByDiscordId = new Map<string, Record<string, string>>();

  for (const { guildId, members } of guildGroups) {
    for (const raw of members as DiscordMember[]) {
      const id = raw.user?.id;
      if (!id) {
        continue;
      }
      if (!memberByDiscordId.has(id)) {
        memberByDiscordId.set(id, raw);
      }
      const resolved = resolveMemberDisplayName(raw);
      if (resolved) {
        let perGuild = guildNamesByDiscordId.get(id);
        if (!perGuild) {
          perGuild = {};
          guildNamesByDiscordId.set(id, perGuild);
        }
        perGuild[guildId] = resolved;
      }
    }
  }

  const users = await UserModel.find({
    "discordIdentity.id": { $exists: true },
  })
    .select("_id firstName lastName avatarUrl discordIdentity")
    .lean<User[]>();

  type BulkOp = {
    updateOne: {
      filter: { _id: User["_id"] };
      update: { $set: Record<string, unknown> };
    };
  };

  const bulkOps: BulkOp[] = [];
  let missing = 0;

  for (const user of users) {
    const discordId = user.discordIdentity?.id;
    if (!discordId) {
      continue;
    }
    const member = memberByDiscordId.get(discordId);
    if (!member) {
      missing++;
      continue;
    }
    const newDisplayName = resolveMemberDisplayName(member);
    const newGuildNames = guildNamesByDiscordId.get(discordId) ?? {};
    const newAvatarUrl = buildAvatarUrl(member);

    const displayNameChanged =
      !!newDisplayName && newDisplayName !== user.discordIdentity?.displayName;
    const guildMapChanged = !guildMapsEqual(
      (user.discordIdentity as any)?.guildDisplayNames,
      newGuildNames
    );
    const avatarChanged = !!newAvatarUrl && newAvatarUrl !== user.avatarUrl;

    if (!displayNameChanged && !guildMapChanged && !avatarChanged) {
      continue;
    }

    const $set: Record<string, unknown> = {};

    if (displayNameChanged) {
      $set["discordIdentity.displayName"] = newDisplayName;
      const synthetic: Pick<
        User,
        "firstName" | "lastName" | "discordIdentity"
      > = {
        firstName: user.firstName,
        lastName: user.lastName,
        discordIdentity: {
          ...user.discordIdentity!,
          displayName: newDisplayName,
        },
      };
      $set.name = computeUserName(synthetic);
    }

    if (guildMapChanged) {
      $set["discordIdentity.guildDisplayNames"] = newGuildNames;
    }

    if (avatarChanged) {
      $set.avatarUrl = newAvatarUrl;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: user._id },
        update: { $set },
      },
    });
  }

  if (bulkOps.length > 0) {
    await UserModel.bulkWrite(bulkOps);
  }

  const summary = {
    scanned: users.length,
    updated: bulkOps.length,
    missing,
  };
  console.log(
    `[DiscordSync] scanned=${summary.scanned} updated=${summary.updated} not-in-guild=${summary.missing}`
  );
  return summary;
}

export const discordSyncWorker = new Worker(
  "discord-sync",
  async (_job: Job) => {
    try {
      await runDiscordSync();
    } catch (error) {
      trackError(error, { env, source: "discordSyncWorker" });
      throw error;
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: 1,
  }
);

discordSyncWorker.on("error", (err) => {
  trackError(err, { env, source: "discordSyncWorker" });
});

import mongoose from "mongoose";
import type { League } from "../../../db/League";
import { LeagueModel, Platform } from "../../../db/League";
import { TeamModel } from "../../../db/Team";
import { UserModel } from "../../../db/User";
import { connectToDatabase } from "../../../utils/dbConnection.server";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";
import { createConnectorForLeague } from "../../../services/connectors/createConnectorForLeague.server";
import type { TeamEntry } from "../../../services/connectors/ILeagueTournamentConnector.server";
import { MahjongSoulConnector } from "~/api/majsoul/data/MajsoulConnector";
import { RiichiCityLeagueConnector } from "../../../services/connectors/RiichiCityLeagueConnector.server";

interface PlayerInRoster {
  userId: string;
  isSubstitute: boolean;
  isCaptain: boolean;
}

interface TeamPayload {
  /** Existing team _id, or null/undefined when creating a new team. */
  teamId?: string | null;
  simpleName: string;
  displayName: string;
  players: PlayerInRoster[];
}

interface PutBody {
  leagueId: string;
  teams: TeamPayload[];
  /** Players outside any team (only for individual leagues). */
  players?: PlayerInRoster[];
  /** Map of userId -> platform ID to set on the user document. */
  platformIdUpdates?: Record<string, string>;
  /** When true, push the resulting roster to the game platform. */
  syncToPlatform?: boolean;
}

interface ValidatePayload {
  intent: "validate-platform-id";
  platform: Platform;
  platformId: string;
}

interface FindOrCreatePayload {
  intent: "find-or-create-user";
  leagueId: string;
  platformId: string;
  /** Optional display name to use when creating a new user. Ignored when the user already exists. */
  nameOverride?: string;
}

interface CreateUnlinkedUserPayload {
  intent: "create-unlinked-user";
  leagueId: string;
  name: string;
}

interface PlatformLookupResult {
  ok: boolean;
  nickname?: string;
  accountId?: string;
  error?: string;
}

async function lookupPlatformId(
  platform: Platform,
  rawId: string
): Promise<PlatformLookupResult> {
  const id = rawId.trim();
  if (!id) {
    return { ok: false, error: "Empty platform ID" };
  }

  if (platform === Platform.MAJSOUL) {
    if (!/^\d+$/.test(id)) {
      return { ok: false, error: "Mahjong Soul ID must be numeric" };
    }
    try {
      await MahjongSoulConnector.instance.ensureInitialized();
      const info =
        await MahjongSoulConnector.instance.getUserInfoFromFriendId(id);
      if (info.nickname && info.accountId !== undefined) {
        return {
          ok: true,
          nickname: info.nickname,
          accountId: info.accountId.toString(),
        };
      }
      return { ok: false, error: "Mahjong Soul user not found" };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Lookup failed",
      };
    }
  }

  if (platform === Platform.RIICHICITY) {
    if (!/^\d+$/.test(id)) {
      return { ok: false, error: "Riichi City ID must be numeric" };
    }
    try {
      const resp =
        await RiichiCityLeagueConnector.instance.service.getUserBrief(
          Number(id)
        );
      if (resp.code === 0 && resp.data?.userID) {
        return {
          ok: true,
          nickname: resp.data.nickname ?? resp.data.name ?? "",
          accountId: String(resp.data.userID),
        };
      }
      return { ok: false, error: resp.message || "Riichi City user not found" };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Lookup failed",
      };
    }
  }

  if (platform === Platform.TENHOU) {
    return { ok: true, nickname: id, accountId: id };
  }

  return { ok: false, error: "Platform does not support ID lookup" };
}

function getUserPlatformId(user: any, platform: Platform): string | null {
  if (platform === Platform.MAJSOUL) {
    return user.majsoulIdentity?.friendId ?? null;
  }
  if (platform === Platform.RIICHICITY) {
    return user.riichiCityIdentity?.id ?? null;
  }
  if (platform === Platform.TENHOU) {
    return user.tenhouIdentity?.name ?? null;
  }
  return null;
}

function platformIdToAccountId(
  platformId: string,
  platform: Platform
): number | string {
  if (platform === Platform.TENHOU) {
    return platformId;
  }
  return Number(platformId);
}

/**
 * GET /api/admin/league-roster?leagueId=...
 *
 * Returns the current roster (teams + members + their platform IDs) for the
 * league, ready for editing.
 */
export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const leagueId = url.searchParams.get("leagueId");
  if (!leagueId) {
    return Response.json({ error: "Missing leagueId" }, { status: 400 });
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  await connectToDatabase();
  const league = await LeagueModel.findById(leagueId).lean<League>();
  if (!league) {
    return Response.json({ error: "League not found" }, { status: 404 });
  }

  const platform = league.platformConfig.platformName;
  const isTeamMode = league.rulesConfig.isTeamMode;

  const teams = await TeamModel.find({ leagueId: league._id })
    .select("_id simpleName displayName roster")
    .lean();

  const userIds = new Set<string>();
  for (const t of teams) {
    if (t.roster?.captain) {
      userIds.add(t.roster.captain.toString());
    }
    for (const id of t.roster?.members ?? []) {
      userIds.add(id.toString());
    }
    for (const id of t.roster?.substitutes ?? []) {
      userIds.add(id.toString());
    }
  }

  const users = await UserModel.find({
    _id: { $in: [...userIds] },
    isDeleted: { $ne: true },
  })
    .select(
      "_id name firstName lastName avatarUrl majsoulIdentity riichiCityIdentity tenhouIdentity"
    )
    .lean();

  const userMap = new Map<
    string,
    {
      _id: string;
      name: string;
      avatarUrl: string | null;
      platformId: string | null;
      platformDisplayName: string | null;
    }
  >();
  for (const u of users) {
    userMap.set(u._id.toString(), {
      _id: u._id.toString(),
      name: u.name,
      avatarUrl: u.avatarUrl ?? null,
      platformId: getUserPlatformId(u, platform),
      platformDisplayName:
        platform === Platform.MAJSOUL
          ? (u.majsoulIdentity?.name ?? null)
          : platform === Platform.RIICHICITY
            ? (u.riichiCityIdentity?.name ?? null)
            : platform === Platform.TENHOU
              ? (u.tenhouIdentity?.name ?? null)
              : null,
    });
  }

  const teamPayload = teams.map((t) => {
    const captainId = t.roster?.captain?.toString() ?? null;
    const members = (t.roster?.members ?? []).map((id) => id.toString());
    const substitutes = (t.roster?.substitutes ?? []).map((id) =>
      id.toString()
    );
    const playerEntries: Array<{
      userId: string;
      isSubstitute: boolean;
      isCaptain: boolean;
    }> = [];
    for (const m of members) {
      playerEntries.push({
        userId: m,
        isSubstitute: false,
        isCaptain: m === captainId,
      });
    }
    for (const s of substitutes) {
      playerEntries.push({
        userId: s,
        isSubstitute: true,
        isCaptain: s === captainId,
      });
    }
    return {
      _id: t._id.toString(),
      simpleName: t.simpleName,
      displayName: t.displayName,
      players: playerEntries,
    };
  });

  return Response.json({
    leagueId: league._id.toString(),
    leagueName: league.name,
    platform,
    isTeamMode,
    hasTournamentId: !!league.platformConfig.tournamentId,
    teams: teamPayload,
    users: [...userMap.values()],
  });
}

/**
 * POST /api/admin/league-roster — supports the following intents:
 *   - { intent: "validate-platform-id", platform, platformId }
 *
 * PUT /api/admin/league-roster — saves the new roster and (optionally)
 *   pushes it to the game platform.
 */
export async function action({ request }: { request: Request }) {
  if (request.method === "POST") {
    const body = (await request.json()) as
      ValidatePayload | FindOrCreatePayload | CreateUnlinkedUserPayload;

    if (body.intent === "validate-platform-id") {
      const result = await lookupPlatformId(
        body.platform,
        body.platformId ?? ""
      );
      return Response.json(result);
    }

    if (
      body.intent === "find-or-create-user" ||
      body.intent === "create-unlinked-user"
    ) {
      const auth = await requireLeagueAdmin(request, body.leagueId);
      if (!auth.authorized) {
        return auth.response;
      }
      await connectToDatabase();
      const league = await LeagueModel.findById(body.leagueId).lean<League>();
      if (!league) {
        return Response.json({ error: "League not found" }, { status: 404 });
      }
      const platform = league.platformConfig.platformName;

      if (body.intent === "create-unlinked-user") {
        const trimmedName = body.name.trim();
        if (!trimmedName) {
          return Response.json({ error: "Name is required" }, { status: 400 });
        }
        const newUser = await UserModel.create({ name: trimmedName });
        return Response.json({
          user: {
            _id: newUser._id.toString(),
            name: newUser.name,
            avatarUrl: null,
            platformId: null,
            platformDisplayName: null,
          },
          created: true,
        });
      }

      const lookup = await lookupPlatformId(platform, body.platformId);
      if (!lookup.ok) {
        return Response.json(
          { error: lookup.error ?? "Lookup failed" },
          { status: 400 }
        );
      }
      const platformIdStr = body.platformId.trim();

      // Find existing user
      let user;
      if (platform === Platform.MAJSOUL) {
        user = await UserModel.findOne({
          $or: [
            { "majsoulIdentity.friendId": platformIdStr },
            { "majsoulIdentity.userId": lookup.accountId },
          ],
          isDeleted: { $ne: true },
        }).exec();
      } else if (platform === Platform.RIICHICITY) {
        user = await UserModel.findOne({
          "riichiCityIdentity.id": lookup.accountId ?? platformIdStr,
          isDeleted: { $ne: true },
        }).exec();
      } else if (platform === Platform.TENHOU) {
        user = await UserModel.findOne({
          "tenhouIdentity.name": platformIdStr,
          isDeleted: { $ne: true },
        }).exec();
      }

      let created = false;
      if (!user) {
        const overrideName = body.nameOverride?.trim() || "";
        // The User pre-validate hook recomputes `name` from identities,
        // so we have to seed `firstName` (highest priority in
        // computeUserName) for the override to stick.
        const newUserData: Record<string, unknown> = {
          name: overrideName || lookup.nickname || platformIdStr,
        };
        if (overrideName) {
          newUserData.firstName = overrideName;
        }
        if (platform === Platform.MAJSOUL) {
          newUserData.majsoulIdentity = {
            friendId: platformIdStr,
            userId: lookup.accountId ?? platformIdStr,
            name: lookup.nickname || platformIdStr,
          };
        } else if (platform === Platform.RIICHICITY) {
          newUserData.riichiCityIdentity = {
            id: lookup.accountId ?? platformIdStr,
            name: lookup.nickname || platformIdStr,
          };
        } else if (platform === Platform.TENHOU) {
          newUserData.tenhouIdentity = { name: platformIdStr };
        }
        user = await UserModel.create(newUserData);
        created = true;
      }

      return Response.json({
        user: {
          _id: user._id.toString(),
          name: user.name,
          avatarUrl: user.get("avatarUrl") ?? null,
          platformId: getUserPlatformId(user, platform),
          platformDisplayName: lookup.nickname ?? null,
        },
        created,
      });
    }

    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }

  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as PutBody;
  const { leagueId, teams, platformIdUpdates, syncToPlatform } = body;
  if (!leagueId || !Array.isArray(teams)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  await connectToDatabase();
  const league = await LeagueModel.findById(leagueId).lean<League>();
  if (!league) {
    return Response.json({ error: "League not found" }, { status: 404 });
  }

  const platform = league.platformConfig.platformName;
  const isTeamMode = league.rulesConfig.isTeamMode;
  if (isTeamMode === false && teams.length > 0) {
    return Response.json(
      { error: "Cannot save teams for an individual league" },
      { status: 400 }
    );
  }

  // Snapshot existing teams once: used both to skip no-op writes and to
  // detect whether the platform-side team config actually needs to be
  // re-pushed.
  const existingTeams = isTeamMode
    ? await TeamModel.find({ leagueId: league._id })
        .select("_id simpleName displayName roster")
        .lean()
    : [];
  const existingTeamMap = new Map(
    existingTeams.map((t) => [t._id.toString(), t])
  );

  // Track which users had their platform ID changed (by us, here) — that
  // affects the platform team payload even if the team membership did not.
  const usersWithChangedPlatformId = new Set<string>();

  // 1. Apply platform ID updates on user documents, skipping any entry
  //    whose value matches the user's current ID (no external lookup, no
  //    DB write).
  if (platformIdUpdates) {
    const updateEntries = Object.entries(platformIdUpdates).filter(
      ([, raw]) => raw.trim().length > 0
    );

    if (updateEntries.length > 0) {
      const candidateIds = updateEntries.map(([userId]) => userId);
      const candidateUsers = await UserModel.find({
        _id: { $in: candidateIds },
      })
        .select(
          "_id name majsoulIdentity riichiCityIdentity tenhouIdentity avatarUrl"
        )
        .exec();
      const candidateMap = new Map(
        candidateUsers.map((u) => [u._id.toString(), u])
      );

      for (const [userId, rawPlatformId] of updateEntries) {
        const platformId = rawPlatformId.trim();
        const user = candidateMap.get(userId);
        if (!user) {
          continue;
        }
        const currentPlatformId = getUserPlatformId(user, platform);
        if (currentPlatformId === platformId) {
          // Field was rendered with the existing value but never edited —
          // nothing to do, and crucially no external API roundtrip.
          continue;
        }

        const lookup = await lookupPlatformId(platform, platformId);
        if (!lookup.ok) {
          return Response.json(
            {
              error: `Invalid platform ID "${platformId}" for user ${userId}: ${lookup.error}`,
            },
            { status: 400 }
          );
        }

        if (platform === Platform.MAJSOUL) {
          user.set("majsoulIdentity", {
            friendId: platformId,
            userId: lookup.accountId ?? platformId,
            name:
              lookup.nickname ?? user.get("majsoulIdentity.name") ?? user.name,
          });
        } else if (platform === Platform.RIICHICITY) {
          user.set("riichiCityIdentity", {
            id: lookup.accountId ?? platformId,
            name:
              lookup.nickname ??
              user.get("riichiCityIdentity.name") ??
              user.name,
          });
        } else if (platform === Platform.TENHOU) {
          user.set("tenhouIdentity", { name: platformId });
        }
        await user.save();
        usersWithChangedPlatformId.add(userId);
      }
    }
  }

  // 2. Save teams — only writing the ones whose payload actually differs
  //    from the stored doc. Track DB-only vs platform-relevant changes
  //    separately so we can skip platform sync when only captain / sub
  //    flags moved around.
  let anyTeamPlatformChange = false;

  if (isTeamMode) {
    const submittedTeamIds = new Set(
      teams.map((t) => t.teamId).filter((id): id is string => !!id)
    );

    // Delete teams that no longer exist
    const toDeleteIds = existingTeams
      .map((t) => t._id.toString())
      .filter((id) => !submittedTeamIds.has(id));
    if (toDeleteIds.length > 0) {
      await TeamModel.deleteMany({ _id: { $in: toDeleteIds } }).exec();
      anyTeamPlatformChange = true;
    }

    for (const teamPayload of teams) {
      const memberObjIds = teamPayload.players
        .filter((p) => !p.isSubstitute)
        .map((p) => new mongoose.Types.ObjectId(p.userId));
      const substituteObjIds = teamPayload.players
        .filter((p) => p.isSubstitute)
        .map((p) => new mongoose.Types.ObjectId(p.userId));
      const captain = teamPayload.players.find((p) => p.isCaptain);
      const fallbackCaptain = teamPayload.players[0];
      const captainId = captain?.userId ?? fallbackCaptain?.userId ?? null;

      if (!captainId) {
        // Empty team: drop existing doc (if any) and skip creation.
        if (teamPayload.teamId && existingTeamMap.has(teamPayload.teamId)) {
          await TeamModel.deleteOne({ _id: teamPayload.teamId }).exec();
          anyTeamPlatformChange = true;
        }
        continue;
      }

      const rosterDoc = {
        captain: new mongoose.Types.ObjectId(captainId),
        members: memberObjIds,
        substitutes: substituteObjIds,
      };

      const existing =
        teamPayload.teamId && existingTeamMap.has(teamPayload.teamId)
          ? existingTeamMap.get(teamPayload.teamId)!
          : null;

      if (!existing) {
        await TeamModel.create({
          simpleName: teamPayload.simpleName,
          displayName: teamPayload.displayName,
          leagueId: league._id,
          roster: rosterDoc,
        });
        anyTeamPlatformChange = true;
        continue;
      }

      const submittedMemberIds = memberObjIds.map((o) => o.toString());
      const submittedSubIds = substituteObjIds.map((o) => o.toString());
      const existingMemberIds = (existing.roster?.members ?? []).map((o) =>
        o.toString()
      );
      const existingSubIds = (existing.roster?.substitutes ?? []).map((o) =>
        o.toString()
      );
      const existingCaptain = existing.roster?.captain?.toString() ?? null;

      const sameSet = (a: string[], b: string[]) =>
        a.length === b.length && [...a].sort().join() === [...b].sort().join();
      const sameOrder = (a: string[], b: string[]) =>
        a.length === b.length && a.every((v, i) => v === b[i]);

      const nameChanged =
        existing.simpleName !== teamPayload.simpleName ||
        existing.displayName !== teamPayload.displayName;
      const captainChanged = existingCaptain !== captainId;
      const membersChanged = !sameOrder(existingMemberIds, submittedMemberIds);
      const subsChanged = !sameOrder(existingSubIds, submittedSubIds);
      const unionChanged = !sameSet(
        [...existingMemberIds, ...existingSubIds],
        [...submittedMemberIds, ...submittedSubIds]
      );

      if (!nameChanged && !captainChanged && !membersChanged && !subsChanged) {
        // Nothing changed for this team — skip the write entirely.
        continue;
      }

      await TeamModel.updateOne(
        { _id: teamPayload.teamId, leagueId: league._id },
        {
          $set: {
            simpleName: teamPayload.simpleName,
            displayName: teamPayload.displayName,
            roster: rosterDoc,
          },
        }
      ).exec();

      // Only the (members ∪ substitutes) set and the team name are
      // visible to the platform. Captain / member<->sub shuffles within
      // the same set are DB-only and don't justify a sync.
      if (nameChanged || unionChanged) {
        anyTeamPlatformChange = true;
      }
    }
  }

  // 3. Push to the game platform — gated on whether any platform-visible
  //    change actually occurred. A pure captain / sub-flag toggle skips
  //    the (often slow) platform call entirely.
  let platformSync:
    | { attempted: false; reason?: string }
    | { attempted: true; success: boolean; error?: string } = {
    attempted: false,
  };

  const needsPlatformSync =
    anyTeamPlatformChange || usersWithChangedPlatformId.size > 0;

  if (
    syncToPlatform &&
    league.platformConfig.tournamentId &&
    platform !== Platform.IRL
  ) {
    if (!needsPlatformSync) {
      platformSync = { attempted: false, reason: "no-platform-change" };
    } else {
      try {
        const connector = createConnectorForLeague(league);
        if (connector.setUsersInTeams) {
          // Re-load teams + users to compute the platform payload from the
          // freshly-saved DB state.
          const finalTeams = await TeamModel.find({ leagueId: league._id })
            .select("simpleName displayName roster")
            .lean();
          const allUserIds = new Set<string>();
          for (const t of finalTeams) {
            for (const id of t.roster?.members ?? []) {
              allUserIds.add(id.toString());
            }
            for (const id of t.roster?.substitutes ?? []) {
              allUserIds.add(id.toString());
            }
          }
          const finalUsers = await UserModel.find({
            _id: { $in: [...allUserIds] },
            isDeleted: { $ne: true },
          })
            .select(
              "_id name majsoulIdentity riichiCityIdentity tenhouIdentity"
            )
            .lean();
          const userIdToUser = new Map(
            finalUsers.map((u) => [u._id.toString(), u])
          );

          const teamEntries: TeamEntry[] = finalTeams
            .map((t) => {
              const allRosterIds = [
                ...(t.roster?.members ?? []),
                ...(t.roster?.substitutes ?? []),
              ].map((id) => id.toString());
              const members = allRosterIds
                .map((uid) => userIdToUser.get(uid))
                .filter(
                  (u): u is NonNullable<typeof u> =>
                    !!u && !!getUserPlatformId(u, platform)
                )
                .map((u) => {
                  const platformId = getUserPlatformId(u, platform)!;
                  // For Majsoul, the platform ID we store is a friend ID
                  // and the connector would otherwise resolve it to the
                  // real account ID via a (slow, sequential) WebSocket
                  // lookup. We already have the resolved value in
                  // `majsoulIdentity.userId`, so pass it through.
                  const resolvedAccountId =
                    platform === Platform.MAJSOUL && u.majsoulIdentity?.userId
                      ? Number(u.majsoulIdentity.userId)
                      : undefined;
                  return {
                    accountId: platformIdToAccountId(platformId, platform),
                    nickname: u.name,
                    ...(resolvedAccountId !== undefined &&
                    !Number.isNaN(resolvedAccountId)
                      ? { resolvedAccountId }
                      : {}),
                  } as TeamEntry["members"][number];
                });
              return {
                name: t.simpleName,
                members,
              };
            })
            // Only push teams that have at least one platform-ID-bearing
            // member: empty teams are not created on the platform, and
            // teams that lose all platform-ID players get removed (the
            // connector replaces the whole config).
            .filter((t) => t.members.length > 0);

          await connector.setUsersInTeams(
            league.platformConfig.tournamentId,
            teamEntries,
            { seasonId: league.platformConfig.seasonId ?? undefined }
          );
          platformSync = { attempted: true, success: true };
        }
      } catch (err) {
        platformSync = {
          attempted: true,
          success: false,
          error: err instanceof Error ? err.message : "Platform sync failed",
        };
      }
    }
  }

  return Response.json({ success: true, platformSync });
}

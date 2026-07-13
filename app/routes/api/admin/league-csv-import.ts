import mongoose from "mongoose";
import { UserModel } from "../../../db/User";
import { TeamModel } from "../../../db/Team";
import { LeagueModel, Platform, type League } from "../../../db/League";
import { fetchGuildMembers } from "../../../utils/discord-guilds.server";
import { MahjongSoulConnector } from "~/api/majsoul/data/MajsoulConnector";
import { RiichiCityLeagueConnector } from "../../../services/connectors/RiichiCityLeagueConnector.server";
import { createConnectorForLeague } from "../../../services/connectors/createConnectorForLeague.server";
import type { TeamEntry } from "../../../services/connectors/ILeagueTournamentConnector.server";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";

interface CsvRow {
  teamName: string;
  displayName: string;
  friendId: string;
  discordId: string;
  substitute: boolean;
}

function parseCsv(raw: string, isTeamMode: boolean): CsvRow[] {
  const rows: CsvRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split(",").map((p) => p.trim());

    if (isTeamMode) {
      // Format: teamName, displayName, friendId, discordId, [substitute]
      const subFlag = (parts[4] ?? "").toLowerCase();
      rows.push({
        teamName: parts[0] ?? "",
        displayName: parts[1] ?? "",
        friendId: parts[2] ?? "",
        discordId: parts[3] ?? "",
        substitute: ["sub", "true", "1", "yes", "s"].includes(subFlag),
      });
    } else {
      // Format: friendId, discordId, [substitute]
      const subFlag = (parts[2] ?? "").toLowerCase();
      rows.push({
        teamName: "",
        displayName: "",
        friendId: parts[0] ?? "",
        discordId: parts[1] ?? "",
        substitute: ["sub", "true", "1", "yes", "s"].includes(subFlag),
      });
    }
  }
  return rows;
}

/**
 * POST /api/admin/league-csv-import
 *
 * Two modes controlled by the `confirm` field:
 *
 * 1. Validation (confirm absent/false):
 *    Body: { leagueId, csv }
 *    Validates friend IDs and Discord IDs, returns a preview.
 *
 * 2. Confirmation (confirm: true):
 *    Body: { leagueId, csv, confirm: true }
 *    Re-validates, creates users, erases league teams, creates new teams in DB,
 *    and pushes teams to the game platform via setUsersInTeams.
 */
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { leagueId, csv, confirm, discordOverrides } = body as {
    leagueId: string;
    csv: string;
    confirm?: boolean;
    discordOverrides?: Record<
      string,
      {
        discordId: string;
        username: string;
        displayName: string;
        avatarUrl: string | null;
      }
    >;
  };

  if (!leagueId || !csv) {
    return Response.json({ error: "Missing leagueId or csv" }, { status: 400 });
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const league = await LeagueModel.findById(leagueId).lean<League>();
    if (!league) {
      return Response.json({ error: "League not found" }, { status: 404 });
    }

    const platform = league.platformConfig.platformName;
    const isTeamMode = league.rulesConfig.isTeamMode;
    const rows = parseCsv(csv, isTeamMode);

    if (rows.length === 0) {
      return Response.json({ error: "CSV is empty" }, { status: 400 });
    }

    // Validate friend IDs against the platform
    const validatedMembers: Array<{
      friendId: string;
      nickname: string | null;
      accountId: string | null;
      platformError: boolean;
      noPlatformId: boolean;
      teamName: string;
      csvDisplayName: string;
      discordId: string;
      discordValid: boolean | null;
      substitute: boolean;
      discordAvatarUrl: string | null;
      discordDisplayName: string | null;
      existingUser: {
        _id: string;
        name: string;
        firstName: string | null;
        lastName: string | null;
        discordId: string | null;
      } | null;
    }> = [];

    // Ensure Majsoul connector is ready before validation loop
    if (platform === Platform.MAJSOUL) {
      try {
        await MahjongSoulConnector.instance.ensureInitialized();
      } catch (err) {
        return Response.json(
          {
            error: `Majsoul connector is not available: ${err instanceof Error ? err.message : String(err)}`,
          },
          { status: 503 }
        );
      }
    }

    for (const row of rows) {
      let nickname: string | null = null;
      let accountId: string | null = null;
      let platformError = false;
      const noPlatformId = !row.friendId;

      if (!row.friendId) {
        // Player intentionally entered without a platform ID — not an error,
        // just flagged so the UI can show a warning and the platform push
        // step can skip them.
      } else if (platform === Platform.MAJSOUL) {
        try {
          const info =
            await MahjongSoulConnector.instance.getUserInfoFromFriendId(
              row.friendId
            );
          if (info.nickname && info.accountId !== undefined) {
            nickname = info.nickname;
            accountId = info.accountId.toString();
          } else {
            platformError = true;
          }
        } catch (err) {
          console.warn(
            `[CSV Import] Failed to look up Majsoul friendId ${row.friendId}:`,
            err instanceof Error ? err.message : err
          );
          platformError = true;
        }
      } else if (platform === Platform.RIICHICITY) {
        try {
          const resp =
            await RiichiCityLeagueConnector.instance.service.getUserBrief(
              Number(row.friendId)
            );
          if (resp.code === 0 && resp.data?.userID) {
            nickname = resp.data.nickname ?? resp.data.name ?? null;
            accountId = String(resp.data.userID);
          } else {
            platformError = true;
          }
        } catch {
          platformError = true;
        }
      } else if (platform === Platform.TENHOU) {
        // Tenhou usernames are self-reported — no server validation possible
        nickname = row.friendId;
        accountId = row.friendId;
      }

      validatedMembers.push({
        friendId: row.friendId,
        nickname,
        accountId,
        platformError,
        noPlatformId,
        teamName: row.teamName,
        csvDisplayName: row.displayName,
        discordId: row.discordId,
        substitute: row.substitute,
        discordValid: null,
        discordAvatarUrl: null,
        discordDisplayName: null,
        existingUser: null,
      });
    }

    // Validate Discord IDs against the tournament server
    const discordServerId = league.discordConfig?.serverId ?? null;
    if (discordServerId) {
      const discordIdsToCheck = validatedMembers
        .map((m) => m.discordId)
        .filter(Boolean);

      if (discordIdsToCheck.length > 0) {
        try {
          const guildMembers = await fetchGuildMembers(discordServerId);
          const guildMap = new Map<
            string,
            { avatarUrl: string | null; displayName: string }
          >();

          for (const member of guildMembers) {
            const userId = member.user?.id;
            if (userId) {
              const avatarUrl = member.avatar
                ? `https://cdn.discordapp.com/guilds/${discordServerId}/users/${userId}/avatars/${member.avatar}.png?size=64`
                : member.user.avatar
                  ? `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png?size=64`
                  : null;
              guildMap.set(userId, {
                avatarUrl,
                displayName:
                  member.nick ??
                  member.user.global_name ??
                  member.user.username,
              });
            }
          }

          for (const m of validatedMembers) {
            if (m.discordId) {
              const guildMember = guildMap.get(m.discordId);
              if (guildMember) {
                m.discordValid = true;
                m.discordAvatarUrl = guildMember.avatarUrl;
                m.discordDisplayName = guildMember.displayName;
              } else {
                m.discordValid = false;
              }
            }
          }
        } catch (err) {
          console.warn(
            "Failed to fetch Discord guild members for CSV import:",
            err
          );
        }
      }
    }

    // Cross-reference with existing DB users
    const allAccountIds = validatedMembers
      .map((m) => m.accountId)
      .filter(Boolean) as string[];

    if (allAccountIds.length > 0) {
      let existingUsers: Array<{
        _id: string;
        name: string;
        firstName?: string;
        lastName?: string;
        platformId: string;
        discordId?: string;
      }> = [];

      if (platform === Platform.MAJSOUL) {
        const users = await UserModel.find({
          "majsoulIdentity.userId": { $in: allAccountIds },
          isDeleted: { $ne: true },
        })
          .select("_id name firstName lastName majsoulIdentity discordIdentity")
          .lean();

        existingUsers = users.map((u: any) => ({
          _id: u._id.toString(),
          name: u.name,
          firstName: u.firstName ?? undefined,
          lastName: u.lastName ?? undefined,
          platformId: u.majsoulIdentity?.userId ?? "",
          discordId: u.discordIdentity?.id ?? undefined,
        }));
      } else if (platform === Platform.RIICHICITY) {
        const users = await UserModel.find({
          "riichiCityIdentity.id": { $in: allAccountIds },
          isDeleted: { $ne: true },
        })
          .select(
            "_id name firstName lastName riichiCityIdentity discordIdentity"
          )
          .lean();

        existingUsers = users.map((u: any) => ({
          _id: u._id.toString(),
          name: u.name,
          firstName: u.firstName ?? undefined,
          lastName: u.lastName ?? undefined,
          platformId: u.riichiCityIdentity?.id ?? "",
          discordId: u.discordIdentity?.id ?? undefined,
        }));
      } else if (platform === Platform.TENHOU) {
        const users = await UserModel.find({
          "tenhouIdentity.name": { $in: allAccountIds },
          isDeleted: { $ne: true },
        })
          .select("_id name firstName lastName tenhouIdentity discordIdentity")
          .lean();

        existingUsers = users.map((u: any) => ({
          _id: u._id.toString(),
          name: u.name,
          firstName: u.firstName ?? undefined,
          lastName: u.lastName ?? undefined,
          platformId: u.tenhouIdentity?.name ?? "",
          discordId: u.discordIdentity?.id ?? undefined,
        }));
      }
      const userByPlatformId = new Map<string, any>(
        existingUsers.map((u) => [u.platformId, u])
      );

      for (const m of validatedMembers) {
        if (m.accountId) {
          const existing = userByPlatformId.get(m.accountId);
          if (existing) {
            m.existingUser = {
              _id: existing._id,
              name: existing.name,
              firstName: existing.firstName ?? null,
              lastName: existing.lastName ?? null,
              discordId: existing.discordId ?? null,
            };
          }
        }
      }
    }

    // Fallback: look up unmatched members by Discord ID
    const unmatchedWithDiscord = validatedMembers.filter(
      (m) => !m.existingUser && m.discordId
    );
    if (unmatchedWithDiscord.length > 0) {
      const discordIds = unmatchedWithDiscord.map((m) => m.discordId);
      const usersByDiscord = await UserModel.find({
        "discordIdentity.id": { $in: discordIds },
        isDeleted: { $ne: true },
      })
        .select("_id name firstName lastName discordIdentity")
        .lean();

      const userByDiscordId = new Map(
        usersByDiscord.map((u: any) => [
          u.discordIdentity?.id as string,
          {
            _id: u._id.toString(),
            name: u.name as string,
            firstName: (u.firstName as string | undefined) ?? null,
            lastName: (u.lastName as string | undefined) ?? null,
            discordId: (u.discordIdentity?.id as string) ?? null,
          },
        ])
      );

      for (const m of unmatchedWithDiscord) {
        const existing = userByDiscordId.get(m.discordId);
        if (existing) {
          m.existingUser = existing;
        }
      }
    }

    // Group by team
    const teamMap = new Map<string, typeof validatedMembers>();
    for (const m of validatedMembers) {
      const key = m.teamName || "__no_team__";
      if (!teamMap.has(key)) {
        teamMap.set(key, []);
      }
      teamMap.get(key)!.push(m);
    }

    const teams = Array.from(teamMap.entries()).map(([name, members]) => ({
      name: name === "__no_team__" ? "" : name,
      members,
    }));

    // --- Confirmation mode: persist to DB and push to platform ---
    if (confirm) {
      const hasErrors = validatedMembers.some((m) => m.platformError);
      if (hasErrors) {
        return Response.json(
          { error: "Cannot confirm: some members have platform errors" },
          { status: 400 }
        );
      }

      let createdCount = 0;

      // Ensure all members have user documents
      for (const m of validatedMembers) {
        // Resolve Discord info: use override if provided, otherwise use CSV data
        const override = discordOverrides?.[m.friendId];
        const effectiveDiscordId =
          override?.discordId ?? (m.discordValid ? m.discordId : null);
        const effectiveDiscordDisplayName =
          override?.displayName ?? m.discordDisplayName ?? effectiveDiscordId;
        const effectiveDiscordAvatarUrl =
          override?.avatarUrl ?? m.discordAvatarUrl;

        if (m.existingUser) {
          // Update Discord identity if provided and not already set
          if (effectiveDiscordId && !m.existingUser.discordId) {
            await UserModel.findByIdAndUpdate(m.existingUser._id, {
              $set: {
                "discordIdentity.id": effectiveDiscordId,
                "discordIdentity.displayName":
                  effectiveDiscordDisplayName ?? effectiveDiscordId,
              },
            });
          }

          // Backfill firstName from CSV displayName when the user doesn't
          // have one yet — this lets a re-import fix users that were
          // previously created without an explicit display name.
          if (m.csvDisplayName) {
            const userDoc = await UserModel.findById(m.existingUser._id);
            if (userDoc && !userDoc.firstName?.trim()) {
              userDoc.firstName = m.csvDisplayName;
              await userDoc.save();
            }
          }

          // Link platform identity if the existing user doesn't have one yet
          if (m.accountId) {
            if (platform === Platform.MAJSOUL) {
              const user = await UserModel.findById(m.existingUser._id)
                .select("majsoulIdentity")
                .lean<{ majsoulIdentity?: { userId?: string } }>();
              if (!user?.majsoulIdentity?.userId) {
                await UserModel.findByIdAndUpdate(m.existingUser._id, {
                  $set: {
                    majsoulIdentity: {
                      userId: m.accountId,
                      friendId: m.friendId,
                      name: m.nickname,
                    },
                  },
                });
              }
            } else if (platform === Platform.RIICHICITY) {
              const user = await UserModel.findById(m.existingUser._id)
                .select("riichiCityIdentity")
                .lean<{ riichiCityIdentity?: { id?: string } }>();
              if (!user?.riichiCityIdentity?.id) {
                await UserModel.findByIdAndUpdate(m.existingUser._id, {
                  $set: {
                    riichiCityIdentity: {
                      id: m.accountId,
                      name: m.nickname,
                    },
                  },
                });
              }
            } else if (platform === Platform.TENHOU) {
              const user = await UserModel.findById(m.existingUser._id)
                .select("tenhouIdentity")
                .lean<{ tenhouIdentity?: { name?: string } }>();
              if (!user?.tenhouIdentity?.name) {
                await UserModel.findByIdAndUpdate(m.existingUser._id, {
                  $set: {
                    tenhouIdentity: {
                      name: m.accountId,
                    },
                  },
                });
              }
            }
          }

          // Re-save the user doc to trigger the pre-validate hook which
          // recomputes `name` from firstName / discord / platform identity.
          // The findByIdAndUpdate calls above bypass the hook, so users
          // previously stored as "Unknown" need this to be refreshed.
          if (m.existingUser.name === "Unknown") {
            const userDoc = await UserModel.findById(m.existingUser._id);
            if (userDoc) {
              await userDoc.save();
            }
          }

          continue;
        }

        // Create a new user with platform + discord identity
        const fallbackName =
          m.csvDisplayName ||
          m.nickname ||
          m.friendId ||
          effectiveDiscordDisplayName ||
          effectiveDiscordId ||
          "Unknown";
        const newUserData: Record<string, unknown> = {
          name: fallbackName,
        };

        // The User pre-validate hook recomputes `name` from firstName /
        // discordIdentity / platform identity. Persist the CSV-provided
        // display name as `firstName` so it takes priority over platform
        // nicknames in the canonical formula.
        if (m.csvDisplayName) {
          newUserData.firstName = m.csvDisplayName;
        }

        if (m.accountId) {
          if (platform === Platform.MAJSOUL) {
            newUserData.majsoulIdentity = {
              userId: m.accountId,
              friendId: m.friendId,
              name: m.nickname,
            };
          } else if (platform === Platform.RIICHICITY) {
            newUserData.riichiCityIdentity = {
              id: m.accountId,
              name: m.nickname,
            };
          } else if (platform === Platform.TENHOU) {
            newUserData.tenhouIdentity = {
              name: m.accountId,
            };
          }
        }

        if (m.discordId) {
          newUserData.discordIdentity = {
            id: effectiveDiscordId ?? m.discordId,
            displayName: effectiveDiscordDisplayName ?? m.discordId,
          };
          if (effectiveDiscordAvatarUrl) {
            newUserData.avatarUrl = effectiveDiscordAvatarUrl;
          }
        }

        const newUser = await UserModel.create(newUserData);
        m.existingUser = {
          _id: newUser._id.toString(),
          name: newUser.name ?? fallbackName,
          firstName: null,
          lastName: null,
          discordId: m.discordId || null,
        };
        createdCount++;
      }

      let officialSubUserIds: string[] = [];

      if (!isTeamMode) {
        // For non-team leagues, collect substitute players into officialSubstitutes
        officialSubUserIds = validatedMembers
          .filter((m) => m.substitute && m.existingUser?._id)
          .map((m) => m.existingUser!._id);

        if (officialSubUserIds.length > 0) {
          await LeagueModel.findByIdAndUpdate(league._id, {
            $addToSet: {
              officialSubstitutes: {
                $each: officialSubUserIds.map(
                  (id) => new mongoose.Types.ObjectId(id)
                ),
              },
            },
          }).exec();
        }
      }

      if (isTeamMode) {
        // Delete all existing teams for this league
        await TeamModel.deleteMany({ leagueId: league._id }).exec();

        // Clear existing official substitutes
        await LeagueModel.findByIdAndUpdate(league._id, {
          $set: { officialSubstitutes: [] },
        }).exec();

        // Create new Team documents in DB
        // Official substitutes (empty team name + substitute flag) go to league-level
        officialSubUserIds = [];

        for (const team of teams) {
          // Detect official substitutes: empty team name and all members are subs
          const isOfficialSubGroup =
            team.name === "" && team.members.every((m) => m.substitute);

          if (isOfficialSubGroup) {
            for (const m of team.members) {
              if (m.existingUser?._id) {
                officialSubUserIds.push(m.existingUser._id);
              }
            }
            continue;
          }

          const regularMembers = team.members
            .filter((m) => !m.substitute && m.existingUser?._id)
            .map((m) => m.existingUser!._id);
          const substituteMembers = team.members
            .filter((m) => m.substitute && m.existingUser?._id)
            .map((m) => m.existingUser!._id);

          const allIds = [...regularMembers, ...substituteMembers];
          if (allIds.length === 0) {
            continue;
          }

          await TeamModel.create({
            simpleName: team.name,
            displayName: team.name,
            leagueId: league._id,
            roster: {
              captain: new mongoose.Types.ObjectId(allIds[0]),
              members: regularMembers.map(
                (id) => new mongoose.Types.ObjectId(id)
              ),
              substitutes: substituteMembers.map(
                (id) => new mongoose.Types.ObjectId(id)
              ),
            },
          });
        }

        // Save official substitutes to the league
        if (officialSubUserIds.length > 0) {
          await LeagueModel.findByIdAndUpdate(league._id, {
            $addToSet: {
              officialSubstitutes: {
                $each: officialSubUserIds.map(
                  (id) => new mongoose.Types.ObjectId(id)
                ),
              },
            },
          }).exec();
        }
      }

      // Push to the game platform
      if (league.platformConfig.tournamentId) {
        const connector = createConnectorForLeague(league);

        // Add all players to the tournament on the platform
        if (connector.addPlayersToTournament) {
          const platform = league.platformConfig.platformName;
          const allPlayers = validatedMembers
            .filter((m) => m.accountId)
            .map((m) => ({
              accountId:
                platform === Platform.TENHOU ? m.friendId : Number(m.friendId),
              nickname: m.nickname ?? m.friendId,
            }));

          if (allPlayers.length > 0) {
            const seasonId = league.platformConfig.seasonId
              ? Number(league.platformConfig.seasonId)
              : undefined;
            await connector.addPlayersToTournament(
              league.platformConfig.tournamentId,
              allPlayers,
              { seasonId }
            );
          }
        }

        // For team-mode leagues, also set team configurations
        if (isTeamMode && connector.setUsersInTeams) {
          const teamEntries: TeamEntry[] = teams
            .filter((t) => t.members.length > 0)
            .filter(
              (t) => !(t.name === "" && t.members.every((m) => m.substitute))
            )
            .map((t) => ({
              name: t.name,
              members: t.members
                .filter((m) => m.accountId)
                .map((m) => ({
                  accountId: Number(m.friendId),
                  nickname: m.nickname ?? m.friendId,
                })),
            }));

          // Add official subs as a separate platform team
          if (officialSubUserIds.length > 0) {
            const officialSubMembers = validatedMembers.filter(
              (m) => m.substitute && !m.teamName && m.accountId
            );
            if (officialSubMembers.length > 0) {
              teamEntries.push({
                name: "Official Substitutes",
                members: officialSubMembers.map((m) => ({
                  accountId: Number(m.friendId),
                  nickname: m.nickname ?? m.friendId,
                })),
              });
            }
          }

          await connector.setUsersInTeams(
            league.platformConfig.tournamentId,
            teamEntries,
            { seasonId: league.platformConfig.seasonId ?? undefined }
          );
        }
      }

      return Response.json({
        success: true,
        teamsProcessed: isTeamMode ? teams.length : 0,
        playersProcessed: validatedMembers.length,
        usersCreated: createdCount,
        teamsUpdated: isTeamMode ? teams.length : 0,
        officialSubstitutesAdded: officialSubUserIds.length,
      });
    }

    // --- Validation mode: return preview ---
    return Response.json({
      leagueId: league._id.toString(),
      leagueName: league.name,
      platform,
      isTeamMode,
      discordServerId,
      teams,
    });
  } catch (error) {
    console.error("Failed to process CSV import:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to process CSV data",
      },
      { status: 500 }
    );
  }
}

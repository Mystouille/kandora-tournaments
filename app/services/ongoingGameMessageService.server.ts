import mongoose from "mongoose";
import { LeagueModel, type League, Platform } from "~/db/League";
import {
  OngoingGameMessageModel,
  type OngoingGameMessage,
  type OngoingGameMessagePlayer,
} from "~/db/OngoingGameMessage";
import { TeamModel } from "~/db/Team";
import { UserModel } from "~/db/User";
import { compositeDisplayName } from "~/components/import-teams/shared";
import {
  type ILeagueTournamentConnector,
  type OngoingGame,
  type OngoingGameStatus,
} from "./connectors/ILeagueTournamentConnector.server";
import { createConnectorForLeague } from "./connectors/createConnectorForLeague.server";
import {
  DiscordMessageNotFoundError,
  deleteChannelMessage,
  editChannelMessage,
  sendChannelMessage,
} from "./discordPublisher.server";
import {
  composeOngoingGameMessage,
  type RenderedPlayer,
} from "./ongoingGameMessageRenderer";

/**
 * Per-account info resolved from the league's User/Team graph, used to format
 * a player's display label in an ongoing-game message.
 */
interface AccountInfo {
  teamName?: string;
  /** Discord user id, if the user has a linked Discord identity. */
  discordId?: string;
  /** True when the user is a member of the league's Discord guild. */
  isInGuild: boolean;
  /** Composite name (firstName + last initial, falling back to `name`). */
  compositeName: string;
}

function platformAccountIdFromUser(
  platform: Platform,
  user: {
    majsoulIdentity?: { userId?: string };
    riichiCityIdentity?: { id?: string };
    tenhouIdentity?: { name?: string };
  }
): string | undefined {
  switch (platform) {
    case Platform.MAJSOUL:
      return user.majsoulIdentity?.userId;
    case Platform.RIICHICITY:
      return user.riichiCityIdentity?.id;
    case Platform.TENHOU:
      return user.tenhouIdentity?.name;
    default:
      return undefined;
  }
}

/**
 * Returns true when the user has a Discord nickname stored for the given
 * guild — our marker that they are a member of that guild.
 */
function isUserInGuild(
  guildDisplayNames:
    | Map<string, string>
    | Record<string, string>
    | null
    | undefined,
  guildId: string
): boolean {
  if (!guildDisplayNames) {
    return false;
  }
  if (guildDisplayNames instanceof Map) {
    return guildDisplayNames.has(guildId);
  }
  return Object.prototype.hasOwnProperty.call(guildDisplayNames, guildId);
}

/**
 * Builds a map from platform-native accountId to per-user info (team name,
 * Discord identity, composite name) for users with a matching platform
 * identity. Used to format ongoing-game player rows.
 */
async function buildAccountInfoMap(
  league: League
): Promise<Map<string, AccountInfo>> {
  const result = new Map<string, AccountInfo>();
  const platform = league.platformConfig.platformName as Platform;
  const guildId = league.discordConfig?.serverId ?? null;

  const platformIdField =
    platform === Platform.MAJSOUL
      ? "majsoulIdentity.userId"
      : platform === Platform.RIICHICITY
        ? "riichiCityIdentity.id"
        : platform === Platform.TENHOU
          ? "tenhouIdentity.name"
          : null;
  if (!platformIdField) {
    return result;
  }

  // userId -> teamName (only relevant in team-mode leagues; empty otherwise).
  const userIdToTeamName = new Map<string, string>();
  if (league.rulesConfig.isTeamMode) {
    const teams = await TeamModel.find({ leagueId: league._id })
      .lean<
        Array<{
          displayName: string;
          roster?: { members?: unknown[]; substitutes?: unknown[] };
          finalsRoster?: {
            members?: unknown[];
            substitutes?: unknown[];
          } | null;
        }>
      >()
      .exec();
    for (const team of teams) {
      const collect = (ids: unknown[] | undefined) => {
        if (!ids) {
          return;
        }
        for (const id of ids) {
          if (id) {
            userIdToTeamName.set(String(id), team.displayName);
          }
        }
      };
      collect(team.roster?.members);
      collect(team.roster?.substitutes);
      collect(team.finalsRoster?.members);
      collect(team.finalsRoster?.substitutes);
    }
  }

  // Resolve every User that has the relevant platform identity. We don't
  // restrict to team members here so non-team leagues still get Discord
  // mentions and composite names.
  const users = await UserModel.find({
    [platformIdField]: { $exists: true, $ne: null },
  })
    .select({
      name: 1,
      firstName: 1,
      lastName: 1,
      majsoulIdentity: 1,
      riichiCityIdentity: 1,
      tenhouIdentity: 1,
      discordIdentity: 1,
    })
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId;
        name: string;
        firstName?: string | null;
        lastName?: string | null;
        majsoulIdentity?: { userId?: string };
        riichiCityIdentity?: { id?: string };
        tenhouIdentity?: { name?: string };
        discordIdentity?: {
          id?: string;
          guildDisplayNames?:
            | Map<string, string>
            | Record<string, string>
            | null;
        } | null;
      }>
    >()
    .exec();

  for (const user of users) {
    const accountId = platformAccountIdFromUser(platform, user);
    if (!accountId) {
      continue;
    }
    result.set(String(accountId), {
      teamName: userIdToTeamName.get(user._id.toString()),
      discordId: user.discordIdentity?.id,
      isInGuild: guildId
        ? isUserInGuild(user.discordIdentity?.guildDisplayNames, guildId)
        : false,
      compositeName: compositeDisplayName({
        name: user.name,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
      }),
    });
  }
  return result;
}

/**
 * Formats the player's display label per spec:
 *  - `<@discordId> (PlatformUsername)` when the user is a member of the
 *    league's Discord guild;
 *  - `CompositeName (PlatformUsername)` when we know the user but they
 *    are not on the guild;
 *  - `PlatformUsername` (or accountId fallback) when no User matched.
 */
function formatPlayerDisplayLabel(
  accountId: string,
  platformNickname: string | undefined,
  info: AccountInfo | undefined
): string {
  const platformPart = platformNickname ?? accountId;
  if (!info) {
    return platformPart;
  }
  if (info.isInGuild && info.discordId) {
    return `<@${info.discordId}> (${platformPart})`;
  }
  return `${info.compositeName} (${platformPart})`;
}

function enrichPlayers(
  game: OngoingGame,
  accountInfo: Map<string, AccountInfo>
): RenderedPlayer[] {
  return game.players.map((p) => {
    const accountId = String(p.accountId);
    const info = accountInfo.get(accountId);
    return {
      accountId,
      nickname: p.nickname,
      teamName: info?.teamName,
      displayLabel: formatPlayerDisplayLabel(accountId, p.nickname, info),
    };
  });
}

interface ConnectorCapabilities {
  supportsPause: boolean;
  supportsResume: boolean;
  supportsTerminate: boolean;
}

function getCapabilities(
  connector: ILeagueTournamentConnector
): ConnectorCapabilities {
  return {
    supportsPause: typeof connector.pauseGame === "function",
    supportsResume: typeof connector.resumeGame === "function",
    supportsTerminate: typeof connector.terminateGame === "function",
  };
}

/** Drops the doc when the underlying Discord message is gone (404). */
async function autoHealMissingMessage(
  doc: { _id: mongoose.Types.ObjectId },
  context: string,
  error: unknown
): Promise<boolean> {
  if (error instanceof DiscordMessageNotFoundError) {
    console.warn(
      `OngoingGameMessage ${doc._id}: ${context} target missing on Discord — dropping doc for re-creation.`
    );
    await OngoingGameMessageModel.deleteOne({ _id: doc._id }).exec();
    return true;
  }
  return false;
}

/**
 * Build a deterministic signature for the user-visible state of an
 * ongoing-game message: status + sorted-by-accountId player rows. Used
 * to skip Discord edits when nothing observable has changed since the
 * previous poll.
 */
function ongoingGameSignature(
  status: OngoingGameStatus,
  players: RenderedPlayer[]
): string {
  const sorted = players
    .slice()
    .sort((a, b) => a.accountId.localeCompare(b.accountId))
    .map(
      (p) =>
        `${p.accountId}|${p.displayLabel ?? ""}|${p.teamName ?? ""}|${p.nickname ?? ""}`
    )
    .join(";");
  return `${status}::${sorted}`;
}

function hasOngoingGameChanged(
  doc: OngoingGameMessage,
  liveStatus: OngoingGameStatus,
  livePlayers: RenderedPlayer[]
): boolean {
  const previous = ongoingGameSignature(
    doc.renderedStatus as OngoingGameStatus,
    doc.players.map((p) => ({
      accountId: p.accountId,
      nickname: p.nickname ?? undefined,
      displayLabel: p.displayLabel,
      teamName: p.teamName ?? undefined,
    }))
  );
  const next = ongoingGameSignature(liveStatus, livePlayers);
  return previous !== next;
}

/**
 * Reconciles ongoing-game admin-channel messages for a league against the
 * platform's live game list:
 *  - new live games → send a fresh message + persist a doc;
 *  - existing games whose status changed → edit the message + update doc;
 *  - existing games whose status is unchanged → skipped (edit-throttle gate);
 *  - games no longer live → finalize the message (strip buttons) + drop doc.
 *
 * Bails (no-op) when the league has no admin channel configured or when the
 * connector does not implement `getOngoingGames`.
 */
export async function syncOngoingGameMessages(
  league: League,
  connector: ILeagueTournamentConnector
): Promise<void> {
  const channelId = league.discordConfig?.adminChannel;
  if (!channelId) {
    return;
  }
  if (typeof connector.getOngoingGames !== "function") {
    return;
  }
  const tournamentId = league.platformConfig.tournamentId;
  if (!tournamentId) {
    return;
  }

  const live = (await connector.getOngoingGames(tournamentId)) ?? [];
  const liveById = new Map(live.map((g) => [g.gameId, g]));

  const docs = await OngoingGameMessageModel.find({ league: league._id })
    .lean<OngoingGameMessage[]>()
    .exec();
  const docByGameId = new Map(docs.map((d) => [d.gameId, d]));

  const accountInfo = await buildAccountInfoMap(league);
  const caps = getCapabilities(connector);
  const leagueId = league._id.toString();

  // 1) New games
  for (const game of live) {
    if (docByGameId.has(game.gameId)) {
      continue;
    }
    const players = enrichPlayers(game, accountInfo);
    const { content, components } = composeOngoingGameMessage({
      leagueId,
      game: { ...game, players },
      isTeamMode: league.rulesConfig.isTeamMode,
      ...caps,
      lastUpdated: new Date(),
    });
    try {
      const msg = await sendChannelMessage(channelId, content, components);
      await OngoingGameMessageModel.create({
        league: league._id,
        gameId: game.gameId,
        channelId,
        messageId: msg.id,
        renderedStatus: game.status,
        startTime: game.startTime,
        players: players.map<OngoingGameMessagePlayer>((p) => ({
          accountId: p.accountId,
          nickname: p.nickname,
          displayLabel: p.displayLabel,
          teamName: p.teamName,
        })),
      });
    } catch (err) {
      console.error(
        `Failed to publish ongoing-game message for ${game.gameId} in league ${league.name}:`,
        err
      );
    }
  }

  // 2) Existing games — only edit when something the user can see has
  //    changed (status, player set, displayLabels, team names). This
  //    avoids spamming Discord with no-op edits on every poll.
  for (const game of live) {
    const doc = docByGameId.get(game.gameId);
    if (!doc) {
      continue;
    }
    // Always re-enrich from live data + accountInfo so guild joins and name
    // updates are reflected; this is essentially free since accountInfo was
    // built once for this tick.
    const players = enrichPlayers(game, accountInfo);

    if (!hasOngoingGameChanged(doc, game.status, players)) {
      continue;
    }

    const { content, components } = composeOngoingGameMessage({
      leagueId,
      game: {
        gameId: game.gameId,
        status: game.status,
        startTime: doc.startTime ?? game.startTime,
        players,
      },
      isTeamMode: league.rulesConfig.isTeamMode,
      ...caps,
      lastUpdated: new Date(),
    });
    try {
      await editChannelMessage(
        doc.channelId,
        doc.messageId,
        content,
        components
      );
      await OngoingGameMessageModel.updateOne(
        { _id: doc._id },
        {
          $set: {
            renderedStatus: game.status,
            players: players.map<OngoingGameMessagePlayer>((p) => ({
              accountId: p.accountId,
              nickname: p.nickname,
              displayLabel: p.displayLabel,
              teamName: p.teamName,
            })),
          },
        }
      ).exec();
    } catch (err) {
      const healed = await autoHealMissingMessage(doc, "edit", err);
      if (!healed) {
        console.error(
          `Failed to update ongoing-game message ${doc.messageId} for ${game.gameId}:`,
          err
        );
      }
    }
  }

  // 3) Disappeared games — delete message & drop doc.
  for (const doc of docs) {
    if (liveById.has(doc.gameId)) {
      continue;
    }
    try {
      await deleteChannelMessage(doc.channelId, doc.messageId);
    } catch (err) {
      console.error(
        `Failed to delete ongoing-game message ${doc.messageId} for ${doc.gameId}:`,
        err
      );
      continue; // leave doc; try again next tick
    }
    await OngoingGameMessageModel.deleteOne({ _id: doc._id }).exec();
  }
}

/**
 * Edits the ongoing-game message in place to remove its action buttons and
 * prepend a short "working" notice. Used by the button-action handler to
 * disable the buttons while the connector call is in flight, preventing
 * double-clicks. Best-effort: errors are logged and swallowed so they don't
 * block the action itself.
 */
export async function setOngoingGameMessageBusy(
  leagueId: string,
  gameId: string,
  notice: string
): Promise<void> {
  const doc = await OngoingGameMessageModel.findOne({
    league: new mongoose.Types.ObjectId(leagueId),
    gameId,
  }).lean<OngoingGameMessage>();
  if (!doc) {
    return;
  }
  // Re-render content from the stored snapshot so we don't accidentally
  // mutate other state, and strip components.
  // We need league context to know team-mode + leagueId; cheap enough to load.
  const league = await LeagueModel.findById(leagueId).lean<League>();
  if (!league) {
    return;
  }
  const players: RenderedPlayer[] = doc.players.map((p) => ({
    accountId: p.accountId,
    nickname: p.nickname ?? undefined,
    displayLabel: p.displayLabel,
    teamName: p.teamName ?? undefined,
  }));
  const { content } = composeOngoingGameMessage({
    leagueId,
    game: {
      gameId: doc.gameId,
      status: doc.renderedStatus as OngoingGame["status"],
      startTime: doc.startTime ?? undefined,
      players,
    },
    isTeamMode: league.rulesConfig.isTeamMode,
    // Capabilities don't matter here — we override components to [] anyway.
    supportsPause: false,
    supportsResume: false,
    supportsTerminate: false,
  });
  const busyContent = `${notice}\n${content}`;
  try {
    await editChannelMessage(doc.channelId, doc.messageId, busyContent, []);
  } catch (err) {
    if (err instanceof DiscordMessageNotFoundError) {
      await OngoingGameMessageModel.deleteOne({ _id: doc._id }).exec();
      return;
    }
    console.warn(
      `Failed to mark ongoing-game message ${doc.messageId} as busy:`,
      err
    );
  }
}

/**
 * Refreshes a single ongoing-game message immediately (used after a button
 * action). Bypasses the status-equality throttle gate so the operator sees
 * the result of the action they just confirmed.
 */
export async function refreshOngoingGameMessage(
  leagueId: string,
  gameId: string
): Promise<void> {
  const league = await LeagueModel.findById(leagueId)
    .populate("leagueTypeConfig")
    .lean<League>();
  if (!league) {
    return;
  }
  const channelId = league.discordConfig?.adminChannel;
  if (!channelId) {
    return;
  }
  const tournamentId = league.platformConfig.tournamentId;
  if (!tournamentId) {
    return;
  }
  const connector = createConnectorForLeague(league);
  if (typeof connector.getOngoingGames !== "function") {
    return;
  }

  const live = (await connector.getOngoingGames(tournamentId)) ?? [];
  const game = live.find((g) => g.gameId === gameId);

  const doc = await OngoingGameMessageModel.findOne({
    league: league._id,
    gameId,
  }).exec();

  // Game is gone — delete the message if we have a doc, else nothing to do.
  if (!game) {
    if (!doc) {
      return;
    }
    try {
      await deleteChannelMessage(doc.channelId, doc.messageId);
    } catch (err) {
      console.error(
        `Failed to delete ongoing-game message ${doc.messageId}:`,
        err
      );
    }
    await OngoingGameMessageModel.deleteOne({ _id: doc._id }).exec();
    return;
  }

  const accountInfo = await buildAccountInfoMap(league);
  const caps = getCapabilities(connector);
  const players = enrichPlayers(game, accountInfo);
  const { content, components } = composeOngoingGameMessage({
    leagueId,
    game: { ...game, players },
    isTeamMode: league.rulesConfig.isTeamMode,
    ...caps,
    lastUpdated: new Date(),
  });

  // No doc yet (button on a freshly-spawned game we haven't synced) — send.
  if (!doc) {
    try {
      const msg = await sendChannelMessage(channelId, content, components);
      await OngoingGameMessageModel.create({
        league: league._id,
        gameId,
        channelId,
        messageId: msg.id,
        renderedStatus: game.status,
        startTime: game.startTime,
        players: players.map<OngoingGameMessagePlayer>((p) => ({
          accountId: p.accountId,
          nickname: p.nickname,
          displayLabel: p.displayLabel,
          teamName: p.teamName,
        })),
      });
    } catch (err) {
      console.error(
        `Failed to publish ongoing-game message for ${gameId}:`,
        err
      );
    }
    return;
  }

  // Existing doc — force edit (bypass throttle gate).
  try {
    await editChannelMessage(doc.channelId, doc.messageId, content, components);
    await OngoingGameMessageModel.updateOne(
      { _id: doc._id },
      { $set: { renderedStatus: game.status } }
    ).exec();
  } catch (err) {
    if (err instanceof DiscordMessageNotFoundError) {
      // Drop and recreate.
      await OngoingGameMessageModel.deleteOne({ _id: doc._id }).exec();
      try {
        const msg = await sendChannelMessage(channelId, content, components);
        await OngoingGameMessageModel.create({
          league: league._id,
          gameId,
          channelId,
          messageId: msg.id,
          renderedStatus: game.status,
          startTime: game.startTime,
          players: players.map<OngoingGameMessagePlayer>((p) => ({
            accountId: p.accountId,
            nickname: p.nickname,
            displayLabel: p.displayLabel,
            teamName: p.teamName,
          })),
        });
      } catch (sendErr) {
        console.error(
          `Failed to recreate ongoing-game message for ${gameId}:`,
          sendErr
        );
      }
    } else {
      console.error(
        `Failed to refresh ongoing-game message ${doc.messageId}:`,
        err
      );
    }
  }
}

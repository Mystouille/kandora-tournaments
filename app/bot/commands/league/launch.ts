import type { ChatInputCommandInteraction } from "discord.js";
import mongoose from "mongoose";
import { LeagueModel, type League } from "~/db/League";
import { BracketModel, type Bracket } from "~/db/Bracket";
import { SchedulingMessageModel } from "~/db/SchedulingMessage";
import { resolveLeagueTypeConfig } from "~/services/league-configs/index";
import type {
  LeagueTypeConfig,
  FinalStageDefinition,
} from "~/services/league-configs/types";
import {
  generateTeamBracketSeating,
  generateIndividualScheduling,
} from "~/services/league-configs/teamBracketSeating";
import {
  resolveRound,
  loadStageParticipantsByIds,
  buildUserMap,
  buildUserMapForMemberIds,
} from "~/services/schedulingMessageService.server";
import { createConnectorForLeague } from "~/services/connectors/createConnectorForLeague.server";
import { strings } from "~/bot/localization/strings";
import { localize } from "~/bot/localizationUtils";
import { stringFormat } from "~/bot/stringUtils";

const reply = strings.commands.league.launch.reply;

/**
 * /league launch — checks that all players scheduled in upcoming rounds
 * are ready on the platform, then launches the games via the connector.
 */
export async function executeLaunch(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const locale = interaction.locale;
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply(localize(locale, reply.mustBeInServer));
    return;
  }

  // ── 1. Find league ─────────────────────────────────────────────────────
  const league = await LeagueModel.findOne({
    "discordConfig.serverId": guildId,
    endTime: { $gt: new Date() },
  })
    .populate("leagueTypeConfig")
    .lean<(League & { _id: mongoose.Types.ObjectId }) | null>();

  if (!league) {
    await interaction.editReply(localize(locale, reply.noActiveLeague));
    return;
  }

  const config = resolveLeagueTypeConfig(
    league.leagueTypeConfig as LeagueTypeConfig | null
  );
  if (!config?.finalPhase) {
    await interaction.editReply(localize(locale, reply.noFinalPhase));
    return;
  }

  // ── 2. Find upcoming scheduling messages ───────────────────────────────
  const upcomingMsgs = await SchedulingMessageModel.find({
    league: league._id,
    status: "upcoming",
  })
    .sort({ stageId: 1 })
    .lean();

  if (upcomingMsgs.length === 0) {
    await interaction.editReply(localize(locale, reply.noUpcomingGames));
    return;
  }

  // Launch every upcoming round across every stage. We keep the stage
  // ordering stable for the launch report so the output mirrors the
  // final-phase config order.
  const stageOrder = new Map(
    config.finalPhase.stages.map(
      (s: FinalStageDefinition, idx: number) => [s.id, idx] as const
    )
  );
  const stageMsgsToLaunch = upcomingMsgs.slice().sort((a, b) => {
    const oa = stageOrder.get(a.stageId) ?? Number.MAX_SAFE_INTEGER;
    const ob = stageOrder.get(b.stageId) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) {
      return oa - ob;
    }
    return a.roundIndex - b.roundIndex;
  });

  // ── 3. Validate connector & tournament ─────────────────────────────────
  const connector = createConnectorForLeague(league);
  if (!connector.startGame) {
    await interaction.editReply(localize(locale, reply.unsupportedPlatform));
    return;
  }

  const tournamentId = league.platformConfig.tournamentId;
  if (!tournamentId) {
    await interaction.editReply(localize(locale, reply.noTournamentId));
    return;
  }

  // ── 4. Load bracket seedings ───────────────────────────────────────────
  const bracket = (await BracketModel.findOne({
    league: league._id,
  }).lean()) as Bracket | null;

  if (!bracket) {
    await interaction.editReply(localize(locale, reply.noBracketSeedings));
    return;
  }

  const isTeamMode = config.isTeamMode !== false;

  // ── 5. Resolve tables ──────────────────────────────────────────────────
  const tablesToLaunch: Array<{
    stageName: string;
    playerAccountIds: (number | string)[];
  }> = [];
  const accountDisplayNames = new Map<string, string>();
  for (const msg of stageMsgsToLaunch) {
    const stage = config.finalPhase.stages.find(
      (s: FinalStageDefinition) => s.id === msg.stageId
    );
    if (!stage) {
      continue;
    }

    // Prefer the persisted seating for this round when available, so the games
    // opened on the platform exactly match the scheduled/displayed tables.
    const persistedTables = msg.tables ?? [];
    if (persistedTables.length > 0) {
      const seatUserIds = persistedTables.flatMap((table) =>
        table.seats.map((seat) => seat.userId)
      );
      const userMap = await buildUserMapForMemberIds(
        seatUserIds,
        league.platformConfig.platformName
      );
      const ordered = [...persistedTables].sort(
        (a, b) => a.tableIndex - b.tableIndex
      );
      for (const table of ordered) {
        const accountIds: (number | string)[] = [];
        for (const seat of table.seats) {
          const info = userMap.get(seat.userId.toString());
          if (info?.platformAccountId == null) {
            continue;
          }
          accountIds.push(info.platformAccountId);
          const key = String(info.platformAccountId);
          if (!accountDisplayNames.has(key)) {
            accountDisplayNames.set(key, info.platformName || info.name || key);
          }
        }
        tablesToLaunch.push({
          stageName: stage.id,
          playerAccountIds: accountIds,
        });
      }
      continue;
    }

    if (!msg.participantIds || msg.participantIds.length === 0) {
      console.warn(
        `[launch] Skipping scheduling message ${msg.messageId} for stage ${msg.stageId} round ${msg.roundIndex}: no participantIds stored`
      );
      continue;
    }

    const participants = await loadStageParticipantsByIds(
      league._id,
      msg.participantIds as mongoose.Types.ObjectId[],
      isTeamMode,
      msg.stageId,
      msg.roundIndex
    );
    const userMap = await buildUserMap(
      participants,
      league.platformConfig.platformName
    );

    const teamSizes: [number, number, number, number] = isTeamMode
      ? [
          participants[0]?.memberIds.length || 4,
          participants[1]?.memberIds.length || 4,
          participants[2]?.memberIds.length || 4,
          participants[3]?.memberIds.length || 4,
        ]
      : [4, 4, 4, 4];

    const scheduling = isTeamMode
      ? generateTeamBracketSeating(stage.gameCount, teamSizes)
      : generateIndividualScheduling(stage.gameCount);

    const resolved = resolveRound(
      stage,
      scheduling,
      msg.roundIndex,
      participants,
      userMap
    );

    for (const table of resolved) {
      const accountIds: (number | string)[] = [];
      for (const seat of table) {
        if (seat.platformAccountId == null) {
          continue;
        }
        accountIds.push(seat.platformAccountId);
        const key = String(seat.platformAccountId);
        if (!accountDisplayNames.has(key)) {
          accountDisplayNames.set(
            key,
            seat.platformName || seat.userName || key
          );
        }
      }

      tablesToLaunch.push({
        stageName: stage.id,
        playerAccountIds: accountIds,
      });
    }
  }

  // ── 6. Verify every player is ready on the platform ────────────────────
  if (connector.getPlayerLobbyEntries) {
    const requiredAccountIds = new Set<string>();
    for (const table of tablesToLaunch) {
      for (const accountId of table.playerAccountIds) {
        requiredAccountIds.add(String(accountId));
      }
    }

    let entries: Awaited<
      ReturnType<NonNullable<typeof connector.getPlayerLobbyEntries>>
    > = [];
    try {
      entries = await connector.getPlayerLobbyEntries(tournamentId, {
        seasonId: league.platformConfig.seasonId
          ? String(league.platformConfig.seasonId)
          : undefined,
      });
    } catch {
      // Platform unavailable — fall through; the launch attempt itself
      // will surface a clearer error if needed.
    }

    const readyAccountIds = new Set(
      entries
        .filter((e) => e.status === "ready")
        .map((e) => String(e.platformAccountId))
    );

    const notReady: string[] = [];
    for (const accountId of requiredAccountIds) {
      if (!readyAccountIds.has(accountId)) {
        const name = accountDisplayNames.get(accountId);
        notReady.push(name ? `${name} (${accountId})` : accountId);
      }
    }

    if (notReady.length > 0) {
      await interaction.editReply(
        stringFormat(locale, reply.playersNotReadyFormat, notReady.join("\n- "))
      );
      return;
    }
  }

  // ── 7. Launch all tables ───────────────────────────────────────────────
  const launchFailures: string[] = [];
  let successCount = 0;

  for (const table of tablesToLaunch) {
    try {
      await connector.startGame!(tournamentId, table.playerAccountIds, {
        seasonId: league.platformConfig.seasonId
          ? Number(league.platformConfig.seasonId)
          : undefined,
      });
      successCount++;
      console.log(
        `[launch] ${table.stageName.toUpperCase()} launched (${table.playerAccountIds.join(", ")})`
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : String(error ?? "unknown");
      console.error(
        `[launch] ${table.stageName.toUpperCase()} failed (${table.playerAccountIds.join(", ")}): ${reason}`
      );
      launchFailures.push(
        stringFormat(
          locale,
          reply.tableFailFormat,
          table.stageName.toUpperCase(),
          table.playerAccountIds.join(", "),
          reason
        )
      );
    }
  }

  const summary = stringFormat(
    locale,
    reply.launchSummaryFormat,
    String(successCount),
    String(tablesToLaunch.length)
  );
  const message =
    launchFailures.length > 0
      ? `${summary}\n${launchFailures.join("\n")}`
      : summary;

  // Discord caps message content at 2000 characters; trim defensively in
  // case there are many failure lines.
  const trimmed =
    message.length > 1990 ? `${message.slice(0, 1987)}...` : message;

  await interaction.editReply(trimmed);
}

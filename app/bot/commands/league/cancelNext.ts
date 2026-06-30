import type { ChatInputCommandInteraction } from "discord.js";
import mongoose from "mongoose";
import { LeagueModel, type League } from "~/db/League";
import { SchedulingMessageModel } from "~/db/SchedulingMessage";
import { getSchedulingQueue } from "~/services/schedulingQueue.server";
import { deleteChannelMessages } from "~/services/discordPublisher.server";
import { strings } from "~/bot/localization/strings";
import { localize } from "~/bot/localizationUtils";

const reply = strings.commands.league.cancelnext.reply;

/**
 * /league cancelnext — cancels all upcoming/in-progress scheduling messages
 * for this league, removes the Discord messages, deletes the DB documents,
 * and drains any associated polling jobs from the queue.
 */
export async function executeCancelNext(
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
  }).lean<(League & { _id: mongoose.Types.ObjectId }) | null>();

  if (!league) {
    await interaction.editReply(localize(locale, reply.noActiveLeague));
    return;
  }

  // ── 2. Find non-completed scheduling messages ──────────────────────────
  const pendingMsgs = await SchedulingMessageModel.find({
    league: league._id,
    status: { $in: ["upcoming", "in_progress"] },
  }).lean();

  if (pendingMsgs.length === 0) {
    await interaction.editReply(localize(locale, reply.noPendingMessages));
    return;
  }

  // ── 3. Remove polling jobs from the queue ──────────────────────────────
  const messageIds = [...new Set(pendingMsgs.map((m) => m.messageId))];

  const [delayed, waiting] = await Promise.all([
    getSchedulingQueue().getDelayed(),
    getSchedulingQueue().getWaiting(),
  ]);

  for (const job of [...delayed, ...waiting]) {
    if (messageIds.includes(job.data.messageId)) {
      await job.remove();
    }
  }

  // ── 4. Delete Discord messages ─────────────────────────────────────────
  const channelId = league.discordConfig?.schedulingChannel;
  if (channelId) {
    const { failed } = await deleteChannelMessages(channelId, messageIds);
    if (failed.length > 0) {
      console.error(
        `cancelNext: ${failed.length} scheduling message(s) could not be ` +
          `deleted in channel ${channelId} for league ${league.name}: ` +
          failed.join(", ")
      );
    }
  }

  // ── 5. Delete scheduling message documents ─────────────────────────────
  const deleteResult = await SchedulingMessageModel.deleteMany({
    _id: { $in: pendingMsgs.map((m) => m._id) },
  });

  await interaction.editReply(
    localize(locale, reply.success).replace(
      "{0}",
      String(deleteResult.deletedCount)
    )
  );
}

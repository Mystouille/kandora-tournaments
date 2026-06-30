import mongoose from "mongoose";
import type { Job } from "bullmq";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { LeagueModel, type League } from "~/db/League";
import {
  SchedulingMessageModel,
  type SchedulingMessage,
} from "~/db/SchedulingMessage";
import { SubstitutionModel } from "~/db/Substitution";
import {
  getSchedulingQueue,
  type SchedulingPollJob,
} from "~/services/schedulingQueue.server";
import { createConnectorForLeague } from "~/services/connectors/createConnectorForLeague.server";
import {
  buildUserMapForMemberIds,
  loadScoredGameDeltas,
  renderCompletedBatchFromPersisted,
} from "~/services/schedulingMessageService.server";
import { resolveLeagueTypeConfig } from "~/services/league-configs/index";
import type { LeagueTypeConfig } from "~/services/league-configs/types";
import { editChannelMessage } from "~/services/discordPublisher.server";

/** Delay used when restarting a missing poll loop (ms). */
const RESTART_DELAY_MS = 5_000;
/**
 * An active job whose last `processedOn` is older than this is considered hung.
 * Comfortably above the worker's handler timeout + lock duration so we only act
 * on genuinely stuck jobs.
 */
const STUCK_ACTIVE_THRESHOLD_MS = 150_000;

type TaggedJob = {
  job: Job<SchedulingPollJob>;
  state: "delayed" | "waiting" | "active";
};

async function safeRemove(job: Job): Promise<boolean> {
  try {
    await job.remove();
    return true;
  } catch (error) {
    console.warn(`[reconcile] could not remove job ${job.id}:`, error);
    return false;
  }
}

/**
 * Resolve the set of platform account ids currently seated in any ongoing game
 * on the platform. Returns `available: false` when the connector cannot report
 * ongoing games, so callers can fall back to a tables-only close decision.
 */
async function loadOngoingAccountIds(
  league: League & { _id: mongoose.Types.ObjectId }
): Promise<{ accountIds: Set<string>; available: boolean }> {
  const tournamentId = league.platformConfig?.tournamentId;
  const connector = createConnectorForLeague(league);
  if (typeof connector.getOngoingGames !== "function" || !tournamentId) {
    return { accountIds: new Set(), available: false };
  }
  try {
    const ongoing = (await connector.getOngoingGames(tournamentId)) ?? [];
    const accountIds = new Set<string>();
    for (const game of ongoing) {
      for (const player of game.players) {
        accountIds.add(String(player.accountId));
      }
    }
    return { accountIds, available: true };
  } catch {
    return { accountIds: new Set(), available: false };
  }
}

/** Resolve the platform account ids of every seat across a batch of messages. */
async function resolveBatchAccountIds(
  messages: SchedulingMessage[],
  platform: string
): Promise<Set<string>> {
  const seatUserIds = messages.flatMap((message) =>
    (message.tables ?? []).flatMap((table) =>
      table.seats.map((seat) => seat.userId)
    )
  );
  const userMap = await buildUserMapForMemberIds(seatUserIds, platform);
  const accountIds = new Set<string>();
  for (const info of userMap.values()) {
    if (info.platformAccountId != null) {
      accountIds.add(String(info.platformAccountId));
    }
  }
  return accountIds;
}

/** Delete substitutions fully consumed by the just-completed rounds. */
async function cleanupConsumedSubstitutions(
  leagueObjId: mongoose.Types.ObjectId,
  messages: SchedulingMessage[]
): Promise<void> {
  const completedRoundByStage = new Map<string, number>();
  for (const message of messages) {
    const round = message.roundIndex + 1;
    const current = completedRoundByStage.get(message.stageId);
    if (current === undefined || round > current) {
      completedRoundByStage.set(message.stageId, round);
    }
  }

  const subs = await SubstitutionModel.find({ league: leagueObjId }).lean();
  const toDelete: mongoose.Types.ObjectId[] = [];
  for (const sub of subs) {
    const completedRound = completedRoundByStage.get(sub.stageId);
    if (completedRound === undefined) {
      continue;
    }
    if (Math.max(...sub.rounds) <= completedRound) {
      toDelete.push(sub._id);
    }
  }
  if (toDelete.length > 0) {
    await SubstitutionModel.deleteMany({ _id: { $in: toDelete } });
  }
}

/**
 * Reconcile the scheduling poll queue against the three sources of truth —
 * finished games (via persisted `tables[].gameId`), the scheduled tables, and
 * the platform's ongoing games — for a single league. Self-heals the common
 * failure modes that previously required a manual restart:
 *
 *  1. **Close** a batch whose every table is linked to a finished game and that
 *     the platform reports idle, then drop its poll jobs (unblocks /startnext).
 *  2. **Kill** a hung active job and let the loop restart.
 *  3. **Restart** a poll loop that has no live job.
 *  4. **Dedupe** multiple jobs targeting the same batch.
 *  5. **Remove** orphan jobs whose batch is already completed or deleted.
 *
 * Designed to run on the resilient `league-updates` recurring job, off the
 * `scheduling-updates` queue, so a wedged scheduling job cannot block it.
 */
export async function reconcileSchedulingJobs(
  leagueId: string | mongoose.Types.ObjectId
): Promise<void> {
  await connectToDatabase();
  const leagueObjId =
    typeof leagueId === "string"
      ? new mongoose.Types.ObjectId(leagueId)
      : leagueId;
  const leagueIdStr = leagueObjId.toString();

  const pending = await SchedulingMessageModel.find({
    league: leagueObjId,
    status: { $in: ["upcoming", "in_progress"] },
  }).lean<SchedulingMessage[]>();

  const queue = getSchedulingQueue();
  const [delayed, waiting, active] = await Promise.all([
    queue.getDelayed(),
    queue.getWaiting(),
    queue.getActive(),
  ]);

  // Group this league's jobs by batch (messageId), tagged with their state.
  const jobsByMessage = new Map<string, TaggedJob[]>();
  const tag = (jobs: Job<SchedulingPollJob>[], state: TaggedJob["state"]) => {
    for (const job of jobs) {
      if (job.data?.leagueId !== leagueIdStr) {
        continue;
      }
      const list = jobsByMessage.get(job.data.messageId) ?? [];
      list.push({ job, state });
      jobsByMessage.set(job.data.messageId, list);
    }
  };
  tag(delayed as Job<SchedulingPollJob>[], "delayed");
  tag(waiting as Job<SchedulingPollJob>[], "waiting");
  tag(active as Job<SchedulingPollJob>[], "active");

  const pendingByMessage = new Map<string, SchedulingMessage[]>();
  for (const message of pending) {
    const list = pendingByMessage.get(message.messageId) ?? [];
    list.push(message);
    pendingByMessage.set(message.messageId, list);
  }

  // 5. Remove orphan jobs (batch already completed or deleted).
  for (const [messageId, tagged] of jobsByMessage) {
    if (!pendingByMessage.has(messageId)) {
      for (const { job } of tagged) {
        await safeRemove(job);
      }
      jobsByMessage.delete(messageId);
    }
  }

  if (pendingByMessage.size === 0) {
    return;
  }

  // Ground truth #3: platform ongoing games (loaded once per league).
  const league = await LeagueModel.findById(leagueObjId)
    .populate("leagueTypeConfig")
    .lean<(League & { _id: mongoose.Types.ObjectId }) | null>();
  if (!league) {
    return;
  }
  const config = resolveLeagueTypeConfig(
    league.leagueTypeConfig as LeagueTypeConfig | null
  );
  const { accountIds: ongoingAccountIds, available: ongoingAvailable } =
    await loadOngoingAccountIds(league);

  // Resolve which linked games are actually scored (a placeholder game created
  // from listing metadata before its log hydrated is linked but not yet
  // scored). A round must only be closed once every table is linked to a
  // *scored* game, otherwise it would freeze showing bogus placeholder deltas.
  const allLinkedGameIds: string[] = [];
  for (const message of pending) {
    for (const table of message.tables ?? []) {
      if (table.gameId) {
        allLinkedGameIds.push(table.gameId);
      }
    }
  }
  const { scoredGameIds, gameDeltaMap } = await loadScoredGameDeltas(
    league,
    allLinkedGameIds
  );

  for (const [messageId, messages] of pendingByMessage) {
    const tagged = jobsByMessage.get(messageId) ?? [];

    // 1. Close a finished batch: every table linked to a SCORED game AND the
    // platform is idle. Requiring "scored" (not merely linked) keeps a round
    // open while a just-linked game is still a placeholder, so the message is
    // never frozen on bogus deltas.
    const allTablesScored = messages.every((message) => {
      const tables = message.tables ?? [];
      return (
        tables.length > 0 &&
        tables.every(
          (table) => table.gameId != null && scoredGameIds.has(table.gameId)
        )
      );
    });

    let platformIdle = true;
    if (allTablesScored && ongoingAvailable && ongoingAccountIds.size > 0) {
      const batchAccountIds = await resolveBatchAccountIds(
        messages,
        league.platformConfig.platformName
      );
      platformIdle = ![...batchAccountIds].some((id) =>
        ongoingAccountIds.has(id)
      );
    }

    if (allTablesScored && platformIdle) {
      // Render the final state into the Discord message before completing.
      // The worker normally does this on its last poll, but when the reconciler
      // is the one closing the batch (e.g. a dead poll loop) the message would
      // otherwise keep whatever it last showed. Best-effort: a Discord failure
      // must not block completion (which would wedge /startnext).
      if (config?.finalPhase) {
        try {
          const content = await renderCompletedBatchFromPersisted(
            config,
            league,
            messages,
            gameDeltaMap
          );
          if (content) {
            const channelId = league.discordConfig?.schedulingChannel;
            if (channelId) {
              await editChannelMessage(channelId, messageId, content);
            }
          }
        } catch (error) {
          console.warn(
            `[reconcile] failed to render completed batch ${messageId}:`,
            error
          );
        }
      }

      await SchedulingMessageModel.updateMany(
        { _id: { $in: messages.map((message) => message._id) } },
        { $set: { status: "completed", completedAt: new Date() } }
      );
      await cleanupConsumedSubstitutions(leagueObjId, messages);
      for (const { job } of tagged) {
        await safeRemove(job);
      }
      continue;
    }

    // 2 & 3. Remove hung active jobs; keep track of which jobs remain live.
    const now = Date.now();
    const liveJobs: Job<SchedulingPollJob>[] = [];
    for (const { job, state } of tagged) {
      if (state === "active") {
        const processedOn = job.processedOn ?? now;
        if (now - processedOn > STUCK_ACTIVE_THRESHOLD_MS) {
          const removed = await safeRemove(job);
          if (!removed) {
            // Couldn't remove a locked job; treat it as live so we don't pile
            // on a duplicate. The worker's stalled-job reclaim will handle it.
            liveJobs.push(job);
          }
          continue;
        }
      }
      liveJobs.push(job);
    }

    // 4. Dedupe: keep a single live job for the batch.
    while (liveJobs.length > 1) {
      const extra = liveJobs.pop();
      if (extra) {
        await safeRemove(extra);
      }
    }

    // 3. Restart a missing poll loop.
    if (liveJobs.length === 0) {
      await queue.add(
        `scheduling-poll:${leagueIdStr}:${messageId}`,
        { leagueId: leagueIdStr, messageId },
        { delay: RESTART_DELAY_MS }
      );
    }
  }
}

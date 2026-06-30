import { Worker, type Job } from "bullmq";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { getRedisConnection } from "./redisConnection.server";
import { trackError } from "./telemetry.server";
import {
  getSchedulingQueue,
  type SchedulingPollJob,
} from "./schedulingQueue.server";
import {
  SchedulingMessageModel,
  type SchedulingStatus,
} from "~/db/SchedulingMessage";
import { LeagueModel, type League } from "~/db/League";
import { BracketModel, type Bracket } from "~/db/Bracket";
import { createConnectorForLeague } from "~/services/connectors/createConnectorForLeague.server";
import type { PlayerReadyMap } from "./schedulingMessageService.server";
import {
  loadStageParticipantsByIds,
  buildUserMap,
  loadSubstituteMap,
  resolveRound,
  composeBatchMessage,
  buildPersistedTables,
  reprojectTables,
  type BatchStageEntry,
  type PersistedTable,
  type TableRender,
} from "./schedulingMessageService.server";
import { linkPlayedGamesToTables } from "./schedulingLink.server";
import { editChannelMessage } from "./discordPublisher.server";
import { computePlayerDeltas, isGameScored } from "./leagueUtils";
import { GameModel, type Game } from "~/db/Game";
import { GameRecordModel, type GameRecord } from "~/db/GameRecord";
import type {
  FinalStageDefinition,
  LeagueTypeConfig,
} from "./league-configs/types";
import {
  generateTeamBracketSeating,
  generateIndividualScheduling,
} from "./league-configs/teamBracketSeating";
import { SubstitutionModel } from "~/db/Substitution";
import mongoose from "mongoose";

const env = process.env.NODE_ENV === "production" ? "prod" : "dev";

/** Polling interval before any games have launched (ms). */
const POLL_INTERVAL_UPCOMING = 5_000;
/** Polling interval once games are in progress (ms). */
const POLL_INTERVAL_IN_PROGRESS = 60_000;

/**
 * Hard cap on a single poll cycle. The handler awaits Discord and platform
 * calls that can hang indefinitely; without a cap a hung call leaves the job
 * "active" forever and (at any concurrency) wedges that slot. On timeout we
 * throw so BullMQ fails the job and the queue keeps moving.
 */
const HANDLER_TIMEOUT_MS = 45_000;
/**
 * Number of poll batches processed concurrently. Each batch is keyed by a
 * distinct Discord messageId and operates on disjoint SchedulingMessage docs,
 * so running several in parallel is safe and stops one slow/hung batch from
 * starving every other league's polling.
 */
const SCHEDULING_WORKER_CONCURRENCY = 3;

/**
 * Race a promise against a timeout. Rejects with a descriptive error if `ms`
 * elapses first. The timer is always cleared so it never keeps the process
 * alive.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Last readyMap signature edited into each scheduling message while it
 * was still in the "upcoming / waiting for players" phase. Used to
 * suppress redundant Discord edits when no player has changed state
 * since the previous poll. Cleared as soon as any stage in the batch
 * transitions to in_progress / completed.
 */
const lastUpcomingReadySignatures = new Map<string, string>();

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

export const schedulingWorker = new Worker(
  "scheduling-updates",
  async (job: Job<SchedulingPollJob>) => {
    const runPoll = async (): Promise<void> => {
      await ensureInitialized();

      const { leagueId, messageId } = job.data;

      // Load all SchedulingMessage docs sharing this Discord message
      let schedulingMsgs = await SchedulingMessageModel.find({
        messageId,
      })
        .sort({ stageId: 1 })
        .lean();

      if (schedulingMsgs.length === 0) {
        return;
      }

      // If every stage in the batch is already completed, stop
      const allCompleted = schedulingMsgs.every(
        (m) => m.status === "completed"
      );
      if (allCompleted) {
        return;
      }

      // Load league with populated leagueTypeConfig
      const league = await LeagueModel.findById(leagueId)
        .populate("leagueTypeConfig")
        .lean<(League & { _id: mongoose.Types.ObjectId }) | null>();

      if (!league) {
        return;
      }

      const config = league.leagueTypeConfig as LeagueTypeConfig | null;
      if (!config?.finalPhase) {
        return;
      }

      const channelId = league.discordConfig?.schedulingChannel;
      if (!channelId) {
        return;
      }

      // Load bracket seedings
      const bracket = await BracketModel.findOne({
        league: league._id,
      }).lean<Bracket | null>();
      if (!bracket) {
        return;
      }

      const isTeamMode = config.isTeamMode !== false;

      // Get per-player lobby status from platform (shared across all stages)
      const connector = createConnectorForLeague(league);
      let readyMap: PlayerReadyMap | undefined;
      let anyInGame = false;

      if (
        connector.getPlayerLobbyEntries &&
        league.platformConfig.tournamentId
      ) {
        try {
          const entries = await connector.getPlayerLobbyEntries(
            league.platformConfig.tournamentId,
            { seasonId: league.platformConfig.seasonId ?? undefined }
          );
          readyMap = {};
          for (const entry of entries) {
            const state =
              entry.status === "in-game"
                ? "in-game"
                : entry.status === "ready"
                  ? "ready"
                  : entry.status === "online"
                    ? "online"
                    : "offline";
            readyMap[String(entry.platformAccountId)] = state;
            if (state === "in-game") {
              anyInGame = true;
            }
          }
        } catch {
          // Platform unavailable — skip ready indicators this cycle
        }
      }

      // Link any finished games to their tables BEFORE composing so a freshly
      // completed table shows its result this cycle. Only worth attempting once
      // a game could plausibly exist (someone in-game now, or a round already
      // progressed past "upcoming" — e.g. a table still waiting for its log).
      // Reload the docs afterwards to pick up newly written gameId / seats.
      const couldHaveGames =
        anyInGame || schedulingMsgs.some((m) => m.status !== "upcoming");
      if (couldHaveGames) {
        try {
          await linkPlayedGamesToTables(leagueId);
        } catch (error) {
          console.error(
            `[schedulingWorker] linkPlayedGamesToTables failed for league ${leagueId}:`,
            error
          );
        }
        schedulingMsgs = await SchedulingMessageModel.find({ messageId })
          .sort({ stageId: 1 })
          .lean();
      }

      // Resolve delta scores for every table linked to a fully scored game.
      // A linked game may still be a placeholder (created from listing metadata
      // before its log was hydrated, with all scores/places zeroed); such games
      // are skipped here and the table is shown as "waiting for game log" until
      // the real result lands, so we never render bogus deltas or complete a
      // round early. Prefer the stored GameRecord deltaPoints; fall back to
      // computing from the raw results with the league's ruleset.
      const linkedGameIds = new Set<string>();
      for (const m of schedulingMsgs) {
        for (const table of m.tables ?? []) {
          if (table.gameId) {
            linkedGameIds.add(table.gameId);
          }
        }
      }

      const gameDeltaMap = new Map<string, Map<string, number>>();
      const scoredGameIds = new Set<string>();
      if (linkedGameIds.size > 0) {
        const ids = Array.from(linkedGameIds);
        const [games, records] = await Promise.all([
          GameModel.find({ league: league._id, gameId: { $in: ids } })
            .select("gameId results")
            .lean<Game[]>(),
          GameRecordModel.find({ gameId: { $in: ids } })
            .select("gameId byUserData.userDbId byUserData.deltaPoints")
            .lean<GameRecord[]>(),
        ]);

        const storedByGameId = new Map<string, Map<string, number>>();
        for (const record of records) {
          const userDeltas = new Map<string, number>();
          for (const ud of record.byUserData ?? []) {
            userDeltas.set(ud.userDbId.toString(), ud.deltaPoints);
          }
          storedByGameId.set(record.gameId, userDeltas);
        }

        for (const game of games) {
          if (!game.gameId) {
            continue;
          }
          const results = game.results ?? [];
          // Skip placeholder games whose results aren't hydrated yet.
          if (!isGameScored(results)) {
            continue;
          }
          scoredGameIds.add(game.gameId);
          const stored = storedByGameId.get(game.gameId);
          const sharedDeltas = computePlayerDeltas(
            results.map((r) => ({ score: r.score })),
            league.rulesConfig.gameRules
          );
          const userDeltas = new Map<string, number>();
          for (let i = 0; i < results.length; i++) {
            const userId = results[i].userId.toString();
            userDeltas.set(userId, stored?.get(userId) ?? sharedDeltas[i]);
          }
          gameDeltaMap.set(game.gameId, userDeltas);
        }
      }

      // Process each stage in the batch
      const batchEntries: BatchStageEntry[] = [];
      let batchHasAnyInProgress = false;
      let batchAllCompleted = true;

      for (const msg of schedulingMsgs) {
        const stage = config.finalPhase.stages.find(
          (s: FinalStageDefinition) => s.id === msg.stageId
        );
        if (!stage) {
          continue;
        }

        if (!msg.participantIds || msg.participantIds.length === 0) {
          console.warn(
            `[schedulingWorker] Skipping scheduling message ${msg.messageId} for stage ${msg.stageId} round ${msg.roundIndex}: no participantIds stored`
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
        const substituteMap = await loadSubstituteMap(
          league._id,
          league.officialSubstitutes ?? []
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
          userMap,
          substituteMap
        );

        // Merge freshly-resolved seating into the persisted tables. Linked
        // (played) tables are frozen by reprojectTables; unlinked tables adopt
        // the fresh seating, and the per-table wasInGame flag is preserved.
        const fresh = buildPersistedTables(resolved, participants);
        const { tables: merged, changed } = reprojectTables(
          msg.tables as PersistedTable[] | undefined,
          fresh
        );

        // Latch wasInGame per table: once any seat is seen in-game the table is
        // "playing", so when it later empties without a linked game we can show
        // "waiting for game log" instead of reverting to lobby icons.
        let wasInGameChanged = false;
        const tableInGame = merged.map((table, t) => {
          const seats = resolved[t] ?? [];
          const inGame = seats.some(
            (seat) =>
              seat.platformAccountId != null &&
              readyMap?.[String(seat.platformAccountId)] === "in-game"
          );
          if (inGame && !table.wasInGame) {
            table.wasInGame = true;
            wasInGameChanged = true;
          }
          return inGame;
        });

        // Determine per-stage status. A round is completed strictly when every
        // table is linked to a fully scored game; it is in progress while any
        // game is being played, has linked, or a table is waiting for its log.
        // Tables linked only to a placeholder game don't count as scored yet,
        // so the round stays in progress until the real results arrive.
        const isScored = (table: PersistedTable): boolean =>
          Boolean(table.gameId) && scoredGameIds.has(table.gameId as string);
        const allScored = merged.length > 0 && merged.every(isScored);
        const anyLinked = merged.some((table) => Boolean(table.gameId));
        const anyWasInGame = merged.some((table) => table.wasInGame);

        let newStatus: SchedulingStatus = msg.status as SchedulingStatus;
        if (msg.status !== "completed") {
          if (allScored) {
            newStatus = "completed";
          } else if (anyInGame || anyLinked || anyWasInGame) {
            newStatus = "in_progress";
          }
        }

        // Persist status change
        if (newStatus !== msg.status) {
          const update: Record<string, unknown> = { status: newStatus };
          if (newStatus === "in_progress" && !msg.launchedAt) {
            update.launchedAt = new Date();
          }
          if (newStatus === "completed" && !msg.completedAt) {
            update.completedAt = new Date();
          }
          await SchedulingMessageModel.updateOne(
            { _id: msg._id },
            { $set: update }
          );
        }

        // Persist the merged seating when the roster changed or a wasInGame
        // flag latched. Skip once completed: every table is then linked and
        // frozen, with its flags already stored.
        if ((changed || wasInGameChanged) && newStatus !== "completed") {
          await SchedulingMessageModel.updateOne(
            { _id: msg._id },
            { $set: { tables: merged } }
          );
        }

        if (newStatus === "in_progress") {
          batchHasAnyInProgress = true;
        }
        if (newStatus !== "completed") {
          batchAllCompleted = false;
        }

        // Per-table render state for the composer: a table linked to a scored
        // game shows its delta scores; a table linked only to a not-yet-hydrated
        // (placeholder) game, or one that has emptied without a link, is waiting
        // for its game log; a table still being played shows live lobby icons.
        const tableRenders: TableRender[] = merged.map((table, t) => {
          if (table.gameId && scoredGameIds.has(table.gameId)) {
            return {
              state: "finished",
              deltaByUserId: gameDeltaMap.get(table.gameId) ?? new Map(),
            };
          }
          if (table.gameId) {
            return { state: "waiting-log" };
          }
          if (tableInGame[t]) {
            return { state: "live" };
          }
          if (table.wasInGame) {
            return { state: "waiting-log" };
          }
          return { state: "live" };
        });

        batchEntries.push({
          stageName: stage.id,
          roundIndex: msg.roundIndex,
          totalRounds: scheduling.length,
          resolved,
          status: newStatus,
          tableRenders,
        });
      }

      // Update the shared Discord message with the combined content.
      // While the whole batch is still "upcoming" we throttle edits: the
      // things that move between polls are the ready icons and the roster
      // (a captain may register a substitution at any time), so we skip the
      // edit only when neither has changed since the previous cycle.
      if (batchEntries.length > 0) {
        const content = composeBatchMessage(batchEntries, readyMap);
        const allUpcoming = batchEntries.every((e) => e.status === "upcoming");
        const readySignature = readyMap
          ? Object.entries(readyMap)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => `${k}:${v}`)
              .join(",")
          : "";

        // Roster signature: captures the resolved seat occupants so a newly
        // registered substitution forces exactly one refresh even when the
        // ready signature is otherwise unchanged (e.g. platforms without
        // lobby polling, where readyMap is always empty).
        const rosterSignature = batchEntries
          .map((entry) =>
            entry.resolved
              .map((table) =>
                table
                  .map(
                    (seat) =>
                      `${entry.stageName}/${entry.roundIndex}/${seat.teamIndex}/${seat.playerIndex}:${seat.platformAccountId ?? seat.userName}`
                  )
                  .join(",")
              )
              .join("|")
          )
          .join("||");

        const signature = `${rosterSignature}##${readySignature}`;

        const shouldSkipEdit =
          allUpcoming &&
          lastUpcomingReadySignatures.get(messageId) === signature;

        if (!shouldSkipEdit) {
          await editChannelMessage(channelId, messageId, content);
        }

        if (allUpcoming) {
          lastUpcomingReadySignatures.set(messageId, signature);
        } else {
          lastUpcomingReadySignatures.delete(messageId);
        }
      }

      // Clear substitutions once the whole batch is finished. Doing it earlier
      // (e.g. on the upcoming → in_progress transition) would cause the live
      // message to revert to the original roster while the games are still
      // being played, hiding the substitute mid-round.
      //
      // Round-targeted substitutions are only removed once their last targeted
      // round has completed, so a sub spanning several rounds survives until it
      // has truly been consumed.
      if (batchAllCompleted) {
        // Map each stage in this batch to its just-completed round (1-based).
        const completedRoundByStage = new Map<string, number>();
        for (const m of schedulingMsgs) {
          completedRoundByStage.set(m.stageId, m.roundIndex + 1);
        }

        const subs = await SubstitutionModel.find({
          league: new mongoose.Types.ObjectId(leagueId),
        }).lean();
        const subIdsToDelete: mongoose.Types.ObjectId[] = [];
        for (const sub of subs) {
          const completedRound = completedRoundByStage.get(sub.stageId);
          if (completedRound === undefined) {
            // Targets a stage that isn't part of this batch — leave untouched.
            continue;
          }
          const maxRound = Math.max(...sub.rounds);
          if (maxRound <= completedRound) {
            subIdsToDelete.push(sub._id);
          }
        }
        if (subIdsToDelete.length > 0) {
          await SubstitutionModel.deleteMany({ _id: { $in: subIdsToDelete } });
        }
        lastUpcomingReadySignatures.delete(messageId);
      }

      // Re-enqueue self if batch is not fully completed
      if (!batchAllCompleted) {
        const delay = batchHasAnyInProgress
          ? POLL_INTERVAL_IN_PROGRESS
          : POLL_INTERVAL_UPCOMING;

        await getSchedulingQueue().add(
          `scheduling-poll:${leagueId}:${messageId}`,
          { leagueId, messageId },
          { delay }
        );
      }
    };

    const work = runPoll();
    // Prevent an unhandled rejection if runPoll settles after the timeout wins.
    work.catch(() => undefined);
    await withTimeout(
      work,
      HANDLER_TIMEOUT_MS,
      `scheduling-poll ${job.data.messageId}`
    );
  },
  {
    connection: getRedisConnection(),
    concurrency: SCHEDULING_WORKER_CONCURRENCY,
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  }
);

schedulingWorker.on("error", (err) => {
  trackError(err, { env, source: "schedulingWorker" });
});

// Self-heal a broken poll loop. Each successful run re-enqueues the next poll
// at the end of the handler; a terminal failure (timeout / repeated error)
// would otherwise silently stop polling this batch until the reconciler runs.
// On the final failed attempt we push a fresh delayed poll so the loop resumes.
schedulingWorker.on("failed", (job, err) => {
  if (!job) {
    return;
  }
  trackError(err, {
    env,
    source: "schedulingWorker.failed",
    messageId: job.data?.messageId,
    attemptsMade: job.attemptsMade,
  });

  const maxAttempts = job.opts?.attempts ?? 1;
  if (job.attemptsMade < maxAttempts) {
    // BullMQ will retry — don't pile on an extra job.
    return;
  }
  const { leagueId, messageId } = job.data ?? {};
  if (!leagueId || !messageId) {
    return;
  }
  getSchedulingQueue()
    .add(
      `scheduling-poll:${leagueId}:${messageId}`,
      { leagueId, messageId },
      { delay: POLL_INTERVAL_IN_PROGRESS }
    )
    .catch((reEnqueueError) => {
      console.error(
        "[schedulingWorker] failed to re-enqueue after terminal failure:",
        reEnqueueError
      );
    });
});

// Eagerly initialize DB
ensureInitialized().catch(() => {});

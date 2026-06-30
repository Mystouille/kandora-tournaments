import { type League } from "~/db/League";
import type {
  FinalStageDefinition,
  LeagueTypeConfig,
} from "~/services/league-configs/types";
import type {
  SeatAssignment,
  StageScheduling,
} from "~/services/league-configs/teamBracketSeating";
import {
  generateTeamBracketSeating,
  generateIndividualScheduling,
} from "~/services/league-configs/teamBracketSeating";
import { TeamModel, type Team } from "~/db/Team";
import {
  SchedulingMessageModel,
  type SchedulingMessage,
  type SchedulingStatus,
} from "~/db/SchedulingMessage";
import { SubstitutionModel } from "~/db/Substitution";
import { GameModel, type Game } from "~/db/Game";
import { GameRecordModel, type GameRecord } from "~/db/GameRecord";
import { computePlayerDeltas, isGameScored } from "~/services/leagueUtils";
import {
  sendChannelMessage,
  editChannelMessage,
} from "~/services/discordPublisher.server";
import { resolvePlayerDisplay } from "~/services/playerDisplay.server";
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubstituteType = "team" | "official";

export interface ResolvedSeat {
  teamIndex: number;
  playerIndex: number;
  /** Resolved seat occupant (declared substitutions already applied). */
  userId: mongoose.Types.ObjectId;
  teamName: string;
  userName: string;
  discordId: string | null;
  platformName: string | null;
  platformAccountId: string | number | null;
  substituteType: SubstituteType | null;
}

export type ResolvedTable = ResolvedSeat[];
export type ResolvedRound = ResolvedTable[];

/** Per-player ready status derived from the platform lobby. */
export type PlayerReadyState =
  | "online"
  | "ready"
  | "in-game"
  | "offline"
  | "unknown";

export interface PlayerReadyMap {
  [platformAccountId: string]: PlayerReadyState;
}

// ---------------------------------------------------------------------------
// Resolve scheduling entries → concrete players
// ---------------------------------------------------------------------------

/**
 * Map a scheduling array for a specific round into concrete players.
 *
 * @param stage - The stage definition
 * @param scheduling - The generated scheduling array
 * @param roundIndex - 0-based round index
 * @param participants - Participants in stage order (index 0 = team/player 1 in scheduling)
 * @param userMap - Map of user ObjectId → { name, platformAccountId }
 */
export function resolveRound(
  stage: FinalStageDefinition,
  scheduling: StageScheduling,
  roundIndex: number,
  participants: StageParticipant[],
  userMap: Map<
    string,
    {
      name: string;
      discordId: string | null;
      platformName: string | null;
      platformAccountId: string | number | null;
    }
  >,
  substituteMap?: Map<string, SubstituteType>
): ResolvedRound {
  if (roundIndex < 0 || roundIndex >= scheduling.length) {
    throw new Error(
      `No scheduling data for stage "${stage.id}" round ${roundIndex}`
    );
  }

  const round = scheduling[roundIndex];
  return round.map((table: SeatAssignment[]) =>
    table.map((seat: SeatAssignment) => {
      const participant = participants[seat.team - 1];
      if (!participant) {
        throw new Error(
          `Stage "${stage.id}" scheduling references participant ${seat.team} but only ${participants.length} in stage`
        );
      }
      const memberId = participant.memberIds[seat.player - 1];
      if (!memberId) {
        throw new Error(
          `Participant "${participant.displayName}" has no member at index ${seat.player} (1-based)`
        );
      }
      const user = userMap.get(memberId.toString());
      return {
        teamIndex: seat.team,
        playerIndex: seat.player,
        userId: memberId,
        teamName: participant.displayName,
        userName: user?.name ?? "Unknown",
        discordId: user?.discordId ?? null,
        platformName: user?.platformName ?? null,
        platformAccountId: user?.platformAccountId ?? null,
        substituteType: substituteMap?.get(memberId.toString()) ?? null,
      };
    })
  );
}

// ---------------------------------------------------------------------------
// Persisted seating (SchedulingMessage.tables[])
// ---------------------------------------------------------------------------

// Pure helpers live in `persistedTables.ts` so the freeze/adopt merge logic can
// be unit tested without this module's database/Discord dependencies. Re-export
// them here so existing call sites keep importing from one place.
export {
  buildPersistedTables,
  reprojectTables,
  type PersistedSeat,
  type PersistedTable,
  type PersistedSubType,
} from "./persistedTables";

// ---------------------------------------------------------------------------
// Compose Discord message content
// ---------------------------------------------------------------------------

function readyIndicator(state: PlayerReadyState | undefined): string {
  switch (state) {
    case "ready":
      return "✅";
    case "online":
      return "🟡";
    case "in-game":
      return "🎮";
    case "offline":
      return "❌";
    default:
      return "❔";
  }
}

function statusLabel(status: SchedulingStatus): string {
  switch (status) {
    case "upcoming":
      return "⏳ Waiting for players";
    case "in_progress":
      return "▶️ In Progress";
    case "completed":
      return "✅ Completed";
  }
}

/** Per-table render state derived by the worker and consumed by the composer. */
export type TableRenderState = "live" | "waiting-log" | "finished";

export interface TableRender {
  state: TableRenderState;
  /**
   * Per-user delta scores for a finished table, keyed by `userId.toString()`.
   * Missing entries render as an em dash (e.g. an undeclared substitute whose
   * id isn't in the resolved seating).
   */
  deltaByUserId?: Map<string, number>;
}

/**
 * Format a signed delta score for display: positive values gain a leading "+",
 * negative values keep their sign, and a missing score renders as an em dash.
 */
function formatDelta(delta: number | undefined): string {
  if (delta === undefined) {
    return "—";
  }
  const rounded = Math.round(delta * 10) / 10;
  const fixed = rounded.toFixed(1);
  return rounded > 0 ? `+${fixed}` : fixed;
}

export function composeRoundMessage(
  stageName: string,
  roundIndex: number,
  totalRounds: number,
  resolved: ResolvedRound,
  status: SchedulingStatus,
  readyMap?: PlayerReadyMap,
  tableRenders?: TableRender[],
  lastUpdated?: Date
): string {
  const lines: string[] = [];

  lines.push(
    `**${stageName.toUpperCase()} — Round ${roundIndex + 1}/${totalRounds}** ${statusLabel(status)}`
  );
  lines.push("");

  for (let t = 0; t < resolved.length; t++) {
    const table = resolved[t];
    const render = tableRenders?.[t];
    const state: TableRenderState = render?.state ?? "live";

    const headerSuffix =
      state === "finished"
        ? " ✅"
        : state === "waiting-log"
          ? " — waiting for game log"
          : "";
    lines.push(`__Table ${t + 1}__${headerSuffix}`);

    // For a finished table the per-player ready icon is replaced by that
    // player's delta score on the left, padded to a common width and wrapped in
    // inline code so the proportional Discord font keeps the names aligned.
    let paddedDeltas: string[] | undefined;
    if (state === "finished") {
      const raw = table.map((seat) =>
        formatDelta(render?.deltaByUserId?.get(seat.userId.toString()))
      );
      const width = raw.reduce((max, s) => Math.max(max, s.length), 0);
      paddedDeltas = raw.map((s) => `\`${s.padStart(width)}\``);
    }

    for (let s = 0; s < table.length; s++) {
      const seat = table[s];
      let prefix: string;
      if (state === "finished") {
        prefix = paddedDeltas![s];
      } else if (state === "waiting-log") {
        prefix = "⌛";
      } else {
        prefix =
          readyMap && seat.platformAccountId != null
            ? readyIndicator(readyMap[String(seat.platformAccountId)])
            : "";
      }
      const displayName = seat.discordId
        ? `<@${seat.discordId}>`
        : `**${seat.userName}**`;
      const platformLabel = seat.platformName ?? seat.userName;
      const subIndicator =
        seat.substituteType === "official"
          ? " 🆘"
          : seat.substituteType === "team"
            ? " 👥"
            : "";
      lines.push(
        `  ${prefix} ${seat.teamName} - ${displayName} (*${platformLabel}*)${subIndicator}`
      );
    }
    lines.push("");
  }

  if (lastUpdated) {
    const ts = Math.floor(lastUpdated.getTime() / 1000);
    lines.push(`-# Last updated <t:${ts}:R>`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Batch message — multiple stages in a single Discord message
// ---------------------------------------------------------------------------

export interface BatchStageEntry {
  stageName: string;
  roundIndex: number;
  totalRounds: number;
  resolved: ResolvedRound;
  status: SchedulingStatus;
  /** Per-table render state (finished / waiting-log / live), one per table. */
  tableRenders?: TableRender[];
}

/**
 * Compose a single Discord message containing one section per stage.
 * Used when multiple stages (e.g. QF1 + QF2) are scheduled simultaneously.
 */
export function composeBatchMessage(
  entries: BatchStageEntry[],
  readyMap?: PlayerReadyMap
): string {
  return entries
    .map((entry) =>
      composeRoundMessage(
        entry.stageName,
        entry.roundIndex,
        entry.totalRounds,
        entry.resolved,
        entry.status,
        // Once a round is completed it no longer polls — strip the
        // per-player status icons so the frozen message doesn't show
        // stale "online / ready / in-game" badges.
        entry.status === "completed" ? undefined : readyMap,
        entry.tableRenders
      )
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Post & update scheduling messages
// ---------------------------------------------------------------------------

/**
 * Post all scheduling messages for a stage to the scheduling channel.
 * Creates SchedulingMessage documents for each round.
 */
export async function postSchedulingMessages(
  league: League & { _id: mongoose.Types.ObjectId },
  stage: FinalStageDefinition,
  scheduling: StageScheduling,
  participants: StageParticipant[],
  userMap: Map<
    string,
    {
      name: string;
      discordId: string | null;
      platformName: string | null;
      platformAccountId: string | number | null;
    }
  >
): Promise<SchedulingMessage[]> {
  const channelId = league.discordConfig?.schedulingChannel;
  if (!channelId) {
    throw new Error("No schedulingChannel configured on league discordConfig");
  }

  if (scheduling.length === 0) {
    throw new Error(`Stage "${stage.id}" has an empty scheduling array`);
  }

  const created: SchedulingMessage[] = [];

  for (let r = 0; r < scheduling.length; r++) {
    const resolved = resolveRound(stage, scheduling, r, participants, userMap);
    const content = composeRoundMessage(
      stage.id,
      r,
      scheduling.length,
      resolved,
      "upcoming"
    );

    const msg = await sendChannelMessage(channelId, content);

    const doc = await SchedulingMessageModel.create({
      messageId: msg.id,
      league: league._id,
      stageId: stage.id,
      roundIndex: r,
      status: "upcoming",
    });

    created.push(doc.toObject() as SchedulingMessage);
  }

  return created;
}

/**
 * Update a scheduling message with new status and/or ready indicators.
 */
export async function updateSchedulingMessage(
  schedulingMsg: SchedulingMessage & { _id: mongoose.Types.ObjectId },
  league: League,
  stage: FinalStageDefinition,
  scheduling: StageScheduling,
  participants: StageParticipant[],
  userMap: Map<
    string,
    {
      name: string;
      discordId: string | null;
      platformName: string | null;
      platformAccountId: string | number | null;
    }
  >,
  newStatus: SchedulingStatus,
  readyMap?: PlayerReadyMap
): Promise<void> {
  const channelId = league.discordConfig?.schedulingChannel;
  if (!channelId) {
    return;
  }

  const resolved = resolveRound(
    stage,
    scheduling,
    schedulingMsg.roundIndex,
    participants,
    userMap
  );

  const content = composeRoundMessage(
    stage.id,
    schedulingMsg.roundIndex,
    scheduling.length,
    resolved,
    newStatus,
    readyMap
  );

  await editChannelMessage(channelId, schedulingMsg.messageId, content);

  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === "in_progress" && !schedulingMsg.launchedAt) {
    update.launchedAt = new Date();
  }
  if (newStatus === "completed" && !schedulingMsg.completedAt) {
    update.completedAt = new Date();
  }

  await SchedulingMessageModel.updateOne(
    { _id: schedulingMsg._id },
    { $set: update }
  );
}

// ---------------------------------------------------------------------------
// Helpers to load teams / users for a stage
// ---------------------------------------------------------------------------

/**
 * A participant in a bracket stage. Abstracts over teams (team mode) and
 * individual players (non-team mode) so that scheduling resolution works
 * uniformly.
 *
 * - **Team mode**: `id` = Team ObjectId, `displayName` = team display name,
 *   `memberIds` = team.members array.
 * - **Individual mode**: `id` = User ObjectId, `displayName` = player name,
 *   `memberIds` = `[userId]` (single-element array so `seat.player = 1` works).
 */
export interface StageParticipant {
  id: mongoose.Types.ObjectId;
  displayName: string;
  memberIds: mongoose.Types.ObjectId[];
}

/**
 * Decide whether a substitution record applies to a given stage/round.
 *
 * A substitution applies only when its `stageId` matches and its 1-based
 * `rounds` list contains the current round.
 *
 * When the caller does not provide a `stageId`/`roundIndex` context (e.g.
 * statistics aggregation), every substitution applies.
 */
function substitutionApplies(
  sub: { stageId?: string | null; rounds?: number[] | null },
  stageId?: string,
  roundIndex?: number
): boolean {
  if (stageId === undefined || roundIndex === undefined) {
    return true;
  }
  return sub.stageId === stageId && (sub.rounds ?? []).includes(roundIndex + 1);
}

/**
 * Like {@link loadStageParticipants} but takes the resolved participant IDs
 * directly. Useful for stages whose participants come from `fromStages`
 * (advancement) rather than direct `seeds` — e.g. the finals stage in a
 * multi-stage bracket, where `stage.seeds` is empty and the actual teams
 * are produced by `computeBracket()`.
 */
export async function loadStageParticipantsByIds(
  leagueId: mongoose.Types.ObjectId,
  participantIds: mongoose.Types.ObjectId[],
  isTeamMode: boolean,
  stageId?: string,
  roundIndex?: number
): Promise<StageParticipant[]> {
  if (isTeamMode) {
    const teams = await TeamModel.find({
      _id: { $in: participantIds },
      leagueId,
    }).lean();

    // Load active substitutions for this league, keeping only those that
    // apply to the current stage/round.
    const substitutions = (
      await SubstitutionModel.find({
        league: leagueId,
        team: { $ne: null },
      }).lean()
    ).filter((s) => substitutionApplies(s, stageId, roundIndex));

    const subMap = new Map(
      substitutions.map((s) => [
        `${s.team!.toString()}-${s.replacedPlayer.toString()}`,
        s.substitutePlayer as mongoose.Types.ObjectId,
      ])
    );

    const teamMap = new Map(
      teams.map((t) => {
        const teamId = t._id.toString();
        const members = (t as Team).roster.members.map((m) => {
          const key = `${teamId}-${m.toString()}`;
          return subMap.get(key) ?? m;
        });
        return [
          teamId,
          {
            id: t._id as mongoose.Types.ObjectId,
            displayName: (t as Team).displayName,
            memberIds: members,
          } satisfies StageParticipant,
        ];
      })
    );

    return participantIds
      .map((id) => teamMap.get(id.toString()))
      .filter((p): p is StageParticipant => p != null);
  }

  // Individual mode — load User documents
  const { UserModel } = await import("~/db/User");

  // Load active substitutions for this league (individual mode: no team
  // field), keeping only those that apply to the current stage/round.
  const substitutions = (
    await SubstitutionModel.find({
      league: leagueId,
    }).lean()
  ).filter((s) => substitutionApplies(s, stageId, roundIndex));

  const subMap = new Map(
    substitutions.map((s) => [
      s.replacedPlayer.toString(),
      s.substitutePlayer as mongoose.Types.ObjectId,
    ])
  );

  // Apply substitutions: swap participant IDs before loading users
  const resolvedIds = participantIds.map(
    (id) => subMap.get(id.toString()) ?? id
  );

  const users = await UserModel.find({
    _id: { $in: resolvedIds },
  }).lean();

  const userMap = new Map(
    users.map((u) => [
      u._id.toString(),
      {
        id: u._id as mongoose.Types.ObjectId,
        displayName: u.name,
        memberIds: [u._id as mongoose.Types.ObjectId],
      } satisfies StageParticipant,
    ])
  );

  return resolvedIds
    .map((id) => userMap.get(id.toString()))
    .filter((p): p is StageParticipant => p != null);
}

/**
 * Build a map of substitute user IDs → substitute type ("team" or "official").
 * This looks at active substitutions for the league and cross-references
 * the league's `officialSubstitutes` list.
 */
export async function loadSubstituteMap(
  leagueId: mongoose.Types.ObjectId,
  officialSubstituteIds: mongoose.Types.ObjectId[]
): Promise<Map<string, SubstituteType>> {
  const substitutions = await SubstitutionModel.find({
    league: leagueId,
  }).lean();

  const officialSet = new Set(officialSubstituteIds.map((id) => id.toString()));
  const map = new Map<string, SubstituteType>();

  for (const sub of substitutions) {
    const subPlayerId = sub.substitutePlayer.toString();
    if (officialSet.has(subPlayerId)) {
      map.set(subPlayerId, "official");
    } else {
      map.set(subPlayerId, "team");
    }
  }

  return map;
}

/**
 * Build a map of each declared substitute's userId → the participant id they
 * were registered to replace (the Team id in team mode, the replaced User id in
 * individual mode), sourced directly from the league's active Substitution
 * documents.
 *
 * This is the exact, recorded answer to "which side did this substitute play
 * for" and is preferred over deduction in bracket computation. Note that
 * substitution documents are deleted once their targeted round completes, so
 * the map only covers still-active rounds; callers fall back to deduction for
 * anything not present here.
 */
export async function buildOfficialSubstituteTeamMap(
  leagueId: mongoose.Types.ObjectId | string
): Promise<Map<string, string>> {
  const subs = await SubstitutionModel.find({ league: leagueId })
    .select("substitutePlayer team replacedPlayer")
    .lean();

  const map = new Map<string, string>();
  for (const sub of subs) {
    const participantId = sub.team
      ? sub.team.toString()
      : sub.replacedPlayer.toString();
    map.set(sub.substitutePlayer.toString(), participantId);
  }
  return map;
}

/**
 * Build a user map from stage participants.
 * In team mode, expands team members. In individual mode, each participant
 * is already a single user.
 */
export type SchedulingUserInfo = {
  name: string;
  discordId: string | null;
  platformName: string | null;
  platformAccountId: string | number | null;
};

/** Build a user map keyed by user id directly from a list of member ids. */
export async function buildUserMapForMemberIds(
  memberIds: mongoose.Types.ObjectId[],
  platform: string
): Promise<Map<string, SchedulingUserInfo>> {
  const { UserModel } = await import("~/db/User");

  const users = await UserModel.find({
    _id: { $in: memberIds },
  }).lean();

  const map = new Map<string, SchedulingUserInfo>();

  for (const user of users) {
    const display = resolvePlayerDisplay(user, { platform });
    map.set(user._id.toString(), {
      name: display.plainName,
      discordId: user.discordIdentity?.id ?? null,
      platformName: display.platformName,
      platformAccountId: display.platformAccountId,
    });
  }

  return map;
}

export async function buildUserMap(
  participants: StageParticipant[],
  platform: string
): Promise<Map<string, SchedulingUserInfo>> {
  return buildUserMapForMemberIds(
    participants.flatMap((p) => p.memberIds),
    platform
  );
}

// ---------------------------------------------------------------------------
// Completed-batch rendering (from persisted tables)
// ---------------------------------------------------------------------------

/**
 * Load the per-user delta scores for a set of games, keeping only games that
 * are fully scored (a placeholder game created from listing metadata before its
 * log hydrated has every `place` at 0 and must be ignored). Prefers the stored
 * `GameRecord.deltaPoints` and falls back to computing from the raw results.
 *
 * @returns `scoredGameIds` (games safe to treat as played) and `gameDeltaMap`
 * (gameId → userId → delta).
 */
export async function loadScoredGameDeltas(
  league: League & { _id: mongoose.Types.ObjectId },
  gameIds: Iterable<string>
): Promise<{
  scoredGameIds: Set<string>;
  gameDeltaMap: Map<string, Map<string, number>>;
}> {
  const ids = Array.from(new Set(gameIds));
  const scoredGameIds = new Set<string>();
  const gameDeltaMap = new Map<string, Map<string, number>>();
  if (ids.length === 0) {
    return { scoredGameIds, gameDeltaMap };
  }

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

  return { scoredGameIds, gameDeltaMap };
}

/**
 * Render the final Discord content for a completed scheduling batch from the
 * PERSISTED tables — i.e. the occupants actually recorded as having played,
 * including any official substitute. This is the correct source for a
 * completed round: declared substitutions are deleted on completion, so
 * re-resolving the seating would revert a subbed seat to the roster player and
 * lose both the name and the delta.
 *
 * @param gameDeltaMap gameId → userId → delta, as produced by
 * {@link loadScoredGameDeltas}. A table linked to a game absent from this map
 * (not yet scored) renders as "waiting for game log".
 * @returns the combined message content, or `null` when no stage in the batch
 * could be resolved.
 */
export async function renderCompletedBatchFromPersisted(
  config: LeagueTypeConfig,
  league: League & { _id: mongoose.Types.ObjectId },
  messages: SchedulingMessage[],
  gameDeltaMap: Map<string, Map<string, number>>
): Promise<string | null> {
  const isTeamMode = config.isTeamMode !== false;
  const platform = league.platformConfig.platformName;
  const stages = config.finalPhase?.stages ?? [];

  const sections: string[] = [];
  for (const msg of messages) {
    const stage = stages.find(
      (s: FinalStageDefinition) => s.id === msg.stageId
    );
    if (!stage) {
      continue;
    }
    const tables = msg.tables ?? [];
    if (tables.length === 0) {
      continue;
    }

    const participants = await loadStageParticipantsByIds(
      league._id,
      (msg.participantIds ?? []) as mongoose.Types.ObjectId[],
      isTeamMode,
      msg.stageId,
      msg.roundIndex
    );
    const teamNameById = new Map(
      participants.map((p) => [p.id.toString(), p.displayName])
    );

    const seatUserIds = tables.flatMap((table) =>
      table.seats.map((seat) => seat.userId as mongoose.Types.ObjectId)
    );
    const userInfo = await buildUserMapForMemberIds(seatUserIds, platform);

    const resolved: ResolvedRound = tables.map((table) =>
      table.seats.map((seat): ResolvedSeat => {
        const info = userInfo.get(seat.userId.toString());
        return {
          teamIndex: 0,
          playerIndex: seat.seatIndex,
          userId: seat.userId as mongoose.Types.ObjectId,
          teamName: seat.teamId
            ? (teamNameById.get(seat.teamId.toString()) ?? "?")
            : "?",
          userName: info?.name ?? "Unknown",
          discordId: info?.discordId ?? null,
          platformName: info?.platformName ?? null,
          platformAccountId: info?.platformAccountId ?? null,
          substituteType: seat.subType ?? null,
        };
      })
    );

    const tableRenders: TableRender[] = tables.map((table) => {
      if (table.gameId && gameDeltaMap.has(table.gameId)) {
        return {
          state: "finished",
          deltaByUserId: gameDeltaMap.get(table.gameId)!,
        };
      }
      if (table.gameId) {
        return { state: "waiting-log" };
      }
      return { state: "live" };
    });

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

    sections.push(
      composeRoundMessage(
        stage.id,
        msg.roundIndex,
        scheduling.length,
        resolved,
        "completed",
        undefined,
        tableRenders
      )
    );
  }

  return sections.length > 0 ? sections.join("\n") : null;
}

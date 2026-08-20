import mongoose from "mongoose";
import { LeagueModel } from "~/core/models/tournament/League";
import { LeagueTypeConfigModel } from "~/core/models/tournament/LeagueTypeConfig";
import { LeagueUserModel } from "~/core/models/tournament/LeagueUser";
import {
  ScheduledGameModel,
  type ScheduledGame,
} from "~/core/models/tournament/ScheduledGame";
import { TeamModel } from "~/core/models/tournament/Team";
import { UserModel } from "~/core/models/shared/User";
import type { LeagueTypeConfig } from "~/core/types/league-config";
import type { PicturePair } from "~/types/pictures";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { emitLeagueUpdated } from "./cacheInvalidation.server";
import { resolveOrderedPhases } from "./league-configs";

export interface ScheduledGameSlotInput {
  seatIndex: number;
  participantId: string | null;
}

export interface ScheduledGameInput {
  id?: string;
  phaseId: string | null;
  scheduledAt: string;
  slots: ScheduledGameSlotInput[];
}

export interface NormalizedScheduledGameInput {
  id?: string;
  phaseId: string | null;
  scheduledAt: Date;
  slots: ScheduledGameSlotInput[];
}

export interface ScheduleValidationContext {
  leagueStartTime: Date;
  leagueEndTime: Date;
  validPhaseIds: ReadonlySet<string | null>;
  validParticipantIds: ReadonlySet<string>;
}

export class ScheduleValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly gameIndex?: number
  ) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

function validationError(
  code: string,
  message: string,
  gameIndex: number
): never {
  throw new ScheduleValidationError(code, message, gameIndex);
}

export function validateScheduledGames(
  games: ScheduledGameInput[],
  context: ScheduleValidationContext
): NormalizedScheduledGameInput[] {
  if (!Array.isArray(games)) {
    throw new ScheduleValidationError(
      "invalid-games",
      "Schedule games must be an array"
    );
  }

  const seenIds = new Set<string>();
  const simultaneousAssignments = new Set<string>();

  return games.map((game, gameIndex) => {
    if (game.id !== undefined) {
      if (!mongoose.isValidObjectId(game.id) || seenIds.has(game.id)) {
        validationError(
          "invalid-game-id",
          "Scheduled game IDs must be unique and valid",
          gameIndex
        );
      }
      seenIds.add(game.id);
    }

    const phaseId =
      typeof game.phaseId === "string" && game.phaseId.trim().length > 0
        ? game.phaseId.trim()
        : null;
    if (!context.validPhaseIds.has(phaseId)) {
      validationError(
        "invalid-phase",
        "Scheduled game references an unknown phase",
        gameIndex
      );
    }

    const scheduledAt = new Date(game.scheduledAt);
    if (
      Number.isNaN(scheduledAt.getTime()) ||
      scheduledAt < context.leagueStartTime ||
      scheduledAt > context.leagueEndTime
    ) {
      validationError(
        "invalid-date",
        "Scheduled game must be within the tournament dates",
        gameIndex
      );
    }

    if (!Array.isArray(game.slots) || game.slots.length !== 4) {
      validationError(
        "invalid-slots",
        "Scheduled game must contain exactly four slots",
        gameIndex
      );
    }

    const seatIndexes = new Set<number>();
    const participantIds = new Set<string>();
    const slots = game.slots.map((slot) => {
      if (
        !Number.isInteger(slot.seatIndex) ||
        slot.seatIndex < 0 ||
        slot.seatIndex > 3 ||
        seatIndexes.has(slot.seatIndex)
      ) {
        validationError(
          "invalid-slots",
          "Scheduled game seats must be unique indexes from 0 to 3",
          gameIndex
        );
      }
      seatIndexes.add(slot.seatIndex);

      const participantId = slot.participantId || null;
      if (
        participantId !== null &&
        !context.validParticipantIds.has(participantId)
      ) {
        validationError(
          "invalid-participant",
          "Scheduled game references a participant outside the roster",
          gameIndex
        );
      }
      if (participantId !== null && participantIds.has(participantId)) {
        validationError(
          "duplicate-participant",
          "A participant cannot occupy two seats in one game",
          gameIndex
        );
      }
      if (participantId !== null) {
        participantIds.add(participantId);
        const assignmentKey = `${scheduledAt.getTime()}:${participantId}`;
        if (simultaneousAssignments.has(assignmentKey)) {
          validationError(
            "participant-conflict",
            "A participant cannot play two games at the same time",
            gameIndex
          );
        }
        simultaneousAssignments.add(assignmentKey);
      }

      return { seatIndex: slot.seatIndex, participantId };
    });

    slots.sort((left, right) => left.seatIndex - right.seatIndex);
    return {
      id: game.id,
      phaseId,
      scheduledAt,
      slots,
    };
  });
}

export class LeagueScheduleError extends Error {
  constructor(
    public readonly code: "not-found" | "disabled" | "invalid-schedule",
    message: string
  ) {
    super(message);
    this.name = "LeagueScheduleError";
  }
}

export interface SchedulePhaseOption {
  id: string | null;
  kind: "regular" | "final" | "tournament";
}

export interface ScheduleParticipantOption {
  id: string;
  name: string;
  pictures: PicturePair | null;
}

export interface LeagueScheduleData {
  leagueId: string;
  leagueName: string;
  startTime: string;
  endTime: string;
  isTeamMode: boolean;
  platformName: string;
  phases: SchedulePhaseOption[];
  participants: ScheduleParticipantOption[];
  games: Array<{
    id: string;
    phaseId: string | null;
    scheduledAt: string;
    slots: ScheduledGameSlotInput[];
  }>;
}

interface ScheduleLeagueRecord {
  _id: mongoose.Types.ObjectId;
  name: string;
  startTime: Date;
  endTime: Date;
  hasSchedule?: boolean;
  rulesConfig: { isTeamMode: boolean };
  platformConfig: { platformName: string };
  leagueTypeConfig?: mongoose.Types.ObjectId | null;
}

interface ScheduleContext {
  league: ScheduleLeagueRecord;
  leagueTypeConfig: LeagueTypeConfig | null;
  phases: SchedulePhaseOption[];
  participants: ScheduleParticipantOption[];
}

export function resolveSchedulePhases(
  leagueTypeConfig: LeagueTypeConfig | null
): SchedulePhaseOption[] {
  const phases = resolveOrderedPhases(leagueTypeConfig);
  if (phases.length === 0) {
    return [{ id: null, kind: "tournament" }];
  }
  return phases.map((phase) => ({ id: phase.id, kind: phase.kind }));
}

async function loadScheduleContext(leagueId: string): Promise<ScheduleContext> {
  await connectToDatabase();
  const league = await LeagueModel.findById(leagueId)
    .select(
      "name startTime endTime hasSchedule rulesConfig.isTeamMode platformConfig.platformName leagueTypeConfig"
    )
    .lean<ScheduleLeagueRecord>();
  if (!league) {
    throw new LeagueScheduleError("not-found", "League not found");
  }
  if (league.hasSchedule !== true) {
    throw new LeagueScheduleError(
      "disabled",
      "This tournament does not use a schedule"
    );
  }

  const leagueTypeConfig = league.leagueTypeConfig
    ? await LeagueTypeConfigModel.findById(league.leagueTypeConfig).lean<LeagueTypeConfig>()
    : null;
  const phases = resolveSchedulePhases(leagueTypeConfig);

  let participants: ScheduleParticipantOption[];
  if (league.rulesConfig.isTeamMode) {
    const teams = await TeamModel.find({ leagueId: league._id })
      .select("_id displayName pictures")
      .sort({ displayName: 1, _id: 1 })
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          displayName: string;
          pictures?: PicturePair | null;
        }>
      >();
    participants = teams.map((team) => ({
      id: team._id.toString(),
      name: team.displayName,
      pictures: team.pictures ?? null,
    }));
  } else {
    const memberships = await LeagueUserModel.find({
      leagueId: league._id,
      isParticipant: { $ne: false },
    })
      .select("userId pictures")
      .sort({ _id: 1 })
      .lean<
        Array<{
          userId: mongoose.Types.ObjectId;
          pictures?: PicturePair | null;
        }>
      >();
    const users = await UserModel.find({
      _id: { $in: memberships.map((membership) => membership.userId) },
      isDeleted: { $ne: true },
    })
      .select("_id name firstName discordIdentity.displayName")
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          name: string;
          firstName?: string;
          discordIdentity?: { displayName?: string };
        }>
      >();
    const userMap = new Map(users.map((user) => [user._id.toString(), user]));
    participants = memberships.flatMap((membership) => {
      const user = userMap.get(membership.userId.toString());
      if (!user) {
        return [];
      }
      return [
        {
          id: user._id.toString(),
          name:
            user.firstName || !user.discordIdentity?.displayName
              ? user.name
              : user.discordIdentity.displayName,
          pictures: membership.pictures ?? null,
        },
      ];
    });
  }

  return { league, leagueTypeConfig, phases, participants };
}

function serializeScheduledGame(game: ScheduledGame) {
  return {
    id: game._id.toString(),
    phaseId: game.phaseId ?? null,
    scheduledAt: game.scheduledAt.toISOString(),
    slots: [...game.slots]
      .sort((left, right) => left.seatIndex - right.seatIndex)
      .map((slot) => ({
        seatIndex: slot.seatIndex,
        participantId: slot.participantId?.toString() ?? null,
      })),
  };
}

async function loadScheduledGames(leagueId: mongoose.Types.ObjectId) {
  const games = await ScheduledGameModel.find({ league: leagueId })
    .sort({ scheduledAt: 1, _id: 1 })
    .lean<ScheduledGame[]>();
  return games.map(serializeScheduledGame);
}

export async function getLeagueScheduleData(
  leagueId: string
): Promise<LeagueScheduleData> {
  const context = await loadScheduleContext(leagueId);
  return {
    leagueId: context.league._id.toString(),
    leagueName: context.league.name,
    startTime: context.league.startTime.toISOString(),
    endTime: context.league.endTime.toISOString(),
    isTeamMode: context.league.rulesConfig.isTeamMode,
    platformName: context.league.platformConfig.platformName,
    phases: context.phases,
    participants: context.participants,
    games: await loadScheduledGames(context.league._id),
  };
}

export async function replaceLeagueSchedule(
  leagueId: string,
  games: ScheduledGameInput[]
): Promise<LeagueScheduleData> {
  const context = await loadScheduleContext(leagueId);
  let normalized: NormalizedScheduledGameInput[];
  try {
    normalized = validateScheduledGames(games, {
      leagueStartTime: context.league.startTime,
      leagueEndTime: context.league.endTime,
      validPhaseIds: new Set(context.phases.map((phase) => phase.id)),
      validParticipantIds: new Set(
        context.participants.map((participant) => participant.id)
      ),
    });
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      throw new LeagueScheduleError("invalid-schedule", error.message);
    }
    throw error;
  }

  const existingIds = normalized.flatMap((game) =>
    game.id ? [new mongoose.Types.ObjectId(game.id)] : []
  );
  const ownedCount = await ScheduledGameModel.countDocuments({
    _id: { $in: existingIds },
    league: context.league._id,
  });
  if (ownedCount !== existingIds.length) {
    throw new LeagueScheduleError(
      "invalid-schedule",
      "Schedule contains a game from another tournament"
    );
  }

  const targetGames = normalized.map((game) => ({
    ...game,
    objectId: game.id
      ? new mongoose.Types.ObjectId(game.id)
      : new mongoose.Types.ObjectId(),
  }));
  const targetIds = targetGames.map((game) => game.objectId);
  await Promise.all(
    targetGames.map((game) =>
      ScheduledGameModel.updateOne(
        { _id: game.objectId, league: context.league._id },
        {
          $set: {
            league: context.league._id,
            phaseId: game.phaseId,
            scheduledAt: game.scheduledAt,
            slots: game.slots.map((slot) => ({
              seatIndex: slot.seatIndex,
              participantId: slot.participantId
                ? new mongoose.Types.ObjectId(slot.participantId)
                : null,
            })),
          },
        },
        { upsert: true }
      ).exec()
    )
  );

  await ScheduledGameModel.deleteMany({
    league: context.league._id,
    ...(targetIds.length > 0 ? { _id: { $nin: targetIds } } : {}),
  }).exec();

  emitLeagueUpdated(leagueId);
  return {
    leagueId: context.league._id.toString(),
    leagueName: context.league.name,
    startTime: context.league.startTime.toISOString(),
    endTime: context.league.endTime.toISOString(),
    isTeamMode: context.league.rulesConfig.isTeamMode,
    platformName: context.league.platformConfig.platformName,
    phases: context.phases,
    participants: context.participants,
    games: await loadScheduledGames(context.league._id),
  };
}
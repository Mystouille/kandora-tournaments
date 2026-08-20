import mongoose from "mongoose";
import { UserModel } from "~/core/models/shared/User";
import {
  LeagueModel,
  Platform,
} from "~/core/models/tournament/League";
import { LeagueTypeConfigModel } from "~/core/models/tournament/LeagueTypeConfig";
import { LeagueUserModel } from "~/core/models/tournament/LeagueUser";
import {
  LiveGameModel,
  type LiveGame,
} from "~/core/models/tournament/LiveGame";
import {
  ScheduledGameModel,
  type ScheduledGame,
} from "~/core/models/tournament/ScheduledGame";
import { TeamModel } from "~/core/models/tournament/Team";
import type { LeagueTypeConfig } from "~/core/types/league-config";
import { isGameEnabled } from "~/game/feature-gate";
import type { PicturePair } from "~/types/pictures";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { resolveGamePhaseId } from "./league-configs";
import {
  LeagueScheduleError,
  resolveSchedulePhases,
} from "./scheduleService.server";
import {
  matchScheduledGamesToLiveGames,
  resolveLiveTeamIds,
  type TeamMembership,
} from "./scheduleLiveMatching";

interface PublicLeagueRecord {
  _id: mongoose.Types.ObjectId;
  name: string;
  startTime: Date;
  endTime: Date;
  isDisplayed?: boolean;
  hasSchedule?: boolean;
  phaseCutoffTimes?: Date[];
  rulesConfig: { isTeamMode: boolean };
  platformConfig: { platformName: Platform };
  leagueTypeConfig?: mongoose.Types.ObjectId | null;
}

interface TeamRecord {
  _id: mongoose.Types.ObjectId;
  displayName: string;
  pictures?: PicturePair | null;
  roster: {
    captain?: mongoose.Types.ObjectId;
    members?: mongoose.Types.ObjectId[];
    substitutes?: mongoose.Types.ObjectId[];
  };
  finalsRoster?: {
    captain?: mongoose.Types.ObjectId;
    members?: mongoose.Types.ObjectId[];
    substitutes?: mongoose.Types.ObjectId[];
  } | null;
}

interface PublicParticipant {
  id: string;
  name: string;
  pictures: PicturePair | null;
}

function rosterUserIds(roster: TeamRecord["roster"] | null | undefined) {
  if (!roster) {
    return [];
  }
  return [
    ...new Set(
      [
        roster.captain,
        ...(roster.members ?? []),
        ...(roster.substitutes ?? []),
      ]
        .filter((userId): userId is mongoose.Types.ObjectId => Boolean(userId))
        .map((userId) => userId.toString())
    ),
  ];
}

export async function getPublicLeagueSchedule(leagueId: string) {
  await connectToDatabase();
  const league = await LeagueModel.findOne({
    _id: leagueId,
    isDisplayed: true,
  })
    .select(
      "name startTime endTime isDisplayed hasSchedule phaseCutoffTimes rulesConfig.isTeamMode platformConfig.platformName leagueTypeConfig"
    )
    .lean<PublicLeagueRecord>();
  if (!league || league.hasSchedule !== true) {
    throw new LeagueScheduleError("not-found", "Schedule not found");
  }

  const leagueTypeConfig = league.leagueTypeConfig
    ? await LeagueTypeConfigModel.findById(league.leagueTypeConfig).lean<LeagueTypeConfig>()
    : null;
  const phases = resolveSchedulePhases(leagueTypeConfig);
  const phaseOrder = new Map(
    phases.map((phase, index) => [phase.id, index] as const)
  );
  const scheduledGames = await ScheduledGameModel.find({ league: league._id })
    .lean<ScheduledGame[]>();
  scheduledGames.sort(
    (left, right) =>
      (phaseOrder.get(left.phaseId ?? null) ?? 0) -
        (phaseOrder.get(right.phaseId ?? null) ?? 0) ||
      left.scheduledAt.getTime() - right.scheduledAt.getTime() ||
      left._id.toString().localeCompare(right._id.toString())
  );

  const participantById = new Map<string, PublicParticipant>();
  let teamMemberships: TeamMembership[] = [];
  if (league.rulesConfig.isTeamMode) {
    const teams = await TeamModel.find({ leagueId: league._id })
      .select("_id displayName pictures roster finalsRoster")
      .lean<TeamRecord[]>();
    for (const team of teams) {
      const id = team._id.toString();
      participantById.set(id, {
        id,
        name: team.displayName,
        pictures: team.pictures ?? null,
      });
    }
    teamMemberships = teams.map((team) => ({
      id: team._id.toString(),
      rosterUserIds: rosterUserIds(team.roster),
      finalsRosterUserIds: team.finalsRoster
        ? rosterUserIds(team.finalsRoster)
        : null,
    }));
  } else {
    const participantIds = [
      ...new Set(
        scheduledGames.flatMap((game) =>
          game.slots.flatMap((slot) =>
            slot.participantId ? [slot.participantId.toString()] : []
          )
        )
      ),
    ];
    const [users, memberships] = await Promise.all([
      UserModel.find({
        _id: { $in: participantIds },
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
        >(),
      LeagueUserModel.find({
        leagueId: league._id,
        userId: { $in: participantIds },
      })
        .select("userId pictures")
        .lean<
          Array<{
            userId: mongoose.Types.ObjectId;
            pictures?: PicturePair | null;
          }>
        >(),
    ]);
    const pictureByUserId = new Map(
      memberships.map((membership) => [
        membership.userId.toString(),
        membership.pictures ?? null,
      ])
    );
    for (const user of users) {
      const id = user._id.toString();
      participantById.set(id, {
        id,
        name:
          user.firstName || !user.discordIdentity?.displayName
            ? user.name
            : user.discordIdentity.displayName,
        pictures: pictureByUserId.get(id) ?? null,
      });
    }
  }

  let liveMatches = new Map<
    string,
    ReturnType<typeof matchScheduledGamesToLiveGames> extends Map<
      string,
      infer Match
    >
      ? Match
      : never
  >();
  if (
    league.platformConfig.platformName === Platform.TENHOU &&
    isGameEnabled()
  ) {
    const liveGames = await LiveGameModel.find({
      league: league._id,
      platform: "tenhou",
    }).lean<LiveGame[]>();
    const matchableLiveGames = liveGames.map((liveGame) => {
      const phaseId = resolveGamePhaseId(
        liveGame,
        leagueTypeConfig,
        league
      );
      const userIds = [...(liveGame.players ?? [])]
        .sort((left, right) => left.seat - right.seat)
        .map((player) => player.userId?.toString() ?? null);
      const participantIds = league.rulesConfig.isTeamMode
        ? (resolveLiveTeamIds(
            userIds,
            teamMemberships,
            phaseId !== null && phaseId === leagueTypeConfig?.finalPhase?.id
          ) ?? userIds.map(() => null))
        : userIds;
      return {
        gameId: liveGame.gameId,
        platform: liveGame.platform,
        phaseId,
        startTime: liveGame.startTime ?? null,
        participantIds,
        watchId: liveGame.watchId ?? null,
      };
    });
    liveMatches = matchScheduledGamesToLiveGames(
      scheduledGames.map((game) => ({
        id: game._id.toString(),
        phaseId: game.phaseId ?? null,
        scheduledAt: game.scheduledAt,
        participantIds: [...game.slots]
          .sort((left, right) => left.seatIndex - right.seatIndex)
          .map((slot) => slot.participantId?.toString() ?? null),
      })),
      matchableLiveGames
    );
  }

  return {
    leagueId: league._id.toString(),
    leagueName: league.name,
    isTeamMode: league.rulesConfig.isTeamMode,
    phases,
    games: scheduledGames.map((game) => {
      const liveGame = liveMatches.get(game._id.toString());
      return {
        id: game._id.toString(),
        phaseId: game.phaseId ?? null,
        scheduledAt: game.scheduledAt.toISOString(),
        slots: [...game.slots]
          .sort((left, right) => left.seatIndex - right.seatIndex)
          .map((slot) => ({
            seatIndex: slot.seatIndex,
            participant: slot.participantId
              ? (participantById.get(slot.participantId.toString()) ?? null)
              : null,
          })),
        live:
          liveGame?.watchId != null
            ? { status: "ongoing" as const, watchId: liveGame.watchId }
            : null,
      };
    }),
  };
}
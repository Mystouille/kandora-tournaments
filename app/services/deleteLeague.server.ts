import mongoose from "mongoose";
import { ReplayLogModel } from "../core/models/game/ReplayLog";
import { ReplayReviewModel } from "../core/models/game/ReplayReview";
import { UserModel } from "../core/models/shared/User";
import { BracketModel } from "../core/models/tournament/Bracket";
import { GameModel } from "../core/models/tournament/Game";
import { GameRecordModel } from "../core/models/tournament/GameRecord";
import { LeagueModel } from "../core/models/tournament/League";
import { LeagueGameMessageModel } from "../core/models/tournament/LeagueGameMessage";
import { LeagueRankingMessageModel } from "../core/models/tournament/LeagueRankingMessage";
import { LeagueUserModel } from "../core/models/tournament/LeagueUser";
import { LiveGameModel } from "../core/models/tournament/LiveGame";
import { OngoingGameMessageModel } from "../core/models/tournament/OngoingGameMessage";
import { RankingModel } from "../core/models/tournament/Ranking";
import { SchedulingMessageModel } from "../core/models/tournament/SchedulingMessage";
import { SubstitutionModel } from "../core/models/tournament/Substitution";
import { TeamModel } from "../core/models/tournament/Team";
import { emitLeagueUpdated } from "./cacheInvalidation.server";
import { getLeagueQueue } from "./queue.server";
import { connectToDatabase } from "../utils/dbConnection.server";

interface UserReferenceSource {
  officialSubstitutes?: mongoose.Types.ObjectId[] | null;
  participantIds?: mongoose.Types.ObjectId[] | null;
  players?: Array<
    mongoose.Types.ObjectId | { userId?: mongoose.Types.ObjectId | null }
  > | null;
  replacedPlayer?: mongoose.Types.ObjectId | null;
  seedings?: Array<{ userId?: mongoose.Types.ObjectId | null }> | null;
  substitutePlayer?: mongoose.Types.ObjectId | null;
  tables?: Array<{
    seats?: Array<{ userId?: mongoose.Types.ObjectId | null }> | null;
  }> | null;
  userId?: mongoose.Types.ObjectId | null;
  results?: Array<{
    userId?: mongoose.Types.ObjectId;
    subId?: mongoose.Types.ObjectId | null;
  }> | null;
  roster?: RosterReference | null;
  finalsRoster?: RosterReference | null;
}

interface RosterReference {
  captain?: mongoose.Types.ObjectId;
  members?: mongoose.Types.ObjectId[] | null;
  substitutes?: mongoose.Types.ObjectId[] | null;
}

export interface DeleteLeagueResult {
  deletedGames: number;
  preservedGames: number;
  deletedUsers: number;
}

function addUserId(target: Set<string>, value?: mongoose.Types.ObjectId | null) {
  if (value) {
    target.add(value.toString());
  }
}

function addRosterUserIds(target: Set<string>, roster?: RosterReference | null) {
  if (!roster) {
    return;
  }

  addUserId(target, roster.captain);
  for (const userId of roster.members ?? []) {
    addUserId(target, userId);
  }
  for (const userId of roster.substitutes ?? []) {
    addUserId(target, userId);
  }
}

export function collectReferencedUserIds(
  sources: UserReferenceSource[]
): string[] {
  const userIds = new Set<string>();

  for (const source of sources) {
    addUserId(userIds, source.userId);
    addUserId(userIds, source.replacedPlayer);
    addUserId(userIds, source.substitutePlayer);
    for (const userId of source.officialSubstitutes ?? []) {
      addUserId(userIds, userId);
    }
    for (const userId of source.participantIds ?? []) {
      addUserId(userIds, userId);
    }
    for (const player of source.players ?? []) {
      if (player instanceof mongoose.Types.ObjectId) {
        addUserId(userIds, player);
      } else {
        addUserId(userIds, player.userId);
      }
    }
    for (const seeding of source.seedings ?? []) {
      addUserId(userIds, seeding.userId);
    }
    for (const table of source.tables ?? []) {
      for (const seat of table.seats ?? []) {
        addUserId(userIds, seat.userId);
      }
    }
    for (const result of source.results ?? []) {
      addUserId(userIds, result.userId);
      addUserId(userIds, result.subId);
    }
    addRosterUserIds(userIds, source.roster);
    addRosterUserIds(userIds, source.finalsRoster);
  }

  return [...userIds];
}

interface GameReference {
  _id: mongoose.Types.ObjectId;
  gameId?: string | null;
}

export function partitionGamesByReview(
  games: GameReference[],
  reviewedSourceGameIds: string[]
) {
  const reviewedIds = new Set(reviewedSourceGameIds);
  return {
    deleteIds: games
      .filter((game) => !game.gameId || !reviewedIds.has(game.gameId))
      .map((game) => game._id.toString()),
    preserveIds: games
      .filter((game) => game.gameId && reviewedIds.has(game.gameId))
      .map((game) => game._id.toString()),
  };
}

export function standaloneUserDeletionFilter(
  candidateUserIds: string[],
  linkedElsewhereUserIds: string[]
) {
  return {
    _id: {
      $in: candidateUserIds,
      $nin: linkedElsewhereUserIds,
    },
    discordIdentity: { $exists: false },
    email: { $exists: false },
    passwordHash: { $exists: false },
    isAdmin: { $ne: true },
    isEditor: { $ne: true },
    isTNTMember: { $ne: true },
  };
}

async function removeLeagueScheduler(leagueId: string) {
  try {
    await getLeagueQueue().removeJobScheduler(
      `league-update-repeat-${leagueId}`
    );
  } catch (error) {
    console.warn(
      `Failed to remove recurring scheduler for deleted league ${leagueId}:`,
      error
    );
  }
}

export class DeleteLeagueError extends Error {
  constructor(
    public readonly code: "not-found" | "name-mismatch",
    message: string
  ) {
    super(message);
    this.name = "DeleteLeagueError";
  }
}

export async function deleteLeague(
  leagueId: string,
  confirmationName: string
): Promise<DeleteLeagueResult> {
  if (!mongoose.isValidObjectId(leagueId)) {
    throw new DeleteLeagueError("not-found", "Tournament not found");
  }

  await connectToDatabase();
  const league = await LeagueModel.findById(leagueId)
    .select("name officialSubstitutes")
    .lean();
  if (!league) {
    throw new DeleteLeagueError("not-found", "Tournament not found");
  }
  if (confirmationName !== league.name) {
    throw new DeleteLeagueError(
      "name-mismatch",
      "Tournament name does not match"
    );
  }

  const [
    teams,
    games,
    bracket,
    leagueUsers,
    schedulingMessages,
    substitutions,
    liveGames,
    leagueGameMessages,
  ] = await Promise.all([
    TeamModel.find({ leagueId: league._id })
      .select("roster finalsRoster")
      .lean(),
    GameModel.find({ league: league._id })
      .select("_id gameId results gameRecord replayLogRef")
      .lean(),
    BracketModel.findOne({ league: league._id }).select("seedings").lean(),
    LeagueUserModel.find({ leagueId: league._id }).select("userId").lean(),
    SchedulingMessageModel.find({ league: league._id })
      .select("participantIds tables")
      .lean(),
    SubstitutionModel.find({ league: league._id })
      .select("replacedPlayer substitutePlayer")
      .lean(),
    LiveGameModel.find({ league: league._id }).select("players.userId").lean(),
    LeagueGameMessageModel.find({ league: league._id })
      .select("players")
      .lean(),
  ]);
  const sourceGameIds = games.flatMap((game) =>
    game.gameId ? [game.gameId] : []
  );
  const reviewedSourceGameIds =
    sourceGameIds.length === 0
      ? []
      : await ReplayReviewModel.distinct("sourceGameId", {
          sourceGameId: { $in: sourceGameIds },
        });
  const { deleteIds, preserveIds } = partitionGamesByReview(
    games,
    reviewedSourceGameIds
  );
  const candidateUserIds = collectReferencedUserIds([
    league,
    ...teams,
    ...games,
    ...(bracket ? [bracket] : []),
    ...leagueUsers,
    ...schedulingMessages,
    ...substitutions,
    ...liveGames,
    ...leagueGameMessages,
  ]);

  const [
    otherTeams,
    otherLeagues,
    otherGames,
    otherBrackets,
    otherLeagueUsers,
    otherSchedulingMessages,
    otherSubstitutions,
    otherLiveGames,
    otherLeagueGameMessages,
  ] =
    candidateUserIds.length === 0
      ? [[], [], [], [], [], [], [], [], []]
      : await Promise.all([
          TeamModel.find({
            leagueId: { $ne: league._id },
            $or: [
              { "roster.captain": { $in: candidateUserIds } },
              { "roster.members": { $in: candidateUserIds } },
              { "roster.substitutes": { $in: candidateUserIds } },
              { "finalsRoster.captain": { $in: candidateUserIds } },
              { "finalsRoster.members": { $in: candidateUserIds } },
              { "finalsRoster.substitutes": { $in: candidateUserIds } },
            ],
          })
            .select("roster finalsRoster")
            .lean(),
          LeagueModel.find({
            _id: { $ne: league._id },
            officialSubstitutes: { $in: candidateUserIds },
          })
            .select("officialSubstitutes")
            .lean(),
          GameModel.find({
            league: { $exists: true, $ne: league._id },
            $or: [
              { "results.userId": { $in: candidateUserIds } },
              { "results.subId": { $in: candidateUserIds } },
            ],
          })
            .select("results")
            .lean(),
          BracketModel.find({
            league: { $ne: league._id },
            "seedings.userId": { $in: candidateUserIds },
          })
            .select("seedings")
            .lean(),
          LeagueUserModel.find({
            leagueId: { $ne: league._id },
            userId: { $in: candidateUserIds },
          })
            .select("userId")
            .lean(),
          SchedulingMessageModel.find({
            league: { $ne: league._id },
            $or: [
              { participantIds: { $in: candidateUserIds } },
              { "tables.seats.userId": { $in: candidateUserIds } },
            ],
          })
            .select("participantIds tables")
            .lean(),
          SubstitutionModel.find({
            league: { $ne: league._id },
            $or: [
              { replacedPlayer: { $in: candidateUserIds } },
              { substitutePlayer: { $in: candidateUserIds } },
            ],
          })
            .select("replacedPlayer substitutePlayer")
            .lean(),
          LiveGameModel.find({
            league: { $ne: league._id },
            "players.userId": { $in: candidateUserIds },
          })
            .select("players.userId")
            .lean(),
          LeagueGameMessageModel.find({
            league: { $ne: league._id },
            players: { $in: candidateUserIds },
          })
            .select("players")
            .lean(),
        ]);
  const linkedElsewhereUserIds = collectReferencedUserIds([
    ...otherTeams,
    ...otherLeagues,
    ...otherGames,
    ...otherBrackets,
    ...otherLeagueUsers,
    ...otherSchedulingMessages,
    ...otherSubstitutions,
    ...otherLiveGames,
    ...otherLeagueGameMessages,
  ]);

  const deleteIdSet = new Set(deleteIds);
  const gamesToDelete = games.filter((game) =>
    deleteIdSet.has(game._id.toString())
  );
  const gameRecordIds = gamesToDelete.flatMap((game) =>
    game.gameRecord ? [game.gameRecord] : []
  );
  const replayLogIds = gamesToDelete.flatMap((game) =>
    game.replayLogRef ? [game.replayLogRef] : []
  );
  const deletedSourceGameIds = gamesToDelete.flatMap((game) =>
    game.gameId ? [game.gameId] : []
  );

  await Promise.all([
    RankingModel.deleteMany({ gameId: { $in: deleteIds } }),
    GameRecordModel.deleteMany({
      $or: [
        { _id: { $in: gameRecordIds } },
        { gameId: { $in: deletedSourceGameIds } },
      ],
    }),
    ReplayLogModel.deleteMany({
      $or: [
        { _id: { $in: replayLogIds } },
        { sourceGameId: { $in: deletedSourceGameIds } },
      ],
    }),
  ]);
  await GameModel.deleteMany({ _id: { $in: deleteIds } });
  await GameModel.updateMany(
    { _id: { $in: preserveIds } },
    { $unset: { league: "" } }
  );
  await Promise.all([
    BracketModel.deleteOne({ league: league._id }),
    LeagueGameMessageModel.deleteMany({ league: league._id }),
    LeagueRankingMessageModel.deleteMany({ league: league._id }),
    LeagueUserModel.deleteMany({ leagueId: league._id }),
    LiveGameModel.deleteMany({ league: league._id }),
    OngoingGameMessageModel.deleteMany({ league: league._id }),
    SchedulingMessageModel.deleteMany({ league: league._id }),
    SubstitutionModel.deleteMany({ league: league._id }),
    TeamModel.deleteMany({ leagueId: league._id }),
  ]);
  await LeagueModel.deleteOne({ _id: league._id });

  const deletedUsers =
    candidateUserIds.length === 0
      ? { deletedCount: 0 }
      : await UserModel.deleteMany(
          standaloneUserDeletionFilter(
            candidateUserIds,
            linkedElsewhereUserIds
          )
        );

  emitLeagueUpdated(leagueId);
  await removeLeagueScheduler(leagueId);

  return {
    deletedGames: deleteIds.length,
    preservedGames: preserveIds.length,
    deletedUsers: deletedUsers.deletedCount,
  };
}
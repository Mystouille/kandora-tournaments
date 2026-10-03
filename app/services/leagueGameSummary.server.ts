import mongoose from "mongoose";
import { GameModel, type Game } from "~/core/models/tournament/Game";
import { LeagueModel, type League } from "~/core/models/tournament/League";
import { LeagueTypeConfigModel } from "~/core/models/tournament/LeagueTypeConfig";
import { TeamModel, type Team } from "~/core/models/tournament/Team";
import { UserModel, type User } from "~/core/models/shared/User";
import {
  LeagueUserModel,
  type LeagueUser,
} from "~/core/models/tournament/LeagueUser";
import {
  GameRecordModel,
  type GameRecord,
} from "~/core/models/tournament/GameRecord";
import { ReplayLogModel, type DbReplayLog } from "~/core/models/game/ReplayLog";
import { BracketModel, type Bracket } from "~/core/models/tournament/Bracket";
import {
  ScheduledGameModel,
  type ScheduledGame,
} from "~/core/models/tournament/ScheduledGame";
import { GameEventSchema, type GameEvent } from "~/game/protocol/messages";
import type {
  LeagueGameSummary,
  SummaryIdentity,
} from "~/types/leagueGameSummary";
import { DEFAULT_TEAM_PICTURE_CENTER_Y } from "~/types/pictures";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { normalizeLegacyReplayEvent } from "~/utils/replayLogCompatibility";
import { slugify } from "~/utils/slugify";
import { getDefaultTeamColor } from "~/utils/teamColors";
import {
  buildSummaryPoints,
  buildSummaryStats,
  type SummaryPlayerRecord,
} from "~/utils/leagueGameSummaryData";
import { buildGameRecordFromReplay } from "~/api/replayToGameRecord";
import { computePlayerDeltas, isGameScored } from "./leagueUtils";
import { resolveGamePhaseId } from "./league-configs";
import { buildGameSummaryStandings } from "./leagueGameStandings";

function replaySource(platform: string) {
  if (platform === "riichiCity") {
    return "riichicity";
  }
  return platform === "majsoul" || platform === "tenhou" ? platform : null;
}

function completionDate(
  startTime: Date,
  value: Date | number | null | undefined
): Date | null {
  if (value == null) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date >= startTime ? date : null;
}

async function loadCompletionDates(
  games: Game[],
  selected: Game,
  record: GameRecord | null,
  replay: DbReplayLog | null
): Promise<Map<string, Date | null>> {
  const dates = new Map(
    games.map((game) => [
      game._id.toString(),
      completionDate(game.startTime, game.endTime) ??
        (game._id.equals(selected._id)
          ? (completionDate(game.startTime, record?.endTime) ??
            completionDate(game.startTime, replay?.endedAt))
          : null),
    ])
  );
  const missing = games.filter(
    (game) =>
      !dates.get(game._id.toString()) &&
      isGameScored(game.results) &&
      game.isValid !== false
  );
  if (missing.length === 0) {
    return dates;
  }
  const recordIds = missing.flatMap((game) =>
    game.gameRecord ? [game.gameRecord] : []
  );
  const nativeIds = missing.flatMap((game) =>
    game.gameId ? [game.gameId] : []
  );
  const replayQueries = missing.flatMap((game) => {
    const source = replaySource(game.platform);
    return source && game.gameId ? [{ source, sourceGameId: game.gameId }] : [];
  });
  const [records, replays] = await Promise.all([
    recordIds.length || nativeIds.length
      ? GameRecordModel.find({
          $or: [{ _id: { $in: recordIds } }, { gameId: { $in: nativeIds } }],
        })
          .select("_id gameId endTime")
          .lean<Pick<GameRecord, "_id" | "gameId" | "endTime">[]>()
      : [],
    replayQueries.length
      ? ReplayLogModel.find({ $or: replayQueries })
          .select("source sourceGameId endedAt")
          .lean<Pick<DbReplayLog, "source" | "sourceGameId" | "endedAt">[]>()
      : [],
  ]);
  const recordsById = new Map(
    records.map((entry) => [entry._id.toString(), entry])
  );
  const recordsByNativeId = new Map(
    records.map((entry) => [entry.gameId, entry])
  );
  const replayDates = new Map(
    replays.map((entry) => [
      `${entry.source}:${entry.sourceGameId}`,
      entry.endedAt,
    ])
  );
  for (const game of missing) {
    const savedRecord =
      recordsById.get(game.gameRecord?.toString() ?? "") ??
      recordsByNativeId.get(game.gameId ?? "");
    dates.set(
      game._id.toString(),
      completionDate(game.startTime, savedRecord?.endTime) ??
        completionDate(
          game.startTime,
          replayDates.get(`${replaySource(game.platform)}:${game.gameId}`)
        )
    );
  }
  return dates;
}

function platformUserIds(user: User | undefined, platform: string): string[] {
  if (platform === "majsoul") {
    return [
      user?.majsoulIdentity?.userId,
      user?.majsoulIdentity?.friendId,
    ].filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  const id =
    platform === "tenhou"
      ? user?.tenhouIdentity?.name
      : user?.riichiCityIdentity?.id;
  return id ? [id] : [];
}

function resolveSeats(
  game: Game,
  record: GameRecord | null,
  replay: DbReplayLog | null,
  events: GameEvent[],
  users: Map<string, User>
): Map<string, number> {
  const seats = new Map<string, number>();
  const matchStart = events.find((event) => event.type === "match_start");
  for (const result of game.results) {
    const playerId = result.userId.toString();
    const saved = (record?.byUserData ?? []).filter(
      (entry) => entry.userDbId?.toString() === playerId
    );
    let candidates = saved.map((entry) => entry.seat);
    if (candidates.length === 0) {
      candidates = (replay?.seats ?? [])
        .filter((entry) => entry.userDbId?.toString() === playerId)
        .map((entry) => entry.seat);
    }
    if (candidates.length === 0) {
      const ids = platformUserIds(users.get(playerId), game.platform);
      candidates = (matchStart?.seats ?? [])
        .filter((entry) => ids.includes(entry.userId))
        .map((entry) => entry.seat);
    }
    if (
      candidates.length === 1 &&
      Number.isInteger(candidates[0]) &&
      candidates[0] >= 0 &&
      candidates[0] <= 3
    ) {
      seats.set(playerId, candidates[0]);
    }
  }
  const counts = new Map<number, number>();
  for (const seat of seats.values()) {
    counts.set(seat, (counts.get(seat) ?? 0) + 1);
  }
  for (const [playerId, seat] of seats) {
    if (counts.get(seat) !== 1) {
      seats.delete(playerId);
    }
  }
  return seats;
}

export async function loadLeagueGameSummary(
  gameId: string
): Promise<LeagueGameSummary> {
  if (!/^[a-f0-9]{24}$/i.test(gameId)) {
    throw new Response("Game not found", { status: 404 });
  }
  gameId = gameId.toLowerCase();
  await connectToDatabase();
  const game = await GameModel.findById(gameId)
    .select(
      "_id gameId league platform rules startTime endTime results phaseId isValid gameRecord replayLogRef"
    )
    .lean<Game | null>();
  if (!game?.league) {
    throw new Response("Game not found", { status: 404 });
  }
  const league = await LeagueModel.findOne({
    _id: game.league,
    isDisplayed: true,
  })
    .populate({ path: "leagueTypeConfig", model: LeagueTypeConfigModel })
    .lean<League | null>();
  if (!league) {
    throw new Response("League not found", { status: 404 });
  }
  if (!isGameScored(game.results)) {
    throw new Response("Game results are not ready", { status: 409 });
  }
  const source = replaySource(game.platform);
  const [history, teams, leagueUsers, record, replay, bracket, schedule] =
    await Promise.all([
      GameModel.find({ league: league._id })
        .select(
          "_id gameId platform startTime endTime results phaseId isValid gameRecord"
        )
        .sort({ startTime: 1, _id: 1 })
        .lean<Game[]>(),
      TeamModel.find({ leagueId: league._id })
        .select("_id displayName color roster finalsRoster pictures")
        .sort({ _id: 1 })
        .lean<Team[]>(),
      LeagueUserModel.find({ leagueId: league._id })
        .select("userId isParticipant pictures")
        .lean<LeagueUser[]>(),
      game.gameRecord || game.gameId
        ? GameRecordModel.findOne(
            game.gameRecord ? { _id: game.gameRecord } : { gameId: game.gameId }
          )
            .select("_id gameId endTime byUserData")
            .lean<GameRecord | null>()
        : null,
      source && (game.replayLogRef || game.gameId)
        ? ReplayLogModel.findOne({
            source,
            ...(game.replayLogRef
              ? { _id: game.replayLogRef }
              : { sourceGameId: game.gameId }),
          }).lean<DbReplayLog | null>()
        : null,
      league.leagueTypeConfig?.finalPhase
        ? BracketModel.findOne({ league: league._id })
            .select("seedings")
            .lean<Bracket | null>()
        : null,
      league.hasSchedule
        ? ScheduledGameModel.find({ league: league._id })
            .select("phaseId scheduledAt slots.participantId")
            .lean<Pick<ScheduledGame, "phaseId" | "scheduledAt" | "slots">[]>()
        : [],
    ]);
  const games = [
    ...history.filter((entry) => !entry._id.equals(game._id)),
    game,
  ];
  const userIds = new Set(
    games.flatMap((entry) =>
      entry.results.map((result) => String(result.userId))
    )
  );
  for (const team of teams) {
    for (const id of [
      ...team.roster.members,
      ...(team.roster.substitutes ?? []),
      ...(team.finalsRoster?.members ?? []),
      ...(team.finalsRoster?.substitutes ?? []),
    ]) {
      userIds.add(String(id));
    }
  }
  for (const member of leagueUsers) {
    if (member.isParticipant) {
      userIds.add(String(member.userId));
    }
  }
  const [userRows, completionDates] = await Promise.all([
    UserModel.find({
      _id: { $in: [...userIds].map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select(
        "_id name avatarUrl discordIdentity.displayName majsoulIdentity.userId majsoulIdentity.friendId tenhouIdentity.name riichiCityIdentity.id"
      )
      .lean<User[]>(),
    loadCompletionDates(games, game, record, replay),
  ]);
  const users = new Map(userRows.map((user) => [String(user._id), user]));
  const leaguePictures = new Map(
    leagueUsers.map((entry) => [String(entry.userId), entry.pictures])
  );
  const teamById = new Map(teams.map((team) => [String(team._id), team]));
  const teamColors = new Map(
    teams.map((team, index) => [
      String(team._id),
      team.color ?? getDefaultTeamColor(index),
    ])
  );
  const phaseId = resolveGamePhaseId(game, league.leagueTypeConfig, league);
  const isFinal =
    phaseId !== null && phaseId === league.leagueTypeConfig?.finalPhase?.id;
  const userTeams = new Map<string, Team>();
  for (const team of teams) {
    const roster = isFinal ? (team.finalsRoster ?? team.roster) : team.roster;
    for (const id of [...roster.members, ...(roster.substitutes ?? [])]) {
      userTeams.set(String(id), team);
    }
  }
  const recordsByPlayer = new Map(
    (record?.byUserData ?? []).map((entry) => [String(entry.userDbId), entry])
  );
  const sortedUserIds = [...userIds].sort();
  const playerIdentity = (id: string, portrait = false): SummaryIdentity => {
    const user = users.get(id);
    const saved = recordsByPlayer.get(id);
    const team =
      teamById.get(String(saved?.teamDbId ?? "")) ?? userTeams.get(id);
    const pictures = leaguePictures.get(id);
    return {
      id,
      name:
        user?.discordIdentity?.displayName ??
        user?.name ??
        saved?.nickname ??
        id,
      teamName: team?.displayName ?? saved?.teamName ?? null,
      imageUrl:
        (portrait ? pictures?.fullPicture : pictures?.croppedPicture) ??
        user?.avatarUrl ??
        null,
      teamLogoUrl:
        team?.pictures?.fullPicture ?? team?.pictures?.croppedPicture ?? null,
      teamLogoCenterY:
        team?.pictures?.summaryCenterY ?? DEFAULT_TEAM_PICTURE_CENTER_Y,
      color:
        (team && teamColors.get(String(team._id))) ??
        getDefaultTeamColor(sortedUserIds.indexOf(id)),
    };
  };

  let events: GameEvent[] = [];
  if (replay) {
    const parsed = GameEventSchema.array().safeParse(
      replay.events.map(normalizeLegacyReplayEvent)
    );
    if (parsed.success) {
      events = parsed.data;
    } else {
      console.error(
        `[game summary] Invalid saved replay for ${gameId}`,
        parsed.error.issues
      );
    }
  }
  const seats = resolveSeats(game, record, replay, events, users);
  const deltas = computePlayerDeltas(
    game.results,
    league.rulesConfig.gameRules
  );
  const players = game.results
    .map((result, index) => ({
      ...playerIdentity(String(result.userId), true),
      seat: seats.get(String(result.userId)) ?? null,
      score: result.score,
      place: result.place,
      gamePoints: deltas[index],
    }))
    .sort(
      (a, b) =>
        a.place - b.place || b.score - a.score || a.id.localeCompare(b.id)
    );
  const mappedPlayers = players.flatMap((player) =>
    player.seat === null
      ? []
      : [
          {
            playerId: player.id,
            seat: player.seat,
            score: player.score,
          },
        ]
  );
  const points: LeagueGameSummary["points"] =
    replay && (events.length === 0 || mappedPlayers.length !== players.length)
      ? { status: "unavailable", reason: "incompleteRecord" }
      : buildSummaryPoints(events, mappedPlayers);
  const replayComplete =
    points.status === "available" || points.reason === "inconsistentScores";
  const replayHandCount = events.filter(
    (event) => event.type === "hand_end"
  ).length;
  let records: SummaryPlayerRecord[] = (record?.byUserData ?? []).map(
    (entry) => ({
      playerId: String(entry.userDbId),
      roundEvents: entry.roundEvents,
    })
  );
  let stats = buildSummaryStats(
    records,
    players.map((player) => player.id),
    replayComplete ? replayHandCount : undefined
  );
  if (
    stats.status === "unavailable" &&
    replayComplete &&
    mappedPlayers.length === 4
  ) {
    const ordered = [...mappedPlayers].sort((a, b) => a.seat - b.seat);
    const projected = buildGameRecordFromReplay({
      gameId: game.gameId ?? gameId,
      startTime: game.startTime,
      events,
      seatToUserId: ordered.map((player) => player.playerId),
      seatToNickname: ordered.map(
        (player) => users.get(player.playerId)?.name ?? player.playerId
      ),
    });
    records = projected.byUserData.map((entry) => ({
      playerId: entry.userId,
      roundEvents: entry.roundEvents,
    }));
    stats = buildSummaryStats(
      records,
      players.map((player) => player.id),
      replayHandCount
    );
  }
  const isTeamMode = league.rulesConfig.isTeamMode;
  const excludedPlayerIds = new Set(
    (league.officialSubstitutes ?? []).map(String)
  );
  const participants = isTeamMode
    ? teams.map((team): SummaryIdentity => ({
        id: String(team._id),
        name: team.displayName,
        teamName: null,
        imageUrl: team.pictures?.croppedPicture ?? null,
        teamLogoUrl:
          team.pictures?.fullPicture ?? team.pictures?.croppedPicture ?? null,
        teamLogoCenterY:
          team.pictures?.summaryCenterY ?? DEFAULT_TEAM_PICTURE_CENTER_Y,
        color: teamColors.get(String(team._id))!,
      }))
    : sortedUserIds
        .filter((id) => !excludedPlayerIds.has(id))
        .map((id) => playerIdentity(id));
  const finalParticipantIds = bracket
    ? new Set(
        bracket.seedings.flatMap((seed) => {
          const id = isTeamMode ? seed.teamId : seed.userId;
          return id ? [String(id)] : [];
        })
      )
    : null;
  const scheduledGameCounts = new Map<string, number>();
  for (const scheduledGame of schedule) {
    if (
      resolveGamePhaseId(
        {
          phaseId: scheduledGame.phaseId,
          startTime: scheduledGame.scheduledAt,
        },
        league.leagueTypeConfig,
        league
      ) !== phaseId
    ) {
      continue;
    }
    for (const slot of scheduledGame.slots) {
      if (slot.participantId) {
        const id = String(slot.participantId);
        scheduledGameCounts.set(id, (scheduledGameCounts.get(id) ?? 0) + 1);
      }
    }
  }
  const standings = buildGameSummaryStandings({
    selectedGameId: gameId,
    games: games.map((entry) => ({
      id: String(entry._id),
      startTime: entry.startTime,
      endTime: completionDates.get(String(entry._id)) ?? null,
      isValid: entry.isValid !== false,
      phaseId: entry.phaseId,
      results: entry.results.map((result) => ({
        userId: String(result.userId),
        score: result.score,
        place: result.place,
      })),
    })),
    teams,
    participants,
    isTeamMode,
    leagueType: league.leagueTypeConfig,
    rules: league.rulesConfig.gameRules,
    cutoffs: league.phaseCutoffTimes ?? [],
    finalParticipantIds,
    excludedPlayerIds,
    scheduledGameCounts,
  });
  const summaryRounds =
    stats.status === "available" ? records[0]?.roundEvents : null;
  return {
    id: gameId,
    platformGameId: game.gameId ?? null,
    league: {
      id: String(league._id),
      name: league.name,
      slug: slugify(league.name),
      isTeamMode,
    },
    startTime: game.startTime.toISOString(),
    endTime: completionDates.get(gameId)?.toISOString() ?? null,
    phaseId,
    isCounted: game.isValid !== false,
    players,
    handCount:
      summaryRounds?.length ?? (replayComplete ? replayHandCount : null),
    drawCount: summaryRounds?.filter((round) => round.ryuukyoku).length ?? null,
    stats,
    points,
    standings,
  };
}

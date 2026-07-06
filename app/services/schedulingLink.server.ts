import mongoose from "mongoose";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { LeagueModel, type League } from "~/db/League";
import { GameModel, type Game } from "~/db/Game";
import { TeamModel, type Team } from "~/db/Team";
import { SchedulingMessageModel } from "~/db/SchedulingMessage";
import {
  resolveLeagueTypeConfig,
  buildFinalsGameMatch,
} from "~/services/league-configs/index";
import type { LeagueTypeConfig } from "~/services/league-configs/types";
import {
  matchGamesToTables,
  type MatchGame,
  type MatchTable,
} from "~/services/scheduleMatching";

/**
 * Link finished games to the persisted scheduling tables they were played at,
 * by player identity and tolerant of undeclared substitutions.
 *
 * For each league SchedulingMessage that has persisted `tables[]` with at least
 * one unlinked table, this:
 *  - matches still-unlinked final-phase games to unlinked tables,
 *  - sets `table.gameId` (and keeps the legacy flat `gameIds[]` in sync),
 *  - records the actual occupant on a seat when an undeclared substitution is
 *    detected (so the persisted seating reflects who really played).
 *
 * Idempotent: already-linked tables and games are skipped, so it is safe to
 * call after game hydration and from the scheduling poll.
 *
 * @returns the number of tables newly linked.
 */
export async function linkPlayedGamesToTables(
  leagueId: string | mongoose.Types.ObjectId
): Promise<number> {
  await connectToDatabase();

  const league = await LeagueModel.findById(leagueId)
    .populate("leagueTypeConfig")
    .lean<(League & { _id: mongoose.Types.ObjectId }) | null>();
  if (!league) {
    return 0;
  }

  const config = resolveLeagueTypeConfig(
    league.leagueTypeConfig as LeagueTypeConfig | null
  );
  // Only bracket (final) phases produce scheduled tables.
  if (!config?.finalPhase) {
    return 0;
  }
  const isTeamMode = config.isTeamMode !== false;

  // Scheduling messages with persisted tables for this league.
  const messages = await SchedulingMessageModel.find({
    league: league._id,
    tables: { $exists: true, $ne: [] },
  });
  if (messages.length === 0) {
    return 0;
  }

  // Gather already-linked game ids and check whether any table still needs one.
  const linkedGameIds = new Set<string>();
  let hasUnlinkedTable = false;
  for (const message of messages) {
    for (const table of message.tables ?? []) {
      if (table.gameId) {
        linkedGameIds.add(table.gameId);
      } else {
        hasUnlinkedTable = true;
      }
    }
  }
  // A game linked to a scheduled table has a validated player set by
  // construction (an exact match, or a substitution validated against the
  // official/team sub pools), so the link itself is the source of truth for
  // validity. Mark linked games `isValid` so the bracket — which counts only
  // `isValid` games — includes official-substitute games. Backfill any games
  // that were linked before this rule existed.
  await markLinkedGamesValid(league._id, linkedGameIds);

  if (!hasUnlinkedTable) {
    return 0;
  }

  // Candidate games: final-phase games not yet linked. We deliberately do NOT
  // filter on `isValid` here: a game featuring an official substitute (who is
  // not on any team roster, and may be flagged invalid) is still a real game
  // and must be linked. The matcher only links a game whose players are an
  // exact set or a validated substitution of a table; once linked, the game is
  // marked `isValid` (markLinkedGamesValid) so the bracket counts it.
  const gameFilter: Record<string, unknown> = { league: league._id };
  const finalsMatch = buildFinalsGameMatch(config, league);
  if (finalsMatch) {
    Object.assign(gameFilter, finalsMatch);
  }
  const games = await GameModel.find(gameFilter)
    .select("gameId results startTime")
    .sort({ startTime: 1 })
    .lean<Game[]>();

  let remaining: MatchGame[] = games
    .filter((g) => g.gameId && !linkedGameIds.has(g.gameId))
    .map((g) => ({
      gameId: g.gameId as string,
      userIds: (g.results ?? []).map((r) => r.userId.toString()),
      startTime: g.startTime,
    }));
  if (remaining.length === 0) {
    return 0;
  }

  // Substitute pools. Mirrors `/league sub` validation, which scopes team subs
  // to the effective (finals-aware) roster.
  const officialSubs = new Set<string>(
    (league.officialSubstitutes ?? []).map((id) => id.toString())
  );
  const teamSubPoolByTeamId = new Map<string, Set<string>>();
  if (isTeamMode) {
    const teams = await TeamModel.find({ leagueId: league._id })
      .select("_id roster finalsRoster")
      .lean<Team[]>();
    for (const team of teams) {
      const effective = team.finalsRoster ?? team.roster;
      teamSubPoolByTeamId.set(
        team._id.toString(),
        new Set((effective.substitutes ?? []).map((s) => s.toString()))
      );
    }
  }

  let linkedCount = 0;
  const newlyLinkedGameIds = new Set<string>();
  for (const message of messages) {
    if (remaining.length === 0) {
      break;
    }
    const tables = message.tables ?? [];

    const matchTables: MatchTable[] = [];
    for (const table of tables) {
      if (table.gameId) {
        continue;
      }
      matchTables.push({
        tableIndex: table.tableIndex,
        seats: table.seats.map((seat) => ({
          userId: seat.userId.toString(),
          teamId: seat.teamId ? seat.teamId.toString() : null,
        })),
      });
    }
    if (matchTables.length === 0) {
      continue;
    }

    const { matches } = matchGamesToTables(matchTables, remaining, {
      officialSubs,
      teamSubPoolByTeamId,
    });
    if (matches.size === 0) {
      continue;
    }

    const justLinked = new Set<string>();
    for (const table of tables) {
      const match = matches.get(table.tableIndex);
      if (!match) {
        continue;
      }
      table.gameId = match.gameId;
      justLinked.add(match.gameId);
      newlyLinkedGameIds.add(match.gameId);
      // Record actual occupants for undeclared substitutions.
      for (const replacement of match.replacements) {
        const seat = table.seats.find(
          (s) => s.seatIndex === replacement.seatIndex
        );
        if (seat) {
          seat.userId = new mongoose.Types.ObjectId(replacement.toUserId);
          seat.isSub = true;
          seat.subType = replacement.subType;
        }
      }
      linkedCount++;
    }

    // Keep the legacy flat gameIds[] in sync for back-compat consumers.
    const linkedForMessage = tables
      .map((table) => table.gameId)
      .filter((id): id is string => Boolean(id));
    message.gameIds = Array.from(
      new Set([...(message.gameIds ?? []), ...linkedForMessage])
    );
    message.markModified("tables");
    await message.save();

    remaining = remaining.filter((game) => !justLinked.has(game.gameId));
  }

  await markLinkedGamesValid(league._id, newlyLinkedGameIds);

  return linkedCount;
}

/**
 * Mark games `isValid` because they are linked to a scheduled table. The link
 * validates the player set (an exact match, or a substitution validated against
 * the official/team sub pools), so a linked game always counts toward the
 * bracket — even when an official substitute kept it off a team roster and an
 * earlier hydration pass flagged it invalid. Only flips games not already valid.
 */
async function markLinkedGamesValid(
  leagueId: mongoose.Types.ObjectId,
  gameIds: Set<string>
): Promise<void> {
  if (gameIds.size === 0) {
    return;
  }
  await GameModel.updateMany(
    {
      league: leagueId,
      gameId: { $in: [...gameIds] },
      isValid: { $ne: true },
    },
    { $set: { isValid: true } }
  );
}

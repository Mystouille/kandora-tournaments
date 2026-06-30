/**
 * Pure logic for matching played games to scheduled tables by player identity,
 * tolerant of undeclared substitutions.
 *
 * A "table" is one scheduled game slot (4 seats). A "game" is one finished
 * game with the user IDs that actually played. Matching is done in two passes:
 *
 *  1. **Exact** — link a game whose player set is identical to the table's
 *     expected occupants (declared substitutions already applied upstream).
 *  2. **Forgiving** — when an admin opened a table with substitutes that were
 *     never declared via `/league sub`, the game's player set differs from the
 *     table by `k` players. We link it only when every differing game player is
 *     a *valid* substitute (official or team) for a differing seat, i.e. a full
 *     bijection exists. Candidates are ranked by fewest substitutions, then by
 *     earliest start time.
 *
 * The module is intentionally free of database / framework dependencies so it
 * can be reused by the bracket-scores API and the scheduling linker, and unit
 * tested in isolation.
 */

export interface MatchSeat {
  /** Currently-expected occupant (declared subs already applied). */
  userId: string;
  /** Team scoping the team-substitute pool. Null in individual mode. */
  teamId: string | null;
}

export interface MatchTable {
  /** Stable index identifying this table within its round / stage. */
  tableIndex: number;
  seats: MatchSeat[];
}

export interface MatchGame {
  gameId: string;
  /** User IDs of the players that actually played. */
  userIds: string[];
  /** Used only for deterministic tie-breaking (earlier games win). */
  startTime?: Date | number | string | null;
}

export interface MatchOptions {
  /** Global official-substitute pool (user IDs). */
  officialSubs: ReadonlySet<string>;
  /** team ID → that team's substitute pool (user IDs). */
  teamSubPoolByTeamId: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Maximum number of undeclared substitutions tolerated per table in the
   * forgiving pass. Defaults to 4 (a full table). The bijection-validity
   * check is the real guard; this is only a safety cap.
   */
  maxSubsPerTable?: number;
}

export interface SeatReplacement {
  seatIndex: number;
  /** The originally-expected occupant of the seat. */
  fromUserId: string;
  /** The player who actually played that seat. */
  toUserId: string;
  subType: "official" | "team";
}

export interface TableMatch {
  tableIndex: number;
  gameId: string;
  /** Empty for exact matches; populated for forgiving (undeclared-sub) matches. */
  replacements: SeatReplacement[];
}

export interface MatchResult {
  /** Matches keyed by tableIndex. */
  matches: Map<number, TableMatch>;
  /** Game IDs that could not be matched to any table. */
  unmatchedGameIds: string[];
}

function sortedKey(userIds: string[]): string {
  return [...userIds].sort().join("|");
}

function startTimeValue(game: MatchGame): number {
  if (game.startTime == null) {
    return 0;
  }
  const time =
    game.startTime instanceof Date
      ? game.startTime.getTime()
      : new Date(game.startTime).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Try to find a perfect matching between `seats` (each needing a substitute)
 * and `users` (the players who actually appeared but were not expected), where
 * each (seat, user) pairing is a valid substitution. Returns the chosen
 * replacements, or null when no full bijection exists. `k = seats.length` is
 * small (≤ 4 in practice), so an exhaustive permutation search is fine.
 */
function findSubstitutionBijection(
  seats: Array<{ seatIndex: number; userId: string; teamId: string | null }>,
  users: string[],
  options: MatchOptions
): SeatReplacement[] | null {
  const k = seats.length;
  if (k !== users.length) {
    return null;
  }
  if (k === 0) {
    return [];
  }

  const validPair = (
    seat: { teamId: string | null },
    user: string
  ): "official" | "team" | null => {
    if (options.officialSubs.has(user)) {
      return "official";
    }
    if (seat.teamId) {
      const pool = options.teamSubPoolByTeamId.get(seat.teamId);
      if (pool && pool.has(user)) {
        return "team";
      }
    }
    return null;
  };

  const usedUser = new Array<boolean>(k).fill(false);
  const assignment: SeatReplacement[] = [];

  const solve = (seatPos: number): SeatReplacement[] | null => {
    if (seatPos === k) {
      return [...assignment];
    }
    const seat = seats[seatPos];
    for (let u = 0; u < k; u++) {
      if (usedUser[u]) {
        continue;
      }
      const subType = validPair(seat, users[u]);
      if (!subType) {
        continue;
      }
      usedUser[u] = true;
      assignment.push({
        seatIndex: seat.seatIndex,
        fromUserId: seat.userId,
        toUserId: users[u],
        subType,
      });
      const result = solve(seatPos + 1);
      if (result) {
        return result;
      }
      assignment.pop();
      usedUser[u] = false;
    }
    return null;
  };

  return solve(0);
}

/**
 * Match finished games to scheduled tables by player identity.
 *
 * Each game is linked to at most one table and each table to at most one game.
 * Exact matches take priority over forgiving (substitution-tolerant) matches.
 */
export function matchGamesToTables(
  tables: MatchTable[],
  games: MatchGame[],
  options: MatchOptions
): MatchResult {
  const matches = new Map<number, TableMatch>();
  const linkedGameIds = new Set<string>();
  const maxSubs = options.maxSubsPerTable ?? 4;

  // ---- Pass 1: exact identity match -------------------------------------
  // Bucket games by their sorted-userId key. Within a bucket, earliest first
  // so that interchangeable tables (e.g. individual mode, where every table in
  // a stage has the same four players) link in a stable chronological order.
  const gamesByKey = new Map<string, MatchGame[]>();
  for (const game of games) {
    const key = sortedKey(game.userIds);
    const bucket = gamesByKey.get(key);
    if (bucket) {
      bucket.push(game);
    } else {
      gamesByKey.set(key, [game]);
    }
  }
  for (const bucket of gamesByKey.values()) {
    bucket.sort((a, b) => startTimeValue(a) - startTimeValue(b));
  }

  const unmatchedTables: MatchTable[] = [];
  for (const table of tables) {
    const key = sortedKey(table.seats.map((s) => s.userId));
    const bucket = gamesByKey.get(key);
    const game = bucket?.shift();
    if (game) {
      matches.set(table.tableIndex, {
        tableIndex: table.tableIndex,
        gameId: game.gameId,
        replacements: [],
      });
      linkedGameIds.add(game.gameId);
    } else {
      unmatchedTables.push(table);
    }
  }

  // ---- Pass 2: forgiving match (undeclared substitutions) ---------------
  for (const table of unmatchedTables) {
    const tableUserIds = new Set(table.seats.map((s) => s.userId));

    let best: {
      game: MatchGame;
      replacements: SeatReplacement[];
      k: number;
    } | null = null;

    for (const game of games) {
      if (linkedGameIds.has(game.gameId)) {
        continue;
      }
      const gameUserIds = new Set(game.userIds);

      // Seats whose expected occupant did not actually play.
      const plannedOnlySeats = table.seats
        .map((seat, seatIndex) => ({ ...seat, seatIndex }))
        .filter((seat) => !gameUserIds.has(seat.userId));
      // Players who appeared but were not expected at this table.
      const gameOnly = game.userIds.filter((u) => !tableUserIds.has(u));

      const k = plannedOnlySeats.length;
      if (k === 0 || k !== gameOnly.length || k > maxSubs) {
        continue;
      }

      const replacements = findSubstitutionBijection(
        plannedOnlySeats,
        gameOnly,
        options
      );
      if (!replacements) {
        continue;
      }

      if (
        !best ||
        k < best.k ||
        (k === best.k && startTimeValue(game) < startTimeValue(best.game))
      ) {
        best = { game, replacements, k };
      }
    }

    if (best) {
      matches.set(table.tableIndex, {
        tableIndex: table.tableIndex,
        gameId: best.game.gameId,
        replacements: best.replacements,
      });
      linkedGameIds.add(best.game.gameId);
    }
  }

  const unmatchedGameIds = games
    .filter((game) => !linkedGameIds.has(game.gameId))
    .map((game) => game.gameId);

  return { matches, unmatchedGameIds };
}

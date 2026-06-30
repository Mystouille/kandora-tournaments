import mongoose from "mongoose";

/**
 * Pure helpers for the persisted seating shape stored on
 * `SchedulingMessage.tables[]`. Kept free of database / Discord imports so the
 * freeze/adopt merge logic can be unit tested in isolation.
 */

export type PersistedSubType = "team" | "official";

export interface PersistedSeat {
  seatIndex: number;
  teamId: mongoose.Types.ObjectId | null;
  userId: mongoose.Types.ObjectId;
  isSub: boolean;
  subType: PersistedSubType | null;
}

export interface PersistedTable {
  tableIndex: number;
  seats: PersistedSeat[];
  gameId: string | null;
  /**
   * Whether any seat at this table has been observed in-game. Lets the worker
   * distinguish a table that has finished playing but whose game log hasn't
   * linked yet ("waiting for game log") from one that hasn't started.
   */
  wasInGame: boolean;
}

/** Minimal shape of a resolved seat needed to build a persisted seat. */
interface ResolvedSeatLike {
  teamIndex: number;
  userId: mongoose.Types.ObjectId;
  substituteType: PersistedSubType | null;
}

/** Minimal shape of a stage participant needed to scope a seat's team. */
interface ParticipantLike {
  id: mongoose.Types.ObjectId;
}

/**
 * Convert a resolved round into the persisted `tables[]` shape. `userId` is the
 * resolved occupant (declared subs already applied); `teamId` holds the
 * participant-slot identity (the Team in team mode, the User in individual
 * mode) and scopes the team-substitute pool. `gameId` is filled in later by the
 * scheduling linker.
 */
export function buildPersistedTables(
  resolved: ResolvedSeatLike[][],
  participants: ParticipantLike[]
): PersistedTable[] {
  return resolved.map((table, tableIndex) => ({
    tableIndex,
    gameId: null,
    wasInGame: false,
    seats: table.map((seat, seatIndex) => {
      const participant = participants[seat.teamIndex - 1];
      return {
        seatIndex,
        teamId: participant?.id ?? null,
        userId: seat.userId,
        isSub: seat.substituteType != null,
        subType: seat.substituteType,
      };
    }),
  }));
}

function seatsDiffer(a: PersistedSeat[], b: PersistedSeat[]): boolean {
  if (a.length !== b.length) {
    return true;
  }
  const byIndex = new Map(a.map((seat) => [seat.seatIndex, seat]));
  for (const next of b) {
    const prev = byIndex.get(next.seatIndex);
    if (!prev) {
      return true;
    }
    if (prev.userId.toString() !== next.userId.toString()) {
      return true;
    }
    if (
      (prev.teamId?.toString() ?? null) !== (next.teamId?.toString() ?? null)
    ) {
      return true;
    }
    if (prev.isSub !== next.isSub) {
      return true;
    }
    if ((prev.subType ?? null) !== (next.subType ?? null)) {
      return true;
    }
  }
  return false;
}

/**
 * Merge freshly-resolved seating into the existing persisted tables, preserving
 * tables already linked to a played game (they are frozen — the game happened
 * with whoever actually played). Unlinked tables adopt the fresh seating so the
 * stored roster tracks declared substitutions while the round is still live.
 *
 * Returns the merged tables and whether anything changed (so callers can skip a
 * redundant DB write). When there is no existing seating (e.g. a round created
 * before persistence was added), the fresh seating is adopted wholesale.
 */
export function reprojectTables(
  existing: PersistedTable[] | undefined,
  fresh: PersistedTable[]
): { tables: PersistedTable[]; changed: boolean } {
  if (!existing || existing.length === 0) {
    return { tables: fresh, changed: true };
  }
  const byIndex = new Map(existing.map((table) => [table.tableIndex, table]));
  let changed = false;
  const tables = fresh.map((freshTable) => {
    const prior = byIndex.get(freshTable.tableIndex);
    if (prior?.gameId) {
      // Already linked / played — freeze the recorded seating.
      return prior;
    }
    if (!prior || seatsDiffer(prior.seats, freshTable.seats)) {
      changed = true;
    }
    // Preserve the observed in-game flag across reprojection. The worker owns
    // flipping it true and decides separately whether to persist that change.
    return {
      ...freshTable,
      gameId: prior?.gameId ?? null,
      wasInGame: prior?.wasInGame ?? false,
    };
  });
  return { tables, changed };
}

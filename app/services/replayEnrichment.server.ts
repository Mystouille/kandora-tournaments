import mongoose from "mongoose";
import { GameRecordModel, type GameRecord } from "~/db/GameRecord";
import { TeamModel } from "~/db/Team";
import type { SeatEnrichment } from "~/game/client/pixi/TableRenderer";

const EMPTY: (SeatEnrichment | null)[] = [null, null, null, null];

/**
 * Per-seat team enrichment for a finished game's replay. Matches each seat's
 * display name against the `GameRecord`'s per-player `nickname` (both come from
 * the same platform log, so they align) to pull team name + logo. Returns all
 * nulls for orphan / non-league replays (no `GameRecord`).
 */
export async function resolveSeatEnrichmentForReplay(
  gameId: string,
  seats: Array<{ displayName?: string | null } | null | undefined>
): Promise<(SeatEnrichment | null)[]> {
  const record = await GameRecordModel.findOne({ gameId })
    .select("byUserData")
    .lean<Pick<GameRecord, "byUserData"> | null>();
  const byUser = record?.byUserData ?? [];
  if (byUser.length === 0) {
    return [...EMPTY];
  }

  const nickTeam = new Map<
    string,
    { teamName: string | null; teamDbId: string | null }
  >();
  const teamDbIds = new Set<string>();
  for (const u of byUser) {
    if (!u.nickname) {
      continue;
    }
    const teamDbId = u.teamDbId ? u.teamDbId.toString() : null;
    nickTeam.set(u.nickname, { teamName: u.teamName ?? null, teamDbId });
    if (teamDbId) {
      teamDbIds.add(teamDbId);
    }
  }

  const teamLogo = new Map<string, string | null>();
  if (teamDbIds.size > 0) {
    const teams = await TeamModel.find({
      _id: { $in: [...teamDbIds].map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("_id pictures")
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          pictures?: { croppedPicture?: string } | null;
        }>
      >();
    for (const team of teams) {
      teamLogo.set(team._id.toString(), team.pictures?.croppedPicture ?? null);
    }
  }

  const result: (SeatEnrichment | null)[] = [null, null, null, null];
  for (let seat = 0; seat < 4; seat++) {
    const name = seats[seat]?.displayName;
    if (!name) {
      continue;
    }
    const entry = nickTeam.get(name);
    if (entry && (entry.teamName || entry.teamDbId)) {
      result[seat] = {
        teamName: entry.teamName,
        teamLogoUrl: entry.teamDbId
          ? (teamLogo.get(entry.teamDbId) ?? null)
          : null,
      };
    }
  }
  return result;
}

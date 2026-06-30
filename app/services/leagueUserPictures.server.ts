import type mongoose from "mongoose";
import { LeagueUserModel } from "../db/LeagueUser";
import type { PicturePair } from "../types/pictures";

/**
 * Returns a `userId.toString() -> PicturePair` map of per-league user
 * pictures for a single league. Users with no custom pictures are
 * absent from the map.
 */
export async function getLeagueUserPictureMap(
  leagueId: string | mongoose.Types.ObjectId
): Promise<Map<string, PicturePair>> {
  const rows = await LeagueUserModel.find({ leagueId })
    .select("userId pictures")
    .lean<
      { userId: mongoose.Types.ObjectId; pictures: PicturePair | null }[]
    >();
  const map = new Map<string, PicturePair>();
  for (const row of rows) {
    if (row.pictures) {
      map.set(row.userId.toString(), {
        fullPicture: row.pictures.fullPicture,
        croppedPicture: row.pictures.croppedPicture,
      });
    }
  }
  return map;
}

/**
 * Same as {@link getLeagueUserPictureMap} but spans multiple leagues.
 * Last-wins when the same user has pictures in several leagues — used
 * by endpoints that aggregate across leagues for display.
 */
export async function getLeagueUserPictureMapForLeagues(
  leagueIds: (string | mongoose.Types.ObjectId)[]
): Promise<Map<string, PicturePair>> {
  if (leagueIds.length === 0) {
    return new Map();
  }
  const rows = await LeagueUserModel.find({ leagueId: { $in: leagueIds } })
    .select("userId pictures")
    .lean<
      { userId: mongoose.Types.ObjectId; pictures: PicturePair | null }[]
    >();
  const map = new Map<string, PicturePair>();
  for (const row of rows) {
    if (row.pictures) {
      map.set(row.userId.toString(), {
        fullPicture: row.pictures.fullPicture,
        croppedPicture: row.pictures.croppedPicture,
      });
    }
  }
  return map;
}

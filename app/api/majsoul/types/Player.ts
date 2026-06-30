import { Player as MajsoulPlayer } from "../data/types/Player";

export interface Player extends Partial<MajsoulPlayer> {
  _id?: string;
  majsoulFriendlyId?: number;
  displayName?: string;
}

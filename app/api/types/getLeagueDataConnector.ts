import { Platform } from "~/db/League";
import { platformConnectorsDisabled } from "config";
import { MahjongSoulConnector } from "~/api/majsoul/data/MajsoulConnector";
import {
  RiichiCityConnector,
  type RiichiCityContestGameRecord,
} from "~/api/riichiCity/data/RiichiCityConnector";
import type { RecordGame } from "~/api/majsoul/data/types/RecordGame";
import type { GameRecord } from "~/api/majsoul/data/types/GameRecord";
import type { GameData } from "~/services/riichiCityModels";
import type { ILeagueDataConnector } from "~/api/types/ILeagueDataConnector";

export type LeagueDataConnector =
  | ILeagueDataConnector<RecordGame, GameRecord>
  | ILeagueDataConnector<RiichiCityContestGameRecord, GameData>;

export function getLeagueDataConnector(
  platform: Platform
): LeagueDataConnector | null {
  if (platformConnectorsDisabled) {
    return null;
  }
  switch (platform) {
    case Platform.MAJSOUL:
      return MahjongSoulConnector.instance;
    case Platform.RIICHICITY:
      return RiichiCityConnector.instance;
    default:
      return null;
  }
}

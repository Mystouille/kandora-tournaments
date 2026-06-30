import { RiichiCityService } from "../../../services/RiichiCityService.server";
import {
  type GameData,
  type LogListData,
} from "../../../services/riichiCityModels";
import type {
  ContestGamesRequest,
  ILeagueDataConnector,
} from "../../types/ILeagueDataConnector";

export interface RiichiCityContestGameRecord {
  uuid: string;
  start_time?: number;
  end_time?: number;
  accounts: Array<{
    account_id: number;
    seat: number;
    nickname: string;
  }>;
  result: {
    players: Array<{
      seat: number;
      part_point_1: number;
    }>;
  };
}

export class RiichiCityConnector implements ILeagueDataConnector<
  RiichiCityContestGameRecord,
  GameData
> {
  private static readonly GLOBAL_KEY = "__RiichiCityConnector__";

  public readonly service: RiichiCityService;
  private isInitialized = false;

  private constructor() {
    this.service = new RiichiCityService();
  }

  static get instance(): RiichiCityConnector {
    if (!(globalThis as any)[RiichiCityConnector.GLOBAL_KEY]) {
      (globalThis as any)[RiichiCityConnector.GLOBAL_KEY] =
        new RiichiCityConnector();
    }
    return (globalThis as any)[RiichiCityConnector.GLOBAL_KEY];
  }

  public async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    await this.service.login();
    this.isInitialized = true;
  }

  public async getAllContestGameRecords(
    request: ContestGamesRequest
  ): Promise<RiichiCityContestGameRecord[]> {
    await this.init();

    const pageSize = 50;
    const maxPages = 500;
    const knownGameIds = new Set(request.knownGameIds ?? []);

    const collected = new Map<string, RiichiCityContestGameRecord>();

    for (let page = 0; page < maxPages; page += 1) {
      const skip = page * pageSize;
      const response = await this.service.readPaiPuList({
        classifyID: request.contestId,
        startTime: request.startTime ?? 0,
        endTime: 0,
        skip,
        limit: pageSize,
      });

      const rows = response.data ?? [];
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        if (knownGameIds.has(row.paiPuId)) {
          continue;
        }

        if (row.isClear) {
          continue;
        }

        if (!collected.has(row.paiPuId)) {
          collected.set(row.paiPuId, mapToContestRecord(row));
        }
      }

      if (rows.length < pageSize) {
        break;
      }
    }

    return Array.from(collected.values());
  }

  public async getContestGameRecord(gameId: string): Promise<GameData> {
    await this.init();
    return this.service.getLog(gameId);
  }
}

function mapToContestRecord(meta: LogListData): RiichiCityContestGameRecord {
  const seatPlayers = meta.players ?? [];

  const players = seatPlayers.map((player, seat) => ({
    seat,
    part_point_1: player.pointNum ?? player.score ?? 0,
  }));

  return {
    uuid: meta.paiPuId,
    start_time: meta.startTime,
    end_time: meta.nowTime,
    accounts: seatPlayers.map((player, seat) => ({
      account_id: player.userId,
      seat,
      nickname: player.nickname,
    })),
    result: {
      players,
    },
  };
}

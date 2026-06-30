import mongoose from "mongoose";

export type GameRecordData = {
  gameId: string;
  startTime: Date;
  endTime?: Date;
  byUserData: UsersRounds[];
};

export type UsersRounds = {
  userId: string;
  seat: number;
  nickname: string;
  roundEvents: RoundEndEvent[];
  userDbId?: mongoose.Types.ObjectId;
  teamDbId?: mongoose.Types.ObjectId;
  teamName?: string;
  isOfficialSubstitute?: boolean;
  score?: number;
  place?: number;
  deltaPoints?: number;
};

export type RoundEndEvent = {
  userId: string;

  wasDealer: boolean;
  haipaiShanten: number;

  wasOpened: boolean;
  numberOfCalls: number;
  kanNumber: number;
  yakus: number[];

  hasRiichi: boolean;
  firstTenpaiTurn: number;
  finishedTenpai: boolean;
  ryuukyoku: boolean;

  isWinner: boolean;
  gotRonned: boolean;
  isTsumo: boolean;
  winningTile: string | undefined;
  totalDoraValue: number;
  uraDoraValue: number;
  hanValue: number;
  fuValue: number;

  ryuukyokuValue: number;

  pointsDiff: number;
  riichiStickDiff: number;
};

export function getNewRoundEndEvent(userId: string): RoundEndEvent {
  return {
    userId: userId,
    wasDealer: false,
    haipaiShanten: -2,
    wasOpened: false,
    numberOfCalls: 0,
    kanNumber: 0,
    yakus: [],
    hasRiichi: false,
    firstTenpaiTurn: -1,
    finishedTenpai: false,
    ryuukyoku: false,
    isWinner: false,
    gotRonned: false,
    isTsumo: false,
    winningTile: undefined,
    ryuukyokuValue: 0,
    totalDoraValue: 0,
    uraDoraValue: 0,
    hanValue: 0,
    fuValue: 0,
    pointsDiff: 0,
    riichiStickDiff: 0,
  };
}

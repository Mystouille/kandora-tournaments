export interface InitSessionResponse {
  data: string;
}

export interface LoginResponse {
  code: number;
  message: string;
  data: LoginResponseData;
}

export interface LoginResponseData {
  user: LoginResponseUser;
}

export interface LoginResponseUser {
  nickname: string;
  id: number;
}

export interface RankResponse {
  code: number;
  data: RankUserResponse[];
}

export interface RankUserResponse {
  userID: number;
  rank: number;
  totalScore: number;
}

export interface PlayerStatusResponse {
  code: number;
  data: PlayerStatusData[];
}

export enum PlayerStatus {
  Online = 1,
  Ready = 2,
  InGame = 3,
}

export interface PlayerStatusData {
  nickname: string;
  status: PlayerStatus;
  userID: number;
}

/**
 * A single entry from `/lobbys/selfIdentityInfo` — the tournament's enrolled
 * roster. `identity` marks the role: 1 = competitor, 3 = organiser/staff.
 */
export interface SelfIdentityData {
  userID: number;
  identity: number;
  nickname: string;
}

export interface TournamentInfoResponse {
  code: number;
  data: TournamentInfoData;
}

export interface TournamentInfoData {
  classifyID: string;
  isAdmin?: boolean;
  name?: string;
}

export interface StartGameResponse {
  code: number;
  data: boolean;
  message?: string;
}

export interface OnlineRoomPlayer {
  userId: number;
  nickname: string;
  position: number;
  identity: number;
  robotLevel: number;
}

export interface OnlineRoom {
  roomId: string;
  isEnd: boolean;
  isPause: boolean;
  startTime: number;
  nowTime: number;
  playerCount: number;
  matchStage: number;
  stageNum: number;
  players: OnlineRoomPlayer[];
}

export interface OnlineRoomResponse {
  code: number;
  data: OnlineRoom[];
  round: number;
  stageType: number;
}

export interface LogListResponse {
  code: number;
  data: LogListData[];
}

export interface LogListData {
  paiPuId: string;
  isClear: boolean;
  /**
   * `true` when the game was terminated mid-way (e.g. via
   * `controlSelfRoom(Terminate)`). Such games still appear in the record
   * list with all players at the starting 25000 points and seat-ordered
   * ranks, so they must be filtered out before importing results.
   */
  isMiddlePause?: boolean;
  players: LogListPlayerData[];
  nowTime?: number;
  startTime?: number;
}

export interface LogListPlayerData {
  nickname: string;
  userId: number;
  pointNum?: number;
  score?: number;
}

export interface GameResponse {
  code: number;
  data: GameData;
}

export interface GameData {
  handRecord: RoundData[];
  nowTime: number;
  keyValue: string;
}

export interface RoundData {
  changCi: number;
  benChangNum: number;
  handCardEncode: string;
  handEventRecord: HandData[];
  /**
   * Per-round snapshot of all four players, ordered by `position`
   * (= seat). Carries the live nickname / userId mapping that
   * `getLog` doesn't otherwise expose, so we use this to hydrate
   * seat → nickname for replays.
   */
  players?: RoundPlayerData[];
}

export interface RoundPlayerData {
  userId: number;
  nickname: string;
  /** Seat index (0..3); equivalent to the per-round `position`. */
  position: number;
  points?: number;
}

export interface HandData {
  eventType: EventType;
  data: string;
  userId: number;
  startTime: number;
}

export enum EventType {
  StartingHand = 1,
  Draw = 2,
  ActionOnDiscard = 3,
  DiscardOrCall = 4,
  RoundEnd = 5,
  GameEnd = 6,
  NewDoraIndicator = 7,
  UnknownEventType8 = 8,
  UnknownEventType9 = 9,
  UnknownEventType10 = 10,
  TenpaiReached = 11,
}

export interface SubHandData {
  hand_cards?: number[];
  bao_pai_card?: number;
  quan_feng?: number;
  chang_ci?: number;
  ben_chang_num?: number;
  li_zhi_bang_num?: number;
  action?: ActionType;
  in_card?: number;
  is_can_lizhi?: boolean;
  is_zi_mo?: boolean;
  bu_gang_cards?: number[];
  is_gang_incard?: boolean;
  is_li_zhi?: boolean;
  li_zhi_type?: DiscardType;
  cards?: number[];
  end_type?: RoundEndType;
  win_info?: WinInfoData[];
  user_profit?: GainsData[];
  user_data?: GameEndData[];
}

export enum ActionType {
  ChiiYXX = 2,
  ChiiXYX = 3,
  ChiiXYY = 4,
  Pon = 5,
  Ron = 7,
  Ankan = 8,
  Minkan = 9,
  Tsumo = 10,
  Discard = 11,
  Kita = 13,
}

export enum DiscardType {
  Default = 0,
  Riichi = 1,
  DoubleRiichi = 2,
}

export enum RoundEndType {
  Ron = 0,
  Tsumo = 1,
  UnknownEndValue2 = 2,
  UnknownEndValue3 = 3,
  UnknownEndValue4 = 4,
  UnknownEndValue5 = 5,
  UnknownEndValue6 = 6,
  RyuuKyoku = 7,
}

export interface WinInfoData {
  fang_info?: YakuData[];
  all_fang_num: number;
  all_fu: number;
  all_point: number;
  li_bao_card?: number[];
  user_id: number;
}

export interface YakuData {
  fang_type: YakuType;
  fang_num: number;
}

export interface GainsData {
  user_id: number;
  point_profit: number;
  li_zhi_profit: number;
  is_bao_pai: boolean;
  user_point: number;
}

export interface GameEndData {
  user_id: number;
  point_num: number;
  score: number;
}

// YakuType now lives in the kandora-core schema package (app/db) so the shared yaku maps can
// reference it. Imported + re-exported here for existing `~/services/riichiCityModels` importers.
import { YakuType } from "~/db/types/yaku-type";
export { YakuType };

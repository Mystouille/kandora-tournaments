export interface MSoulUser {
  account_id: number;
  nickname: string;
  remark?: string;
  team_name?: string;
}

export interface RunningGamePlayer {
  account_id: number;
  nickname?: string;
  team_name?: string;
}

export interface RunningGame {
  game_uuid: string;
  players: RunningGamePlayer[];
  start_time: number;
  tag?: string;
}

export interface GamePlanAccount {
  account_id: number;
  init_points: number;
  nickname: string;
  remark: string;
  seat: number;
  team_name: string;
}

export interface GamePlan {
  accounts: GamePlanAccount[];
  game_start_time: number;
  remark: string;
  shuffle_seat: boolean;
  uuid: string;
}

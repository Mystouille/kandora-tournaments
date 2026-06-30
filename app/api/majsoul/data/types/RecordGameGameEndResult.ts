export interface PlayerResult {
  part_point_1: number;
  total_point: number;
  seat: number;
}

export interface RecordGameGameEndResult {
  players: PlayerResult[];
}

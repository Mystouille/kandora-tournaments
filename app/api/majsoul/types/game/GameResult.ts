import { GameResultVersion } from "../enums/GameResultVersion";
import { Player } from "../Player";
import { FinalScore } from "./FinalScore";
import { RoundResult } from "./round/RoundResult";

export interface GameResult {
  config?: {
    aiLevel: number;
    riichiStickValue?: number;
  };
  contestMajsoulId?: number;
  majsoulId?: string;
  start_time?: number;
  end_time?: number;
  finalScore?: FinalScore[];
  rounds?: RoundResult[];
  _id?: string | undefined;
  contestId: string | undefined;
  players?: Player[];
  notFoundOnMajsoul?: boolean;
  hidden?: boolean;
  version?: GameResultVersion;
}

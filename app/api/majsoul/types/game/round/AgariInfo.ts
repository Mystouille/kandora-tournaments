import { Han } from "../../../data/enums";

export interface AgariInfo {
  extras: number;
  winner: number;
  value: number;
  riichi?: boolean;
  han: Han[];
}

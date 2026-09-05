import type { MyReplayGroup } from "./myReplays";
import type { ReplayLog } from "~/game/replay/types";

export interface MyReplaysApiResponse {
  replays: MyReplayGroup[];
}

export interface MyReplayLogApiResponse {
  log: ReplayLog;
}

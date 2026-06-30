// @ts-nocheck -- Vendored MahjongSoul client type (liqi protobuf version drift); excluded from typecheck by intent.
import * as lq from "./liqi";
import type { RecordGameGameEndResult } from "./RecordGameGameEndResult";

export interface RecordGame {
  uuid?: string;
  start_time?: number;
  end_time?: number;
  config?: unknown;
  accounts?: lq.RecordGameAccountInfo[];
  result?: RecordGameGameEndResult;
}

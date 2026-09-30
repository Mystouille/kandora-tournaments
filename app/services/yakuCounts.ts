import type { UserGameRecordData } from "../core/models/tournament/GameRecord";
import { Han } from "../core/types/Han";

const DORA_YAKU = Han.Dora;
const URA_DORA_YAKU = Han.Ura_Dora;
const RED_FIVE_YAKU = Han.Red_Five;

type YakuCountRound = Pick<
  UserGameRecordData["roundEvents"][number],
  "yakus" | "totalDoraValue" | "uraDoraValue"
>;

export interface YakuCount {
  yakuId: number;
  count: number;
}

/**
 * Count yaku occurrences for one winning round.
 *
 * Dora values are authoritative because historical Tenhou records can contain
 * zero-han marker IDs, notably Ura Dora from the `53,0` log pair.
 */
export function getYakuCounts(round: YakuCountRound): YakuCount[] {
  const yakus = new Set<number>(round.yakus ?? []);
  const results: YakuCount[] = [];

  if ((round.totalDoraValue ?? 0) > 0) {
    results.push({ yakuId: DORA_YAKU, count: 1 });
  }

  if ((round.uraDoraValue ?? 0) > 0) {
    results.push({ yakuId: URA_DORA_YAKU, count: 1 });
  }

  for (const yaku of yakus) {
    if (
      yaku === DORA_YAKU ||
      yaku === URA_DORA_YAKU ||
      yaku === RED_FIVE_YAKU
    ) {
      continue;
    }
    results.push({ yakuId: yaku, count: 1 });
  }

  return results;
}

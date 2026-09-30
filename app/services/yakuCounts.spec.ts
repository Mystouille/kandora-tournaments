import { describe, expect, it } from "vitest";
import { Han } from "../core/types/Han";
import { getYakuCounts } from "./yakuCounts";

describe("getYakuCounts", () => {
  it("ignores zero-value dora marker IDs from historical records", () => {
    expect(
      getYakuCounts({
        yakus: [Han.Riichi, Han.Dora, Han.Ura_Dora, Han.Red_Five],
        totalDoraValue: 0,
        uraDoraValue: 0,
      })
    ).toEqual([{ yakuId: Han.Riichi, count: 1 }]);
  });

  it("uses normalized dora values even when marker IDs are absent", () => {
    expect(
      getYakuCounts({
        yakus: [Han.Riichi],
        totalDoraValue: 2,
        uraDoraValue: 1,
      })
    ).toEqual([
      { yakuId: Han.Dora, count: 1 },
      { yakuId: Han.Ura_Dora, count: 1 },
      { yakuId: Han.Riichi, count: 1 },
    ]);
  });
});

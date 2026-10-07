import { describe, expect, it } from "vitest";
import { resolveRuleSet, type RuleSetOverride } from "~/game/rules/ruleSet";
import { getTournamentGameRules } from "~/services/tournamentRules";
import {
  ruleSetToTenhouConfig,
  assertTenhouRulesApplied,
} from "./ruleSetToTenhouConfig";

const current = {
  RULE: "202610010000,202611012359,0149,0,0,0,0",
  CSRULE:
    "400fc0c0,00000402,,,33000,35000,37000,,,,2000,200,,,,,100,200,300,,,5,-15,-35,6,-16,-36,7,-17,-37,8,-18,-38,9,-19,-39,6,16,,7,17,,8,18,",
};

function convert(overrides: RuleSetOverride = {}) {
  return ruleSetToTenhouConfig(
    resolveRuleSet({
      uma: getTournamentGameRules("m-league").uma,
      splitTiedUma: true,
      ...overrides,
    }),
    current
  );
}

describe("ruleSetToTenhouConfig", () => {
  it.each(["ema", "jpml-hanchan", "m-league"] as const)(
    "converts the canonical %s preset without changing it",
    (presetId) => {
      const rules = getTournamentGameRules(presetId);
      const original = structuredClone(rules);
      const converted = ruleSetToTenhouConfig(rules, current);
      expect(converted.R2).toBe(presetId === "m-league" ? "0149" : "014b");
      const fields = converted.CSRULE.split(",");
      expect(fields).toHaveLength(45);
      expect(fields.slice(4, 7)).toEqual([
        String(rules.startingScore),
        "30000",
        "30000",
      ]);
      expect(fields[10]).toBe("1000");
      expect(fields[11]).toBe("100");
      expect(fields.slice(16, 19)).toEqual(["1000", "1500", "3000"]);
      expect(fields.slice(21, 36)).toEqual(
        rules.uma.flatMap((row) => row.slice(1).map(String))
      );
      expect(fields.slice(36)).toEqual(current.CSRULE.split(",").slice(36));
      expect(Number.parseInt(fields[0], 16) & 0x40000000).toBe(0x40000000);
      expect(Number.parseInt(fields[1], 16) & 0x00000402).toBe(0x00000402);
      expect(rules).toEqual(original);
    }
  );

  it("disables nagashi mangan for JPML A", () => {
    const rules = getTournamentGameRules("jpml-hanchan");
    const converted = ruleSetToTenhouConfig(rules, current);
    const flags = Number.parseInt(converted.CSRULE.split(",")[0], 16);
    expect(flags & 0x00000001).toBe(0x00000001);
  });

  it.each([
    ["four-winds", 0x00000100],
    ["four-riichi", 0x00000400],
    ["nine-terminals", 0x00000800],
  ] as const)("disables JPML A %s abortive draws", (_name, mask) => {
    const rules = getTournamentGameRules("jpml-hanchan");
    const converted = ruleSetToTenhouConfig(rules, current);
    const flags = Number.parseInt(converted.CSRULE.split(",")[0], 16);
    expect(flags & mask).toBe(mask);
  });

  it("uses the HAR bit positions and keeps flags unrelated to gameplay", () => {
    const converted = convert({
      roundWindCount: 1,
      kuitan: false,
      nbRedFiveManzu: 0,
      nbRedFivePinzu: 0,
      nbRedFiveSouzu: 0,
      nagashiMangan: false,
      kiriageMangan: true,
      bustedScore: null,
      kanDora: false,
      uraDora: false,
      ippatsu: false,
      atamahane: true,
      tenpaiRenchan: false,
      doubleWindPairFu: 2,
      unclaimedRiichiDeposits: "left_outside_table_score",
      aborts: {
        kyuushuu: false,
        suufonRenda: false,
        suuchaRiichi: false,
        sanchahou: false,
      },
    });
    expect(converted.R2).toBe("0147");
    const fields = converted.CSRULE.split(",");
    expect(fields[0]).toBe("402affe7");
    expect(fields[1]).toBe("00000407");
    expect(fields[6]).toBe("30000");
    expect(fields.slice(21, 36)).toEqual(
      Array.from({ length: 5 }, () => ["10", "-10", "-30"]).flat()
    );
  });

  it("supports distinct floating UMA rows and the captured point values", () => {
    const converted = ruleSetToTenhouConfig(
      resolveRuleSet({
        startingScore: 33000,
        riichiBetValue: 2000,
        returnScore: 37000,
        minimumScoreToWin: 35000,
        roundFinalScores: false,
        splitTiedUma: true,
        uma: [
          [45, 5, -15, -35],
          [46, 6, -16, -36],
          [47, 7, -17, -37],
          [48, 8, -18, -38],
          [49, 9, -19, -39],
        ],
      }),
      current
    );
    const fields = converted.CSRULE.split(",");
    expect(fields.slice(4, 7)).toEqual(["33000", "35000", "37000"]);
    expect(Number.parseInt(fields[0], 16) & 0x00200000).toBe(0);
    expect(fields[10]).toBe("2000");
    expect(fields.slice(21, 36)).toEqual([
      "5",
      "-15",
      "-35",
      "6",
      "-16",
      "-36",
      "7",
      "-17",
      "-37",
      "8",
      "-18",
      "-38",
      "9",
      "-19",
      "-39",
    ]);
  });

  it("disables dependent kan flags even if dormant source settings are true", () => {
    const fields = convert({ kanDora: false }).CSRULE.split(",");
    const flags = Number.parseInt(fields[0], 16);
    expect(flags & 0x00000008).toBe(0);
    expect(flags & 0x000002a0).toBe(0x000002a0);
    expect(flags & 0x00000040).toBe(0);
  });

  it("keeps ankan immediate while allowing deferred minkan dora", () => {
    const fields = convert({
      instantlyRevealDoraForMinkan: false,
    }).CSRULE.split(",");
    expect(Number.parseInt(fields[0], 16) & 0x8).toBe(0);
  });

  it("maps disabled honba and noten payments to explicit zeroes", () => {
    const fields = convert({
      honbaPayments: false,
      tenpaiPayments: false,
    }).CSRULE.split(",");
    expect(fields[11]).toBe("0");
    expect(fields.slice(16, 19)).toEqual(["0", "0", "0"]);
  });

  it("supports an ordinary lobby with no custom rules and preserves unknown tail fields", () => {
    const rules = getTournamentGameRules("ema");
    const noCustom = ruleSetToTenhouConfig(rules, {
      RULE: current.RULE,
    });
    expect(noCustom.CSRULE.split(",").slice(4, 7)).toEqual([
      "30000",
      "30000",
      "30000",
    ]);
    const extended = ruleSetToTenhouConfig(rules, {
      ...current,
      CSRULE: `${current.CSRULE},future,value`,
    });
    expect(extended.CSRULE.split(",").slice(45)).toEqual(["future", "value"]);
  });

  it("converts a three-player/chip lobby to the engine's four-player non-chip game", () => {
    const converted = ruleSetToTenhouConfig(resolveRuleSet(), {
      ...current,
      RULE: current.RULE.replace("0149", "0759"),
    });
    expect(converted.R2).toBe("0149");
  });

  it.each<[RuleSetOverride, string]>([
    [{ roundWindCount: 4 }, "roundWindCount"],
    [{ roundLimit: 3 }, "roundLimit"],
    [{ nbRedFivePinzu: 2 }, "red"],
    [{ kuikae: "allowed" }, "kuikae"],
    [{ doubleRiichi: false }, "doubleRiichi"],
    [{ renhou: true }, "renhou"],
    [{ instantlyRevealDoraForAnkan: false }, "instantlyRevealDoraForAnkan"],
    [{ bustedScore: 1000 }, "bustedScore"],
    [{ bustedStrict: false }, "bustedStrict"],
    [{ agariYame: true }, "agariYame"],
    [{ tenpaiYame: true }, "tenpaiYame"],
    [{ buuMode: true }, "buuMode"],
    [{ scoreCap: "mangan" }, "scoreCap"],
    [{ winnerThreshold: 30000 }, "winnerThreshold"],
    [{ startingScore: 25001 }, "startingScore"],
  ])("rejects unsupported rules %j explicitly", (overrides, field) => {
    expect(() => convert(overrides)).toThrow(field);
  });

  it("rejects invalid existing flags and impossible scoring instead of guessing", () => {
    const rules = resolveRuleSet();
    expect(() => ruleSetToTenhouConfig(rules, { RULE: "invalid" })).toThrow(
      "RULE"
    );
    expect(() =>
      ruleSetToTenhouConfig(rules, {
        ...current,
        CSRULE: "not-hex,00000000",
      })
    ).toThrow("CSRULE");
    expect(() => convert({ startingScore: 40000 })).toThrow("returnScore");
    expect(() =>
      ruleSetToTenhouConfig(
        { ...rules, uma: [[1, 2, 3, 4], ...rules.uma.slice(1)] },
        current
      )
    ).toThrow("UMA");
  });
});

describe("Tenhou configuration readback", () => {
  it("accepts equivalent default amounts and flag casing", () => {
    const expected = ruleSetToTenhouConfig(resolveRuleSet(), {
      RULE: current.RULE,
    });
    const actual = expected.CSRULE.split(",");
    actual[0] = actual[0].toUpperCase();
    for (const index of [4, 5, 6, 10, 11, 16, 17, 18]) {
      actual[index] = "";
    }
    expect(() =>
      assertTenhouRulesApplied(expected, {
        RULE: current.RULE,
        CSRULE: actual.join(","),
      })
    ).not.toThrow();
  });

  it("detects settings silently rejected by Tenhou", () => {
    const expected = convert({ tenpaiPayments: false });
    const actual = expected.CSRULE.split(",");
    actual[16] = "";
    expect(() =>
      assertTenhouRulesApplied(expected, {
        RULE: current.RULE,
        CSRULE: actual.join(","),
      })
    ).toThrow("CSRULE[16]");
  });

  it("also verifies that custom timers survived the update", () => {
    const expected = convert();
    const actual = expected.CSRULE.split(",");
    actual[36] = "";
    expect(() =>
      assertTenhouRulesApplied(expected, {
        RULE: current.RULE,
        CSRULE: actual.join(","),
      })
    ).toThrow("CSRULE[36]");
  });
});

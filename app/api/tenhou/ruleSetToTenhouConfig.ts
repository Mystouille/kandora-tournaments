import { RuleSetSchema, type RuleSet } from "~/game/rules/ruleSet";

export interface TenhouRuleSource {
  RULE: string;
  CSRULE?: string;
}

export interface TenhouRuleConfig {
  R2: string;
  CSRULE: string;
}

export class TenhouRuleConversionError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`Cannot convert rules to Tenhou: ${issues.join("; ")}`);
    this.name = "TenhouRuleConversionError";
  }
}

export function getTenhouRuleCode(config: TenhouRuleSource): string {
  const code = config.RULE.split(",")[2];
  if (!code || !/^[\da-f]{4}$/i.test(code)) {
    throw new TenhouRuleConversionError(["invalid lobby RULE code"]);
  }
  return code.toLowerCase();
}

function customFields(customRule = ""): string[] {
  const fields = customRule.split(",");
  while (fields.length < 45) {
    fields.push("");
  }
  for (const index of [0, 1]) {
    if (fields[index] && !/^[\da-f]{8}$/i.test(fields[index])) {
      throw new TenhouRuleConversionError([`invalid CSRULE[${index}] flags`]);
    }
  }
  return fields;
}

function flags(value: string): number {
  return value ? Number.parseInt(value, 16) : 0;
}

function setFlag(value: number, mask: number, enabled: boolean): number {
  return enabled ? value | mask : value & ~mask;
}

function hex(value: number, length: number): string {
  return (value >>> 0).toString(16).padStart(length, "0");
}

function validateRules(rules: RuleSet): void {
  const issues: string[] = [];
  const require = (condition: boolean, message: string) => {
    if (!condition) {
      issues.push(message);
    }
  };
  require(rules.roundWindCount !== 4, "roundWindCount must be 1 or 2");
  require(rules.roundLimit === 4, "roundLimit must be 4");
  require(rules.kuikae === "full", "kuikae must be full");
  const redCounts = [
    rules.nbRedFiveManzu,
    rules.nbRedFivePinzu,
    rules.nbRedFiveSouzu,
  ];
  require(redCounts.every((count) => count === 0) ||
    redCounts.every(
      (count) => count === 1
    ), "red fives must be either absent or one per suit");
  require(rules.doubleRiichi, "doubleRiichi cannot be disabled");
  require(!rules.renhou, "renhou yakuman is not supported (Tenhou uses mangan)");
  require(!rules.kanDora ||
    rules.instantlyRevealDoraForAnkan, "instantlyRevealDoraForAnkan cannot be disabled while kanDora is enabled");
  require(rules.bustedScore === null ||
    rules.bustedScore === 0, "bustedScore must be null or 0");
  require(rules.bustedScore === null ||
    rules.bustedStrict, "bustedStrict must be true (Tenhou continues at exactly zero)");
  require(!rules.agariYame, "agariYame ends unconditionally in the game engine, but only when first in Tenhou");
  require(!rules.tenpaiYame, "tenpaiYame ends unconditionally in the game engine, but only when first in Tenhou");
  require(!rules.buuMode, "buuMode is not supported");
  require(rules.scoreCap === null, "scoreCap is not supported");
  require(rules.winnerThreshold === null, "winnerThreshold is not supported");
  require(rules.startingChips === 0, "startingChips must be 0");
  require(rules.startingScore >= 0 &&
    rules.startingScore <= 999999 &&
    rules.startingScore % 100 ===
      0, "startingScore must be a nonnegative multiple of 100 below 1000000");
  require(rules.riichiBetValue <= 99999 &&
    rules.riichiBetValue % 100 ===
      0, "riichiBetValue must be a multiple of 100 below 100000");
  require(rules.returnScore >= rules.startingScore &&
    rules.returnScore <= 999999 &&
    rules.returnScore % 100 ===
      0, "returnScore must be a multiple of 100, at least startingScore and below 1000000");
  require(rules.minimumScoreToWin === null ||
    (rules.minimumScoreToWin >= 0 &&
      rules.minimumScoreToWin <= 999999 &&
      rules.minimumScoreToWin % 100 ===
        0), "minimumScoreToWin must be null or a nonnegative multiple of 100 below 1000000");
  require(rules.uma.length === 5 &&
    rules.uma.every(
      (row) =>
        row.length === 4 &&
        row.every((value) => Number.isInteger(value)) &&
        row.slice(1).every((value) => String(value).length <= 4) &&
        row.reduce((sum, value) => sum + value, 0) === 0
    ), "UMA requires five zero-sum integer rows; each posted bonus must fit four characters");
  if (issues.length > 0) {
    throw new TenhouRuleConversionError(issues);
  }
}

export function ruleSetToTenhouConfig(
  ruleSet: RuleSet,
  current: TenhouRuleSource
): TenhouRuleConfig {
  const parsed = RuleSetSchema.safeParse(ruleSet);
  if (!parsed.success) {
    throw new TenhouRuleConversionError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      )
    );
  }
  const rules = parsed.data;
  validateRules(rules);
  const oldCode = Number.parseInt(getTenhouRuleCode(current), 16);
  const fields = customFields(current.CSRULE);
  // Keep lobby speed, tsumogiri display and unrelated/reserved rule bits.
  let code = (oldCode & ~0x061f) | 0x0001;
  code = setFlag(code, 0x0008, rules.roundWindCount === 2);
  code = setFlag(code, 0x0004, !rules.kuitan);
  code = setFlag(code, 0x0002, rules.nbRedFiveManzu === 0);

  let first = flags(fields[0]);
  const settings: ReadonlyArray<readonly [number, boolean]> = [
    [0x00000001, !rules.nagashiMangan],
    [0x00000002, rules.kiriageMangan],
    [0x00000004, rules.bustedScore === null],
    [0x00000008, rules.kanDora && rules.instantlyRevealDoraForMinkan],
    [0x00000010, false],
    [0x00000020, !rules.kanDora],
    [0x00000040, !rules.uraDora],
    [0x00000080, !(rules.kanDora && rules.uraDora)],
    [0x00000100, !rules.aborts.suufonRenda],
    // The game engine has no four-kan abort; Tenhou also requires this when kan dora is off.
    [0x00000200, true],
    [0x00000400, !rules.aborts.suuchaRiichi],
    [0x00000800, !rules.aborts.kyuushuu],
    [0x00001000, !rules.aborts.sanchahou || rules.atamahane],
    [0x00002000, rules.atamahane],
    [0x00004000, true],
    [0x00008000, true],
    [0x00010000, false],
    [0x00020000, !rules.tenpaiRenchan],
    [0x00040000, rules.roundFinalScores],
    [0x00080000, !rules.ippatsu],
    [0x00100000, false],
    [0x00200000, rules.minimumScoreToWin === null],
    [0x01000000, false],
  ];
  for (const [mask, enabled] of settings) {
    first = setFlag(first, mask, enabled);
  }
  let second = flags(fields[1]);
  second = setFlag(second, 0x1, rules.doubleWindPairFu === 2);
  second = setFlag(second, 0x2, rules.splitTiedUma);
  second = setFlag(
    second,
    0x4,
    rules.unclaimedRiichiDeposits === "left_outside_table_score"
  );
  fields[0] = hex(first, 8);
  fields[1] = hex(second, 8);
  fields[4] = String(rules.startingScore);
  // The threshold is dormant when the rules disable sudden-death extension.
  fields[5] = String(rules.minimumScoreToWin ?? rules.returnScore);
  fields[6] = String(rules.returnScore);
  fields[7] = "0";
  fields[10] = String(rules.riichiBetValue);
  fields[11] = rules.honbaPayments ? "100" : "0";
  fields[16] = rules.tenpaiPayments ? "1000" : "0";
  fields[17] = rules.tenpaiPayments ? "1500" : "0";
  fields[18] = rules.tenpaiPayments ? "3000" : "0";
  for (const [below, uma] of rules.uma.entries()) {
    for (let place = 1; place < 4; place++) {
      fields[21 + below * 3 + place - 1] = String(uma[place]);
    }
  }
  return { R2: hex(code, 4), CSRULE: fields.join(",") };
}

function normalizedFields(config: TenhouRuleConfig): string[] {
  const fields = customFields(config.CSRULE).map((value) => value.trim());
  const sanma = (Number.parseInt(config.R2, 16) & 0x10) !== 0;
  const defaults: Record<number, string> = {
    4: sanma ? "35000" : "25000",
    5: sanma ? "40000" : "30000",
    6: sanma ? "40000" : "30000",
    7: "0",
    10: "1000",
    11: "100",
    16: "1000",
    17: sanma ? "2000" : "1500",
    18: sanma ? "" : "3000",
  };
  fields[0] = hex(flags(fields[0]), 8);
  fields[1] = hex(flags(fields[1]), 8);
  for (const [index, value] of Object.entries(defaults)) {
    fields[Number(index)] ||= value;
  }
  for (let index = 21; index < 36; index++) {
    fields[index] ||= ["10", "-10", "-20"][(index - 21) % 3];
  }
  const fast = (Number.parseInt(config.R2, 16) & 0x40) !== 0;
  for (const index of [36, 39, 42]) {
    fields[index] ||= fast ? "3" : "5";
    fields[index + 1] ||= fast ? "5" : "10";
    fields[index + 2] ||= "5";
  }
  return fields;
}

export function assertTenhouRulesApplied(
  expected: TenhouRuleConfig,
  actual: TenhouRuleSource
): void {
  const actualCode = getTenhouRuleCode(actual);
  const differences: string[] = [];
  if (actualCode !== expected.R2) {
    differences.push("R2");
  }
  const expectedFields = normalizedFields(expected);
  const actualFields = normalizedFields({
    R2: actualCode,
    CSRULE: actual.CSRULE ?? "",
  });
  for (
    let index = 0;
    index < Math.max(expectedFields.length, actualFields.length);
    index++
  ) {
    if (expectedFields[index] !== actualFields[index]) {
      differences.push(`CSRULE[${index}]`);
    }
  }
  if (differences.length > 0) {
    throw new Error(
      `Tenhou did not retain the requested settings: ${differences.join(", ")}`
    );
  }
}

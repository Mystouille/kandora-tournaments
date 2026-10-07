import { z } from "zod";
import { Ruleset } from "~/core/types/league-enums";
import { getPreset, presetToRuleSet } from "~/game/rules/presets";
import type { RuleSet } from "~/game/rules/ruleSet";

const gamePresetIds = ["ema", "jpml-hanchan", "m-league"] as const;
export type TournamentGamePresetId = (typeof gamePresetIds)[number];
const legacyRulesets: Record<TournamentGamePresetId, Ruleset> = {
  ema: Ruleset.EMA,
  "jpml-hanchan": Ruleset.JPML,
  "m-league": Ruleset.MLEAGUE,
};
const presetByRuleset = new Map<Ruleset, TournamentGamePresetId>(
  gamePresetIds.map((id) => [legacyRulesets[id], id])
);

export const tournamentGamePresets = gamePresetIds.map(getPreset);

export const TournamentRulesConfigSchema = z
  .object({
    gameRulePresetId: z.enum(gamePresetIds),
    isTeamMode: z.boolean().default(false),
  })
  .strict()
  .transform((config) => ({
    ...config,
    gameRules: legacyRulesets[config.gameRulePresetId],
  }));

export function getTournamentRulesForScoring(
  ruleset: Ruleset
): RuleSet | undefined {
  const presetId = presetByRuleset.get(ruleset);
  return presetId ? getPreset(presetId) : undefined;
}

export function getTournamentGameRules(
  presetId: TournamentGamePresetId
): RuleSet {
  return presetToRuleSet(getPreset(presetId));
}

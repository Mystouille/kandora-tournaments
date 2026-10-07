import { describe, expect, it } from "vitest";
import { getPreset } from "~/game/rules/presets";
import { Ruleset } from "~/core/types/league-enums";
import { LeagueModel } from "~/core/models/tournament/League";
import {
  TournamentRulesConfigSchema,
  getTournamentGameRules,
  tournamentGamePresets,
} from "./tournamentRules";
import { computePlayerDeltas } from "./leagueUtils";

describe("tournament rule sources", () => {
  it("offers the existing EMA, JPML A and M-League game presets", () => {
    expect(tournamentGamePresets.map((preset) => preset.id)).toEqual([
      "ema",
      "jpml-hanchan",
      "m-league",
    ]);
    for (const preset of tournamentGamePresets) {
      expect(preset).toBe(getPreset(preset.id));
    }
  });

  it("sources gameplay and settlement from the same immutable preset", () => {
    const original = structuredClone(getPreset("jpml-hanchan"));
    const rules = getTournamentGameRules("jpml-hanchan");
    expect(rules.startingScore).toBe(30000);
    expect(rules.ippatsu).toBe(false);
    expect(rules.kanDora).toBe(false);
    expect(rules.returnScore).toBe(30000);
    expect(rules.uma).toEqual(original.uma);
    expect(rules).not.toHaveProperty("id");
    expect(getPreset("jpml-hanchan")).toEqual(original);
  });

  it.each([Ruleset.WRC, Ruleset.ONLINE, Ruleset.INDONESIAN])(
    "does not accept a separate legacy %s scoring selection",
    (gameRules) => {
      expect(
        TournamentRulesConfigSchema.safeParse({
          gameRules,
          gameRulePresetId: "ema",
        }).success
      ).toBe(false);
    }
  );

  it("requires an explicit supported gameplay preset", () => {
    expect(TournamentRulesConfigSchema.safeParse({}).success).toBe(false);
    expect(
      TournamentRulesConfigSchema.safeParse({
        gameRulePresetId: "buu-east",
      }).success
    ).toBe(false);
  });

  it.each([
    ["ema", Ruleset.EMA],
    ["m-league", Ruleset.MLEAGUE],
  ] as const)(
    "%s scoring agrees with the existing standings calculation",
    (presetId, ruleset) => {
      const config = getTournamentGameRules(presetId);
      const results = [42000, 32000, 22000, 4000].map((score) => ({ score }));
      const oka = (4 * (config.returnScore - config.startingScore)) / 1000;
      const expected = results.map(
        ({ score }, place) =>
          (score - config.returnScore) / 1000 +
          config.uma[0][place] +
          (place === 0 ? oka : 0)
      );
      expect(computePlayerDeltas(results, ruleset)).toEqual(expected);
    }
  );

  it("derives the persisted rules identifier, including JPML, from the preset", () => {
    expect(
      TournamentRulesConfigSchema.parse({ gameRulePresetId: "jpml-hanchan" })
    ).toEqual({
      gameRulePresetId: "jpml-hanchan",
      gameRules: Ruleset.JPML,
      isTeamMode: false,
    });
    expect(
      computePlayerDeltas(
        [45000, 35000, 25000, 15000].map((score) => ({ score })),
        Ruleset.JPML
      )
    ).toEqual([23, 9, -9, -23]);
  });

  it("keeps legacy scoring behavior available for existing tournaments", () => {
    const players = [40000, 35000, 25000, 20000].map((score) => ({ score }));
    expect(computePlayerDeltas(players, Ruleset.WRC)).toEqual([
      25, 10, -10, -25,
    ]);
    expect(computePlayerDeltas(players, Ruleset.INDONESIAN)).toEqual([
      25, 10, -10, -25,
    ]);
    expect(computePlayerDeltas(players, Ruleset.ONLINE)).toEqual([
      15, 10, 0, -5,
    ]);
  });

  it("persists the gameplay selection independently of legacy scoring", async () => {
    const league = new LeagueModel({
      name: "Preset persistence",
      startTime: new Date("2026-10-01"),
      endTime: new Date("2026-11-01"),
      rulesConfig: {
        gameRules: Ruleset.JPML,
        gameRulePresetId: "jpml-hanchan",
        isTeamMode: false,
      },
      platformConfig: { platformName: "TENHOU" },
    });
    await league.validate();
    expect(league.toObject().rulesConfig).toEqual({
      gameRules: Ruleset.JPML,
      gameRulePresetId: "jpml-hanchan",
      isTeamMode: false,
    });
    league.rulesConfig.gameRules = Ruleset.INDONESIAN;
    league.rulesConfig.gameRulePresetId = undefined;
    await expect(league.validate()).resolves.toBeUndefined();
  });
});

import type { LeagueTypeConfig } from "../../../services/league-configs/types";
import type { Translations } from "../../../i18n/types";

export type ConfigT = Translations["onlineTournaments"]["admin"]["config"];

export type LeagueTypeConfigFormResult =
  | { mode: "existing"; configId: string; config: LeagueTypeConfig }
  | { mode: "new"; config: LeagueTypeConfig };

export function defaultRegularPhase(
  id = "regular"
): NonNullable<LeagueTypeConfig["regularPhase"]> {
  return { id, scoring: { type: "cumulative" } };
}

export function defaultFinalStage(id = "stage-1") {
  return {
    id,
    gameCount: 4,
    seeds: [] as number[],
    fromStages: [] as {
      stageId: string;
      topN: number;
      places?: number[];
    }[],
  };
}

export function defaultFinalPhase(): NonNullable<
  LeagueTypeConfig["finalPhase"]
> {
  return {
    id: "finals",
    scoring: { type: "bracket-delta" },
    scoreCarryOver: { num: 0, den: 1 },
    stages: [
      { id: "final", gameCount: 4, seeds: [1, 2, 3, 4], fromStages: [] },
    ],
  };
}

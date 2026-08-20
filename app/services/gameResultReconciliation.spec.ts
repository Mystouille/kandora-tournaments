import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import type { GameResult } from "~/core/models/tournament/Game";
import { computePlayerDeltas } from "./leagueUtils";
import { Ruleset } from "~/core/models/tournament/League";
import { reconcileGameResultStanding } from "./gameResultReconciliation";

describe("reconcileGameResultStanding", () => {
  it("replaces Tenhou's post-uma summary delta with raw replay points", () => {
    const userId = new mongoose.Types.ObjectId();
    const results: GameResult[] = [
      { userId, score: 47.8, place: 1, nbChombo: 0 },
    ];

    expect(reconcileGameResultStanding(results, userId, 27800, 1)).toBe(true);
    expect(results[0]).toMatchObject({ score: 27800, place: 1 });
    expect(computePlayerDeltas(results, Ruleset.MLEAGUE)).toEqual([47.8]);
  });

  it("does not rewrite an already-authoritative standing", () => {
    const userId = new mongoose.Types.ObjectId();
    const results: GameResult[] = [
      { userId, score: 27800, place: 1, nbChombo: 0 },
    ];

    expect(reconcileGameResultStanding(results, userId, 27800, 1)).toBe(false);
  });
});
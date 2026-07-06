import { describe, expect, it } from "vitest";
import {
  resolveOrderedPhases,
  resolveGamePhaseId,
  isFinalsPhaseGame,
  buildFinalsGameMatch,
  buildRegularGameMatch,
} from "./index";
import type { LeagueTypeConfig } from "./types";

// ---------------------------------------------------------------------------
// Config fixtures
// ---------------------------------------------------------------------------

const singleRegularWithFinals: LeagueTypeConfig = {
  displayName: "Single + Finals",
  isTeamMode: false,
  regularPhase: { id: "regular", scoring: { type: "cumulative" } },
  finalPhase: {
    id: "finals",
    scoring: { type: "bracket-delta" },
    scoreCarryOver: { num: 0, den: 1 },
    stages: [],
  },
};

const multiRegular: LeagueTypeConfig = {
  displayName: "Multi-phase",
  isTeamMode: true,
  regularPhases: [
    { id: "qualifiers", scoring: { type: "cumulative" } },
    { id: "regular", scoring: { type: "cumulative" } },
  ],
  finalPhase: {
    id: "finals",
    scoring: { type: "bracket-delta" },
    scoreCarryOver: { num: 0, den: 1 },
    stages: [],
  },
};

const regularOnly: LeagueTypeConfig = {
  displayName: "Regular only",
  isTeamMode: false,
  regularPhase: { id: "regular", scoring: { type: "cumulative" } },
};

// A league doc with a single finals cutoff.
const cutoff = new Date("2026-03-01T00:00:00Z");
const league = { phaseCutoffTimes: [cutoff] };

describe("resolveOrderedPhases", () => {
  it("returns single regular phase then finals", () => {
    expect(resolveOrderedPhases(singleRegularWithFinals)).toEqual([
      { id: "regular", kind: "regular", index: 0 },
      { id: "finals", kind: "final", index: 1 },
    ]);
  });

  it("expands multi regular phases in order then finals", () => {
    expect(resolveOrderedPhases(multiRegular)).toEqual([
      { id: "qualifiers", kind: "regular", index: 0 },
      { id: "regular", kind: "regular", index: 1 },
      { id: "finals", kind: "final", index: 2 },
    ]);
  });

  it("returns empty for null config", () => {
    expect(resolveOrderedPhases(null)).toEqual([]);
  });
});

describe("resolveGamePhaseId", () => {
  it("prefers the game's phaseId tag over time", () => {
    // Tagged finals but started before the cutoff — the tag wins.
    const game = { phaseId: "finals", startTime: new Date("2026-01-01") };
    expect(resolveGamePhaseId(game, singleRegularWithFinals, league)).toBe(
      "finals"
    );
  });

  it("falls back to the time bucket for untagged games", () => {
    const before = { startTime: new Date("2026-02-01T00:00:00Z") };
    const after = { startTime: new Date("2026-03-02T00:00:00Z") };
    expect(resolveGamePhaseId(before, singleRegularWithFinals, league)).toBe(
      "regular"
    );
    expect(resolveGamePhaseId(after, singleRegularWithFinals, league)).toBe(
      "finals"
    );
  });

  it("buckets untagged multi-phase games across two cutoffs", () => {
    const twoCutoffs = {
      phaseCutoffTimes: [
        new Date("2026-02-01T00:00:00Z"),
        new Date("2026-03-01T00:00:00Z"),
      ],
    };
    expect(
      resolveGamePhaseId(
        { startTime: new Date("2026-01-15") },
        multiRegular,
        twoCutoffs
      )
    ).toBe("qualifiers");
    expect(
      resolveGamePhaseId(
        { startTime: new Date("2026-02-15") },
        multiRegular,
        twoCutoffs
      )
    ).toBe("regular");
    expect(
      resolveGamePhaseId(
        { startTime: new Date("2026-03-15") },
        multiRegular,
        twoCutoffs
      )
    ).toBe("finals");
  });

  it("returns null when no phases are configured", () => {
    expect(resolveGamePhaseId({ phaseId: "x" }, null, league)).toBe("x");
    expect(resolveGamePhaseId({ startTime: new Date() }, null, league)).toBe(
      null
    );
  });
});

describe("isFinalsPhaseGame", () => {
  it("uses the tag when present", () => {
    expect(
      isFinalsPhaseGame({ phaseId: "finals" }, singleRegularWithFinals, league)
    ).toBe(true);
    expect(
      isFinalsPhaseGame({ phaseId: "regular" }, singleRegularWithFinals, league)
    ).toBe(false);
  });

  it("falls back to the time cutoff for untagged games", () => {
    expect(
      isFinalsPhaseGame(
        { startTime: new Date("2026-03-05") },
        singleRegularWithFinals,
        league
      )
    ).toBe(true);
    expect(
      isFinalsPhaseGame(
        { startTime: new Date("2026-02-05") },
        singleRegularWithFinals,
        league
      )
    ).toBe(false);
  });

  it("is false when there is no finals phase", () => {
    expect(
      isFinalsPhaseGame({ startTime: new Date("2026-03-05") }, regularOnly, {
        phaseCutoffTimes: [cutoff],
      })
    ).toBe(false);
  });
});

describe("buildFinalsGameMatch / buildRegularGameMatch", () => {
  it("returns null when there is no finals phase", () => {
    expect(buildFinalsGameMatch(regularOnly, league)).toBeNull();
    expect(buildRegularGameMatch(regularOnly, league)).toBeNull();
  });

  it("builds a tag-preferring finals match with time fallback", () => {
    expect(buildFinalsGameMatch(singleRegularWithFinals, league)).toEqual({
      $or: [
        { phaseId: "finals" },
        { phaseId: null, startTime: { $gte: cutoff } },
      ],
    });
  });

  it("builds a tag-preferring regular match with time fallback", () => {
    expect(buildRegularGameMatch(singleRegularWithFinals, league)).toEqual({
      $or: [
        { phaseId: { $nin: [null, "finals"] } },
        { phaseId: null, startTime: { $lt: cutoff } },
      ],
    });
  });

  it("drops the time clause when no cutoff is configured", () => {
    const noCutoff = { phaseCutoffTimes: [] };
    expect(buildFinalsGameMatch(singleRegularWithFinals, noCutoff)).toEqual({
      $or: [{ phaseId: "finals" }, { phaseId: null }],
    });
  });
});

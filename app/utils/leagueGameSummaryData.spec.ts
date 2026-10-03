import { describe, expect, it } from "vitest";
import type { GameEvent } from "~/game/protocol/messages";
import { buildSummaryPoints, buildSummaryStats } from "./leagueGameSummaryData";

const players = [0, 1, 2, 3].map((seat) => ({
  playerId: `player-${seat}`,
  seat,
  score: [44000, 31000, 26000, -1000][seat],
}));
const round = (overrides = {}) => ({
  hasRiichi: false,
  isWinner: false,
  gotRonned: false,
  ryuukyoku: false,
  ...overrides,
});

function events(): GameEvent[] {
  return [
    {
      type: "hand_start",
      round: 0,
      dealer: 0,
      roundWind: "E",
      roundNumber: 1,
      honba: 0,
      doraIndicators: ["1z"],
      scores: [30000, 30000, 30000, 30000],
    },
    { type: "hand_end", reason: "exhaustive_draw" },
    {
      type: "hand_start",
      round: 0,
      dealer: 0,
      roundWind: "E",
      roundNumber: 1,
      honba: 1,
      doraIndicators: ["2z"],
      scores: [29000, 31000, 30000, 30000],
    },
    {
      type: "hand_end",
      reason: "ron",
      scores: [43000, 31000, 26000, -1000],
    },
    {
      type: "match_end",
      reason: "busted",
      finalScores: [
        { seat: 2, score: 26000, place: 3 },
        { seat: 0, score: 44000, place: 1 },
        { seat: 3, score: -1000, place: 4 },
        { seat: 1, score: 31000, place: 2 },
      ],
    },
  ];
}

describe("league game summary statistics", () => {
  it("counts completed-hand flags, not payments or individual ron claims", () => {
    const result = buildSummaryStats(
      [
        {
          playerId: "a",
          roundEvents: [
            round({ hasRiichi: true, isWinner: true }),
            round({ gotRonned: true }),
            round({ ryuukyoku: true }),
          ],
        },
        {
          playerId: "b",
          roundEvents: [
            round(),
            round({ isWinner: true, hasRiichi: true }),
            round({ ryuukyoku: true }),
          ],
        },
      ],
      ["b", "a"],
      3
    );
    expect(result).toEqual({
      status: "available",
      data: {
        a: { riichis: 1, wins: 1, dealIns: 1 },
        b: { riichis: 1, wins: 1, dealIns: 0 },
      },
    });
  });

  it("distinguishes a real zero from absent or incomplete records", () => {
    expect(buildSummaryStats([], ["a"])).toEqual({
      status: "unavailable",
      reason: "missingRecord",
    });
    expect(
      buildSummaryStats([{ playerId: "a", roundEvents: [] }], ["a"])
    ).toEqual({ status: "unavailable", reason: "incompleteRecord" });
    expect(
      buildSummaryStats([{ playerId: "a", roundEvents: [round()] }], ["a"], 2)
    ).toEqual({ status: "unavailable", reason: "incompleteRecord" });
    expect(
      buildSummaryStats([{ playerId: "a", roundEvents: [round()] }], ["a"])
    ).toEqual({
      status: "available",
      data: { a: { riichis: 0, wins: 0, dealIns: 0 } },
    });
  });

  it("requires unambiguous records for every participant", () => {
    expect(
      buildSummaryStats([{ playerId: "a", roundEvents: [round()] }], ["a", "b"])
        .status
    ).toBe("unavailable");
    expect(
      buildSummaryStats(
        [
          { playerId: "a", roundEvents: [round()] },
          { playerId: "a", roundEvents: [round()] },
        ],
        ["a"]
      ).status
    ).toBe("unavailable");
  });
});

describe("league game summary points", () => {
  it("uses one settled snapshot per hand, including the final settlement", () => {
    const result = buildSummaryPoints(events(), [...players].reverse());
    expect(result).toEqual({
      status: "available",
      data: {
        labels: [
          { kind: "start" },
          { kind: "hand", wind: "E", number: 1, honba: 0 },
          { kind: "hand", wind: "E", number: 1, honba: 1 },
        ],
        series: [
          { playerId: "player-3", scores: [30000, 30000, -1000] },
          { playerId: "player-2", scores: [30000, 30000, 26000] },
          { playerId: "player-1", scores: [30000, 31000, 31000] },
          { playerId: "player-0", scores: [30000, 29000, 44000] },
        ],
      },
    });
  });

  it("does not plot an extra Tenhou result before final-hand riichi deductions", () => {
    const finalScores = [18600, 7900, 37900, 35600];
    const finalPlayers = ([0, 1, 2, 3] as const).map((seat) => ({
      playerId: `seat-${seat}`,
      seat,
      score: finalScores[seat],
    }));
    const replay: GameEvent[] = [
      {
        type: "hand_start",
        round: 6,
        dealer: 2,
        roundWind: "S",
        roundNumber: 3,
        honba: 0,
        doraIndicators: ["1z"],
        scores: [18600, 13100, 32700, 35600],
      },
      {
        type: "hand_end",
        reason: "ron",
        scores: [19600, 13100, 31700, 35600],
      },
      {
        type: "hand_start",
        round: 7,
        dealer: 3,
        roundWind: "S",
        roundNumber: 4,
        honba: 0,
        doraIndicators: ["2z"],
        scores: [19600, 13100, 31700, 35600],
      },
      { type: "discard", seat: 0, tile: "1m", tsumogiri: false, riichi: true },
      { type: "discard", seat: 2, tile: "2m", tsumogiri: false, riichi: true },
      { type: "win", seat: 2, loser: 1, delta: [0, -5200, 7200, 0] },
      {
        type: "hand_end",
        reason: "ron",
        scores: [19600, 7900, 38900, 35600],
      },
      {
        type: "match_end",
        reason: "round_limit",
        finalScores: finalPlayers.map((player) => ({
          seat: player.seat,
          score: player.score,
          place: [3, 4, 1, 2][player.seat],
        })),
      },
    ];
    const result = buildSummaryPoints(replay, finalPlayers);
    expect(result.status).toBe("available");
    if (result.status !== "available") {
      throw new Error("The final-hand regression should produce a chart");
    }
    expect(result.data.labels).toEqual([
      { kind: "start" },
      { kind: "hand", wind: "S", number: 3, honba: 0 },
      { kind: "hand", wind: "S", number: 4, honba: 0 },
    ]);
    expect(result.data.series[0].scores).toEqual([18600, 19600, 18600]);
    const winner = result.data.series[2].scores;
    const runnerUp = result.data.series[3].scores;
    expect(winner).toEqual([32700, 31700, 37900]);
    expect(
      winner.filter((score, index) => score > runnerUp[index])
    ).toHaveLength(1);
    expect(
      result.data.series.every((series) => series.scores.length === 3)
    ).toBe(true);
  });

  it("does not invent an initial balance or a missing settlement", () => {
    const incomplete = events();
    const first = incomplete[0];
    if (first.type === "hand_start") {
      delete first.scores;
    }
    expect(buildSummaryPoints(incomplete, players)).toEqual({
      status: "unavailable",
      reason: "incompleteRecord",
    });
    expect(buildSummaryPoints(events().slice(0, -1), players).status).toBe(
      "unavailable"
    );
    expect(buildSummaryPoints([], players)).toEqual({
      status: "unavailable",
      reason: "missingRecord",
    });
  });

  it("rejects a stale replay that disagrees with corrected final results", () => {
    expect(
      buildSummaryPoints(events(), [
        { ...players[0], score: 45000 },
        ...players.slice(1),
      ])
    ).toEqual({ status: "unavailable", reason: "inconsistentScores" });
  });

  it("requires complete hands and unique seat mappings", () => {
    expect(
      buildSummaryPoints(
        events().filter((event) => event.type !== "hand_end"),
        players
      ).status
    ).toBe("unavailable");
    expect(
      buildSummaryPoints(events(), [
        players[0],
        { ...players[1], seat: 0 },
        ...players.slice(2),
      ]).status
    ).toBe("unavailable");
  });
});

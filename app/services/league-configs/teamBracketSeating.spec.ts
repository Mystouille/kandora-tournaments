import { describe, expect, it } from "vitest";
import {
  generateTeamBracketSeating,
  type SeatAssignment,
  type StageScheduling,
} from "./teamBracketSeating";

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/** Key for a cross-team player pair (order-independent on teams). */
function pairKey(tA: number, pA: number, tB: number, pB: number): string {
  if (tA > tB || (tA === tB && pA > pB)) {
    return `${tB}-${pB}:${tA}-${pA}`;
  }
  return `${tA}-${pA}:${tB}-${pB}`;
}

/**
 * Count how many times each cross-team player pair shares a table across the
 * entire schedule.  Returns a Map from pair key → count.
 */
function countCrossTeamEncounters(
  schedule: StageScheduling
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const round of schedule) {
    for (const table of round) {
      for (let i = 0; i < table.length; i++) {
        for (let j = i + 1; j < table.length; j++) {
          const a = table[i];
          const b = table[j];
          if (a.team === b.team) {
            continue;
          }
          const key = pairKey(a.team, a.player, b.team, b.player);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

/**
 * Assert that every table has exactly one player from each of the 4 teams.
 */
function assertOnePerTeamPerTable(schedule: StageScheduling): void {
  for (let r = 0; r < schedule.length; r++) {
    for (let t = 0; t < schedule[r].length; t++) {
      const table = schedule[r][t];
      const teams = table.map((s) => s.team).sort();
      expect(teams, `round ${r} table ${t}`).toEqual([1, 2, 3, 4]);
    }
  }
}

/**
 * Assert that within each round, every player of a team with `n` players
 * appears exactly once (when tables-per-round equals n).
 */
function assertOnePerRound(schedule: StageScheduling, teamSize: number): void {
  for (let r = 0; r < schedule.length; r++) {
    for (let team = 1; team <= 4; team++) {
      const players = schedule[r]
        .map((table) => table.find((s) => s.team === team)!)
        .map((s) => s.player)
        .sort((a, b) => a - b);
      const expected = Array.from({ length: teamSize }, (_, i) => i + 1);
      expect(players, `round ${r} team ${team}`).toEqual(expected);
    }
  }
}

/**
 * Assert every player index in the schedule is valid for the given team sizes.
 */
function assertValidIndices(
  schedule: StageScheduling,
  teamSizes: number[]
): void {
  for (const round of schedule) {
    for (const table of round) {
      for (const seat of table) {
        expect(seat.team).toBeGreaterThanOrEqual(1);
        expect(seat.team).toBeLessThanOrEqual(4);
        expect(seat.player).toBeGreaterThanOrEqual(1);
        expect(seat.player).toBeLessThanOrEqual(teamSizes[seat.team - 1]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("teamBracketSeating", () => {
  // -----------------------------------------------------------------------
  // Master block (4×4 MOLS) structural properties
  // -----------------------------------------------------------------------
  describe("master block (4×4 MOLS) via generateTeamBracketSeating(16)", () => {
    const schedule = generateTeamBracketSeating(16);

    it("has 4 rounds", () => {
      expect(schedule).toHaveLength(4);
    });

    it("has 4 tables per round", () => {
      for (const round of schedule) {
        expect(round).toHaveLength(4);
      }
    });

    it("has 4 seats per table", () => {
      for (const round of schedule) {
        for (const table of round) {
          expect(table).toHaveLength(4);
        }
      }
    });

    it("every seat has valid team ∈ {1..4} and player ∈ {1..4}", () => {
      assertValidIndices(schedule, [4, 4, 4, 4]);
    });

    it("each table has exactly one player from each team", () => {
      assertOnePerTeamPerTable(schedule);
    });

    it("each player of each team plays exactly once per round", () => {
      assertOnePerRound(schedule, 4);
    });

    it("MOLS optimality: every cross-team pair meets exactly once", () => {
      const encounters = countCrossTeamEncounters(schedule);

      // Total distinct cross-team pairs: C(4,2) × 4 × 4 = 96
      expect(encounters.size).toBe(96);

      for (const [key, count] of encounters) {
        expect(count, `pair ${key} should meet exactly once`).toBe(1);
      }
    });

    it("round 0 is the identity: table j seats player j+1 from every team", () => {
      const round0 = schedule[0];
      for (let j = 0; j < 4; j++) {
        const table = round0[j];
        for (const seat of table) {
          expect(seat.player, `round 0 table ${j} team ${seat.team}`).toBe(
            j + 1
          );
        }
      }
    });

    it("round 1 matches hand-computed GF(4) values", () => {
      // r=1: multipliers are GF4_MUL[k][1] = {0,1,2,3}
      // T1 player = j+1 (always)
      // T2 player = GF4_ADD[1][j]+1
      // T3 player = GF4_ADD[2][j]+1
      // T4 player = GF4_ADD[3][j]+1
      const expected: SeatAssignment[][] = [
        // j=0: T2=ADD(1,0)+1=2, T3=ADD(2,0)+1=3, T4=ADD(3,0)+1=4
        [
          { team: 1, player: 1 },
          { team: 2, player: 2 },
          { team: 3, player: 3 },
          { team: 4, player: 4 },
        ],
        // j=1: T2=ADD(1,1)+1=1, T3=ADD(2,1)+1=4, T4=ADD(3,1)+1=3
        [
          { team: 1, player: 2 },
          { team: 2, player: 1 },
          { team: 3, player: 4 },
          { team: 4, player: 3 },
        ],
        // j=2: T2=ADD(1,2)+1=4, T3=ADD(2,2)+1=1, T4=ADD(3,2)+1=2
        [
          { team: 1, player: 3 },
          { team: 2, player: 4 },
          { team: 3, player: 1 },
          { team: 4, player: 2 },
        ],
        // j=3: T2=ADD(1,3)+1=3, T3=ADD(2,3)+1=2, T4=ADD(3,3)+1=1
        [
          { team: 1, player: 4 },
          { team: 2, player: 3 },
          { team: 3, player: 2 },
          { team: 4, player: 1 },
        ],
      ];
      expect(schedule[1]).toEqual(expected);
    });

    it("round 2 matches hand-computed GF(4) values", () => {
      // r=2: GF4_MUL[k][2] = {0, 2, 3, 1}
      // T2 offset = 2, T3 offset = 3, T4 offset = 1
      const expected: SeatAssignment[][] = [
        // j=0: T2=ADD(2,0)+1=3, T3=ADD(3,0)+1=4, T4=ADD(1,0)+1=2
        [
          { team: 1, player: 1 },
          { team: 2, player: 3 },
          { team: 3, player: 4 },
          { team: 4, player: 2 },
        ],
        // j=1: T2=ADD(2,1)+1=4, T3=ADD(3,1)+1=3, T4=ADD(1,1)+1=1
        [
          { team: 1, player: 2 },
          { team: 2, player: 4 },
          { team: 3, player: 3 },
          { team: 4, player: 1 },
        ],
        // j=2: T2=ADD(2,2)+1=1, T3=ADD(3,2)+1=2, T4=ADD(1,2)+1=4
        [
          { team: 1, player: 3 },
          { team: 2, player: 1 },
          { team: 3, player: 2 },
          { team: 4, player: 4 },
        ],
        // j=3: T2=ADD(2,3)+1=2, T3=ADD(3,3)+1=1, T4=ADD(1,3)+1=3
        [
          { team: 1, player: 4 },
          { team: 2, player: 2 },
          { team: 3, player: 1 },
          { team: 4, player: 3 },
        ],
      ];
      expect(schedule[2]).toEqual(expected);
    });

    it("round 3 matches hand-computed GF(4) values", () => {
      // r=3: GF4_MUL[k][3] = {0, 3, 1, 2}
      // T2 offset = 3, T3 offset = 1, T4 offset = 2
      const expected: SeatAssignment[][] = [
        // j=0: T2=ADD(3,0)+1=4, T3=ADD(1,0)+1=2, T4=ADD(2,0)+1=3
        [
          { team: 1, player: 1 },
          { team: 2, player: 4 },
          { team: 3, player: 2 },
          { team: 4, player: 3 },
        ],
        // j=1: T2=ADD(3,1)+1=3, T3=ADD(1,1)+1=1, T4=ADD(2,1)+1=4
        [
          { team: 1, player: 2 },
          { team: 2, player: 3 },
          { team: 3, player: 1 },
          { team: 4, player: 4 },
        ],
        // j=2: T2=ADD(3,2)+1=2, T3=ADD(1,2)+1=4, T4=ADD(2,2)+1=1
        [
          { team: 1, player: 3 },
          { team: 2, player: 2 },
          { team: 3, player: 4 },
          { team: 4, player: 1 },
        ],
        // j=3: T2=ADD(3,3)+1=1, T3=ADD(1,3)+1=3, T4=ADD(2,3)+1=2
        [
          { team: 1, player: 4 },
          { team: 2, player: 1 },
          { team: 3, player: 3 },
          { team: 4, player: 2 },
        ],
      ];
      expect(schedule[3]).toEqual(expected);
    });
  });

  // -----------------------------------------------------------------------
  // generateTeamBracketSeating — public API
  // -----------------------------------------------------------------------
  describe("generateTeamBracketSeating", () => {
    it("gameCount=16 returns 4 rounds with full MOLS properties", () => {
      const schedule = generateTeamBracketSeating(16);
      expect(schedule).toHaveLength(4);
      assertOnePerTeamPerTable(schedule);
      assertOnePerRound(schedule, 4);

      const encounters = countCrossTeamEncounters(schedule);
      expect(encounters.size).toBe(96);
      for (const [, count] of encounters) {
        expect(count).toBe(1);
      }
    });

    it("gameCount=4 returns 1 round (partial block)", () => {
      const schedule = generateTeamBracketSeating(4);
      expect(schedule).toHaveLength(1);
      assertOnePerTeamPerTable(schedule);
      assertOnePerRound(schedule, 4);
    });

    it("gameCount=8 returns 2 rounds", () => {
      const schedule = generateTeamBracketSeating(8);
      expect(schedule).toHaveLength(2);
      assertOnePerTeamPerTable(schedule);
      assertOnePerRound(schedule, 4);
    });

    it("gameCount=32 returns 8 rounds (tiled 2×)", () => {
      const schedule = generateTeamBracketSeating(32);
      expect(schedule).toHaveLength(8);
      assertOnePerTeamPerTable(schedule);

      // Rounds 4-7 should be identical to rounds 0-3 (tiling)
      for (let i = 0; i < 4; i++) {
        expect(schedule[i + 4]).toEqual(schedule[i]);
      }
    });

    it("tiled schedule (32 games) has each pair meeting exactly twice", () => {
      const schedule = generateTeamBracketSeating(32);
      const encounters = countCrossTeamEncounters(schedule);
      expect(encounters.size).toBe(96);
      for (const [key, count] of encounters) {
        expect(count, `pair ${key}`).toBe(2);
      }
    });

    it("throws on gameCount = 0", () => {
      expect(() => generateTeamBracketSeating(0)).toThrow(/positive/);
    });

    it("throws on negative gameCount", () => {
      expect(() => generateTeamBracketSeating(-4)).toThrow(/positive/);
    });

    it("gameCount=5 returns 1 full round + 1 partial round", () => {
      const schedule = generateTeamBracketSeating(5);
      expect(schedule).toHaveLength(2);
      expect(schedule[0]).toHaveLength(4); // full round
      expect(schedule[1]).toHaveLength(1); // remainder: 1 table
      assertOnePerTeamPerTable(schedule);
    });

    it("gameCount=3 returns 1 round of 3 tables", () => {
      const schedule = generateTeamBracketSeating(3);
      expect(schedule).toHaveLength(1);
      expect(schedule[0]).toHaveLength(3);
      assertOnePerTeamPerTable(schedule);
    });

    it("gameCount=7 returns 1 full round + 1 partial of 3 tables", () => {
      const schedule = generateTeamBracketSeating(7);
      expect(schedule).toHaveLength(2);
      expect(schedule[0]).toHaveLength(4);
      expect(schedule[1]).toHaveLength(3);
      assertOnePerTeamPerTable(schedule);
    });

    it("gameCount=1 returns 1 round of 1 table", () => {
      const schedule = generateTeamBracketSeating(1);
      expect(schedule).toHaveLength(1);
      expect(schedule[0]).toHaveLength(1);
      expect(schedule[0][0]).toHaveLength(4);
      assertOnePerTeamPerTable(schedule);
    });
  });

  // -----------------------------------------------------------------------
  // MOLS mathematical properties — deeper checks
  // -----------------------------------------------------------------------
  describe("MOLS mathematical properties", () => {
    const schedule = generateTeamBracketSeating(16);

    it("the schedule encodes 3 mutually orthogonal Latin squares", () => {
      // Each of teams 2, 3, 4 defines a Latin square L_k where
      // L_k[r][j] = player assigned to team k at round r, table j.
      // "Latin" means each symbol appears exactly once per row and per column.
      for (let team = 2; team <= 4; team++) {
        const square: number[][] = [];
        for (let r = 0; r < 4; r++) {
          const row: number[] = [];
          for (let j = 0; j < 4; j++) {
            const seat = schedule[r][j].find((s) => s.team === team)!;
            row.push(seat.player);
          }
          square.push(row);
        }

        // Check Latin property: each row is a permutation of {1,2,3,4}
        for (let r = 0; r < 4; r++) {
          expect([...square[r]].sort(), `team ${team} row ${r}`).toEqual([
            1, 2, 3, 4,
          ]);
        }
        // Each column is a permutation of {1,2,3,4}
        for (let j = 0; j < 4; j++) {
          const col = [0, 1, 2, 3].map((r) => square[r][j]);
          expect([...col].sort(), `team ${team} col ${j}`).toEqual([
            1, 2, 3, 4,
          ]);
        }
      }
    });

    it("pairs of Latin squares are mutually orthogonal", () => {
      // Extract the 3 Latin squares
      const squares: Map<number, number[][]> = new Map();
      for (let team = 2; team <= 4; team++) {
        const square: number[][] = [];
        for (let r = 0; r < 4; r++) {
          const row: number[] = [];
          for (let j = 0; j < 4; j++) {
            const seat = schedule[r][j].find((s) => s.team === team)!;
            row.push(seat.player);
          }
          square.push(row);
        }
        squares.set(team, square);
      }

      // For each pair of squares, superimposing them should produce
      // all 16 distinct ordered pairs (a, b) with a, b ∈ {1,2,3,4}
      const teamPairs = [
        [2, 3],
        [2, 4],
        [3, 4],
      ];
      for (const [tA, tB] of teamPairs) {
        const sqA = squares.get(tA)!;
        const sqB = squares.get(tB)!;
        const seen = new Set<string>();
        for (let r = 0; r < 4; r++) {
          for (let j = 0; j < 4; j++) {
            seen.add(`${sqA[r][j]},${sqB[r][j]}`);
          }
        }
        expect(
          seen.size,
          `squares for teams ${tA} and ${tB} must be orthogonal (16 distinct pairs)`
        ).toBe(16);
      }
    });

    it("the 16-game block is a resolvable transversal design TD(4,4)", () => {
      // A TD(4,4) has 16 points (4 groups of 4), 16 blocks (tables) of size 4,
      // each block contains exactly one point from each group (team),
      // and every cross-group pair appears in exactly one block.
      // We verify: 16 blocks total, one-per-team, all 96 pairs covered once.
      let totalTables = 0;
      for (const round of schedule) {
        totalTables += round.length;
      }
      expect(totalTables).toBe(16);

      assertOnePerTeamPerTable(schedule);

      const encounters = countCrossTeamEncounters(schedule);
      expect(encounters.size).toBe(96);
      for (const [, count] of encounters) {
        expect(count).toBe(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // MOLS-based optimal schedules for other prime-power team sizes
  // -----------------------------------------------------------------------
  describe("greedy fallback: 3 players per team (no MOLS for n < 4)", () => {
    const n = 3;
    const gameCount = n * n; // 9 games = 3 rounds × 3 tables
    const schedule = generateTeamBracketSeating(gameCount, [n, n, n, n]);

    it(`has ${n} rounds of ${n} tables with 4 seats each`, () => {
      expect(schedule).toHaveLength(n);
      for (const round of schedule) {
        expect(round).toHaveLength(n);
        for (const table of round) {
          expect(table).toHaveLength(4);
        }
      }
    });

    it("every seat has valid indices", () => {
      assertValidIndices(schedule, [n, n, n, n]);
    });

    it("each table has exactly one player from each team", () => {
      assertOnePerTeamPerTable(schedule);
    });

    it("each player of each team plays exactly once per round", () => {
      assertOnePerRound(schedule, n);
    });

    it("no cross-team pair meets more than twice", () => {
      // 9 tables × 6 pairs/table = 54 pair-slots for 54 pairs (C(4,2)×3×3).
      // Without MOLS, perfect coverage isn't guaranteed but should be close.
      const encounters = countCrossTeamEncounters(schedule);
      const maxCount = Math.max(...encounters.values());
      expect(maxCount).toBeLessThanOrEqual(2);
    });
  });

  describe("MOLS optimal: 5 players per team", () => {
    const n = 5;
    const gameCount = n * n; // 25 games = 5 rounds × 5 tables
    const schedule = generateTeamBracketSeating(gameCount, [n, n, n, n]);

    it(`has ${n} rounds of ${n} tables with 4 seats each`, () => {
      expect(schedule).toHaveLength(n);
      for (const round of schedule) {
        expect(round).toHaveLength(n);
        for (const table of round) {
          expect(table).toHaveLength(4);
        }
      }
    });

    it("every seat has valid indices", () => {
      assertValidIndices(schedule, [n, n, n, n]);
    });

    it("each table has exactly one player from each team", () => {
      assertOnePerTeamPerTable(schedule);
    });

    it("each player of each team plays exactly once per round", () => {
      assertOnePerRound(schedule, n);
    });

    it("MOLS optimality: every cross-team pair meets exactly once", () => {
      const encounters = countCrossTeamEncounters(schedule);
      const expectedPairs = 6 * n * n; // 150
      expect(encounters.size).toBe(expectedPairs);
      for (const [key, count] of encounters) {
        expect(count, `pair ${key}`).toBe(1);
      }
    });

    it("is a resolvable transversal design TD(4,5)", () => {
      let totalTables = 0;
      for (const round of schedule) {
        totalTables += round.length;
      }
      expect(totalTables).toBe(n * n);

      assertOnePerTeamPerTable(schedule);

      const encounters = countCrossTeamEncounters(schedule);
      expect(encounters.size).toBe(6 * n * n);
      for (const [, count] of encounters) {
        expect(count).toBe(1);
      }
    });
  });

  describe("MOLS optimal: 7 players per team", () => {
    const n = 7;
    const gameCount = n * n; // 49 games = 7 rounds × 7 tables
    const schedule = generateTeamBracketSeating(gameCount, [n, n, n, n]);

    it(`has ${n} rounds of ${n} tables with 4 seats each`, () => {
      expect(schedule).toHaveLength(n);
      for (const round of schedule) {
        expect(round).toHaveLength(n);
        for (const table of round) {
          expect(table).toHaveLength(4);
        }
      }
    });

    it("every seat has valid indices", () => {
      assertValidIndices(schedule, [n, n, n, n]);
    });

    it("each table has exactly one player from each team", () => {
      assertOnePerTeamPerTable(schedule);
    });

    it("each player of each team plays exactly once per round", () => {
      assertOnePerRound(schedule, n);
    });

    it("MOLS optimality: every cross-team pair meets exactly once", () => {
      const encounters = countCrossTeamEncounters(schedule);
      const expectedPairs = 6 * n * n; // 294
      expect(encounters.size).toBe(expectedPairs);
      for (const [key, count] of encounters) {
        expect(count, `pair ${key}`).toBe(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Greedy fallback: n = 6 (no MOLS for order 6)
  // -----------------------------------------------------------------------
  describe("greedy fallback: 6 players per team", () => {
    const n = 6;
    const gameCount = n * n; // 36 games = 6 rounds × 6 tables
    const schedule = generateTeamBracketSeating(gameCount, [n, n, n, n]);

    it(`has ${n} rounds of ${n} tables`, () => {
      expect(schedule).toHaveLength(n);
      for (const round of schedule) {
        expect(round).toHaveLength(n);
        for (const table of round) {
          expect(table).toHaveLength(4);
        }
      }
    });

    it("every seat has valid indices", () => {
      assertValidIndices(schedule, [n, n, n, n]);
    });

    it("each table has exactly one player from each team", () => {
      assertOnePerTeamPerTable(schedule);
    });

    it("each player of each team plays exactly once per round", () => {
      assertOnePerRound(schedule, n);
    });

    it("most cross-team pairs are covered", () => {
      const encounters = countCrossTeamEncounters(schedule);
      const totalPairs = 6 * n * n; // 216
      // No MOLS exist for n=6, so full coverage in n rounds isn't guaranteed.
      // The greedy should cover the vast majority of pairs.
      expect(encounters.size).toBeGreaterThanOrEqual(totalPairs * 0.8);
    });

    it("max encounter count is at most 2 (near-optimal)", () => {
      // With 36 tables × 6 pairs/table = 216 pair-slots for 216 possible pairs,
      // any repeat means some other pair is uncovered.  Greedy should keep
      // repeats low.
      const encounters = countCrossTeamEncounters(schedule);
      const maxCount = Math.max(...encounters.values());
      expect(maxCount).toBeLessThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // Unequal team sizes
  // -----------------------------------------------------------------------
  describe("unequal team sizes [4, 5, 4, 3]", () => {
    const teamSizes: [number, number, number, number] = [4, 5, 4, 3];
    const K = 3; // min team size
    const gameCount = K * 4; // 12 games = 4 rounds × 3 tables
    const schedule = generateTeamBracketSeating(gameCount, teamSizes);

    it(`has ${gameCount / K} rounds of ${K} tables`, () => {
      expect(schedule).toHaveLength(gameCount / K);
      for (const round of schedule) {
        expect(round).toHaveLength(K);
      }
    });

    it("each table has 4 seats (one per team)", () => {
      for (const round of schedule) {
        for (const table of round) {
          expect(table).toHaveLength(4);
        }
      }
    });

    it("each table has exactly one player from each team", () => {
      assertOnePerTeamPerTable(schedule);
    });

    it("every seat has valid indices for each team's size", () => {
      assertValidIndices(schedule, teamSizes);
    });

    it("player play counts are balanced within each team", () => {
      // Count games per player per team
      const playCounts: Map<string, number> = new Map();
      for (const round of schedule) {
        for (const table of round) {
          for (const seat of table) {
            const key = `${seat.team}-${seat.player}`;
            playCounts.set(key, (playCounts.get(key) ?? 0) + 1);
          }
        }
      }

      for (let team = 1; team <= 4; team++) {
        const counts: number[] = [];
        for (let p = 1; p <= teamSizes[team - 1]; p++) {
          counts.push(playCounts.get(`${team}-${p}`) ?? 0);
        }
        const minCount = Math.min(...counts);
        const maxCount = Math.max(...counts);
        expect(
          maxCount - minCount,
          `team ${team} play count spread`
        ).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("unequal team sizes [5, 5, 7, 5]", () => {
    const teamSizes: [number, number, number, number] = [5, 5, 7, 5];
    const K = 5;
    const numRounds = 7;
    const gameCount = K * numRounds; // 35 games
    const schedule = generateTeamBracketSeating(gameCount, teamSizes);

    it(`has ${numRounds} rounds of ${K} tables`, () => {
      expect(schedule).toHaveLength(numRounds);
      for (const round of schedule) {
        expect(round).toHaveLength(K);
      }
    });

    it("each table has exactly one player from each team", () => {
      assertOnePerTeamPerTable(schedule);
    });

    it("every seat has valid indices", () => {
      assertValidIndices(schedule, teamSizes);
    });

    it("player play counts are balanced within each team", () => {
      const playCounts: Map<string, number> = new Map();
      for (const round of schedule) {
        for (const table of round) {
          for (const seat of table) {
            const key = `${seat.team}-${seat.player}`;
            playCounts.set(key, (playCounts.get(key) ?? 0) + 1);
          }
        }
      }

      for (let team = 1; team <= 4; team++) {
        const counts: number[] = [];
        for (let p = 1; p <= teamSizes[team - 1]; p++) {
          counts.push(playCounts.get(`${team}-${p}`) ?? 0);
        }
        const minCount = Math.min(...counts);
        const maxCount = Math.max(...counts);
        expect(
          maxCount - minCount,
          `team ${team} play count spread`
        ).toBeLessThanOrEqual(1);
      }
    });

    it("max encounter count is reasonable", () => {
      const encounters = countCrossTeamEncounters(schedule);
      const maxCount = Math.max(...encounters.values());
      // With 35 tables and varying pair pools, max should stay low
      expect(maxCount).toBeLessThanOrEqual(3);
    });
  });

  // -----------------------------------------------------------------------
  // Error cases for new signature
  // -----------------------------------------------------------------------
  describe("error cases with teamSizes", () => {
    it("throws on gameCount=0 with custom team sizes", () => {
      expect(() => generateTeamBracketSeating(0, [5, 5, 5, 5])).toThrow(
        /positive/
      );
    });

    it("throws on negative gameCount with custom team sizes", () => {
      expect(() => generateTeamBracketSeating(-3, [3, 4, 5, 3])).toThrow(
        /positive/
      );
    });
  });

  // -----------------------------------------------------------------------
  // Remainder (non-multiple gameCount) with custom team sizes
  // -----------------------------------------------------------------------
  describe("remainder rounds with custom team sizes", () => {
    it("gameCount=7 with teamSizes=[3,3,3,3]: 2 full rounds + 1 partial", () => {
      const schedule = generateTeamBracketSeating(7, [3, 3, 3, 3]);
      expect(schedule).toHaveLength(3);
      expect(schedule[0]).toHaveLength(3);
      expect(schedule[1]).toHaveLength(3);
      expect(schedule[2]).toHaveLength(1); // remainder
      assertOnePerTeamPerTable(schedule);
    });

    it("gameCount=11 with teamSizes=[5,5,5,5]: 2 full + partial of 1", () => {
      const schedule = generateTeamBracketSeating(11, [5, 5, 5, 5]);
      expect(schedule).toHaveLength(3);
      expect(schedule[0]).toHaveLength(5);
      expect(schedule[1]).toHaveLength(5);
      expect(schedule[2]).toHaveLength(1);
      assertOnePerTeamPerTable(schedule);
    });

    it("partial round tables still have valid indices", () => {
      const schedule = generateTeamBracketSeating(6, [4, 5, 4, 3]);
      const K = 3;
      // 6/3 = 2 full rounds, no remainder
      expect(schedule).toHaveLength(2);
      expect(schedule[0]).toHaveLength(K);
      expect(schedule[1]).toHaveLength(K);
      assertValidIndices(schedule, [4, 5, 4, 3]);
      assertOnePerTeamPerTable(schedule);
    });

    it("gameCount=5 with teamSizes=[4,5,4,3]: 1 full + partial of 2", () => {
      const schedule = generateTeamBracketSeating(5, [4, 5, 4, 3]);
      expect(schedule).toHaveLength(2);
      expect(schedule[0]).toHaveLength(3); // K=3
      expect(schedule[1]).toHaveLength(2); // remainder
      assertOnePerTeamPerTable(schedule);
      assertValidIndices(schedule, [4, 5, 4, 3]);
    });
  });
});

/**
 * Generates optimal team-bracket seating for 4 teams with variable player
 * counts.
 *
 * When all teams have the same prime-power size n ∈ {3, 4, 5, 7}, the
 * schedule is derived from mutually orthogonal Latin squares (MOLS) over
 * GF(n), producing n rounds of n tables where every cross-team player pair
 * meets exactly once.
 *
 * For other sizes (e.g. n = 6) or unequal team sizes, a greedy algorithm
 * minimizes repeat cross-team encounters.  Each round has K = min(teamSizes)
 * simultaneous tables with balanced player rotation.
 *
 * For stages with more games than one full block, the block is tiled.
 */

/** A single seat assignment: 1-based team index and 1-based player index. */
export interface SeatAssignment {
  team: number;
  player: number;
}

/**
 * Three-level nested array:
 *   Level 1 = rounds  (batches of simultaneous games)
 *   Level 2 = tables  (games within a round)
 *   Level 3 = 4 seat assignments per table
 */
export type StageScheduling = SeatAssignment[][][];

// ---------------------------------------------------------------------------
// Galois-field arithmetic for supported prime-power orders
// ---------------------------------------------------------------------------

interface GaloisField {
  order: number;
  add(a: number, b: number): number;
  mul(a: number, b: number): number;
}

// GF(3) — simple modular arithmetic
function makeGFPrime(p: number): GaloisField {
  return {
    order: p,
    add: (a, b) => (a + b) % p,
    mul: (a, b) => (a * b) % p,
  };
}

// GF(4) — elements 0-3, irreducible polynomial x²+x+1
const GF4_ADD: number[][] = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [2, 3, 0, 1],
  [3, 2, 1, 0],
];

const GF4_MUL: number[][] = [
  [0, 0, 0, 0],
  [0, 1, 2, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
];

const GF4: GaloisField = {
  order: 4,
  add: (a, b) => GF4_ADD[a][b],
  mul: (a, b) => GF4_MUL[a][b],
};

const GF5 = makeGFPrime(5);
const GF7 = makeGFPrime(7);

// MOLS for 4 teams needs 3 mutually orthogonal Latin squares, which requires
// 3 distinct non-zero field multipliers.  GF(n) has n-1 non-zero elements,
// so n must be ≥ 4.  GF(3) is excluded (only 2 non-zero elements).
const SUPPORTED_FIELDS: Map<number, GaloisField> = new Map([
  [4, GF4],
  [5, GF5],
  [7, GF7],
]);

// ---------------------------------------------------------------------------
// MOLS-based master block for equal prime-power team sizes
// ---------------------------------------------------------------------------

/**
 * Build a master n-round schedule using MOLS over GF(n).
 *
 * We pick 3 distinct non-zero field elements as multipliers for teams 2-4.
 * For round `r` (0..n-1) and table `j` (0..n-1), the four seats are:
 *   T1 → player j
 *   Tk → player (m_k · r + j)  in GF(n)   for k = 2, 3, 4
 *
 * where m_2, m_3, m_4 are the first 3 non-zero elements of GF(n).
 * All indices are converted to 1-based for the SeatAssignment format.
 */
function buildMolsBlock(gf: GaloisField): StageScheduling {
  const n = gf.order;
  // First 3 non-zero elements: 1, 2, 3 (works for n ≥ 4)
  const multipliers = [1, 2, 3];
  const block: StageScheduling = [];

  for (let r = 0; r < n; r++) {
    const round: SeatAssignment[][] = [];
    for (let j = 0; j < n; j++) {
      round.push([
        { team: 1, player: j + 1 },
        { team: 2, player: gf.add(gf.mul(multipliers[0], r), j) + 1 },
        { team: 3, player: gf.add(gf.mul(multipliers[1], r), j) + 1 },
        { team: 4, player: gf.add(gf.mul(multipliers[2], r), j) + 1 },
      ]);
    }
    block.push(round);
  }

  return block;
}

// Pre-compute the GF(4) master block for the default fast path
const MASTER_BLOCK_4 = buildMolsBlock(GF4);

// ---------------------------------------------------------------------------
// Greedy scheduling for non-MOLS cases
// ---------------------------------------------------------------------------

/**
 * Select K 1-based player indices for a team of size `teamSize` in round `r`,
 * using balanced circular rotation.
 */
function selectPlayers(
  teamSize: number,
  K: number,
  roundIndex: number
): number[] {
  const offset = (roundIndex * K) % teamSize;
  const players: number[] = [];
  for (let i = 0; i < K; i++) {
    players.push(((offset + i) % teamSize) + 1);
  }
  return players;
}

/**
 * Build a full block of rounds using the greedy algorithm.
 *
 * For each round:
 *   1. Select K players per team via balanced rotation
 *   2. Fix team 1's players at tables 1..K
 *   3. For teams 2, 3, 4: find the permutation that minimizes accumulated
 *      cross-team encounter cost
 */
function buildGreedyBlock(
  teamSizes: [number, number, number, number],
  numRounds: number
): StageScheduling {
  const K = Math.min(...teamSizes);
  const schedule: StageScheduling = [];

  // Encounter matrix: encounters[tA][pA][tB][pB] = count
  // Using 0-based team and player indices internally
  const encounters: number[][][][] = Array.from({ length: 4 }, (_, tA) =>
    Array.from({ length: teamSizes[tA] }, () =>
      Array.from({ length: 4 }, (__, tB) =>
        Array.from({ length: teamSizes[tB] }, () => 0)
      )
    )
  );

  for (let r = 0; r < numRounds; r++) {
    // Phase 1: select players for each team
    const selected: number[][] = teamSizes.map((size, t) =>
      selectPlayers(size, K, r + t * numRounds)
    );

    // Phase 2: assign to tables
    // For small K, include all 4 teams in brute-force optimization.
    // For larger K, fix team 0 and optimize teams 1-3.
    const perms: number[][][] = [];
    const fixTeam0 = K > 4;

    if (fixTeam0) {
      perms.push([selected[0]]); // team 0 is fixed
      for (let team = 1; team < 4; team++) {
        perms.push(allPermutations(selected[team]));
      }
    } else {
      for (let team = 0; team < 4; team++) {
        perms.push(allPermutations(selected[team]));
      }
    }

    let bestCost = Infinity;
    let bestPerm: [number[], number[], number[], number[]] = [
      selected[0],
      selected[1],
      selected[2],
      selected[3],
    ];

    if (K <= 4) {
      // Brute-force all 4 teams: (K!)^4 combinations
      // K=3: 1296, K=4: 331776 — both tractable
      for (const p0 of perms[0]) {
        for (const p1 of perms[1]) {
          for (const p2 of perms[2]) {
            for (const p3 of perms[3]) {
              const cost = permutationCost([p0, p1, p2, p3], K, encounters);
              if (cost < bestCost) {
                bestCost = cost;
                bestPerm = [p0, p1, p2, p3];
              }
            }
          }
        }
      }
    } else if (!fixTeam0) {
      // K=5 without fixing team 0: (5!)^4 ≈ 207M — too expensive.
      // Fall through to sequential with team 0 fixed at identity.
      // This shouldn't happen since fixTeam0 is false only for K ≤ 4.
      for (const p1 of perms[1]) {
        for (const p2 of perms[2]) {
          for (const p3 of perms[3]) {
            const cost = permutationCost(
              [selected[0], p1, p2, p3],
              K,
              encounters
            );
            if (cost < bestCost) {
              bestCost = cost;
              bestPerm = [selected[0], p1, p2, p3];
            }
          }
        }
      }
    } else {
      // K ≥ 5 with team 0 fixed: brute-force (K!)^3 for K=5 (1.7M),
      // sequential greedy for K ≥ 6
      if (K === 5) {
        for (const p1 of perms[1]) {
          for (const p2 of perms[2]) {
            for (const p3 of perms[3]) {
              const cost = permutationCost(
                [selected[0], p1, p2, p3],
                K,
                encounters
              );
              if (cost < bestCost) {
                bestCost = cost;
                bestPerm = [selected[0], p1, p2, p3];
              }
            }
          }
        }
      } else {
        // Sequential greedy: optimize one team at a time
        const current = [selected[0], selected[1], selected[2], selected[3]];
        for (let team = 1; team < 4; team++) {
          let teamBestCost = Infinity;
          let teamBestPerm = current[team];
          for (const p of perms[team]) {
            current[team] = p;
            const cost = permutationCost(current, K, encounters);
            if (cost < teamBestCost) {
              teamBestCost = cost;
              teamBestPerm = p;
            }
          }
          current[team] = teamBestPerm;
        }
        bestPerm = current as [number[], number[], number[], number[]];
      }
    }

    // Build the round from bestPerm
    const round: SeatAssignment[][] = [];
    for (let j = 0; j < K; j++) {
      const table: SeatAssignment[] = [];
      for (let team = 0; team < 4; team++) {
        table.push({ team: team + 1, player: bestPerm[team][j] });
      }
      round.push(table);
    }
    schedule.push(round);

    // Update encounter matrix
    for (let j = 0; j < K; j++) {
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) {
          const pA = bestPerm[a][j] - 1;
          const pB = bestPerm[b][j] - 1;
          encounters[a][pA][b][pB]++;
          encounters[b][pB][a][pA]++;
        }
      }
    }
  }

  return schedule;
}

/**
 * Cost of a permutation assignment.
 * Primary: minimize the maximum encounter count that would result.
 * Secondary: minimize the sum of encounter counts (break ties).
 * Tertiary: prefer spread (anti-diagonal diversity) to break ties at cost=0.
 * Returns a single comparable number.
 */
function permutationCost(
  perm: number[][],
  K: number,
  encounters: number[][][][]
): number {
  let maxEnc = 0;
  let sumEnc = 0;
  let samePosition = 0; // count of (team, table) where player index == table index
  for (let j = 0; j < K; j++) {
    for (let a = 0; a < 4; a++) {
      // Penalize when player from team a at table j has the same player index
      // as another team's player — encourages spread from the start
      for (let b = a + 1; b < 4; b++) {
        const c = encounters[a][perm[a][j] - 1][b][perm[b][j] - 1];
        if (c > maxEnc) {
          maxEnc = c;
        }
        sumEnc += c;
      }
      if (perm[a][j] === perm[0][j]) {
        samePosition++;
      }
    }
  }
  // Encode priorities: max encounter >> sum >> same-position penalty
  return maxEnc * 10000000 + sumEnc * 1000 + samePosition;
}

function allPermutations(arr: number[]): number[][] {
  if (arr.length <= 1) {
    return [arr.slice()];
  }
  const result: number[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const perm of allPermutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the full seating schedule for a team-bracket stage.
 *
 * @param gameCount Total number of games in the stage (must be positive).
 *                  If not a multiple of K = min(teamSizes), the last round
 *                  will contain only the remaining games.
 * @param teamSizes Optional array of 4 player counts, one per team (1-based).
 *                  Defaults to [4, 4, 4, 4].
 * @returns A `StageScheduling` array whose rounds contain up to K tables of
 *          4 seats each, where K = min(teamSizes).
 */
export function generateTeamBracketSeating(
  gameCount: number,
  teamSizes: [number, number, number, number] = [4, 4, 4, 4]
): StageScheduling {
  const K = Math.min(...teamSizes);

  if (gameCount <= 0) {
    throw new Error(`gameCount must be positive, got ${gameCount}`);
  }

  const fullRounds = Math.floor(gameCount / K);
  const remainder = gameCount % K;
  const numRounds = fullRounds + (remainder > 0 ? 1 : 0);
  const allEqual = teamSizes.every((s) => s === teamSizes[0]);

  // Fast path: equal team sizes with a supported Galois field → MOLS
  if (allEqual) {
    const gf = SUPPORTED_FIELDS.get(teamSizes[0]);
    if (gf) {
      const masterBlock =
        teamSizes[0] === 4 ? MASTER_BLOCK_4 : buildMolsBlock(gf);
      const schedule: StageScheduling = [];
      for (let i = 0; i < numRounds; i++) {
        const round = masterBlock[i % gf.order];
        if (i === numRounds - 1 && remainder > 0) {
          schedule.push(round.slice(0, remainder));
        } else {
          schedule.push(round);
        }
      }
      return schedule;
    }
  }

  // General path: greedy scheduling (always produces full rounds)
  const schedule = buildGreedyBlock(
    teamSizes,
    fullRounds + (remainder > 0 ? 1 : 0)
  );

  // Trim the last round if there's a remainder
  if (remainder > 0 && schedule.length > 0) {
    schedule[schedule.length - 1] = schedule[schedule.length - 1].slice(
      0,
      remainder
    );
  }

  return schedule;
}

/**
 * Generate a trivial scheduling for individual (non-team) bracket stages.
 *
 * Every game has the same 4 participants, so each round is a single table
 * with seats `{ team: 1..4, player: 1 }`.
 *
 * @param gameCount Number of games to schedule.
 */
export function generateIndividualScheduling(
  gameCount: number
): StageScheduling {
  if (gameCount <= 0) {
    throw new Error(`gameCount must be positive, got ${gameCount}`);
  }

  const table: SeatAssignment[] = [
    { team: 1, player: 1 },
    { team: 2, player: 1 },
    { team: 3, player: 1 },
    { team: 4, player: 1 },
  ];

  return Array.from({ length: gameCount }, () => [table]);
}

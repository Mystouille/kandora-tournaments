import { Ruleset } from "../db/League";
import { computePlayerDeltas } from "./leagueUtils";

/** Signed, one-decimal score string (e.g. `+22.9`, `-8.9`). */
function formatBracketScore(totalScore: number): string {
  return totalScore >= 0 ? `+${totalScore.toFixed(1)}` : totalScore.toFixed(1);
}

/**
 * Default LFCR bracket stage definitions.
 *
 * QF1: seeds 5, 6, 11, 12
 * QF2: seeds 7, 8, 9, 10
 * DF1: seeds 1, 4 + QF1-2nd + QF2-1st
 * DF2: seeds 2, 3 + QF1-1st + QF2-2nd
 * FINALE: DF1-1st, DF1-2nd, DF2-1st, DF2-2nd
 */

export interface StageSource {
  stage: string;
  place: number;
}

export interface BracketStageDefinition {
  name: string;
  order: number;
  seeds: number[];
  fromStages: StageSource[];
  advancementLabel?: string;
  advancementLabelKey?: string;
  gamesToComplete?: number;
  /** Fraction (0–1) of each advancing team's previous stage score to add as
   *  a starting offset in this stage. 0 = full reset (default). */
  scoreCarryOver?: number;
  /** Explicit tranche/slice grouping concurrent stages. When omitted, the
   *  effective slice falls back to the topological bracket depth (`groupIndex`
   *  from {@link computeBracketStageMetadata}). */
  slice?: number;
}

export const GAMES_PER_STAGE = 16;

export const LFCR_STAGES: BracketStageDefinition[] = [
  {
    name: "QF1",
    order: 0,
    seeds: [5, 6, 11, 12],
    fromStages: [],
    advancementLabelKey: "QF1",
    gamesToComplete: GAMES_PER_STAGE,
  },
  {
    name: "QF2",
    order: 1,
    seeds: [7, 8, 9, 10],
    fromStages: [],
    advancementLabelKey: "QF2",
    gamesToComplete: GAMES_PER_STAGE,
  },
  {
    name: "DF1",
    order: 2,
    seeds: [1, 4],
    fromStages: [
      { stage: "QF1", place: 2 },
      { stage: "QF2", place: 1 },
    ],
    advancementLabelKey: "DF1",
    gamesToComplete: GAMES_PER_STAGE,
  },
  {
    name: "DF2",
    order: 3,
    seeds: [2, 3],
    fromStages: [
      { stage: "QF1", place: 1 },
      { stage: "QF2", place: 2 },
    ],
    advancementLabelKey: "DF2",
    gamesToComplete: GAMES_PER_STAGE,
  },
  {
    name: "FINALE",
    order: 4,
    seeds: [],
    fromStages: [
      { stage: "DF1", place: 1 },
      { stage: "DF1", place: 2 },
      { stage: "DF2", place: 1 },
      { stage: "DF2", place: 2 },
    ],
    advancementLabel: "",
    gamesToComplete: GAMES_PER_STAGE,
  },
];

export interface StageTeamResult {
  teamId: string;
  teamName: string;
  totalScore: number;
  gamesPlayed: number;
}

export interface ComputedStage {
  definition: BracketStageDefinition;
  teams: string[];
  results: StageTeamResult[];
  isComplete: boolean;
  gamesPlayed: number;
}

export interface BracketStageMetadata {
  groupIndex: number;
  stageOrder: number;
  advancingCount: number;
}

/** Minimal game shape needed for bracket computation. */
export interface BracketGameInput {
  results: { userId: string; score: number }[];
}

/** Pre-built lookup maps passed into bracket computation. */
export interface BracketContext {
  /** seed number → participant ID (teamId or userId depending on mode) */
  seedings: Map<number, string>;
  /** userId → teamId (includes substitutes) */
  userToTeamMap: Map<string, string>;
  /** teamId → display name */
  teamNameMap: Map<string, string>;
  /** All valid games for the league */
  games: BracketGameInput[];
  /** Ruleset for delta computation */
  rules: Ruleset;
  /** Optional strategy-specific delta computer for final phases. */
  deltaComputer?: (players: { userId: string; score: number }[]) => number[];
  /** Score offsets carried over from the regular phase into the first bracket
   *  stage, keyed by participantId. Computed from finalPhase.scoreCarryOver. */
  initialScoreOffsets?: Map<string, number>;
  /**
   * User IDs of the league's official substitutes. Official subs are not on any
   * team roster, so they never appear in `userToTeamMap`; this lets stage
   * attribution infer the team an official sub played for (the stage team with
   * no other player in that game) instead of dropping the game entirely.
   */
  officialSubIds?: Set<string>;
  /**
   * Maps an official substitute's userId to the participant id they were
   * declared to replace (Team id in team mode, replaced User id in individual
   * mode), sourced from the league's active Substitution documents. Used in
   * preference to deduction so the attribution is exact while the substitution
   * record still exists. Entries are absent once a round's substitutions are
   * cleaned up (on completion); those fall back to deduction.
   */
  officialSubTeamMap?: Map<string, string>;
}

function getGamesToComplete(stageDef: BracketStageDefinition): number {
  return stageDef.gamesToComplete ?? GAMES_PER_STAGE;
}

/**
 * Resolves the teams for each bracket stage based on seedings and prior stage results.
 */
function resolveStageTeams(
  stageDef: BracketStageDefinition,
  seedings: Map<number, string>,
  completedStages: Map<string, ComputedStage>
): string[] {
  const teams: string[] = [];

  for (const seed of stageDef.seeds) {
    const teamId = seedings.get(seed);
    if (teamId) {
      teams.push(teamId);
    }
  }

  for (const source of stageDef.fromStages) {
    const prevStage = completedStages.get(source.stage);
    if (
      prevStage &&
      prevStage.isComplete &&
      prevStage.results.length >= source.place
    ) {
      teams.push(prevStage.results[source.place - 1].teamId);
    }
  }

  return teams;
}

/**
 * Computes the results for a single bracket stage from pre-fetched game data.
 */
function computeStageResults(
  stageTeamIds: string[],
  ctx: BracketContext,
  scoreOffsets: Map<string, number>
): { results: StageTeamResult[]; gamesPlayed: number } {
  if (stageTeamIds.length === 0) {
    return { results: [], gamesPlayed: 0 };
  }

  const stageTeamSet = new Set(stageTeamIds);

  const teamScores = new Map<
    string,
    { totalScore: number; gamesPlayed: number }
  >();
  for (const teamId of stageTeamIds) {
    teamScores.set(teamId, {
      totalScore: scoreOffsets.get(teamId) ?? 0,
      gamesPlayed: 0,
    });
  }

  let totalGames = 0;

  for (const game of ctx.games) {
    const gameResults = game.results;
    // Map each result to its team. An official substitute always plays for the
    // team that is short a player, never for their own roster team, so their
    // userToTeamMap entry (if any) is ignored here and resolved below — first
    // from the recorded substitution document, then by deduction. This keeps a
    // game played with an official sub attributed to the right stage instead of
    // being dropped.
    const isOfficialSub = (userId: string): boolean =>
      ctx.officialSubIds?.has(userId) ?? false;
    const teamByIndex: (string | null)[] = gameResults.map((result) =>
      isOfficialSub(result.userId)
        ? null
        : (ctx.userToTeamMap.get(result.userId) ?? null)
    );
    if (ctx.officialSubIds && ctx.officialSubIds.size > 0) {
      const present = new Set(
        teamByIndex.filter((tid): tid is string => tid != null)
      );

      // First pass: attribute each official sub from the recorded substitution
      // document (substitutePlayer → participant). Exact while the sub doc
      // still exists; the guard keeps it to a missing stage team so a stale or
      // cross-stage record can't double-book a team.
      if (ctx.officialSubTeamMap && ctx.officialSubTeamMap.size > 0) {
        for (let i = 0; i < gameResults.length; i++) {
          if (teamByIndex[i] != null || !isOfficialSub(gameResults[i].userId)) {
            continue;
          }
          const recorded = ctx.officialSubTeamMap.get(gameResults[i].userId);
          if (
            recorded &&
            stageTeamSet.has(recorded) &&
            !present.has(recorded)
          ) {
            teamByIndex[i] = recorded;
            present.add(recorded);
          }
        }
      }

      // Second pass: deduce any still-unattributed official sub as the stage
      // team with no other player in this game. Used when no substitution doc
      // was found (e.g. a completed round whose substitutions were cleaned up).
      const missing = stageTeamIds.filter((tid) => !present.has(tid));
      let missingIdx = 0;
      for (let i = 0; i < gameResults.length; i++) {
        if (
          teamByIndex[i] == null &&
          isOfficialSub(gameResults[i].userId) &&
          missingIdx < missing.length
        ) {
          const inferred = missing[missingIdx++];
          teamByIndex[i] = inferred;
          present.add(inferred);
        }
      }
    }

    const gameTeamIds = new Set<string>(
      teamByIndex.filter((tid): tid is string => tid != null)
    );

    if (gameTeamIds.size !== stageTeamSet.size) {
      continue;
    }
    let allMatch = true;
    for (const tid of gameTeamIds) {
      if (!stageTeamSet.has(tid)) {
        allMatch = false;
        break;
      }
    }
    if (!allMatch) {
      continue;
    }

    totalGames++;
    const deltas = ctx.deltaComputer
      ? ctx.deltaComputer(gameResults)
      : computePlayerDeltas(gameResults, ctx.rules);
    for (let i = 0; i < gameResults.length; i++) {
      const teamId = teamByIndex[i];
      if (teamId && teamScores.has(teamId)) {
        const entry = teamScores.get(teamId)!;
        entry.totalScore += deltas[i];
        entry.gamesPlayed++;
      }
    }
  }

  const results: StageTeamResult[] = [];
  for (const [teamId, scores] of teamScores) {
    results.push({
      teamId,
      teamName: ctx.teamNameMap.get(teamId) ?? "?",
      totalScore: Math.round(scores.totalScore * 10) / 10,
      gamesPlayed: scores.gamesPlayed,
    });
  }

  results.sort((a, b) => b.totalScore - a.totalScore);
  return { results, gamesPlayed: totalGames };
}

/**
 * Computes all configured bracket stages from pre-fetched context.
 * Takes pre-fetched context to stay DB-agnostic.
 */
export function computeBracket(
  stages: BracketStageDefinition[],
  ctx: BracketContext
): ComputedStage[] {
  const completedStages = new Map<string, ComputedStage>();
  const allStages: ComputedStage[] = [];
  // Carry-over offsets seeded from the regular phase (or empty when no carry-over).
  const baseOffsets = new Map<string, number>(ctx.initialScoreOffsets ?? []);

  for (const stageDef of stages) {
    const stageTeamIds = resolveStageTeams(
      stageDef,
      ctx.seedings,
      completedStages
    );

    // Build per-stage score offsets: start from base offsets then layer in
    // any inter-stage carry-over defined on this stage's config.
    const stageOffsets = new Map<string, number>(baseOffsets);
    if (stageDef.scoreCarryOver && stageDef.scoreCarryOver > 0) {
      for (const source of stageDef.fromStages) {
        const prevStage = completedStages.get(source.stage);
        if (prevStage?.isComplete && prevStage.results.length >= source.place) {
          const advancingTeam = prevStage.results[source.place - 1];
          const carryAmount =
            Math.round(
              advancingTeam.totalScore * stageDef.scoreCarryOver * 10
            ) / 10;
          const existing = stageOffsets.get(advancingTeam.teamId) ?? 0;
          stageOffsets.set(advancingTeam.teamId, existing + carryAmount);
        }
      }
    }

    let results: StageTeamResult[] = [];
    let gamesPlayed = 0;

    if (
      stageTeamIds.length ===
      stageDef.seeds.length + stageDef.fromStages.length
    ) {
      const computed = computeStageResults(stageTeamIds, ctx, stageOffsets);
      results = computed.results;
      gamesPlayed = computed.gamesPlayed;
    }

    const stage: ComputedStage = {
      definition: stageDef,
      teams: stageTeamIds,
      results,
      isComplete: gamesPlayed >= getGamesToComplete(stageDef),
      gamesPlayed,
    };

    allStages.push(stage);
    completedStages.set(stageDef.name, stage);
  }

  return allStages;
}

export function computeLfcrBracket(ctx: BracketContext): ComputedStage[] {
  return computeBracket(LFCR_STAGES, ctx);
}

export function computeBracketStageMetadata(
  stageDefinitions: BracketStageDefinition[]
): Map<string, BracketStageMetadata> {
  const sortedDefinitions = [...stageDefinitions].sort(
    (a, b) => a.order - b.order
  );
  const metadata = new Map<string, BracketStageMetadata>();

  for (const stageDef of sortedDefinitions) {
    let groupIndex = 0;
    if (stageDef.fromStages.length > 0) {
      let maxSourceGroup = 0;
      for (const source of stageDef.fromStages) {
        const sourceGroup = metadata.get(source.stage)?.groupIndex ?? 0;
        if (sourceGroup > maxSourceGroup) {
          maxSourceGroup = sourceGroup;
        }
      }
      groupIndex = maxSourceGroup + 1;
    }

    metadata.set(stageDef.name, {
      groupIndex,
      stageOrder: stageDef.order,
      advancingCount: 0,
    });
  }

  for (const stageDef of sortedDefinitions) {
    for (const source of stageDef.fromStages) {
      const sourceMetadata = metadata.get(source.stage);
      if (!sourceMetadata) {
        continue;
      }
      if (source.place > sourceMetadata.advancingCount) {
        sourceMetadata.advancingCount = source.place;
      }
    }
  }

  return metadata;
}

/**
 * Resolves the effective "slice" (tranche) of each stage — the group of stages
 * that can run concurrently because all of their seeds are resolvable together
 * (e.g. round-of-32 = 0, quarter-finals = 1, semi-finals = 2). A stage's
 * explicit `slice` wins; otherwise it falls back to the topological bracket
 * depth (`groupIndex` from {@link computeBracketStageMetadata}). Returned map is
 * keyed by stage name.
 */
export function resolveStageSlices(
  stageDefinitions: BracketStageDefinition[]
): Map<string, number> {
  const metadata = computeBracketStageMetadata(stageDefinitions);
  const slices = new Map<string, number>();
  for (const def of stageDefinitions) {
    const topologicalDepth = metadata.get(def.name)?.groupIndex ?? 0;
    slices.set(def.name, def.slice ?? topologicalDepth);
  }
  return slices;
}

/**
 * Given computed stages and game data, classifies each game into its stage.
 * Returns a Map from stage name to the list of games belonging to that stage.
 */
export function classifyGamesByStage(
  stages: ComputedStage[],
  games: BracketGameInput[],
  userToTeamMap: Map<string, string>
): Map<string, BracketGameInput[]> {
  const result = new Map<string, BracketGameInput[]>();

  for (const stage of stages) {
    if (stage.teams.length === 0) {
      continue;
    }
    const stageTeamSet = new Set(stage.teams);
    const stageGames: BracketGameInput[] = [];

    for (const game of games) {
      const gameTeamIds = new Set<string>();
      for (const r of game.results) {
        const teamId = userToTeamMap.get(r.userId);
        if (teamId) {
          gameTeamIds.add(teamId);
        }
      }
      if (gameTeamIds.size !== stageTeamSet.size) {
        continue;
      }
      let allMatch = true;
      for (const tid of gameTeamIds) {
        if (!stageTeamSet.has(tid)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        stageGames.push(game);
      }
    }

    result.set(stage.definition.name, stageGames);
  }

  return result;
}

/**
 * Renders an ASCII bracket tree for Discord display.
 */
export function renderBracketAscii(
  leagueName: string,
  stages: ComputedStage[],
  seedings: Map<number, string>,
  teamNames: Map<string, string>,
  options?: {
    stageLabels?: Record<string, string>;
    advancementLabels?: Record<string, string>;
    tbdLabel?: string;
    seedLabel?: string;
  }
): string {
  const teamToSeed = new Map<string, number>();
  for (const [seed, teamId] of seedings) {
    teamToSeed.set(teamId, seed);
  }

  const maxScoreLen = Math.max(
    ...stages.flatMap((s) =>
      s.results.map((r) => formatBracketScore(r.totalScore).length)
    ),
    0
  );

  const lines: string[] = [];
  lines.push(`🏆 ${leagueName}`);
  lines.push("");

  for (const stage of stages) {
    const def = stage.definition;
    const localizedStageName = options?.stageLabels?.[def.name] ?? def.name;
    const progressLabel =
      stage.results.length > 0
        ? ` (${stage.gamesPlayed}/${getGamesToComplete(stage.definition)})`
        : "";
    lines.push(`━━ ${localizedStageName}${progressLabel} ━━`);

    if (stage.results.length > 0) {
      for (let i = 0; i < stage.results.length; i++) {
        const r = stage.results[i];
        // Score before the name and right-aligned (all values carry one
        // decimal, so right-alignment lines up the decimal points). Putting it
        // first keeps the team-name column aligned regardless of (variable
        // visual width) CJK names.
        const score = formatBracketScore(r.totalScore).padStart(maxScoreLen);
        lines.push(`  ${i + 1}. ${score} ${r.teamName}`);
      }
    } else if (stage.teams.length > 0) {
      for (const teamId of stage.teams) {
        const name = teamNames.get(teamId) ?? "?";
        const seed = teamToSeed.get(teamId);
        const seedLabel = seed
          ? ` (${options?.seedLabel ?? "seed"} ${seed})`
          : "";
        lines.push(`  · ${name}${seedLabel}`);
      }
    } else {
      lines.push(`  ${options?.tbdLabel ?? "À déterminer"}`);
    }

    const advancementLabel = def.advancementLabelKey
      ? options?.advancementLabels?.[def.advancementLabelKey]
      : def.advancementLabel;
    if (advancementLabel) {
      lines.push(`  → ${advancementLabel}`);
    }

    lines.push("");
  }

  return "```\n" + lines.join("\n") + "```";
}

/**
 * Like {@link renderBracketAscii} but splits the output into multiple Discord
 * messages. Stages are first grouped into "slices" (tranches) — sets of stages
 * that can run concurrently (see {@link resolveStageSlices}) — and every slice
 * starts a fresh message, so e.g. quarter-final standings never share a message
 * with the round-of-32. Within a slice the output is further split so each part
 * stays under Discord's 2000-character cap. Slices whose stages are all still
 * unresolved (no teams and no results) are skipped entirely. Each returned
 * string is a self-contained code block led by the league header; the caller is
 * responsible for appending any footer (e.g. "Last updated") to each part.
 */
export function renderBracketAsciiParts(
  leagueName: string,
  stages: ComputedStage[],
  seedings: Map<number, string>,
  teamNames: Map<string, string>,
  options?: {
    stageLabels?: Record<string, string>;
    advancementLabels?: Record<string, string>;
    tbdLabel?: string;
    seedLabel?: string;
    /** Soft cap per part, in characters (default 1800 to leave room for per-part footers). */
    maxPartLength?: number;
  }
): string[] {
  const maxPartLength = options?.maxPartLength ?? 1800;

  const teamToSeed = new Map<string, number>();
  for (const [seed, teamId] of seedings) {
    teamToSeed.set(teamId, seed);
  }

  const maxScoreLen = Math.max(
    ...stages.flatMap((s) =>
      s.results.map((r) => formatBracketScore(r.totalScore).length)
    ),
    0
  );

  const headerLine = `🏆 ${leagueName}`;

  const renderStageBlock = (stage: ComputedStage): string => {
    const blockLines: string[] = [];
    const def = stage.definition;
    const localizedStageName = options?.stageLabels?.[def.name] ?? def.name;
    const progressLabel =
      stage.results.length > 0
        ? ` (${stage.gamesPlayed}/${getGamesToComplete(stage.definition)})`
        : "";
    blockLines.push(`━━ ${localizedStageName}${progressLabel} ━━`);

    if (stage.results.length > 0) {
      for (let i = 0; i < stage.results.length; i++) {
        const r = stage.results[i];
        // Score before the name and right-aligned (all values carry one
        // decimal, so right-alignment lines up the decimal points). Putting it
        // first keeps the team-name column aligned regardless of (variable
        // visual width) CJK names.
        const score = formatBracketScore(r.totalScore).padStart(maxScoreLen);
        blockLines.push(`  ${i + 1}. ${score} ${r.teamName}`);
      }
    } else if (stage.teams.length > 0) {
      for (const teamId of stage.teams) {
        const name = teamNames.get(teamId) ?? "?";
        const seed = teamToSeed.get(teamId);
        const seedLabel = seed
          ? ` (${options?.seedLabel ?? "seed"} ${seed})`
          : "";
        blockLines.push(`  · ${name}${seedLabel}`);
      }
    } else {
      blockLines.push(`  ${options?.tbdLabel ?? "À déterminer"}`);
    }

    const advancementLabel = def.advancementLabelKey
      ? options?.advancementLabels?.[def.advancementLabelKey]
      : def.advancementLabel;
    if (advancementLabel) {
      blockLines.push(`  → ${advancementLabel}`);
    }

    return blockLines.join("\n");
  };

  // Group stages into slices, preserving stage order within each slice and
  // visiting slices in ascending order.
  const sliceByStage = resolveStageSlices(stages.map((s) => s.definition));
  const stagesBySlice = new Map<number, ComputedStage[]>();
  for (const stage of stages) {
    const slice = sliceByStage.get(stage.definition.name) ?? 0;
    const group = stagesBySlice.get(slice);
    if (group) {
      group.push(stage);
    } else {
      stagesBySlice.set(slice, [stage]);
    }
  }
  const orderedSlices = [...stagesBySlice.keys()].sort((a, b) => a - b);

  const wrap = (body: string) => "```\n" + body + "\n```";
  const wrapperOverhead = "```\n\n```".length;

  const parts: string[] = [];

  for (const slice of orderedSlices) {
    const sliceStages = stagesBySlice.get(slice) ?? [];
    // Skip a slice with no resolved participants anywhere (a future round).
    const hasContent = sliceStages.some(
      (s) => s.results.length > 0 || s.teams.length > 0
    );
    if (!hasContent) {
      continue;
    }

    // Each slice starts its own message, led by the league header so every
    // separate message is self-identifying. Within the slice we keep the
    // character-budget split; continuation parts omit the header to stay
    // compact.
    let currentBody: string[] = [headerLine, ""];
    let currentLen = headerLine.length + 1;
    let bodyHasStage = false;

    for (const stage of sliceStages) {
      const block = renderStageBlock(stage);
      const addLen = block.length + 2;
      const projected = currentLen + addLen + wrapperOverhead;
      if (bodyHasStage && projected > maxPartLength) {
        parts.push(wrap(currentBody.join("\n")));
        currentBody = [];
        currentLen = 0;
        bodyHasStage = false;
      }
      currentBody.push(block);
      currentBody.push("");
      currentLen += addLen;
      bodyHasStage = true;
    }

    if (bodyHasStage) {
      parts.push(wrap(currentBody.join("\n")));
    }
  }

  return parts;
}

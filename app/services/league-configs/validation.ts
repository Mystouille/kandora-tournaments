const REGULAR_SCORING_TYPES = [
  "team-delta-cap",
  "best-consecutive-window",
  "cumulative",
] as const;

const FINAL_SCORING_TYPES = ["bracket-delta"] as const;

/**
 * Validates a `LeagueTypeConfig` JSON object.
 * Returns an array of human-readable error strings (empty = valid).
 */
export function validateLeagueTypeConfig(config: unknown): string[] {
  const errors: string[] = [];

  if (config == null || typeof config !== "object") {
    return ["Config must be a non-null object"];
  }

  const c = config as Record<string, unknown>;

  // --- Top-level ---
  if (typeof c.displayName !== "string" || c.displayName.trim() === "") {
    errors.push("displayName is required and must be a non-empty string");
  }
  if (typeof c.isTeamMode !== "boolean") {
    errors.push("isTeamMode is required and must be a boolean");
  }

  const hasRegular = c.regularPhase != null;
  const hasMulti = Array.isArray(c.regularPhases);
  const hasFinal = c.finalPhase != null;
  if (!hasRegular && !hasMulti && !hasFinal) {
    errors.push(
      "At least one of regularPhase, regularPhases, or finalPhase must be provided"
    );
  }
  if (hasRegular && hasMulti) {
    errors.push("Cannot specify both regularPhase and regularPhases");
  }

  // --- Single regular phase ---
  if (hasRegular) {
    validateRegularPhase(
      c.regularPhase as Record<string, unknown>,
      "regularPhase",
      errors,
      false
    );
  }

  // --- Multi-phase ---
  if (hasMulti) {
    const phases = c.regularPhases as unknown[];
    if (phases.length < 2) {
      errors.push("regularPhases must have at least 2 phases");
    }
    const phaseIds = new Set<string>();
    phases.forEach((phase, i) => {
      const prefix = `regularPhases[${i}]`;
      if (phase == null || typeof phase !== "object") {
        errors.push(`${prefix} must be an object`);
        return;
      }
      const isLast = i === phases.length - 1;
      validateRegularPhase(
        phase as Record<string, unknown>,
        prefix,
        errors,
        !isLast
      );
      const id = (phase as Record<string, unknown>).id;
      if (typeof id === "string") {
        if (phaseIds.has(id)) {
          errors.push(`${prefix}.id "${id}" is duplicated`);
        }
        phaseIds.add(id);
      }
    });
  }

  // --- Final phase ---
  if (c.finalPhase != null) {
    validateFinalPhase(c.finalPhase as Record<string, unknown>, errors);
  }

  return errors;
}

function validateRegularPhase(
  phase: Record<string, unknown>,
  prefix: string,
  errors: string[],
  requireProgression: boolean
) {
  if (typeof phase.id !== "string" || phase.id.trim() === "") {
    errors.push(`${prefix}.id is required`);
  }
  validateScoring(phase.scoring, `${prefix}.scoring`, errors, false);

  if (requireProgression) {
    if (phase.progression == null) {
      errors.push(`${prefix}.progression is required (not the last phase)`);
    } else {
      validateProgression(
        phase.progression as Record<string, unknown>,
        `${prefix}.progression`,
        errors
      );
    }
  } else if (phase.progression != null) {
    validateProgression(
      phase.progression as Record<string, unknown>,
      `${prefix}.progression`,
      errors
    );
  }
}

function validateScoring(
  scoring: unknown,
  prefix: string,
  errors: string[],
  isFinal: boolean
) {
  if (scoring == null || typeof scoring !== "object") {
    errors.push(`${prefix} must be an object`);
    return;
  }
  const s = scoring as Record<string, unknown>;
  const validTypes: readonly string[] = isFinal
    ? FINAL_SCORING_TYPES
    : REGULAR_SCORING_TYPES;
  if (!validTypes.includes(s.type as string)) {
    errors.push(`${prefix}.type must be one of: ${validTypes.join(", ")}`);
    return;
  }

  if (s.type === "team-delta-cap") {
    if (
      typeof s.capPercent !== "number" ||
      s.capPercent <= 0 ||
      s.capPercent >= 1
    ) {
      errors.push(
        `${prefix}.capPercent must be a number between 0 and 1 (exclusive)`
      );
    }
    if (
      typeof s.minGamesForCap !== "number" ||
      s.minGamesForCap < 0 ||
      !Number.isInteger(s.minGamesForCap)
    ) {
      errors.push(`${prefix}.minGamesForCap must be a non-negative integer`);
    }
  }

  if (s.type === "best-consecutive-window") {
    if (
      typeof s.windowSize !== "number" ||
      s.windowSize < 1 ||
      !Number.isInteger(s.windowSize)
    ) {
      errors.push(`${prefix}.windowSize must be a positive integer`);
    }
    if (
      s.qualificationMode != null &&
      s.qualificationMode !== "faction-top-n"
    ) {
      errors.push(
        `${prefix}.qualificationMode must be "faction-top-n" or absent`
      );
    }
    if (s.qualificationMode === "faction-top-n") {
      if (
        typeof s.qualificationCount !== "number" ||
        s.qualificationCount < 1 ||
        !Number.isInteger(s.qualificationCount)
      ) {
        errors.push(
          `${prefix}.qualificationCount must be a positive integer when qualificationMode is set`
        );
      }
    }
  }
}

function validateProgression(
  prog: Record<string, unknown>,
  prefix: string,
  errors: string[]
) {
  if (
    typeof prog.advancingCount !== "number" ||
    prog.advancingCount < 1 ||
    !Number.isInteger(prog.advancingCount)
  ) {
    errors.push(`${prefix}.advancingCount must be a positive integer`);
  }
  validateRational(prog.scoreRetention, `${prefix}.scoreRetention`, errors);
}

function validateRational(value: unknown, prefix: string, errors: string[]) {
  if (value == null || typeof value !== "object") {
    errors.push(`${prefix} must be a {num, den} object`);
    return;
  }
  const r = value as Record<string, unknown>;
  if (typeof r.num !== "number" || !Number.isInteger(r.num) || r.num < 0) {
    errors.push(`${prefix}.num must be a non-negative integer`);
  }
  if (typeof r.den !== "number" || !Number.isInteger(r.den) || r.den < 1) {
    errors.push(`${prefix}.den must be a positive integer`);
  }
  if (typeof r.num === "number" && typeof r.den === "number" && r.num > r.den) {
    errors.push(`${prefix}: num (${r.num}) must be ≤ den (${r.den})`);
  }
}

function validateFinalPhase(fp: Record<string, unknown>, errors: string[]) {
  const prefix = "finalPhase";
  if (typeof fp.id !== "string" || fp.id.trim() === "") {
    errors.push(`${prefix}.id is required`);
  }
  validateScoring(fp.scoring, `${prefix}.scoring`, errors, true);
  validateRational(fp.scoreCarryOver, `${prefix}.scoreCarryOver`, errors);

  if (!Array.isArray(fp.stages) || fp.stages.length === 0) {
    errors.push(`${prefix}.stages must be a non-empty array`);
    return;
  }

  const stages = fp.stages as unknown[];
  const stageIds = new Set<string>();

  stages.forEach((stage, i) => {
    const sp = `${prefix}.stages[${i}]`;
    if (stage == null || typeof stage !== "object") {
      errors.push(`${sp} must be an object`);
      return;
    }
    const s = stage as Record<string, unknown>;

    if (typeof s.id !== "string" || s.id.trim() === "") {
      errors.push(`${sp}.id is required`);
    } else {
      if (stageIds.has(s.id as string)) {
        errors.push(`${sp}.id "${s.id}" is duplicated`);
      }
      stageIds.add(s.id as string);
    }

    if (
      typeof s.gameCount !== "number" ||
      s.gameCount < 0 ||
      !Number.isInteger(s.gameCount)
    ) {
      errors.push(`${sp}.gameCount must be a non-negative integer`);
    }

    if (
      s.slice != null &&
      (typeof s.slice !== "number" || s.slice < 0 || !Number.isInteger(s.slice))
    ) {
      errors.push(`${sp}.slice must be a non-negative integer when set`);
    }

    if (!Array.isArray(s.seeds)) {
      errors.push(`${sp}.seeds must be an array`);
    } else {
      for (let j = 0; j < (s.seeds as unknown[]).length; j++) {
        const seed = (s.seeds as unknown[])[j];
        if (typeof seed !== "number" || seed < 1 || !Number.isInteger(seed)) {
          errors.push(`${sp}.seeds[${j}] must be a positive integer`);
        }
      }
    }

    if (!Array.isArray(s.fromStages)) {
      errors.push(`${sp}.fromStages must be an array`);
    } else {
      for (let j = 0; j < (s.fromStages as unknown[]).length; j++) {
        const edge = (s.fromStages as unknown[])[j];
        const ep = `${sp}.fromStages[${j}]`;
        if (edge == null || typeof edge !== "object") {
          errors.push(`${ep} must be an object`);
          continue;
        }
        const e = edge as Record<string, unknown>;
        if (typeof e.stageId !== "string" || e.stageId.trim() === "") {
          errors.push(`${ep}.stageId is required`);
        }
        if (
          typeof e.topN !== "number" ||
          e.topN < 1 ||
          !Number.isInteger(e.topN)
        ) {
          errors.push(`${ep}.topN must be a positive integer`);
        }
        if (e.places != null) {
          if (!Array.isArray(e.places) || e.places.length === 0) {
            errors.push(`${ep}.places must be a non-empty array when set`);
          } else {
            const places = e.places as unknown[];
            for (let k = 0; k < places.length; k++) {
              const p = places[k];
              if (typeof p !== "number" || p < 1 || !Number.isInteger(p)) {
                errors.push(`${ep}.places[${k}] must be a positive integer`);
              }
            }
            if (
              typeof e.topN === "number" &&
              Array.isArray(e.places) &&
              e.places.length !== e.topN
            ) {
              errors.push(
                `${ep}.places length (${(e.places as unknown[]).length}) must match topN (${e.topN})`
              );
            }
          }
        }
      }
    }

    if (
      !Array.isArray(s.seeds) ||
      ((s.seeds as unknown[]).length === 0 &&
        (!Array.isArray(s.fromStages) ||
          (s.fromStages as unknown[]).length === 0))
    ) {
      errors.push(`${sp} must have at least one seed or fromStage`);
    }

    if (s.scoreCarryOver != null) {
      validateRational(s.scoreCarryOver, `${sp}.scoreCarryOver`, errors);
    }
  });

  // Validate DAG: no forward references — fromStages can only reference earlier stages
  const orderedIds: string[] = [];
  stages.forEach((stage, i) => {
    const s = stage as Record<string, unknown>;
    const id = s.id as string;
    if (!id) {
      return;
    }

    if (Array.isArray(s.fromStages)) {
      for (const edge of s.fromStages as Record<string, unknown>[]) {
        const refId = edge?.stageId as string;
        if (refId && !orderedIds.includes(refId)) {
          errors.push(
            `${prefix}.stages[${i}].fromStages references "${refId}" which must appear earlier in the stages array`
          );
        }
      }
    }
    orderedIds.push(id);
  });
}

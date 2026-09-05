export function normalizeLegacyReplayEvent(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return value;
  }

  const event = value as Record<string, unknown>;
  if (event.type === "hand_start" && event.hand === null) {
    const normalized = { ...event };
    delete normalized.hand;
    return normalized;
  }
  if (event.type === "win" && event.uraDoraIndicators === null) {
    const normalized = { ...event };
    delete normalized.uraDoraIndicators;
    return normalized;
  }
  return value;
}

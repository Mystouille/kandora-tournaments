import type { Translations } from "~/i18n/types";
import { yakuNamesRomaji } from "~/i18n/yakuNamesRomaji";
import { yakuNamesJa } from "~/i18n/yakuNamesJa";
import { YAKU_KEY_MAP, MERGE_TARGET } from "./yakuMap.constants";

/** Resolve a yaku id to its display name (locale, romaji, or japanese) */
export function getYakuName(
  yakuId: number,
  t: Translations,
  useRomaji = false,
  useJapanese = false
): string {
  const key = YAKU_KEY_MAP[yakuId];
  if (!key) {
    return `Yaku ${yakuId}`;
  }
  if (useJapanese) {
    return yakuNamesJa[key];
  }
  return useRomaji ? yakuNamesRomaji[key] : t.yakuNames[key];
}

/** Sort yakus so the most common ones appear first */
export function sortedYakuIds(
  yakuCounts: Record<string, Record<string, number>>
): number[] {
  const totals = new Map<number, number>();
  for (const [yakuId, cols] of Object.entries(yakuCounts)) {
    let sum = 0;
    for (const v of Object.values(cols)) {
      sum += v;
    }
    totals.set(Number(yakuId), sum);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Merge yakuCounts so grouped yakus (e.g. 3 dragons) are summed into one row */
export function mergeYakuCounts(
  raw: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const merged: Record<string, Record<string, number>> = {};
  for (const [yakuIdStr, cols] of Object.entries(raw)) {
    const yakuId = Number(yakuIdStr);
    const target = MERGE_TARGET[yakuId] ?? yakuId;
    const key = String(target);
    if (!merged[key]) {
      merged[key] = {};
    }
    for (const [colId, count] of Object.entries(cols)) {
      merged[key][colId] = (merged[key][colId] ?? 0) + count;
    }
  }
  return merged;
}

/** Build an interpolated background colour from 0→max */
export function heatColor(
  value: number,
  max: number,
  isDark: boolean,
  variant: "blue" | "red" = "blue"
): string {
  if (max === 0 || value === 0) {
    return isDark ? "#1f1f1f" : "#fafafa";
  }
  const t = Math.min(value / max, 1);
  if (variant === "red") {
    if (isDark) {
      const r = Math.round(50 + t * 180);
      const g = Math.round(30 + t * 10);
      const b = Math.round(30 + t * 10);
      return `rgb(${r},${g},${b})`;
    }
    const r = Math.round(255);
    const g = Math.round(240 - t * 180);
    const b = Math.round(240 - t * 180);
    return `rgb(${r},${g},${b})`;
  }
  // Blue scale
  if (isDark) {
    const r = Math.round(30 + t * 10);
    const g = Math.round(30 + t * 60);
    const b = Math.round(50 + t * 180);
    return `rgb(${r},${g},${b})`;
  }
  const r = Math.round(240 - t * 180);
  const g = Math.round(245 - t * 150);
  const b = Math.round(255);
  return `rgb(${r},${g},${b})`;
}

import { listPresets } from "~/game/rules/presets";
import type { ReplaySource } from "~/game/replay/types";
import type {
  MyReplayContext,
  MyReplayContextKind,
  MyReplayReason,
  MyReplayRuleset,
  MyReplaySeat,
} from "~/types/myReplays";
import type { MobileStoredReplaySummary } from "../persistence/mobileMatchRepository";
import type { MyReplayApiGroup } from "./myReplaysApi";

export type ReplayLibraryMode = "offline" | "online";
export type ReplayLibrarySortOrder = "newest" | "oldest";
export type ReplayLibraryRowKind = "replay" | "review";

export interface ReplayLibraryRow {
  key: string;
  groupKey: string;
  kind: ReplayLibraryRowKind;
  mode: ReplayLibraryMode;
  source: ReplaySource;
  sourceGameId: string;
  reviewShortId: string | null;
  reviewedPlayerName: string | null;
  commentCount: number;
  treeBranch: "middle" | "last" | null;
  replayUrl: string | null;
  gameDate: number | null;
  seats: MyReplaySeat[];
  context: MyReplayContext;
  ruleset: MyReplayRuleset;
  reasons: MyReplayReason[];
}

export interface ReplayLibraryFilters {
  gameDateRange: [number, number] | null;
  rulesets: string[];
  sources: ReplaySource[];
  contexts: MyReplayContextKind[];
  reasons: MyReplayReason[];
  sortOrder: ReplayLibrarySortOrder;
}

export interface ReplayLibraryFilterOptions {
  rulesets: MyReplayRuleset[];
  sources: ReplaySource[];
  contexts: MyReplayContextKind[];
  reasons: MyReplayReason[];
}

export const EMPTY_REPLAY_LIBRARY_FILTERS: ReplayLibraryFilters = {
  gameDateRange: null,
  rulesets: [],
  sources: [],
  contexts: [],
  reasons: [],
  sortOrder: "newest",
};

const PRESET_LABELS = new Map(
  listPresets().map((preset) => [preset.id, preset.displayName])
);

const SOURCE_ORDER: ReplaySource[] = [
  "ingame",
  "majsoul",
  "tenhou",
  "riichicity",
];
const CONTEXT_ORDER: MyReplayContextKind[] = [
  "tournament",
  "friendly",
  "external",
];
const REASON_ORDER: MyReplayReason[] = [
  "created",
  "played",
  "commented",
  "reviewed",
];

function orderedSeats(seats: MyReplaySeat[]): MyReplaySeat[] {
  return [...seats].sort(
    (left, right) => left.place - right.place || left.seat - right.seat
  );
}

export function offlineReplayRows(
  summaries: MobileStoredReplaySummary[]
): ReplayLibraryRow[] {
  return summaries.map((summary) => {
    const key = `offline:${summary.source}:${summary.sourceGameId}`;
    return {
      key,
      groupKey: key,
      kind: "replay",
      mode: "offline",
      source: summary.source,
      sourceGameId: summary.sourceGameId,
      reviewShortId: null,
      reviewedPlayerName: null,
      commentCount: 0,
      treeBranch: null,
      replayUrl: null,
      gameDate: summary.startedAt,
      seats: orderedSeats(summary.seats),
      context: { kind: "friendly" },
      ruleset: {
        id: summary.ruleSet,
        label: PRESET_LABELS.get(summary.ruleSet) ?? summary.ruleSet,
      },
      reasons: [],
    };
  });
}

export function onlineReplayRows(
  replays: MyReplayApiGroup[]
): ReplayLibraryRow[] {
  return replays.flatMap((replay) => {
    const parent: ReplayLibraryRow = {
      key: replay.key,
      groupKey: replay.key,
      kind: "replay",
      mode: "online",
      source: replay.source,
      sourceGameId: replay.sourceGameId,
      reviewShortId: null,
      reviewedPlayerName: null,
      commentCount: replay.commentCount,
      treeBranch: null,
      replayUrl: replay.replayUrl,
      gameDate: replay.gameDate,
      seats: orderedSeats(replay.seats),
      context: replay.context,
      ruleset: replay.ruleset,
      reasons: replay.reasons,
    };
    const reviews = replay.reviews.map<ReplayLibraryRow>((review, index) => ({
      ...parent,
      key: `${replay.key}:review:${review.shortId}`,
      kind: "review",
      reviewShortId: review.shortId,
      reviewedPlayerName: review.reviewedPlayerName,
      commentCount: review.commentCount,
      treeBranch: index === replay.reviews.length - 1 ? "last" : "middle",
      reasons: review.reasons,
    }));
    return [parent, ...reviews];
  });
}

function compareDates(
  left: ReplayLibraryRow,
  right: ReplayLibraryRow,
  order: ReplayLibrarySortOrder
): number {
  if (left.gameDate === null && right.gameDate === null) {
    return left.key.localeCompare(right.key);
  }
  if (left.gameDate === null) {
    return 1;
  }
  if (right.gameDate === null) {
    return -1;
  }
  const difference =
    order === "newest"
      ? right.gameDate - left.gameDate
      : left.gameDate - right.gameDate;
  if (difference !== 0) {
    return difference;
  }
  const groupDifference = left.groupKey.localeCompare(right.groupKey);
  if (groupDifference !== 0) {
    return groupDifference;
  }
  if (left.kind !== right.kind) {
    return left.kind === "replay" ? -1 : 1;
  }
  return left.key.localeCompare(right.key);
}

export function filterReplayLibraryRows(
  rows: ReplayLibraryRow[],
  mode: ReplayLibraryMode,
  filters: ReplayLibraryFilters
): ReplayLibraryRow[] {
  return rows
    .filter((row) => {
      if (row.mode !== mode) {
        return false;
      }
      if (
        filters.gameDateRange !== null &&
        (row.gameDate === null ||
          row.gameDate < filters.gameDateRange[0] ||
          row.gameDate > filters.gameDateRange[1])
      ) {
        return false;
      }
      if (
        filters.rulesets.length > 0 &&
        !filters.rulesets.includes(row.ruleset.id)
      ) {
        return false;
      }
      if (mode === "offline") {
        return true;
      }
      return (
        (filters.sources.length === 0 ||
          filters.sources.includes(row.source)) &&
        (filters.contexts.length === 0 ||
          filters.contexts.includes(row.context.kind)) &&
        (filters.reasons.length === 0 ||
          row.reasons.some((reason) => filters.reasons.includes(reason)))
      );
    })
    .sort((left, right) => compareDates(left, right, filters.sortOrder));
}

export function replayLibraryFilterOptions(
  rows: ReplayLibraryRow[]
): ReplayLibraryFilterOptions {
  const rulesets = new Map<string, MyReplayRuleset>();
  const sources = new Set<ReplaySource>();
  const contexts = new Set<MyReplayContextKind>();
  const reasons = new Set<MyReplayReason>();
  for (const row of rows) {
    rulesets.set(row.ruleset.id, row.ruleset);
    sources.add(row.source);
    contexts.add(row.context.kind);
    for (const reason of row.reasons) {
      reasons.add(reason);
    }
  }
  return {
    rulesets: [...rulesets.values()].sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    sources: SOURCE_ORDER.filter((source) => sources.has(source)),
    contexts: CONTEXT_ORDER.filter((context) => contexts.has(context)),
    reasons: REASON_ORDER.filter((reason) => reasons.has(reason)),
  };
}

export function activeReplayFilterCount(
  mode: ReplayLibraryMode,
  filters: ReplayLibraryFilters
): number {
  return (
    Number(filters.gameDateRange !== null) +
    Number(filters.rulesets.length > 0) +
    Number(filters.sortOrder !== "newest") +
    (mode === "online"
      ? Number(filters.sources.length > 0) +
        Number(filters.contexts.length > 0) +
        Number(filters.reasons.length > 0)
      : 0)
  );
}

import type { ReplaySource } from "~/game/replay/types";
import type { MyReplayContextKind, MyReplayReason } from "~/types/myReplays";
import {
  DEFAULT_MY_REPLAY_SORT,
  EMPTY_MY_REPLAY_FILTERS,
  type MyReplayFilters,
  type MyReplaySort,
} from "./myReplayRows";

export const MY_REPLAY_TABLE_STORAGE_KEY = "kandora.myReplays.table.v1";

export const MY_REPLAY_COLUMN_DISPLAY_ORDER = [
  "gameDate",
  "context",
  "platform",
  "links",
  "ruleset",
  "lastModified",
  "comments",
] as const;

export type MyReplayColumnKey = (typeof MY_REPLAY_COLUMN_DISPLAY_ORDER)[number];

const MY_REPLAY_COLUMN_PRIORITY: MyReplayColumnKey[] = [
  "gameDate",
  "links",
  "context",
  "platform",
  "ruleset",
  "comments",
  "lastModified",
];

export const MY_REPLAY_COLUMN_WIDTH: Record<MyReplayColumnKey, number> = {
  gameDate: 220,
  links: 190,
  platform: 125,
  context: 200,
  ruleset: 145,
  lastModified: 180,
  comments: 90,
};

const HEADER_CHARACTER_WIDTH = 9;
const HEADER_HORIZONTAL_PADDING = 32;
const HEADER_CONTROL_WIDTH: Record<MyReplayColumnKey, number> = {
  gameDate: 44,
  context: 24,
  platform: 24,
  links: 0,
  ruleset: 24,
  lastModified: 44,
  comments: 0,
};

const EXPAND_COLUMN_WIDTH = 48;
const PAGE_SIZES = [10, 20, 50, 100] as const;
const REPLAY_SOURCES: ReplaySource[] = [
  "ingame",
  "majsoul",
  "tenhou",
  "riichicity",
];
const REASONS: MyReplayReason[] = [
  "created",
  "played",
  "commented",
  "reviewed",
];
const CONTEXTS: MyReplayContextKind[] = ["friendly", "tournament", "external"];
const CONTEXT_FILTER_PREFIX = "context:";
const REASON_FILTER_PREFIX = "reason:";

export function myReplayContextFilterValue(
  context: MyReplayContextKind
): string {
  return `${CONTEXT_FILTER_PREFIX}${context}`;
}

export function myReplayReasonFilterValue(reason: MyReplayReason): string {
  return `${REASON_FILTER_PREFIX}${reason}`;
}

export interface MyReplayTablePreferences {
  filters: MyReplayFilters;
  sort: MyReplaySort;
  enabledColumns: MyReplayColumnKey[];
  pageSize: number;
}

export function longestHeaderWordLength(label: string): number {
  return Math.max(
    1,
    ...label
      .trim()
      .split(/\s+/u)
      .map((word) => Array.from(word).length)
  );
}

export function resolveMyReplayColumnWidths(
  labels: Record<MyReplayColumnKey, string>
): Record<MyReplayColumnKey, number> {
  return Object.fromEntries(
    MY_REPLAY_COLUMN_DISPLAY_ORDER.map((key) => {
      const headerMinimum =
        longestHeaderWordLength(labels[key]) * HEADER_CHARACTER_WIDTH +
        HEADER_HORIZONTAL_PADDING +
        HEADER_CONTROL_WIDTH[key];
      return [key, Math.max(MY_REPLAY_COLUMN_WIDTH[key], headerMinimum)];
    })
  ) as Record<MyReplayColumnKey, number>;
}

type HeaderFilterKey = "platform" | "context" | "ruleset";
type HeaderFilterValues = Partial<
  Record<HeaderFilterKey, readonly unknown[] | null>
>;

function defaultFilters(): MyReplayFilters {
  return {
    ...EMPTY_MY_REPLAY_FILTERS,
    platforms: [],
    reasons: [],
    contexts: [],
    rulesets: [],
  };
}

export function defaultMyReplayTablePreferences(): MyReplayTablePreferences {
  return {
    filters: defaultFilters(),
    sort: { ...DEFAULT_MY_REPLAY_SORT },
    enabledColumns: [...MY_REPLAY_COLUMN_DISPLAY_ORDER],
    pageSize: 20,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allowedStrings<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowedSet = new Set<string>(allowed);
  return [
    ...new Set(
      value.filter(
        (entry): entry is T =>
          typeof entry === "string" && allowedSet.has(entry)
      )
    ),
  ];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((entry): entry is string => typeof entry === "string")
        ),
      ]
    : [];
}

function dateRange(value: unknown): [number, number] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    return null;
  }
  const [start, end] = value;
  return start > 0 && end >= start ? [start, end] : null;
}

export function parseMyReplayTablePreferences(
  raw: string | null
): MyReplayTablePreferences {
  const defaults = defaultMyReplayTablePreferences();
  if (!raw) {
    return defaults;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!isRecord(parsed)) {
    return defaults;
  }

  const storedFilters = isRecord(parsed.filters) ? parsed.filters : {};
  const storedSort = isRecord(parsed.sort) ? parsed.sort : {};
  const enabledColumns = allowedStrings(
    parsed.enabledColumns,
    MY_REPLAY_COLUMN_DISPLAY_ORDER
  );
  const sortField =
    storedSort.field === "gameDate" || storedSort.field === "lastModified"
      ? storedSort.field
      : defaults.sort.field;
  const sortOrder =
    storedSort.order === "ascend" || storedSort.order === "descend"
      ? storedSort.order
      : defaults.sort.order;
  const pageSize = PAGE_SIZES.includes(
    parsed.pageSize as (typeof PAGE_SIZES)[number]
  )
    ? (parsed.pageSize as number)
    : defaults.pageSize;

  return {
    filters: {
      gameDateRange: dateRange(storedFilters.gameDateRange),
      lastModifiedRange: dateRange(storedFilters.lastModifiedRange),
      platforms: allowedStrings(storedFilters.platforms, REPLAY_SOURCES),
      reasons: allowedStrings(storedFilters.reasons, REASONS),
      contexts: allowedStrings(storedFilters.contexts, CONTEXTS),
      rulesets: stringArray(storedFilters.rulesets),
    },
    sort: { field: sortField, order: sortOrder },
    enabledColumns:
      enabledColumns.length > 0 ? enabledColumns : defaults.enabledColumns,
    pageSize,
  };
}

export function fitMyReplayColumns(
  enabledColumns: readonly MyReplayColumnKey[],
  containerWidth: number,
  hasExpandColumn = true,
  columnWidths: Record<MyReplayColumnKey, number> = MY_REPLAY_COLUMN_WIDTH
): MyReplayColumnKey[] {
  const enabled = new Set(enabledColumns);
  const availableWidth = Math.max(
    0,
    Math.floor(containerWidth) - (hasExpandColumn ? EXPAND_COLUMN_WIDTH : 0)
  );
  const fitted = new Set<MyReplayColumnKey>();
  let usedWidth = 0;

  for (const key of MY_REPLAY_COLUMN_PRIORITY) {
    if (!enabled.has(key)) {
      continue;
    }
    const columnWidth = columnWidths[key];
    if (fitted.size > 0 && usedWidth + columnWidth > availableWidth) {
      break;
    }
    fitted.add(key);
    usedWidth += columnWidth;
  }

  return MY_REPLAY_COLUMN_DISPLAY_ORDER.filter((key) => fitted.has(key));
}

export function mergeMyReplayHeaderFilters(
  current: MyReplayFilters,
  reported: HeaderFilterValues
): MyReplayFilters {
  const has = (key: HeaderFilterKey): boolean =>
    Object.prototype.hasOwnProperty.call(reported, key);
  const combinedContextValues = has("context")
    ? stringArray(reported.context)
    : null;
  const combinedContexts = combinedContextValues
    ? allowedStrings(
        combinedContextValues.map((value) =>
          value.startsWith(CONTEXT_FILTER_PREFIX)
            ? value.slice(CONTEXT_FILTER_PREFIX.length)
            : value
        ),
        CONTEXTS
      )
    : null;
  const combinedReasons = combinedContextValues
    ? allowedStrings(
        combinedContextValues
          .filter((value) => value.startsWith(REASON_FILTER_PREFIX))
          .map((value) => value.slice(REASON_FILTER_PREFIX.length)),
        REASONS
      )
    : null;
  return {
    ...current,
    platforms: has("platform")
      ? allowedStrings(reported.platform, REPLAY_SOURCES)
      : current.platforms,
    contexts: combinedContexts ?? current.contexts,
    rulesets: has("ruleset") ? stringArray(reported.ruleset) : current.rulesets,
    reasons: combinedReasons ?? current.reasons,
  };
}

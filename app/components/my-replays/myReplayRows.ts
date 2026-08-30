import type { MyReplayContextKind, MyReplayGroup } from "~/types/myReplays";
import type { ReplaySource } from "~/game/replay/types";

export type MyReplayRowType = "replay" | "review";
export type MyReplaySortField = "gameDate" | "lastModified";
export type MyReplaySortOrder = "ascend" | "descend";

export interface MyReplayFilters {
  gameDateRange: [number, number] | null;
  lastModifiedRange: [number, number] | null;
  platforms: ReplaySource[];
  rowTypes: MyReplayRowType[];
  contexts: MyReplayContextKind[];
  rulesets: string[];
}

export interface MyReplaySort {
  field: MyReplaySortField;
  order: MyReplaySortOrder;
}

export const EMPTY_MY_REPLAY_FILTERS: MyReplayFilters = {
  gameDateRange: null,
  lastModifiedRange: null,
  platforms: [],
  rowTypes: [],
  contexts: [],
  rulesets: [],
};

export const DEFAULT_MY_REPLAY_SORT: MyReplaySort = {
  field: "gameDate",
  order: "descend",
};

function isInRange(
  value: number | null,
  range: [number, number] | null
): boolean {
  if (!range) {
    return true;
  }
  return value !== null && value >= range[0] && value <= range[1];
}

function compareNullable(
  left: number | null,
  right: number | null,
  order: MyReplaySortOrder
): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return order === "ascend" ? left - right : right - left;
}

export function filterAndSortMyReplayGroups(
  groups: MyReplayGroup[],
  filters: MyReplayFilters,
  sort: MyReplaySort
): MyReplayGroup[] {
  const wantsReplay =
    filters.rowTypes.length === 0 || filters.rowTypes.includes("replay");
  const wantsReview =
    filters.rowTypes.length === 0 || filters.rowTypes.includes("review");

  const filtered = groups.flatMap((group) => {
    if (
      !isInRange(group.gameDate, filters.gameDateRange) ||
      (filters.platforms.length > 0 &&
        !filters.platforms.includes(group.source)) ||
      (filters.contexts.length > 0 &&
        !filters.contexts.includes(group.context.kind)) ||
      (filters.rulesets.length > 0 &&
        !filters.rulesets.includes(group.ruleset.id))
    ) {
      return [];
    }

    const matchingReviews = group.reviews.filter((review) =>
      isInRange(review.lastModified, filters.lastModifiedRange)
    );
    if (filters.lastModifiedRange && matchingReviews.length === 0) {
      return [];
    }
    if (!wantsReplay && (!wantsReview || matchingReviews.length === 0)) {
      return [];
    }

    const visibleReviews = wantsReview ? matchingReviews : [];
    const reviewOrder = sort.field === "lastModified" ? sort.order : "descend";
    visibleReviews.sort(
      (left, right) =>
        compareNullable(left.lastModified, right.lastModified, reviewOrder) ||
        left.shortId.localeCompare(right.shortId)
    );
    return [
      {
        ...group,
        commentCount: visibleReviews.reduce(
          (total, review) => total + review.commentCount,
          0
        ),
        reviews: visibleReviews,
      },
    ];
  });

  return filtered.sort((left, right) => {
    const leftValue =
      sort.field === "gameDate"
        ? left.gameDate
        : left.reviews.reduce<number | null>(
            (latest, review) =>
              latest === null ||
              (review.lastModified !== null && review.lastModified > latest)
                ? review.lastModified
                : latest,
            null
          );
    const rightValue =
      sort.field === "gameDate"
        ? right.gameDate
        : right.reviews.reduce<number | null>(
            (latest, review) =>
              latest === null ||
              (review.lastModified !== null && review.lastModified > latest)
                ? review.lastModified
                : latest,
            null
          );
    return (
      compareNullable(leftValue, rightValue, sort.order) ||
      left.key.localeCompare(right.key)
    );
  });
}

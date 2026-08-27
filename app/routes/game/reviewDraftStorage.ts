import type { ReplaySource } from "~/game/replay/types";
import type {
  SerializedReview,
  SerializedReviewEdit,
} from "~/types/replayReview";

export const REVIEW_DRAFT_STORAGE_PREFIX = "kandora.replayReview.draft.v1:";
export const REVIEW_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const SNAPSHOT_VERSION = 1;
const MAX_TEXT_LENGTH = 256 * 1024;
const MAX_DRAWING_BASE64_LENGTH = 128 * 1024;

export interface ReviewDraftIdentity {
  userId: string;
  source: ReplaySource;
  sourceGameId: string;
  reviewShortId: string | null;
}

export interface StoredReviewPatch {
  text: string;
  drawingBase64: string | null;
}

export interface StoredPendingReviewEdit {
  eventIndex: number;
  patch: StoredReviewPatch | null;
  baseUpdatedAt: string | null;
}

export interface StoredActiveReviewDraft {
  eventIndex: number;
  mode: "text" | "pen";
  text?: string;
  drawingBase64?: string | null;
  baseUpdatedAt: string | null;
}

export interface ReviewDraftSnapshot {
  version: 1;
  identity: ReviewDraftIdentity;
  seat: number | null;
  updatedAt: number;
  pending: StoredPendingReviewEdit[];
  active: StoredActiveReviewDraft | null;
}

export interface ReviewDraftReconciliation {
  pending: StoredPendingReviewEdit[];
  active: StoredActiveReviewDraft | null;
  conflictEventIndices: number[];
  alreadyAppliedEventIndices: number[];
  invalidEventIndices: number[];
  seatConflict: boolean;
}

export interface ReviewDraftStorageLike {
  readonly length?: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key?(index: number): string | null;
}

export type ReviewDraftWriteResult = "written" | "removed" | "unavailable";

function browserStorage(): ReviewDraftStorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReplaySource(value: unknown): value is ReplaySource {
  return (
    value === "ingame" ||
    value === "majsoul" ||
    value === "tenhou" ||
    value === "riichicity"
  );
}

function isSeat(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 3)
  );
}

function isEventIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      Number.isFinite(Date.parse(value)))
  );
}

function parseIdentity(value: unknown): ReviewDraftIdentity | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.userId !== "string" ||
    value.userId.length === 0 ||
    !isReplaySource(value.source) ||
    typeof value.sourceGameId !== "string" ||
    value.sourceGameId.length === 0 ||
    !(
      value.reviewShortId === null ||
      (typeof value.reviewShortId === "string" &&
        value.reviewShortId.length > 0)
    )
  ) {
    return null;
  }
  return {
    userId: value.userId,
    source: value.source,
    sourceGameId: value.sourceGameId,
    reviewShortId: value.reviewShortId,
  };
}

function parsePatch(value: unknown): StoredReviewPatch | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    value.text.length > MAX_TEXT_LENGTH ||
    !(
      value.drawingBase64 === null ||
      (typeof value.drawingBase64 === "string" &&
        value.drawingBase64.length <= MAX_DRAWING_BASE64_LENGTH)
    )
  ) {
    return undefined;
  }
  return {
    text: value.text,
    drawingBase64: value.drawingBase64,
  };
}

function parsePending(value: unknown): StoredPendingReviewEdit[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: StoredPendingReviewEdit[] = [];
  const eventIndices = new Set<number>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isEventIndex(item.eventIndex) ||
      !isTimestamp(item.baseUpdatedAt)
    ) {
      return null;
    }
    const patch = parsePatch(item.patch);
    if (patch === undefined || eventIndices.has(item.eventIndex)) {
      return null;
    }
    eventIndices.add(item.eventIndex);
    result.push({
      eventIndex: item.eventIndex,
      patch,
      baseUpdatedAt: item.baseUpdatedAt,
    });
  }
  return result;
}

function parseActive(value: unknown): StoredActiveReviewDraft | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !isEventIndex(value.eventIndex) ||
    (value.mode !== "text" && value.mode !== "pen") ||
    !isTimestamp(value.baseUpdatedAt)
  ) {
    return undefined;
  }
  const hasText = Object.prototype.hasOwnProperty.call(value, "text");
  const hasDrawing = Object.prototype.hasOwnProperty.call(
    value,
    "drawingBase64"
  );
  if (!hasText && !hasDrawing) {
    return undefined;
  }
  if (
    (hasText &&
      (typeof value.text !== "string" || value.text.length > MAX_TEXT_LENGTH)) ||
    (hasDrawing &&
      !(
        value.drawingBase64 === null ||
        (typeof value.drawingBase64 === "string" &&
          value.drawingBase64.length <= MAX_DRAWING_BASE64_LENGTH)
      ))
  ) {
    return undefined;
  }
  const active: StoredActiveReviewDraft = {
    eventIndex: value.eventIndex,
    mode: value.mode,
    baseUpdatedAt: value.baseUpdatedAt,
  };
  if (hasText) {
    active.text = value.text as string;
  }
  if (hasDrawing) {
    active.drawingBase64 = value.drawingBase64 as string | null;
  }
  return active;
}

function sameIdentity(
  left: ReviewDraftIdentity,
  right: ReviewDraftIdentity
): boolean {
  return (
    left.userId === right.userId &&
    left.source === right.source &&
    left.sourceGameId === right.sourceGameId &&
    left.reviewShortId === right.reviewShortId
  );
}

export function reviewDraftStorageKey(identity: ReviewDraftIdentity): string {
  const target = identity.reviewShortId
    ? `review:${identity.reviewShortId}`
    : `new:${identity.source}:${identity.sourceGameId}`;
  return `${REVIEW_DRAFT_STORAGE_PREFIX}${encodeURIComponent(
    identity.userId
  )}:${encodeURIComponent(target)}`;
}

export function parseReviewDraftSnapshot(
  raw: string,
  expectedIdentity?: ReviewDraftIdentity
): ReviewDraftSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.version !== SNAPSHOT_VERSION ||
    !isSeat(value.seat) ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < 0
  ) {
    return null;
  }
  const identity = parseIdentity(value.identity);
  const pending = parsePending(value.pending);
  const active = parseActive(value.active);
  if (
    !identity ||
    !pending ||
    active === undefined ||
    (expectedIdentity && !sameIdentity(identity, expectedIdentity))
  ) {
    return null;
  }
  return {
    version: SNAPSHOT_VERSION,
    identity,
    seat: value.seat,
    updatedAt: value.updatedAt,
    pending,
    active,
  };
}

export function hasReviewDraftWork(snapshot: ReviewDraftSnapshot): boolean {
  return snapshot.pending.length > 0 || snapshot.active !== null;
}

function removeStorageKey(
  key: string,
  storage: ReviewDraftStorageLike | null
): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function pruneExpiredReviewDrafts(
  now = Date.now(),
  storage: ReviewDraftStorageLike | null = browserStorage()
): number {
  if (!storage || typeof storage.key !== "function") {
    return 0;
  }
  const length = storage.length ?? 0;
  const keys: string[] = [];
  try {
    for (let index = 0; index < length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(REVIEW_DRAFT_STORAGE_PREFIX)) {
        keys.push(key);
      }
    }
  } catch {
    return 0;
  }
  let removed = 0;
  for (const key of keys) {
    try {
      const raw = storage.getItem(key);
      const snapshot = raw ? parseReviewDraftSnapshot(raw) : null;
      if (
        !snapshot ||
        now - snapshot.updatedAt > REVIEW_DRAFT_MAX_AGE_MS ||
        !hasReviewDraftWork(snapshot)
      ) {
        storage.removeItem(key);
        removed++;
      }
    } catch {
      // Leave inaccessible entries alone and continue pruning the rest.
    }
  }
  return removed;
}

export function readReviewDraft(
  identity: ReviewDraftIdentity,
  now = Date.now(),
  storage: ReviewDraftStorageLike | null = browserStorage()
): ReviewDraftSnapshot | null {
  if (!storage) {
    return null;
  }
  const key = reviewDraftStorageKey(identity);
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const snapshot = parseReviewDraftSnapshot(raw, identity);
    if (
      !snapshot ||
      now - snapshot.updatedAt > REVIEW_DRAFT_MAX_AGE_MS ||
      !hasReviewDraftWork(snapshot)
    ) {
      removeStorageKey(key, storage);
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function writeReviewDraft(
  snapshot: ReviewDraftSnapshot,
  storage: ReviewDraftStorageLike | null = browserStorage(),
  now = Date.now()
): ReviewDraftWriteResult {
  const key = reviewDraftStorageKey(snapshot.identity);
  if (!hasReviewDraftWork(snapshot)) {
    return removeStorageKey(key, storage) ? "removed" : "unavailable";
  }
  if (!storage) {
    return "unavailable";
  }
  const raw = JSON.stringify(snapshot);
  if (!parseReviewDraftSnapshot(raw, snapshot.identity)) {
    return "unavailable";
  }
  try {
    storage.setItem(key, raw);
    return "written";
  } catch {
    pruneExpiredReviewDrafts(now, storage);
    try {
      storage.setItem(key, raw);
      return "written";
    } catch {
      return "unavailable";
    }
  }
}

export function removeReviewDraft(
  identity: ReviewDraftIdentity,
  storage: ReviewDraftStorageLike | null = browserStorage()
): boolean {
  return removeStorageKey(reviewDraftStorageKey(identity), storage);
}

export function moveReviewDraft(
  snapshot: ReviewDraftSnapshot,
  nextIdentity: ReviewDraftIdentity,
  storage: ReviewDraftStorageLike | null = browserStorage(),
  now = Date.now()
): ReviewDraftWriteResult {
  const nextSnapshot: ReviewDraftSnapshot = {
    ...snapshot,
    identity: nextIdentity,
  };
  const result = writeReviewDraft(nextSnapshot, storage, now);
  if (result === "written" || result === "removed") {
    removeReviewDraft(snapshot.identity, storage);
  }
  return result;
}

function serverPatch(
  edit: SerializedReviewEdit | undefined
): StoredReviewPatch | null {
  if (!edit) {
    return null;
  }
  return {
    text: edit.text,
    drawingBase64: edit.drawingBase64,
  };
}

function patchesEqual(
  left: StoredReviewPatch | null,
  right: StoredReviewPatch | null
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.text === right.text && left.drawingBase64 === right.drawingBase64
  );
}

function activeMatchesServer(
  active: StoredActiveReviewDraft,
  edit: SerializedReviewEdit | undefined
): boolean {
  if (
    Object.prototype.hasOwnProperty.call(active, "text") &&
    active.text !== (edit?.text ?? "")
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(active, "drawingBase64") &&
    active.drawingBase64 !== (edit?.drawingBase64 ?? null)
  ) {
    return false;
  }
  return true;
}

function timestampOf(edit: SerializedReviewEdit | undefined): string | null {
  return edit?.updatedAt ?? null;
}

export function reconcileReviewDraft(
  snapshot: ReviewDraftSnapshot,
  review: SerializedReview | null,
  currentUserId: string,
  eventCount: number
): ReviewDraftReconciliation {
  const conflictEventIndices = new Set<number>();
  const alreadyAppliedEventIndices = new Set<number>();
  const invalidEventIndices = new Set<number>();
  const pendingStatus = new Map<
    number,
    "safe" | "already-applied" | "conflict" | "invalid"
  >();
  const pending: StoredPendingReviewEdit[] = [];
  const reviewMatchesIdentity = snapshot.identity.reviewShortId
    ? review?.shortId === snapshot.identity.reviewShortId &&
      review.source === snapshot.identity.source &&
      review.sourceGameId === snapshot.identity.sourceGameId
    : review === null;
  const seatConflict =
    reviewMatchesIdentity &&
    snapshot.seat !== null &&
    typeof review?.seat === "number" &&
    review.seat !== snapshot.seat;
  const ownEdits = new Map<number, SerializedReviewEdit>();
  if (reviewMatchesIdentity && review) {
    for (const edit of review.edits) {
      if (edit.author === currentUserId) {
        ownEdits.set(edit.eventIndex, edit);
      }
    }
  }

  for (const stored of snapshot.pending) {
    if (stored.eventIndex >= eventCount) {
      invalidEventIndices.add(stored.eventIndex);
      pendingStatus.set(stored.eventIndex, "invalid");
      continue;
    }
    if (!reviewMatchesIdentity || seatConflict) {
      conflictEventIndices.add(stored.eventIndex);
      pendingStatus.set(stored.eventIndex, "conflict");
      continue;
    }
    const serverEdit = ownEdits.get(stored.eventIndex);
    if (patchesEqual(stored.patch, serverPatch(serverEdit))) {
      alreadyAppliedEventIndices.add(stored.eventIndex);
      pendingStatus.set(stored.eventIndex, "already-applied");
      continue;
    }
    if (stored.baseUpdatedAt === timestampOf(serverEdit)) {
      pending.push(stored);
      pendingStatus.set(stored.eventIndex, "safe");
      continue;
    }
    conflictEventIndices.add(stored.eventIndex);
    pendingStatus.set(stored.eventIndex, "conflict");
  }

  let active: StoredActiveReviewDraft | null = null;
  const storedActive = snapshot.active;
  if (storedActive) {
    const eventIndex = storedActive.eventIndex;
    const serverEdit = ownEdits.get(eventIndex);
    const status = pendingStatus.get(eventIndex);
    if (eventIndex >= eventCount) {
      invalidEventIndices.add(eventIndex);
    } else if (!reviewMatchesIdentity || seatConflict || status === "conflict") {
      conflictEventIndices.add(eventIndex);
    } else if (activeMatchesServer(storedActive, serverEdit)) {
      alreadyAppliedEventIndices.add(eventIndex);
    } else if (status === "safe") {
      active = storedActive;
    } else if (
      status === "already-applied" ||
      storedActive.baseUpdatedAt === timestampOf(serverEdit)
    ) {
      active = {
        ...storedActive,
        baseUpdatedAt: timestampOf(serverEdit),
      };
    } else {
      conflictEventIndices.add(eventIndex);
    }
  }

  return {
    pending,
    active,
    conflictEventIndices: [...conflictEventIndices].sort((a, b) => a - b),
    alreadyAppliedEventIndices: [...alreadyAppliedEventIndices].sort(
      (a, b) => a - b
    ),
    invalidEventIndices: [...invalidEventIndices].sort((a, b) => a - b),
    seatConflict,
  };
}
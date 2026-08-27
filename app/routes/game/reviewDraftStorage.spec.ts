import { describe, expect, it } from "vitest";
import type { SerializedReview } from "../../types/replayReview";
import {
  REVIEW_DRAFT_MAX_AGE_MS,
  REVIEW_DRAFT_STORAGE_PREFIX,
  moveReviewDraft,
  parseReviewDraftSnapshot,
  pruneExpiredReviewDrafts,
  readReviewDraft,
  reconcileReviewDraft,
  reviewDraftStorageKey,
  writeReviewDraft,
  type ReviewDraftIdentity,
  type ReviewDraftSnapshot,
  type ReviewDraftStorageLike,
} from "./reviewDraftStorage";

function createStorage(
  entries: Array<[string, string]> = []
): ReviewDraftStorageLike & { values: Map<string, string> } {
  const values = new Map(entries);
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const identity: ReviewDraftIdentity = {
  userId: "user-1",
  source: "tenhou",
  sourceGameId: "game-1",
  reviewShortId: "Review1234",
};

function snapshot(
  overrides: Partial<ReviewDraftSnapshot> = {}
): ReviewDraftSnapshot {
  return {
    version: 1,
    identity,
    seat: 2,
    updatedAt: 1_000_000,
    pending: [
      {
        eventIndex: 4,
        patch: { text: "local", drawingBase64: null },
        baseUpdatedAt: "2026-08-20T10:00:00.000Z",
      },
    ],
    active: null,
    ...overrides,
  };
}

function review(
  text = "server",
  updatedAt = "2026-08-20T10:00:00.000Z"
): SerializedReview {
  return {
    shortId: "Review1234",
    source: "tenhou",
    sourceGameId: "game-1",
    createdBy: "user-1",
    seat: 2,
    reviewers: [{ user: "user-1", name: "Reviewer" }],
    edits: [
      {
        eventIndex: 4,
        author: "user-1",
        authorName: "Reviewer",
        colorIndex: 0,
        text,
        drawingBase64: null,
        updatedAt,
      },
    ],
  };
}

describe("review draft storage", () => {
  it("round-trips an exact identity and isolates other users", () => {
    const storage = createStorage();
    expect(writeReviewDraft(snapshot(), storage)).toBe("written");
    expect(readReviewDraft(identity, 1_000_001, storage)).toEqual(snapshot());
    expect(
      readReviewDraft({ ...identity, userId: "user-2" }, 1_000_001, storage)
    ).toBeNull();
    expect(reviewDraftStorageKey(identity)).toContain(
      REVIEW_DRAFT_STORAGE_PREFIX
    );
  });

  it("rejects corrupt, wrong-version, and mismatched snapshots", () => {
    expect(parseReviewDraftSnapshot("not-json")).toBeNull();
    expect(
      parseReviewDraftSnapshot(JSON.stringify({ ...snapshot(), version: 2 }))
    ).toBeNull();
    expect(
      parseReviewDraftSnapshot(
        JSON.stringify(snapshot()),
        { ...identity, reviewShortId: "Other12345" }
      )
    ).toBeNull();
  });

  it("expires drafts after 30 days and opportunistically prunes them", () => {
    const expired = snapshot({ updatedAt: 100 });
    const storage = createStorage([
      [reviewDraftStorageKey(identity), JSON.stringify(expired)],
    ]);
    const now = 100 + REVIEW_DRAFT_MAX_AGE_MS + 1;
    expect(readReviewDraft(identity, now, storage)).toBeNull();
    expect(storage.values.size).toBe(0);

    storage.values.set(reviewDraftStorageKey(identity), JSON.stringify(expired));
    storage.values.set("unrelated", "value");
    expect(pruneExpiredReviewDrafts(now, storage)).toBe(1);
    expect(storage.values.get("unrelated")).toBe("value");
  });

  it("removes empty drafts and reports unavailable storage", () => {
    const storage = createStorage();
    expect(writeReviewDraft(snapshot(), storage)).toBe("written");
    expect(
      writeReviewDraft(snapshot({ pending: [], active: null }), storage)
    ).toBe("removed");
    expect(storage.values.size).toBe(0);
    expect(writeReviewDraft(snapshot(), null)).toBe("unavailable");
  });

  it("retries a quota failure after pruning expired drafts", () => {
    const expiredIdentity = { ...identity, reviewShortId: "Expired123" };
    const storage = createStorage([
      [
        reviewDraftStorageKey(expiredIdentity),
        JSON.stringify(
          snapshot({ identity: expiredIdentity, updatedAt: 1 })
        ),
      ],
    ]);
    let attempts = 0;
    const originalSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      attempts++;
      if (attempts === 1) {
        throw new Error("quota");
      }
      originalSet(key, value);
    };
    expect(
      writeReviewDraft(snapshot(), storage, REVIEW_DRAFT_MAX_AGE_MS + 2)
    ).toBe("written");
    expect(attempts).toBe(2);
    expect(storage.values.has(reviewDraftStorageKey(expiredIdentity))).toBe(
      false
    );
  });

  it("moves a provisional snapshot only after writing its review key", () => {
    const storage = createStorage();
    const provisionalIdentity = { ...identity, reviewShortId: null };
    const provisional = snapshot({ identity: provisionalIdentity });
    writeReviewDraft(provisional, storage);
    expect(moveReviewDraft(provisional, identity, storage)).toBe("written");
    expect(storage.values.has(reviewDraftStorageKey(provisionalIdentity))).toBe(
      false
    );
    expect(readReviewDraft(identity, 1_000_001, storage)?.identity).toEqual(
      identity
    );
  });

  it("round-trips dirty active text and drawing fields", () => {
    const withActive = snapshot({
      active: {
        eventIndex: 8,
        mode: "pen",
        text: "unfinished",
        drawingBase64: "AQID",
        baseUpdatedAt: null,
      },
    });
    expect(
      parseReviewDraftSnapshot(JSON.stringify(withActive))?.active
    ).toEqual(withActive.active);
  });
});

describe("review draft reconciliation", () => {
  it("restores edits whose server baseline is unchanged", () => {
    const result = reconcileReviewDraft(snapshot(), review(), "user-1", 20);
    expect(result.pending).toEqual(snapshot().pending);
    expect(result.conflictEventIndices).toEqual([]);
  });

  it("drops an edit already applied by an interrupted publish", () => {
    const result = reconcileReviewDraft(
      snapshot(),
      review("local", "2026-08-20T10:01:00.000Z"),
      "user-1",
      20
    );
    expect(result.pending).toEqual([]);
    expect(result.alreadyAppliedEventIndices).toEqual([4]);
  });

  it("flags a newer same-user server edit instead of overwriting it", () => {
    const result = reconcileReviewDraft(
      snapshot(),
      review("newer", "2026-08-20T10:01:00.000Z"),
      "user-1",
      20
    );
    expect(result.pending).toEqual([]);
    expect(result.conflictEventIndices).toEqual([4]);
  });

  it("handles safe and already-applied deletions", () => {
    const deletion = snapshot({
      pending: [
        {
          eventIndex: 4,
          patch: null,
          baseUpdatedAt: "2026-08-20T10:00:00.000Z",
        },
      ],
    });
    expect(
      reconcileReviewDraft(deletion, review(), "user-1", 20).pending
    ).toHaveLength(1);
    expect(
      reconcileReviewDraft(
        deletion,
        { ...review(), edits: [] },
        "user-1",
        20
      ).alreadyAppliedEventIndices
    ).toEqual([4]);
  });

  it("rejects invalid event indices and seat conflicts", () => {
    const invalid = reconcileReviewDraft(snapshot(), review(), "user-1", 4);
    expect(invalid.invalidEventIndices).toEqual([4]);

    const wrongSeat = reconcileReviewDraft(
      snapshot(),
      { ...review(), seat: 1 },
      "user-1",
      20
    );
    expect(wrongSeat.seatConflict).toBe(true);
    expect(wrongSeat.conflictEventIndices).toEqual([4]);
  });

  it("restores an active edit layered over an already-applied pending edit", () => {
    const layered = snapshot({
      active: {
        eventIndex: 4,
        mode: "text",
        text: "still typing",
        baseUpdatedAt: "2026-08-20T10:00:00.000Z",
      },
    });
    const result = reconcileReviewDraft(
      layered,
      review("local", "2026-08-20T10:01:00.000Z"),
      "user-1",
      20
    );
    expect(result.pending).toEqual([]);
    expect(result.active).toEqual({
      ...layered.active,
      baseUpdatedAt: "2026-08-20T10:01:00.000Z",
    });
  });
});
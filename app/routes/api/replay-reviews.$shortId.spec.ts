import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  findReview: vi.fn(),
  findUser: vi.fn(),
  notifyReviewContributors: vi.fn(),
}));

vi.mock("../../utils/dbConnection.server", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));
vi.mock("../../utils/jwt.server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("../../core/models/game/ReplayReview", () => ({
  ReplayReviewModel: { findOne: mocks.findReview },
}));
vi.mock("../../core/models/shared/User", () => ({
  UserModel: { findById: mocks.findUser },
}));
vi.mock("../../services/replayReviewNotification.server", () => ({
  notifyReviewContributors: mocks.notifyReviewContributors,
}));

import { action, loader } from "./replay-reviews.$shortId";

const CREATOR_ID = "64b000000000000000000001";
const CONTRIBUTOR_ID = "64b000000000000000000002";

interface FakeEdit {
  eventIndex: number;
  author?: mongoose.Types.ObjectId;
  text?: string;
  drawing?: Buffer;
  updatedAt?: Date;
}

interface FakeReviewer {
  user: mongoose.Types.ObjectId;
  name: string;
}

function objectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}

function makeReview(options?: {
  seat?: number | null;
  edits?: FakeEdit[];
  reviewers?: FakeReviewer[];
}) {
  const review = {
    shortId: "Review1234",
    source: "tenhou",
    sourceGameId: "2026081100gm-test",
    createdBy: objectId(CREATOR_ID),
    seat: options?.seat === undefined ? 0 : options.seat,
    edits: options?.edits ?? [],
    reviewers:
      options?.reviewers ??
      [{ user: objectId(CREATOR_ID), name: "Creator" }],
    set: vi.fn((key: string, value: unknown) => {
      if (key === "seat") {
        review.seat = value as number | null;
      }
    }),
    markModified: vi.fn(),
    save: vi.fn(async () => review),
  };
  return review;
}

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/replay-reviews/Review1234", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mutate(body: Record<string, unknown>) {
  const response = await action({
    request: request(body),
    params: { shortId: "Review1234" },
  });
  return {
    response,
    data: (await response.json()) as Record<string, unknown>,
  };
}

describe("replay review collaboration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectToDatabase.mockResolvedValue(undefined);
    mocks.getAuthenticatedUser.mockResolvedValue({
      sub: CONTRIBUTOR_ID,
      username: "Contributor",
      loginMethod: "discord",
    });
    mocks.findUser.mockReturnValue({
      select: () => ({
        lean: async () => ({ name: "Creator" }),
      }),
    });
    mocks.notifyReviewContributors.mockResolvedValue(undefined);
  });

  it("lets anonymous viewers read a shared review with author metadata", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CREATOR_ID),
          text: "Creator note",
        },
      ],
    });
    mocks.findReview.mockReturnValue({ lean: async () => review });

    const response = await loader({ params: { shortId: "Review1234" } });
    const data = (await response.json()) as {
      ok: boolean;
      review: { edits: Array<Record<string, unknown>> };
    };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.review.edits[0]).toMatchObject({
      eventIndex: 10,
      author: CREATOR_ID,
      authorName: "Creator",
      colorIndex: 0,
      text: "Creator note",
    });
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("rejects anonymous mutations", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const { response, data } = await mutate({ eventIndex: 10, text: "Note" });

    expect(response.status).toBe(401);
    expect(data.error).toBe("unauthorized");
    expect(mocks.findReview).not.toHaveBeenCalled();
  });

  it("lets a second user annotate the same event independently", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CREATOR_ID),
          text: "Creator note",
        },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response, data } = await mutate({
      eventIndex: 10,
      text: "Contributor note",
      seat: 0,
      author: CREATOR_ID,
    });

    expect(response.status).toBe(200);
    expect(review.edits).toHaveLength(2);
    expect(review.edits[0].text).toBe("Creator note");
    expect(String(review.edits[1].author)).toBe(CONTRIBUTOR_ID);
    expect(review.edits[1].text).toBe("Contributor note");
    expect(data.edit).toMatchObject({
      eventIndex: 10,
      author: CONTRIBUTOR_ID,
      authorName: "Contributor",
      colorIndex: 1,
      text: "Contributor note",
    });
    expect(data.reviewers).toEqual([
      { user: CREATOR_ID, name: "Creator" },
      { user: CONTRIBUTOR_ID, name: "Contributor" },
    ]);
  });

  it("updates only the authenticated user's same-event edit", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CREATOR_ID),
          text: "Creator note",
        },
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Old contributor note",
        },
      ],
      reviewers: [
        { user: objectId(CREATOR_ID), name: "Creator" },
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response } = await mutate({
      eventIndex: 10,
      text: "Updated contributor note",
      seat: 0,
    });

    expect(response.status).toBe(200);
    expect(review.edits[0].text).toBe("Creator note");
    expect(review.edits[1].text).toBe("Updated contributor note");
  });

  it("updates when the expected timestamp matches", async () => {
    const updatedAt = new Date("2026-08-26T10:00:00.000Z");
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Original",
          updatedAt,
        },
      ],
      reviewers: [
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response } = await mutate({
      eventIndex: 10,
      text: "Recovered change",
      seat: 0,
      expectedUpdatedAt: updatedAt.toISOString(),
    });

    expect(response.status).toBe(200);
    expect(review.edits[0].text).toBe("Recovered change");
  });

  it("rejects a stale timestamp and returns the current edit", async () => {
    const updatedAt = new Date("2026-08-26T10:05:00.000Z");
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Newer server note",
          updatedAt,
        },
      ],
      reviewers: [
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response, data } = await mutate({
      eventIndex: 10,
      text: "Recovered stale note",
      seat: 0,
      expectedUpdatedAt: "2026-08-26T10:00:00.000Z",
    });

    expect(response.status).toBe(409);
    expect(data.error).toBe("edit-conflict");
    expect(data.edit).toMatchObject({
      eventIndex: 10,
      text: "Newer server note",
      updatedAt: updatedAt.toISOString(),
    });
    expect(review.edits[0].text).toBe("Newer server note");
    expect(review.save).not.toHaveBeenCalled();
  });

  it("treats an exact stale retry as already applied", async () => {
    const updatedAt = new Date("2026-08-26T10:05:00.000Z");
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Recovered note",
          updatedAt,
        },
      ],
      reviewers: [
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response, data } = await mutate({
      eventIndex: 10,
      text: "Recovered note",
      seat: 0,
      expectedUpdatedAt: "2026-08-26T10:00:00.000Z",
    });

    expect(response.status).toBe(200);
    expect(data.edit).toMatchObject({ text: "Recovered note" });
    expect(review.save).not.toHaveBeenCalled();
  });

  it("removes text without removing the authenticated user's drawing", async () => {
    const drawing = Buffer.from([1, 2, 3]);
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Contributor note",
          drawing,
        },
      ],
      reviewers: [
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response } = await mutate({
      eventIndex: 10,
      text: "",
      seat: 0,
    });

    expect(response.status).toBe(200);
    expect(review.edits).toHaveLength(1);
    expect(review.edits[0].text).toBe("");
    expect(review.edits[0].drawing).toEqual(drawing);
  });

  it("removes a drawing without removing the authenticated user's text", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Contributor note",
          drawing: Buffer.from([1, 2, 3]),
        },
      ],
      reviewers: [
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response } = await mutate({
      eventIndex: 10,
      drawingBase64: null,
      seat: 0,
    });

    expect(response.status).toBe(200);
    expect(review.edits).toHaveLength(1);
    expect(review.edits[0].text).toBe("Contributor note");
    expect(review.edits[0].drawing).toBeUndefined();
  });

  it("notifies contributors once when the final publish request changes an annotation", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CREATOR_ID),
          text: "Creator note",
        },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response } = await mutate({
      eventIndex: 12,
      text: "Contributor note",
      seat: 0,
      notifyReviewers: true,
      notificationEventIndex: 12,
    });

    expect(response.status).toBe(200);
    expect(mocks.notifyReviewContributors).toHaveBeenCalledTimes(1);
    expect(mocks.notifyReviewContributors).toHaveBeenCalledWith({
      review,
      publisherId: CONTRIBUTOR_ID,
      publisherName: "Contributor",
      eventIndex: 12,
    });
  });

  it("notifies contributors for a drawing-only annotation", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CREATOR_ID),
          text: "Creator note",
        },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response } = await mutate({
      eventIndex: 12,
      drawingBase64: "AQID",
      seat: 0,
      notifyReviewers: true,
      notificationEventIndex: 12,
    });

    expect(response.status).toBe(200);
    expect(review.edits[1].drawing).toEqual(Buffer.from([1, 2, 3]));
    expect(mocks.notifyReviewContributors).toHaveBeenCalledOnce();
  });

  it("does not notify when a marked request repeats identical content", async () => {
    const updatedAt = new Date("2026-08-26T10:00:00.000Z");
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Unchanged note",
          updatedAt,
        },
      ],
      reviewers: [
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response } = await mutate({
      eventIndex: 10,
      text: "Unchanged note",
      seat: 0,
      notifyReviewers: true,
      notificationEventIndex: 10,
    });

    expect(response.status).toBe(200);
    expect(review.edits[0].updatedAt).toBe(updatedAt);
    expect(mocks.notifyReviewContributors).not.toHaveBeenCalled();
  });

  it("does not notify for an unmarked deletion-only publish", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Contributor note",
        },
      ],
      reviewers: [
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response } = await mutate({
      eventIndex: 10,
      delete: true,
    });

    expect(response.status).toBe(200);
    expect(mocks.notifyReviewContributors).not.toHaveBeenCalled();
  });

  it("lets a changed final deletion complete a mixed publish notification", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CREATOR_ID),
          text: "Creator note",
        },
        {
          eventIndex: 12,
          author: objectId(CONTRIBUTOR_ID),
          text: "Contributor note",
        },
      ],
      reviewers: [
        { user: objectId(CREATOR_ID), name: "Creator" },
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response } = await mutate({
      eventIndex: 12,
      delete: true,
      notifyReviewers: true,
      notificationEventIndex: 14,
    });

    expect(response.status).toBe(200);
    expect(mocks.notifyReviewContributors).toHaveBeenCalledWith({
      review,
      publisherId: CONTRIBUTOR_ID,
      publisherName: "Contributor",
      eventIndex: 14,
    });
  });

  it("deletes only the authenticated user's edit and retains the seat", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CREATOR_ID),
          text: "Creator note",
        },
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Contributor note",
        },
      ],
      reviewers: [
        { user: objectId(CREATOR_ID), name: "Creator" },
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response, data } = await mutate({
      eventIndex: 10,
      delete: true,
    });

    expect(response.status).toBe(200);
    expect(review.edits).toHaveLength(1);
    expect(String(review.edits[0].author)).toBe(CREATOR_ID);
    expect(review.seat).toBe(0);
    expect(data.seat).toBe(0);
  });

  it("clears the seat after deleting the review's final edit", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Contributor note",
        },
      ],
      reviewers: [
        { user: objectId(CREATOR_ID), name: "Creator" },
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response, data } = await mutate({
      eventIndex: 10,
      delete: true,
    });

    expect(response.status).toBe(200);
    expect(review.edits).toHaveLength(0);
    expect(review.seat).toBeNull();
    expect(data.seat).toBeNull();
  });

  it("rejects a stale deletion without removing the newer edit", async () => {
    const review = makeReview({
      edits: [
        {
          eventIndex: 10,
          author: objectId(CONTRIBUTOR_ID),
          text: "Newer server note",
          updatedAt: new Date("2026-08-26T10:05:00.000Z"),
        },
      ],
      reviewers: [
        { user: objectId(CONTRIBUTOR_ID), name: "Contributor" },
      ],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response, data } = await mutate({
      eventIndex: 10,
      delete: true,
      expectedUpdatedAt: "2026-08-26T10:00:00.000Z",
    });

    expect(response.status).toBe(409);
    expect(data.error).toBe("edit-conflict");
    expect(review.edits).toHaveLength(1);
    expect(review.save).not.toHaveBeenCalled();
  });

  it("rejects contributions from a different player perspective", async () => {
    const review = makeReview();
    mocks.findReview.mockResolvedValue(review);

    const { response, data } = await mutate({
      eventIndex: 10,
      text: "Wrong seat",
      seat: 1,
    });

    expect(response.status).toBe(409);
    expect(data.error).toBe("seat-locked");
    expect(review.edits).toHaveLength(0);
  });

  it("treats legacy authorless edits as creator-owned and stamps them on write", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      sub: CREATOR_ID,
      username: "Creator",
      loginMethod: "discord",
    });
    const review = makeReview({
      edits: [{ eventIndex: 10, text: "Legacy note" }],
      reviewers: [],
    });
    mocks.findReview.mockResolvedValue(review);

    const { response, data } = await mutate({
      eventIndex: 10,
      text: "Migrated note",
      seat: 0,
    });

    expect(response.status).toBe(200);
    expect(String(review.edits[0].author)).toBe(CREATOR_ID);
    expect(review.edits[0].text).toBe("Migrated note");
    expect(data.edit).toMatchObject({
      author: CREATOR_ID,
      authorName: "Creator",
      colorIndex: 0,
    });
  });
});
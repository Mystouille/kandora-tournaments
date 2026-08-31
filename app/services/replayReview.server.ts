import { UserModel } from "~/core/models/shared/User";
import { bytesToBase64 } from "~/game/replay/reviewDrawing";
import type { ReplaySource } from "~/game/replay/types";
import type {
  SerializedReview,
  SerializedReviewEdit,
  SerializedReviewer,
} from "~/types/replayReview";

interface ReviewEditLike {
  eventIndex: number;
  author?: unknown;
  text?: string;
  drawing?: unknown;
  updatedAt?: Date | string;
}

interface ReviewDocumentLike {
  shortId: string;
  source: string;
  sourceGameId: string;
  createdBy: unknown;
  seat?: number | null;
  target?: { user?: unknown; name?: string } | null;
  reviewers?: Array<{ user: unknown; name?: string }>;
  edits?: ReviewEditLike[];
}

export function effectiveReviewAuthor(
  edit: Pick<ReviewEditLike, "author">,
  createdBy: unknown
): string {
  return edit.author === undefined || edit.author === null
    ? String(createdBy)
    : String(edit.author);
}

function unwrapDrawing(raw: unknown): Uint8Array | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "object" && raw !== null && "buffer" in raw) {
    const inner = (raw as { buffer: unknown }).buffer;
    if (inner instanceof Uint8Array) {
      return new Uint8Array(inner.buffer, inner.byteOffset, inner.byteLength);
    }
  }
  if (raw instanceof Uint8Array) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
}

async function resolveUserName(userId: string): Promise<string> {
  try {
    const user = await UserModel.findById(userId).select("name").lean();
    return (user as { name?: string } | null)?.name ?? "";
  } catch {
    return "";
  }
}

export async function resolveReviewersForDoc(
  doc: Pick<ReviewDocumentLike, "createdBy" | "reviewers" | "edits">
): Promise<SerializedReviewer[]> {
  const reviewers: SerializedReviewer[] = [];
  const seen = new Set<string>();

  for (const reviewer of doc.reviewers ?? []) {
    const user = String(reviewer.user);
    if (!seen.has(user)) {
      reviewers.push({ user, name: reviewer.name ?? "" });
      seen.add(user);
    }
  }

  for (const edit of doc.edits ?? []) {
    const user = effectiveReviewAuthor(edit, doc.createdBy);
    if (!seen.has(user)) {
      reviewers.push({ user, name: await resolveUserName(user) });
      seen.add(user);
    }
  }

  return reviewers;
}

export function serializeReviewEdit(
  edit: ReviewEditLike,
  createdBy: unknown,
  reviewers: SerializedReviewer[]
): SerializedReviewEdit {
  const author = effectiveReviewAuthor(edit, createdBy);
  const reviewerIndex = reviewers.findIndex(
    (reviewer) => reviewer.user === author
  );
  const colorIndex = Math.max(0, reviewerIndex);
  const bytes = unwrapDrawing(edit.drawing);
  const updatedAt = edit.updatedAt
    ? new Date(edit.updatedAt).toISOString()
    : new Date().toISOString();

  return {
    eventIndex: edit.eventIndex,
    author,
    authorName: reviewers[colorIndex]?.name ?? "",
    colorIndex,
    text: edit.text ?? "",
    drawingBase64: bytes && bytes.length > 0 ? bytesToBase64(bytes) : null,
    updatedAt,
  };
}

export function serializeReview(
  doc: ReviewDocumentLike,
  reviewers: SerializedReviewer[]
): SerializedReview {
  return {
    shortId: doc.shortId,
    source: doc.source as ReplaySource,
    sourceGameId: doc.sourceGameId,
    createdBy: String(doc.createdBy),
    seat: typeof doc.seat === "number" ? doc.seat : null,
    ...(doc.target?.name
      ? {
          target: {
            name: doc.target.name,
          },
        }
      : {}),
    reviewers,
    edits: (doc.edits ?? []).map((edit) =>
      serializeReviewEdit(edit, doc.createdBy, reviewers)
    ),
  };
}

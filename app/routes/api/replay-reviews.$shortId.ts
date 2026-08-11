import mongoose from "mongoose";
import { connectToDatabase } from "../../utils/dbConnection.server";
import { getAuthenticatedUser } from "../../utils/jwt.server";
import { ReplayReviewModel } from "../../db/models/ReplayReview";
import { base64ToBytes } from "../../game/replay/reviewDrawing";
import {
  effectiveReviewAuthor,
  resolveReviewersForDoc,
  serializeReview,
  serializeReviewEdit,
} from "../../services/replayReview.server";
import type { SerializedReviewer } from "../../types/replayReview";

/**
 * `GET /api/replay-reviews/:shortId` — fetch a review by its public
 * handle. No auth required; anyone with the link can read.
 *
 * `PUT /api/replay-reviews/:shortId` — upsert or delete the authenticated
 * user's edit at a given `eventIndex`. Any signed-in user with the review link
 * may contribute; authors can modify only their own annotations.
 *
 * Body shapes:
 *   - `{ eventIndex, text?, drawingBase64? }` — upsert the edit.
 *     Pass an empty `text` and omit `drawingBase64` to clear text;
 *     pass `drawingBase64: null` to clear the drawing; omit a field
 *     to leave it unchanged.
 *   - `{ eventIndex, delete: true }` — drop the entire edit row.
 */

export async function loader({ params }: { params: { shortId?: string } }) {
  const shortId = params.shortId;
  if (!shortId) {
    return Response.json({ ok: false, error: "missing-id" }, { status: 400 });
  }
  await connectToDatabase();
  const doc = await ReplayReviewModel.findOne({ shortId }).lean();
  if (!doc) {
    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  const reviewers = await resolveReviewersForDoc(doc);
  return Response.json({
    ok: true,
    review: serializeReview(doc, reviewers),
  });
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { shortId?: string };
}) {
  const shortId = params.shortId;
  if (!shortId) {
    return Response.json({ ok: false, error: "missing-id" }, { status: 400 });
  }
  if (request.method !== "PUT" && request.method !== "POST") {
    return Response.json(
      { ok: false, error: "method-not-allowed" },
      { status: 405 }
    );
  }
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: {
    eventIndex?: number;
    text?: string;
    drawingBase64?: string | null;
    delete?: boolean;
    seat?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  const eventIndex = body.eventIndex;
  if (typeof eventIndex !== "number" || eventIndex < 0) {
    return Response.json(
      { ok: false, error: "bad-event-index" },
      { status: 400 }
    );
  }
  await connectToDatabase();
  const doc = await ReplayReviewModel.findOne({ shortId });
  if (!doc) {
    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }

  const authorId = String(jwtPayload.sub);
  const authorObjectId = new mongoose.Types.ObjectId(authorId);
  const createdBy = String(doc.createdBy);
  const existingReviewers = await resolveReviewersForDoc(doc);
  const existingIdx = doc.edits.findIndex(
    (edit: { eventIndex: number; author?: unknown }) =>
      edit.eventIndex === eventIndex &&
      effectiveReviewAuthor(edit, createdBy) === authorId
  );

  // Bind the review to a single seat. The seat is locked the
  // first time any edit lands on the document; subsequent PUTs
  // that try to change it are rejected so the review stays
  // coherent ("this is a review of seat X's play").
  const docSeat =
    typeof (doc as unknown as { seat?: number | null }).seat === "number"
      ? (doc as unknown as { seat: number }).seat
      : null;
  const requestedSeat =
    typeof body.seat === "number" &&
    body.seat >= 0 &&
    body.seat <= 3 &&
    Number.isInteger(body.seat)
      ? body.seat
      : null;

  const setSeat = (seat: number | null): void => {
    doc.set("seat", seat);
    doc.markModified("seat");
  };

  const responseReviewers = async (): Promise<SerializedReviewer[]> =>
    resolveReviewersForDoc(doc);

  if (body.delete) {
    if (existingIdx >= 0) {
      doc.edits.splice(existingIdx, 1);
      if (doc.edits.length === 0) {
        setSeat(null);
      }
      await doc.save();
    }
    return Response.json({
      ok: true,
      seat: doc.edits.length === 0 ? null : docSeat,
      edit: null,
      reviewers: await responseReviewers(),
    });
  }

  if (
    docSeat !== null &&
    requestedSeat !== null &&
    requestedSeat !== docSeat
  ) {
    return Response.json(
      { ok: false, error: "seat-locked", seat: docSeat },
      { status: 409 }
    );
  }

  // Sanity-cap text length to prevent abuse; ~2 KB is plenty for a
  // single-event annotation.
  const text =
    typeof body.text === "string" ? body.text.slice(0, 2048) : undefined;

  let drawingBuffer: Buffer | undefined | null;
  if (body.drawingBase64 === null) {
    drawingBuffer = null;
  } else if (typeof body.drawingBase64 === "string") {
    if (body.drawingBase64.length === 0) {
      drawingBuffer = null;
    } else {
      try {
        const bytes = base64ToBytes(body.drawingBase64);
        // Cap drawing blob at 64 KB — far more than the codec ever
        // produces for a single event.
        if (bytes.length > 64 * 1024) {
          return Response.json(
            { ok: false, error: "drawing-too-large" },
            { status: 413 }
          );
        }
        drawingBuffer = Buffer.from(bytes);
      } catch {
        return Response.json(
          { ok: false, error: "bad-drawing" },
          { status: 400 }
        );
      }
    }
  }

  let contributed = false;
  if (existingIdx >= 0) {
    const edit = doc.edits[existingIdx];
    if (edit.author === undefined || edit.author === null) {
      edit.author = authorObjectId;
    }
    if (text !== undefined) {
      edit.text = text;
    }
    if (drawingBuffer !== undefined) {
      edit.drawing = drawingBuffer ?? undefined;
    }
    edit.updatedAt = new Date();
    // If both fields are empty, drop the edit entirely.
    const isEmpty =
      (edit.text ?? "").length === 0 &&
      (!edit.drawing || edit.drawing.length === 0);
    if (isEmpty) {
      doc.edits.splice(existingIdx, 1);
    } else {
      contributed = true;
    }
  } else {
    const hasText = typeof text === "string" && text.length > 0;
    const hasDrawing = !!drawingBuffer && drawingBuffer.length > 0;
    if (!hasText && !hasDrawing) {
      return Response.json({
        ok: true,
        seat: docSeat,
        edit: null,
        reviewers: existingReviewers,
      });
    }
    // First edit lands → lock the seat to the requested one if
    // we don't already have one. Reject when the caller asks for
    // a seat that conflicts with the locked one.
    if (docSeat === null) {
      if (requestedSeat === null) {
        return Response.json(
          { ok: false, error: "missing-seat" },
          { status: 400 }
        );
      }
      setSeat(requestedSeat);
    }
    doc.edits.push({
      eventIndex,
      author: authorObjectId,
      text: text ?? "",
      drawing: drawingBuffer ?? undefined,
      updatedAt: new Date(),
    });
    contributed = true;
  }

  if (doc.edits.length === 0) {
    setSeat(null);
  }

  if (contributed) {
    const persistedReviewerIds = new Set(
      doc.reviewers.map((reviewer: { user: unknown }) => String(reviewer.user))
    );
    const desiredReviewers = existingReviewers.some(
      (reviewer) => reviewer.user === authorId
    )
      ? existingReviewers
      : [
          ...existingReviewers,
          { user: authorId, name: jwtPayload.username ?? "" },
        ];
    for (const reviewer of desiredReviewers) {
      if (!persistedReviewerIds.has(reviewer.user)) {
        doc.reviewers.push({
          user: new mongoose.Types.ObjectId(reviewer.user),
          name: reviewer.name,
        });
        persistedReviewerIds.add(reviewer.user);
      }
    }
  }

  await doc.save();

  const reviewers = await responseReviewers();
  const stored = doc.edits.find(
    (edit: { eventIndex: number; author?: unknown }) =>
      edit.eventIndex === eventIndex &&
      effectiveReviewAuthor(edit, createdBy) === authorId
  );
  const finalSeat =
    typeof (doc as unknown as { seat?: number | null }).seat === "number"
      ? (doc as unknown as { seat: number }).seat
      : null;
  return Response.json({
    ok: true,
    seat: finalSeat,
    edit: stored
      ? serializeReviewEdit(stored, doc.createdBy, reviewers)
      : null,
    reviewers,
  });
}

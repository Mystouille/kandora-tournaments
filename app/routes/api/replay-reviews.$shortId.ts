import { connectToDatabase } from "../../utils/dbConnection.server";
import { getAuthenticatedUser } from "../../utils/jwt.server";
import { ReplayReviewModel } from "../../db/models/ReplayReview";
import { base64ToBytes, bytesToBase64 } from "../../game/replay/reviewDrawing";

/**
 * `GET /api/replay-reviews/:shortId` — fetch a review by its public
 * handle. No auth required; anyone with the link can read.
 *
 * `PUT /api/replay-reviews/:shortId` — upsert / delete the edit at
 * a given `eventIndex`. Owner-only (`createdBy === current user`).
 *
 * Body shapes:
 *   - `{ eventIndex, text?, drawingBase64? }` — upsert the edit.
 *     Pass an empty `text` and omit `drawingBase64` to clear text;
 *     pass `drawingBase64: null` to clear the drawing; omit a field
 *     to leave it unchanged.
 *   - `{ eventIndex, delete: true }` — drop the entire edit row.
 */

interface SerializedEdit {
  eventIndex: number;
  text: string;
  drawingBase64: string | null;
  updatedAt: string;
}

/**
 * Mongoose `.lean()` returns BSON `Binary` for `Buffer` schema
 * fields, not Node `Buffer`. `new Uint8Array(binary)` yields an
 * empty array because `Binary` isn't an `ArrayLike<number>`. Reach
 * into `.buffer` first.
 */
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

function serializeEdit(edit: {
  eventIndex: number;
  text?: string;
  drawing?: Buffer | null;
  updatedAt?: Date;
}): SerializedEdit {
  const bytes = unwrapDrawing(edit.drawing);
  const drawingBase64: string | null =
    bytes && bytes.length > 0 ? bytesToBase64(bytes) : null;
  return {
    eventIndex: edit.eventIndex,
    text: edit.text ?? "",
    drawingBase64,
    updatedAt: (edit.updatedAt ?? new Date()).toISOString(),
  };
}

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
  return Response.json({
    ok: true,
    review: {
      shortId: doc.shortId,
      source: doc.source,
      sourceGameId: doc.sourceGameId,
      createdBy: String(doc.createdBy),
      seat:
        typeof (doc as { seat?: unknown }).seat === "number"
          ? (doc as { seat: number }).seat
          : null,
      edits: (doc.edits ?? []).map(serializeEdit),
    },
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
  if (String(doc.createdBy) !== String(jwtPayload.sub)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const existingIdx = doc.edits.findIndex(
    (e: { eventIndex: number }) => e.eventIndex === eventIndex
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

  if (body.delete) {
    if (existingIdx >= 0) {
      doc.edits.splice(existingIdx, 1);
      // Clearing the last edit also clears the locked seat so
      // the author can re-target the review at a different seat
      // afterwards.
      if (doc.edits.length === 0) {
        (doc as unknown as { set: (k: string, v: unknown) => void }).set(
          "seat",
          null
        );
      }
      await doc.save();
    }
    return Response.json({ ok: true, seat: docSeat });
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

  if (existingIdx >= 0) {
    const edit = doc.edits[existingIdx];
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
    }
  } else {
    const hasText = typeof text === "string" && text.length > 0;
    const hasDrawing = !!drawingBuffer && drawingBuffer.length > 0;
    if (!hasText && !hasDrawing) {
      return Response.json({ ok: true, seat: docSeat });
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
      // Use `doc.set(...)` instead of direct assignment so we
      // survive a stale Mongoose model cache: in dev, HMR can
      // keep a previously-registered schema in `mongoose.models`
      // that doesn't know about new fields, in which case plain
      // property assignment silently no-ops. `set` goes through
      // the schema's strict-mode check and `markModified` makes
      // sure the field is flushed regardless.
      (doc as unknown as { set: (k: string, v: unknown) => void }).set(
        "seat",
        requestedSeat
      );
      (doc as unknown as { markModified: (k: string) => void }).markModified(
        "seat"
      );
    } else if (requestedSeat !== null && requestedSeat !== docSeat) {
      return Response.json(
        { ok: false, error: "seat-locked", seat: docSeat },
        { status: 409 }
      );
    }
    doc.edits.push({
      eventIndex,
      text: text ?? "",
      drawing: drawingBuffer ?? undefined,
      updatedAt: new Date(),
    });
  }
  // If the last edit was just removed (empty upsert above), drop
  // the locked seat too so the review can be re-targeted.
  if (doc.edits.length === 0) {
    (doc as unknown as { set: (k: string, v: unknown) => void }).set(
      "seat",
      null
    );
  }
  await doc.save();

  const stored = doc.edits.find(
    (e: { eventIndex: number }) => e.eventIndex === eventIndex
  );
  const finalSeat =
    typeof (doc as unknown as { seat?: number | null }).seat === "number"
      ? (doc as unknown as { seat: number }).seat
      : null;
  return Response.json({
    ok: true,
    seat: finalSeat,
    edit: stored ? serializeEdit(stored) : null,
  });
}

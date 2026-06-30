import { connectToDatabase } from "../../utils/dbConnection.server";
import { getAuthenticatedUser } from "../../utils/jwt.server";
import { ReplayReviewModel } from "../../db/models/ReplayReview";
import { inferReplaySource } from "../../game/replay/inferSource";
import { customAlphabet } from "nanoid";
import type { ReplaySource } from "../../game/replay/types";

const SHORT_ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SHORT_ID_LENGTH = 10;
const generateShortId = customAlphabet(SHORT_ID_ALPHABET, SHORT_ID_LENGTH);

/**
 * `POST /api/replay-reviews` — create a new review for a replay.
 *
 * Body: `{ source?: ReplaySource, sourceGameId: string }`. When
 * `source` is missing we infer it from `sourceGameId`. Returns
 * `{ ok: true, shortId }` on success; the client appends `?review=
 * <shortId>` to the replay URL to enter edit mode.
 *
 * Logged-in users only. There is no per-user uniqueness on
 * `(sourceGameId, createdBy)` — a user can keep multiple separate
 * reviews of the same game.
 */
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "method-not-allowed" },
      { status: 405 }
    );
  }
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { source?: string; sourceGameId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  const sourceGameId =
    typeof body.sourceGameId === "string" ? body.sourceGameId : "";
  if (!sourceGameId) {
    return Response.json({ ok: false, error: "missing-game" }, { status: 400 });
  }
  const source: ReplaySource | null =
    (body.source as ReplaySource | undefined) ??
    inferReplaySource(sourceGameId);
  if (!source) {
    return Response.json(
      { ok: false, error: "unknown-source" },
      { status: 400 }
    );
  }
  await connectToDatabase();

  // Retry a couple of times to dodge the (astronomically rare)
  // short-id collision; the unique index is the source of truth.
  for (let attempt = 0; attempt < 5; attempt++) {
    const shortId = generateShortId();
    try {
      const doc = await ReplayReviewModel.create({
        shortId,
        source,
        sourceGameId,
        createdBy: jwtPayload.sub,
        edits: [],
      });
      return Response.json({ ok: true, shortId: doc.shortId });
    } catch (err) {
      const isDup =
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: number }).code === 11000;
      if (!isDup) {
        console.error("[replay-reviews] create failed", err);
        return Response.json(
          { ok: false, error: "server-error" },
          { status: 500 }
        );
      }
    }
  }
  return Response.json({ ok: false, error: "id-collision" }, { status: 500 });
}

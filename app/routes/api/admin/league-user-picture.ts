import { LeagueUserModel } from "../../../db/LeagueUser";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";
import { connectToDatabase } from "../../../utils/dbConnection.server";
import { emitLeagueUpdated } from "../../../services/cacheInvalidation.server";
import { storePicturePair } from "../../../services/pictureStorage.server";
import type { PicturePair } from "../../../types/pictures";

const MAX_BASE64_LENGTH = 1_600_000; // ~1.2 MB decoded, applied to each image
const VALID_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/webp;base64,",
];

function validateDataUrl(value: unknown, label: string): string | null {
  if (typeof value !== "string") {
    return `${label} must be a string`;
  }
  // Already-stored URLs (e.g. re-saving migrated data) are passed through.
  if (value.startsWith("/")) {
    return null;
  }
  if (!VALID_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return `${label} must be a data URL with image/png, image/jpeg, or image/webp content type`;
  }
  if (value.length > MAX_BASE64_LENGTH) {
    return `${label} is too large. Maximum size is ~1.2 MB.`;
  }
  return null;
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { leagueId, userId, pictures } = body as {
    leagueId?: string;
    userId?: string;
    pictures?: PicturePair | null;
  };

  if (!leagueId) {
    return Response.json(
      { error: "Missing required field: leagueId" },
      { status: 400 }
    );
  }
  if (!userId) {
    return Response.json(
      { error: "Missing required field: userId" },
      { status: 400 }
    );
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  if (pictures !== null && pictures !== undefined) {
    if (typeof pictures !== "object") {
      return Response.json(
        { error: "pictures must be an object or null" },
        { status: 400 }
      );
    }
    const fullErr = validateDataUrl(pictures.fullPicture, "fullPicture");
    if (fullErr) {
      return Response.json({ error: fullErr }, { status: 400 });
    }
    const croppedErr = validateDataUrl(
      pictures.croppedPicture,
      "croppedPicture"
    );
    if (croppedErr) {
      return Response.json({ error: croppedErr }, { status: 400 });
    }
  }

  await connectToDatabase();

  if (pictures === null || pictures === undefined) {
    await LeagueUserModel.deleteOne({ leagueId, userId });
  } else {
    const stored = await storePicturePair(pictures);
    await LeagueUserModel.updateOne(
      { leagueId, userId },
      {
        $set: {
          pictures: {
            fullPicture: stored.fullPicture,
            croppedPicture: stored.croppedPicture,
          },
        },
      },
      { upsert: true }
    );
  }

  emitLeagueUpdated(leagueId);

  return Response.json({ success: true });
}

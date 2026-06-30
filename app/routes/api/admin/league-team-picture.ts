import { TeamModel } from "../../../db/Team";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";
import { connectToDatabase } from "../../../utils/dbConnection.server";
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
  const { teamId, pictures } = body as {
    teamId?: string;
    pictures?: PicturePair | null;
  };

  if (!teamId) {
    return Response.json(
      { error: "Missing required field: teamId" },
      { status: 400 }
    );
  }

  await connectToDatabase();

  const team = await TeamModel.findById(teamId).select("leagueId").lean();
  if (!team) {
    return Response.json({ error: "Team not found" }, { status: 404 });
  }

  const auth = await requireLeagueAdmin(
    request,
    (team as any).leagueId.toString()
  );
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

  const storedPictures =
    pictures === null || pictures === undefined
      ? null
      : await storePicturePair(pictures);

  await TeamModel.updateOne(
    { _id: teamId },
    {
      $set: {
        pictures:
          storedPictures === null
            ? null
            : {
                fullPicture: storedPictures.fullPicture,
                croppedPicture: storedPictures.croppedPicture,
              },
      },
    }
  );

  return Response.json({ success: true });
}

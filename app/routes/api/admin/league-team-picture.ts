import { z } from "zod";
import { TeamModel, type Team } from "../../../core/models/tournament/Team";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";
import { connectToDatabase } from "../../../utils/dbConnection.server";
import { storePicturePair } from "../../../services/pictureStorage.server";
import { emitLeagueUpdated } from "../../../services/cacheInvalidation.server";
import {
  DEFAULT_TEAM_PICTURE_CENTER_Y,
  type TeamPicturePair,
} from "../../../types/pictures";

const MAX_BASE64_LENGTH = 1_600_000; // ~1.2 MB decoded, applied to each image
const VALID_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/webp;base64,",
];

const teamIdentitySchema = z.object({
  teamId: z.string().regex(/^[0-9a-f]{24}$/i),
});
const centerSchema = teamIdentitySchema.extend({
  fullPicture: z.string().min(1).max(MAX_BASE64_LENGTH),
  summaryCenterY: z.number().finite().min(0).max(1),
});
const pictureSchema = teamIdentitySchema.extend({
  pictures: z
    .object({
      fullPicture: z.string(),
      croppedPicture: z.string(),
      summaryCenterY: z.number().finite().min(0).max(1).optional(),
    })
    .nullable(),
});

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
  if (request.method !== "PUT" && request.method !== "PATCH") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "PUT, PATCH" } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const identity = teamIdentitySchema.safeParse(body);
  if (!identity.success) {
    return Response.json({ error: "Invalid teamId" }, { status: 400 });
  }

  try {
    const { teamId } = identity.data;
    await connectToDatabase();
    const team = await TeamModel.findById(teamId)
      .select("leagueId pictures")
      .lean<Pick<Team, "leagueId" | "pictures"> | null>();
    if (!team) {
      return Response.json({ error: "Team not found" }, { status: 404 });
    }
    const leagueId = team.leagueId.toString();
    const auth = await requireLeagueAdmin(request, leagueId);
    if (!auth.authorized) {
      return auth.response;
    }

    if (request.method === "PATCH") {
      const parsed = centerSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json(
          { error: "Invalid picture center" },
          { status: 400 }
        );
      }
      const { fullPicture, summaryCenterY } = parsed.data;
      if (team.pictures?.fullPicture !== fullPicture) {
        return Response.json({ error: "picture_changed" }, { status: 409 });
      }
      const updated = await TeamModel.findOneAndUpdate(
        { _id: teamId, leagueId, "pictures.fullPicture": fullPicture },
        { $set: { "pictures.summaryCenterY": summaryCenterY } },
        { new: true, runValidators: true }
      )
        .select("pictures")
        .lean<Pick<Team, "pictures"> | null>();
      if (!updated) {
        return Response.json({ error: "picture_changed" }, { status: 409 });
      }
      if (
        !updated.pictures ||
        updated.pictures.summaryCenterY !== summaryCenterY
      ) {
        throw new Error("The requested team picture center was not persisted");
      }
      emitLeagueUpdated(leagueId);
      return Response.json({ success: true, pictures: updated.pictures });
    }

    const parsed = pictureSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid picture pair" }, { status: 400 });
    }
    const { pictures } = parsed.data;
    let storedPictures: TeamPicturePair | null = null;
    if (pictures) {
      const fullErr = validateDataUrl(pictures.fullPicture, "fullPicture");
      const croppedErr = validateDataUrl(
        pictures.croppedPicture,
        "croppedPicture"
      );
      if (fullErr || croppedErr) {
        return Response.json({ error: fullErr ?? croppedErr }, { status: 400 });
      }
      const stored = await storePicturePair(pictures);
      storedPictures = {
        ...stored,
        summaryCenterY:
          pictures.summaryCenterY ??
          (stored.fullPicture === team.pictures?.fullPicture
            ? (team.pictures.summaryCenterY ?? DEFAULT_TEAM_PICTURE_CENTER_Y)
            : DEFAULT_TEAM_PICTURE_CENTER_Y),
      };
    }
    const updated = await TeamModel.findOneAndUpdate(
      { _id: teamId, leagueId },
      { $set: { pictures: storedPictures } },
      { new: true, runValidators: true }
    )
      .select("pictures")
      .lean<Pick<Team, "pictures"> | null>();
    if (!updated) {
      return Response.json({ error: "Team not found" }, { status: 404 });
    }
    if (
      storedPictures &&
      (updated.pictures?.fullPicture !== storedPictures.fullPicture ||
        updated.pictures?.summaryCenterY !== storedPictures.summaryCenterY)
    ) {
      throw new Error("The requested team picture metadata was not persisted");
    }
    emitLeagueUpdated(leagueId);
    return Response.json({ success: true, pictures: updated.pictures ?? null });
  } catch (error) {
    console.error("Failed to save team picture:", error);
    return Response.json(
      { error: "Failed to save team picture" },
      { status: 500 }
    );
  }
}

import { connectToDatabase } from "../../../utils/dbConnection.server";
import { LeagueModel } from "../../../db/League";
import {
  translateHtmlField,
  translateText,
} from "../../../services/translationService.server";
import { storeSingleImage } from "../../../services/pictureStorage.server";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";

const MAX_COVER_BASE64_LENGTH = 2_000_000; // ~1.5 MB decoded

/** PUT /api/admin/league-presentation — update a league's presentation content */
export async function action({ request }: { request: Request }) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { leagueId, fr, en, summaryFr, summaryEn, coverImageUrl, translate } =
    body;

  if (!leagueId) {
    return Response.json(
      { error: "Missing required field: leagueId" },
      { status: 400 }
    );
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectToDatabase();

    const league = await LeagueModel.findById(leagueId);
    if (!league) {
      return Response.json({ error: "League not found" }, { status: 404 });
    }

    const presentation: { fr: string; en: string } = {
      fr: fr ?? league.presentation?.fr ?? "",
      en: en ?? league.presentation?.en ?? "",
    };

    const summary: { fr: string; en: string } = {
      fr: summaryFr ?? league.summary?.fr ?? "",
      en: summaryEn ?? league.summary?.en ?? "",
    };

    // If translate flag is set, translate the French content to English
    if (translate && presentation.fr) {
      try {
        presentation.en = await translateHtmlField(presentation.fr);
      } catch (error) {
        console.warn("League presentation translation failed:", error);
      }
    }

    // Summary is plain text, so translate it without HTML tag handling.
    if (translate && summary.fr) {
      try {
        summary.en = await translateText(summary.fr);
      } catch (error) {
        console.warn("League summary translation failed:", error);
      }
    }

    league.presentation = presentation;
    league.summary = summary;
    if (typeof coverImageUrl === "string") {
      const trimmedCover = coverImageUrl.trim();
      if (!trimmedCover) {
        league.coverImageUrl = "";
      } else if (trimmedCover.startsWith("data:image/")) {
        if (trimmedCover.length > MAX_COVER_BASE64_LENGTH) {
          return Response.json(
            { error: "Cover image is too large. Maximum size is ~1.5 MB." },
            { status: 400 }
          );
        }
        league.coverImageUrl = await storeSingleImage(trimmedCover);
      } else {
        // Already a stored/relative URL — keep as-is (idempotent re-save).
        league.coverImageUrl = trimmedCover;
      }
    }
    await league.save();

    return Response.json({
      success: true,
      presentation,
      summary,
      coverImageUrl: league.coverImageUrl ?? "",
    });
  } catch (error) {
    console.error("Failed to update league presentation:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

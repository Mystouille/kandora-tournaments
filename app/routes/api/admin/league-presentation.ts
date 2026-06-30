import { connectToDatabase } from "../../../utils/dbConnection.server";
import { LeagueModel } from "../../../db/League";
import { translateHtmlField } from "../../../services/translationService.server";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";

/** PUT /api/admin/league-presentation — update a league's presentation content */
export async function action({ request }: { request: Request }) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { leagueId, fr, en, translate } = body;

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

    // If translate flag is set, translate the French content to English
    if (translate && presentation.fr) {
      try {
        presentation.en = await translateHtmlField(presentation.fr);
      } catch (error) {
        console.warn("League presentation translation failed:", error);
      }
    }

    league.presentation = presentation;
    await league.save();

    return Response.json({ success: true, presentation });
  } catch (error) {
    console.error("Failed to update league presentation:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

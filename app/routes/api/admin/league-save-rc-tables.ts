import { requireLeagueAdmin } from "../../../utils/league-permissions.server";
import { connectToDatabase } from "../../../utils/dbConnection.server";
import { saveAllRiichiCityTablesForLeague } from "../../../services/saveRiichiCityTables.server";

/**
 * POST /api/admin/league-save-rc-tables
 *
 * Failsafe: pre-save Riichi City table pairings for every remaining round
 * of every stage whose participants are fully resolved. Used when admins
 * suspect the Discord bot may not be able to schedule rounds in time.
 */
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => ({}));
  const { leagueId } = body as { leagueId?: string };

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
    const result = await saveAllRiichiCityTablesForLeague(leagueId);
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("Failed to save Riichi City tables:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

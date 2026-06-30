import { connectToDatabase } from "../../../utils/dbConnection.server";
import { TeamModel } from "../../../db/Team";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";

interface FinalsRosterEntry {
  teamId: string;
  captain: string;
  members: string[];
  substitutes: string[];
}

/** PUT /api/admin/league-finals-roster — update finals rosters for all teams in a league */
export async function action({ request }: { request: Request }) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { leagueId, teams } = body as {
    leagueId: string;
    teams: FinalsRosterEntry[];
  };

  if (!leagueId) {
    return Response.json(
      { error: "Missing required field: leagueId" },
      { status: 400 }
    );
  }

  if (!Array.isArray(teams)) {
    return Response.json(
      { error: "Missing required field: teams" },
      { status: 400 }
    );
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectToDatabase();

    // Verify all team IDs belong to this league
    const dbTeams = await TeamModel.find({ leagueId }).select("_id").lean();
    const validTeamIds = new Set(dbTeams.map((t) => t._id.toString()));

    for (const entry of teams) {
      if (!validTeamIds.has(entry.teamId)) {
        return Response.json(
          { error: `Team ${entry.teamId} does not belong to this league` },
          { status: 400 }
        );
      }
    }

    // Update each team's finalsRoster
    const ops = teams.map((entry) =>
      TeamModel.updateOne(
        { _id: entry.teamId, leagueId },
        {
          $set: {
            finalsRoster: {
              captain: entry.captain,
              members: entry.members,
              substitutes: entry.substitutes,
            },
          },
        }
      )
    );

    await Promise.all(ops);

    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to update finals rosters:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { connectToDatabase } from "../../../utils/dbConnection.server";
import { UserModel } from "../../../db/User";
import { getAuthenticatedUser } from "../../../utils/jwt.server";
import { MahjongSoulConnector } from "../../../api/majsoul/data/MajsoulConnector";

async function requireAdmin(request: Request): Promise<Response | null> {
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select("isAdmin");
  if (!user?.isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** GET /api/admin/majsoul-seasons?tournamentId=59234227 */
export async function loader({ request }: { request: Request }) {
  const forbidden = await requireAdmin(request);
  if (forbidden) {
    return forbidden;
  }

  const url = new URL(request.url);
  const tournamentId = url.searchParams.get("tournamentId");

  if (!tournamentId) {
    return Response.json(
      { error: "Missing query param: tournamentId" },
      { status: 400 }
    );
  }

  try {
    const contestApi = MahjongSoulConnector.instance.contestApi;
    const seasons = await contestApi.fetchContestSeasonList(tournamentId);

    return Response.json({
      seasons: seasons.map((s) => ({
        seasonId: s.season_id,
        startTime: s.start_time,
        endTime: s.end_time,
        remark: s.remark,
        state: s.state,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch Majsoul seasons:", error);
    return Response.json({ error: "Failed to fetch seasons" }, { status: 500 });
  }
}

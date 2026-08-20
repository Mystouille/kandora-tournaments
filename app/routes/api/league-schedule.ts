import mongoose from "mongoose";
import { getPublicLeagueSchedule } from "../../services/publicSchedule.server";
import { LeagueScheduleError } from "../../services/scheduleService.server";

export async function loader({ request }: { request: Request }) {
  const leagueId = new URL(request.url).searchParams.get("leagueId");
  if (!leagueId || !mongoose.isValidObjectId(leagueId)) {
    return Response.json({ error: "Invalid leagueId" }, { status: 400 });
  }

  try {
    return Response.json(await getPublicLeagueSchedule(leagueId));
  } catch (error) {
    if (error instanceof LeagueScheduleError) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    console.error("Failed to load public league schedule:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
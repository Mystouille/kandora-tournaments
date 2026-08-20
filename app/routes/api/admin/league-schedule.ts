import mongoose from "mongoose";
import {
  getLeagueScheduleData,
  LeagueScheduleError,
  replaceLeagueSchedule,
  type ScheduledGameInput,
} from "../../../services/scheduleService.server";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";

function errorResponse(error: unknown) {
  if (error instanceof LeagueScheduleError) {
    const status = error.code === "not-found" ? 404 : 400;
    return Response.json({ error: error.code }, { status });
  }
  console.error("Failed to manage league schedule:", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export async function loader({ request }: { request: Request }) {
  const leagueId = new URL(request.url).searchParams.get("leagueId");
  if (!leagueId || !mongoose.isValidObjectId(leagueId)) {
    return Response.json({ error: "Invalid leagueId" }, { status: 400 });
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    return Response.json(await getLeagueScheduleData(leagueId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as {
    leagueId?: string;
    games?: ScheduledGameInput[];
  };
  if (!body.leagueId || !mongoose.isValidObjectId(body.leagueId)) {
    return Response.json({ error: "Invalid leagueId" }, { status: 400 });
  }
  if (!Array.isArray(body.games)) {
    return Response.json({ error: "Invalid games" }, { status: 400 });
  }

  const auth = await requireLeagueAdmin(request, body.leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    return Response.json(
      await replaceLeagueSchedule(body.leagueId, body.games)
    );
  } catch (error) {
    return errorResponse(error);
  }
}
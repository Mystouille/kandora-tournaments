import mongoose from "mongoose";
import {
  deleteLeague,
  DeleteLeagueError,
} from "../../../services/deleteLeague.server";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  const leagueId = body?.leagueId;
  const confirmationName = body?.confirmationName;
  if (
    typeof leagueId !== "string" ||
    !mongoose.isValidObjectId(leagueId) ||
    typeof confirmationName !== "string"
  ) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const result = await deleteLeague(leagueId, confirmationName);
    return Response.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof DeleteLeagueError) {
      return Response.json(
        { error: error.code },
        { status: error.code === "not-found" ? 404 : 400 }
      );
    }

    console.error("Failed to delete tournament:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
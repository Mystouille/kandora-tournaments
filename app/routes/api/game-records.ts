import { connectToDatabase } from "../../utils/dbConnection.server";
import type { Route } from "./+types/game-records";
import { GameRecordModel } from "../../db/GameRecord";

/**
 * GET /api/game-records
 *
 * Debug endpoint – returns all game records as JSON.
 */
export async function loader(_args: Route.LoaderArgs) {
  try {
    await connectToDatabase();
    const GameRecord = GameRecordModel;

    const records = await GameRecord.find().lean();

    return Response.json(records);
  } catch (error) {
    console.error("Error fetching game records:", error);
    return Response.json(
      { error: "Failed to fetch game records" },
      { status: 500 }
    );
  }
}

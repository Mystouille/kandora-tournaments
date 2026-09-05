import type { MyReplaysApiResponse } from "~/types/myReplaysApi";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { getMyReplays } from "./myReplays.server";

export async function getMyReplaysApiResponse(
  userId: string
): Promise<MyReplaysApiResponse | null> {
  await connectToDatabase();
  const replays = await getMyReplays(userId);
  return replays === null ? null : { replays };
}

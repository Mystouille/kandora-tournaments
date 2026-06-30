import { connectToDatabase } from "~/utils/dbConnection.server";
import { getAuthenticatedUser } from "~/utils/jwt.server";
import { MahjongSoulConnector } from "~/api/majsoul/data/MajsoulConnector";
import { RiichiCityLeagueConnector } from "~/services/connectors/RiichiCityLeagueConnector.server";

/**
 * POST /api/auth/validate-identity
 * Validates and fetches information for identity linking.
 * Supports: majsoulId
 */
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const body = await request.json();
    const { type, id } = body;

    if (type === "majsoulfId") {
      if (!id || typeof id !== "string" || !id.trim()) {
        return Response.json(
          { error: "Mahjong Soul ID is required" },
          { status: 400 }
        );
      }

      if (!/^\d+$/.test(id.trim())) {
        return Response.json(
          { error: "Mahjong Soul ID must be a number" },
          { status: 400 }
        );
      }

      try {
        const msoulConnector = MahjongSoulConnector.instance;
        const { nickname, accountId } =
          await msoulConnector.getUserInfoFromFriendId(id.trim());

        if (nickname === undefined || accountId === undefined) {
          return Response.json(
            { error: "Mahjong Soul user not found" },
            { status: 404 }
          );
        }

        return Response.json({
          success: true,
          type: "majsoulfId",
          id: id.trim(),
          accountId,
          nickname,
        });
      } catch (error) {
        console.error("Mahjong Soul lookup error:", error);
        return Response.json(
          { error: "Failed to fetch Mahjong Soul user info" },
          { status: 500 }
        );
      }
    }

    if (type === "riichiCityId") {
      if (!id || typeof id !== "string" || !id.trim()) {
        return Response.json(
          { error: "Riichi City ID is required" },
          { status: 400 }
        );
      }

      if (!/^\d+$/.test(id.trim())) {
        return Response.json(
          { error: "Riichi City ID must be a number" },
          { status: 400 }
        );
      }

      try {
        const riichiCityService = RiichiCityLeagueConnector.instance.service;
        const payload = await riichiCityService.getUserBrief(Number(id.trim()));

        if (payload.code !== 0 || !payload.data?.userID) {
          return Response.json(
            { error: payload.message || "Riichi City user not found" },
            { status: 404 }
          );
        }

        return Response.json({
          success: true,
          type: "riichiCityId",
          id: String(payload.data.userID),
          accountId: String(payload.data.userID),
          nickname: payload.data.nickname || "",
        });
      } catch (error) {
        console.error("Riichi City lookup error:", error);

        const message =
          error instanceof Error ? error.message : "Unknown Riichi City error";
        if (message.includes("Missing Riichi City credentials")) {
          return Response.json(
            {
              error:
                "Riichi City lookup is not configured on the server. Please contact an admin.",
            },
            { status: 503 }
          );
        }

        return Response.json(
          {
            error: `Failed to fetch Riichi City user info: ${message}`,
          },
          { status: 500 }
        );
      }
    }

    return Response.json({ error: "Unknown identity type" }, { status: 400 });
  } catch (error) {
    console.error("Validation error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

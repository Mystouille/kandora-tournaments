import { connectToDatabase } from "../../../utils/dbConnection.server";
import { UserModel } from "../../../db/User";
import { getAuthenticatedUser } from "../../../utils/jwt.server";
import { Platform } from "../../../db/League";
import { RiichiCityLeagueConnector } from "../../../services/connectors/RiichiCityLeagueConnector.server";
import { MahjongSoulConnector } from "~/api/majsoul/data/MajsoulConnector";
import { TenhouService } from "../../../api/tenhou/TenhouService.server";

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

/** GET /api/admin/validate-tournament?platform=RIICHICITY&tournamentId=123 */
export async function loader({ request }: { request: Request }) {
  const forbidden = await requireAdmin(request);
  if (forbidden) {
    return forbidden;
  }

  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");
  const tournamentId = url.searchParams.get("tournamentId");

  if (!platform || !tournamentId) {
    return Response.json(
      { error: "Missing query params: platform, tournamentId" },
      { status: 400 }
    );
  }

  try {
    if (platform === Platform.RIICHICITY) {
      const connector = RiichiCityLeagueConnector.instance;
      const info = await connector.service.getTournamentInfo(
        Number(tournamentId)
      );
      const classifyID = info.data?.classifyID;
      if (info.code !== 0 || classifyID == null) {
        return Response.json({
          valid: false,
          error: "Tournament not found or bot has no access",
        });
      }
      if (!info.data?.isAdmin) {
        return Response.json({
          valid: false,
          error: "Bot is not a manager of this tournament",
        });
      }
      return Response.json({
        valid: true,
        internalTournamentId: classifyID,
        tournamentName: info.data?.name,
      });
    }

    if (platform === Platform.MAJSOUL) {
      if (!MahjongSoulConnector.instance.isInitialized) {
        return Response.json({
          valid: false,
          error:
            "Majsoul connector is not initialized. Please try again later.",
        });
      }

      let internalId = tournamentId;
      let tournamentName: string | undefined;

      // 6-digit IDs are friendly IDs — resolve to internal unique_id
      if (/^\d{1,6}$/.test(tournamentId)) {
        const contest =
          await MahjongSoulConnector.instance.findContestByFriendlyId(
            Number(tournamentId)
          );
        if (!contest) {
          return Response.json({
            valid: false,
            error: "Tournament not found (friendly ID lookup failed)",
          });
        }
        internalId = String(contest.majsoulId);
        tournamentName = contest.name;
      }

      let details;
      try {
        details =
          await MahjongSoulConnector.instance.contestApi.fetchContestDetails(
            internalId
          );
      } catch {
        return Response.json({
          valid: false,
          error: "Tournament not found or bot has no access",
        });
      }
      if (!details) {
        return Response.json({
          valid: false,
          error: "Tournament not found or bot has no access",
        });
      }
      if (!tournamentName) {
        const data = (
          details as { data?: { contest_name?: { content?: string }[] } }
        ).data;
        tournamentName = data?.contest_name?.[0]?.content;
      }
      return Response.json({
        valid: true,
        internalTournamentId: Number(internalId),
        tournamentName,
      });
    }

    if (platform === Platform.TENHOU) {
      // Probe the lobby to verify the tournament ID is reachable
      try {
        await TenhouService.instance.fetchLobbyPlayers(tournamentId);
      } catch {
        return Response.json({
          valid: false,
          error: "Could not reach Tenhou lobby. Check the tournament ID.",
        });
      }
      // Best-effort: pull the lobby title (cmd_load.cgi) to auto-fill the
      // tournament name. A failure here must not fail validation.
      let tournamentName: string | undefined;
      try {
        const config =
          await TenhouService.instance.fetchTournamentConfig(tournamentId);
        tournamentName = config.TITLE?.trim() || undefined;
      } catch {
        // title is optional — ignore fetch / parse failures
      }
      return Response.json({ valid: true, tournamentName });
    }

    if (platform === Platform.IRL) {
      return Response.json({ valid: true });
    }

    return Response.json(
      { error: `Unsupported platform: ${platform}` },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Validation failed";
    console.error("Tournament validation failed:", error);
    return Response.json({ valid: false, error: message });
  }
}

import { connectToDatabase } from "~/utils/dbConnection.server";
import { LiveGameModel, type LiveGame } from "~/db/LiveGame";
import { TeamModel, type Team } from "~/db/Team";
import { isGameEnabled } from "~/game/feature-gate";

/**
 * GET /api/game/enrichment?matchId=<gameServerMatchId>
 *
 * Per-seat team enrichment for a live spectator match, resolved from the
 * `LiveGame` projection (matched by `relayMatchId`). Host-app convention
 * endpoint consumed by the shared spectator viewer, same pattern as
 * `/api/game/session`. Returns `{ seats: [] }` when the game isn't enabled,
 * the match isn't a tracked relay, or nothing resolves — the viewer then
 * simply shows no enrichment.
 */
export async function loader({ request }: { request: Request }) {
  if (!isGameEnabled()) {
    return Response.json({ seats: [] });
  }
  const matchId = new URL(request.url).searchParams.get("matchId");
  if (!matchId) {
    return Response.json({ seats: [] });
  }

  await connectToDatabase();
  const live = await LiveGameModel.findOne({
    relayMatchId: matchId,
  }).lean<LiveGame | null>();
  if (!live) {
    return Response.json({ seats: [] });
  }

  const teams = await TeamModel.find({ leagueId: live.league })
    .select("_id displayName roster pictures")
    .lean<Team[]>();
  const userTeam = new Map<
    string,
    { teamName: string; teamLogoUrl: string | null }
  >();
  for (const team of teams) {
    const roster = team.roster ?? { members: [], substitutes: [] };
    for (const memberId of [
      ...(roster.members ?? []),
      ...(roster.substitutes ?? []),
    ]) {
      userTeam.set(memberId.toString(), {
        teamName: team.displayName,
        teamLogoUrl: team.pictures?.croppedPicture ?? null,
      });
    }
  }

  const seats = (live.players ?? [])
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const pid = p.userId ? p.userId.toString() : null;
      const team = pid ? userTeam.get(pid) : undefined;
      return {
        seat: p.seat,
        playerName: p.nickname,
        teamName: team?.teamName ?? null,
        teamLogoUrl: team?.teamLogoUrl ?? null,
      };
    });

  return Response.json({ seats });
}

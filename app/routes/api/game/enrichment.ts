import { connectToDatabase } from "~/utils/dbConnection.server";
import {
  LiveGameModel,
  type LiveGame,
} from "~/core/models/tournament/LiveGame";
import { TeamModel, type Team } from "~/core/models/tournament/Team";
import { UserModel } from "~/core/models/shared/User";
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
    .select("_id displayName roster finalsRoster pictures")
    .lean<Team[]>();
  const userTeam = new Map<
    string,
    { teamName: string; teamLogoUrl: string | null }
  >();
  const rosterUserIds = new Set<string>();
  for (const team of teams) {
    for (const roster of [team.roster, team.finalsRoster]) {
      if (!roster) {
        continue;
      }
      const teamUserIds = [
        ...(roster.members ?? []),
        ...(roster.substitutes ?? []),
      ];
      if (roster.captain) {
        teamUserIds.push(roster.captain);
      }
      for (const memberId of teamUserIds) {
        const userId = memberId.toString();
        rosterUserIds.add(userId);
        userTeam.set(userId, {
          teamName: team.displayName,
          teamLogoUrl: team.pictures?.croppedPicture ?? null,
        });
      }
    }
  }

  const rosterUsers = await UserModel.find({ _id: { $in: [...rosterUserIds] } })
    .select("_id tenhouIdentity.name")
    .lean<
      Array<{ _id: { toString(): string }; tenhouIdentity?: { name?: string } }>
    >();
  const tenhouNameToUserId = new Map<string, string>();
  for (const user of rosterUsers) {
    const tenhouName = user.tenhouIdentity?.name?.trim().toLocaleLowerCase();
    if (tenhouName) {
      tenhouNameToUserId.set(tenhouName, user._id.toString());
    }
  }

  const seats = (live.players ?? [])
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const pid = p.userId?.toString() ?? null;
      const identityUserId =
        tenhouNameToUserId.get(p.nickname.trim().toLocaleLowerCase()) ?? null;
      const team =
        (pid ? userTeam.get(pid) : undefined) ??
        (identityUserId ? userTeam.get(identityUserId) : undefined);
      return {
        seat: p.seat,
        playerName: p.nickname,
        teamName: team?.teamName ?? null,
        teamLogoUrl: team?.teamLogoUrl ?? null,
      };
    });

  return Response.json({ seats });
}

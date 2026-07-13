import { MahjongSoulConnector } from "~/api/majsoul/data/MajsoulConnector";
import { RiichiCityLeagueConnector } from "~/services/connectors/RiichiCityLeagueConnector.server";
import { mergePlaceholderParticipant } from "~/utils/riichiCityParticipantMerge.server";
import { AuthService } from "~/utils/auth.server";
import type { IdentityLinkDeps } from "~/db/services/identityLinking";

/**
 * This deployment's platform-identity glue: connector lookups plus user
 * maintenance, injected into the shared `linkPlatformIdentity` /
 * `validatePlatformIdentity` logic (kandora-core). Only `lookupRiichiCity`
 * differs from the portal deployment.
 */
export const identityLinkDeps: IdentityLinkDeps = {
  lookupMahjongSoul: async (friendId) => {
    try {
      const { nickname, accountId } =
        await MahjongSoulConnector.instance.getUserInfoFromFriendId(friendId);
      if (!nickname || accountId === undefined) {
        return { ok: false, status: 404, error: "Mahjong Soul user not found" };
      }
      return { ok: true, name: nickname, accountId: String(accountId) };
    } catch (error) {
      console.error("Mahjong Soul lookup error:", error);
      return {
        ok: false,
        status: 500,
        error: "Failed to fetch Mahjong Soul user info",
      };
    }
  },
  lookupRiichiCity: async (id) => {
    try {
      const payload =
        await RiichiCityLeagueConnector.instance.service.getUserBrief(
          Number(id)
        );
      if (payload.code !== 0 || !payload.data?.userID) {
        return {
          ok: false,
          status: 404,
          error: payload.message || "Riichi City user not found",
        };
      }
      return {
        ok: true,
        name: payload.data.nickname || "",
        accountId: String(payload.data.userID),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Riichi City error";
      if (message.includes("Missing Riichi City credentials")) {
        return {
          ok: false,
          status: 503,
          error:
            "Riichi City lookup is not configured on the server. Please contact an admin.",
        };
      }
      return {
        ok: false,
        status: 500,
        error: `Failed to fetch Riichi City user info: ${message}`,
      };
    }
  },
  transferUserReferences: (targetUserId, sourceUserId) =>
    AuthService.transferUserReferences(targetUserId, sourceUserId),
  onFirstRiichiCityLink: (userId, userName) =>
    mergePlaceholderParticipant(userId, userName),
};

/**
 * `PortalAdapter` implementation backed by the tournaments host.
 *
 * "Portal" here is the adapter-pattern name for *the host that embeds the
 * game* (see `~/game/portal-adapter/types`); in this repo that host is the
 * tournaments app, which owns the game-server deployment.
 *
 *   - `verifyToken`    → shared `jose` JWT verifier (`~/utils/jwt.server`),
 *                        which validates portal-issued tokens with the shared
 *                        `JWT_SECRET` / issuer / audience.
 *   - `getUserProfile` → shared Mongoose `UserModel` (`~/core/models/shared/User`).
 *   - `publishMatchEnded` is intentionally left unimplemented (optional).
 */
import { computeUserName, UserModel } from "~/core/models/shared/User";
import { gameAllowLegacyAuthTokens } from "config";
import {
  verifyGameToken,
  verifyToken as verifySiteToken,
} from "~/utils/jwt.server";
import { connectToDatabase } from "~/utils/dbConnection.server";
import type {
  PortalAdapter,
  PortalUserProfile,
  VerifiedToken,
} from "~/game/portal-adapter/types";

if (gameAllowLegacyAuthTokens) {
  console.warn(
    "[game-auth] GAME_ALLOW_LEGACY_AUTH_TOKENS is enabled; site JWTs can access the game-server."
  );
}

export const portalAdapter: PortalAdapter = {
  async ensureDbConnected(): Promise<void> {
    await connectToDatabase();
  },

  async verifyToken(token: string): Promise<VerifiedToken | null> {
    const payload = await verifyGameToken(token);
    if (payload) {
      return { userId: payload.sub };
    }
    if (!gameAllowLegacyAuthTokens) {
      return null;
    }
    const legacyPayload = await verifySiteToken(token);
    if (!legacyPayload) {
      return null;
    }
    return { userId: legacyPayload.sub };
  },

  async getUserProfile(userId: string): Promise<PortalUserProfile | null> {
    await connectToDatabase();
    const user = await UserModel.findById(userId)
      .select("firstName lastName discordIdentity avatarUrl")
      .lean();
    if (!user) {
      return null;
    }
    return {
      id: userId,
      displayName: computeUserName(user),
      avatarUrl: user.avatarUrl ?? undefined,
    };
  },
};

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
 *   - `getUserProfile` → shared Mongoose `UserModel` (`~/db/User`).
 *   - `publishMatchEnded` is intentionally left unimplemented (optional).
 */
import { computeUserName, UserModel } from "~/db/User";
import { verifyToken as verifyJwt } from "~/utils/jwt.server";
import { connectToDatabase } from "~/utils/dbConnection.server";
import type {
  PortalAdapter,
  PortalUserProfile,
  VerifiedToken,
} from "~/game/portal-adapter/types";

export const portalAdapter: PortalAdapter = {
  async ensureDbConnected(): Promise<void> {
    await connectToDatabase();
  },

  async verifyToken(token: string): Promise<VerifiedToken | null> {
    const payload = await verifyJwt(token);
    if (!payload) {
      return null;
    }
    return { userId: payload.sub };
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

import { redirect } from "react-router";
import { UserModel } from "~/core/models/shared/User";
import { getMainServer } from "~/config/servers";
import { connectToDatabase } from "./dbConnection.server";
import { lookupGuildMember } from "./discord-guilds.server";
import { gameReturnPathFromRequest, gameSignInPath } from "./gameReturnPath";
import { getAuthenticatedUser, type JwtPayload } from "./jwt.server";

export type GameAccessResult =
  | { status: "allowed"; user: JwtPayload }
  | { status: "signed_out" }
  | { status: "discord_unlinked" }
  | { status: "not_in_main_guild" }
  | { status: "membership_unavailable" };

export async function evaluateGameAccess(
  request: Request
): Promise<GameAccessResult> {
  const authenticatedUser = await getAuthenticatedUser(request);
  if (!authenticatedUser) {
    return { status: "signed_out" };
  }

  try {
    await connectToDatabase();
    const user = await UserModel.findById(authenticatedUser.sub)
      .select("discordIdentity")
      .lean();
    if (!user) {
      return { status: "signed_out" };
    }
    const discordUserId = user.discordIdentity?.id;
    if (!discordUserId) {
      return { status: "discord_unlinked" };
    }

    const membership = await lookupGuildMember(
      getMainServer().id,
      discordUserId
    );
    if (membership.status === "not_member") {
      return { status: "not_in_main_guild" };
    }
    if (membership.status === "unavailable") {
      return { status: "membership_unavailable" };
    }
    return { status: "allowed", user: authenticatedUser };
  } catch (error) {
    console.error("Failed to evaluate live-game access:", error);
    return { status: "membership_unavailable" };
  }
}

/** Require a signed-in main-guild member for interactive or live pages. */
export async function requireGameUser(request: Request): Promise<JwtPayload> {
  const access = await evaluateGameAccess(request);
  if (access.status === "allowed") {
    return access.user;
  }
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  throw redirect(
    gameSignInPath(gameReturnPathFromRequest(request, basePath)),
    302
  );
}

export type GameApiAccessResult =
  | { authorized: true; user: JwtPayload }
  | { authorized: false; response: Response };

export async function requireGameApiAccess(
  request: Request
): Promise<GameApiAccessResult> {
  const access = await evaluateGameAccess(request);
  if (access.status === "allowed") {
    return { authorized: true, user: access.user };
  }

  const errors: Record<
    Exclude<GameAccessResult["status"], "allowed">,
    { status: number; error: string }
  > = {
    signed_out: { status: 401, error: "sign_in_required" },
    discord_unlinked: { status: 403, error: "discord_required" },
    not_in_main_guild: { status: 403, error: "tnt_membership_required" },
    membership_unavailable: {
      status: 503,
      error: "membership_unavailable",
    },
  };
  const failure = errors[access.status];
  return {
    authorized: false,
    response: Response.json({ error: failure.error }, { status: failure.status }),
  };
}

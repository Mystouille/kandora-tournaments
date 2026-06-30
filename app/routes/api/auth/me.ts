import { connectToDatabase } from "~/utils/dbConnection.server";
import {
  getAuthenticatedUserWithRefresh,
  signToken,
  createAuthCookie,
} from "../../../utils/jwt.server";
import { UserModel } from "~/db/User";

/**
 * GET /api/auth/me
 * Returns the currently authenticated user from the JWT cookie.
 * Used by the client on page load to restore the session.
 *
 * Implements a **sliding session**: when the JWT is past the halfway
 * point of its lifetime, a fresh token is issued so active users
 * stay logged in indefinitely.
 */
export async function loader({ request }: { request: Request }) {
  const { payload: jwtPayload, needsRefresh } =
    await getAuthenticatedUserWithRefresh(request);

  if (!jwtPayload) {
    return Response.json({ authenticated: false });
  }

  try {
    await connectToDatabase();
    const user = await UserModel.findById(jwtPayload.sub).select(
      "-passwordHash"
    );

    if (!user) {
      return Response.json({ authenticated: false });
    }

    const responseBody = {
      authenticated: true,
      user: {
        ...user.toJSON(),
        avatarUrl: jwtPayload.avatarUrl ?? null,
      },
      loginMethod: jwtPayload.loginMethod,
    };

    // Sliding session: re-issue the JWT if it's approaching expiry
    if (needsRefresh) {
      const newToken = await signToken({
        sub: jwtPayload.sub,
        username: jwtPayload.username,
        loginMethod: jwtPayload.loginMethod,
        avatarUrl: jwtPayload.avatarUrl,
      });
      return Response.json(responseBody, {
        headers: { "Set-Cookie": createAuthCookie(newToken) },
      });
    }

    return Response.json(responseBody);
  } catch (error) {
    console.error("Auth me error:", error);
    return Response.json({ authenticated: false }, { status: 500 });
  }
}

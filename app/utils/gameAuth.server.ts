import { getAuthenticatedUser, type JwtPayload } from "./jwt.server";

/** Require a signed-in user for interactive or live game surfaces. */
export async function requireGameUser(request: Request): Promise<JwtPayload> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    throw new Response("Sign in to access live games.", {
      status: 403,
      statusText: "Forbidden",
    });
  }
  return user;
}

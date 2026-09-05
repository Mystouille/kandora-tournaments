import { getAuthenticatedUser, verifyGameToken } from "./jwt.server";

export type SessionTransport = "web-cookie" | "game-token";

export interface AuthenticatedPrincipal {
  userId: string;
  transport: SessionTransport;
}

export type SessionCredentials =
  | { transport: "web-cookie" }
  | { transport: "game-token"; token: FormDataEntryValue | null };

export async function getAuthenticatedPrincipal(
  request: Request,
  credentials: SessionCredentials
): Promise<AuthenticatedPrincipal | null> {
  if (credentials.transport === "web-cookie") {
    const webUser = await getAuthenticatedUser(request);
    return webUser === null
      ? null
      : { userId: webUser.sub, transport: "web-cookie" };
  }

  const gameToken = credentials.token;
  if (typeof gameToken !== "string" || gameToken === "") {
    return null;
  }
  const gameUser = await verifyGameToken(gameToken);
  return gameUser === null
    ? null
    : { userId: gameUser.sub, transport: "game-token" };
}

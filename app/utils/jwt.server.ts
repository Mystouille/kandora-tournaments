import { SignJWT, jwtVerify } from "jose";
import { coreConfig } from "config";

const JWT_ISSUER = "kandora-portal";
const JWT_AUDIENCE = "kandora-portal";
const JWT_EXPIRATION = "7d";
const JWT_EXPIRATION_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Threshold (in seconds) before expiration at which we re-issue the token.
 * When less than half the lifetime remains, the token is refreshed.
 */
const JWT_REFRESH_THRESHOLD = JWT_EXPIRATION_SECONDS / 2; // 3.5 days

// Encode the secret as Uint8Array for jose
function getSecret() {
  return new TextEncoder().encode(coreConfig.JWT_SECRET);
}

export interface JwtPayload {
  sub: string; // MongoDB user _id
  username: string;
  loginMethod: "email" | "discord";
  avatarUrl?: string;
}

/**
 * Sign a JWT token with user data.
 * Used by both email/password and Discord login flows.
 */
export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(JWT_EXPIRATION)
    .sign(getSecret());
}

/**
 * Verify and decode a JWT token.
 * Returns the payload if valid, null if invalid/expired.
 */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

const COOKIE_NAME = "auth_token";

/**
 * Create a Set-Cookie header value for the JWT token.
 * Uses httpOnly, secure (in production), sameSite=lax.
 */
export function createAuthCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${7 * 24 * 60 * 60}`, // 7 days
  ];
  if (isProduction) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Create a Set-Cookie header that clears the auth cookie.
 */
export function clearAuthCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Check whether a JWT payload is close enough to expiry that it should
 * be silently re-issued (sliding session). Returns true when less than
 * half the token lifetime remains.
 */
export function shouldRefreshToken(payload: Record<string, unknown>): boolean {
  const exp = payload.exp as number | undefined;
  if (!exp) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  const remainingSeconds = exp - now;
  return remainingSeconds > 0 && remainingSeconds < JWT_REFRESH_THRESHOLD;
}

/**
 * Extract the JWT token from the request's cookies.
 */
export function getTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const authCookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!authCookie) {
    return null;
  }

  return authCookie.split("=")[1] || null;
}

/**
 * Get the authenticated user from a request.
 * Returns the JWT payload if valid, null otherwise.
 */
export async function getAuthenticatedUser(
  request: Request
): Promise<JwtPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) {
    return null;
  }
  return verifyToken(token);
}

/**
 * Get the authenticated user AND a flag indicating whether the token
 * should be refreshed (sliding session).
 */
export async function getAuthenticatedUserWithRefresh(
  request: Request
): Promise<{ payload: JwtPayload | null; needsRefresh: boolean }> {
  const token = getTokenFromRequest(request);
  if (!token) {
    return { payload: null, needsRefresh: false };
  }

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const jwtPayload = payload as unknown as JwtPayload;
    const needsRefresh = shouldRefreshToken(payload as Record<string, unknown>);
    return { payload: jwtPayload, needsRefresh };
  } catch {
    return { payload: null, needsRefresh: false };
  }
}

/**
 * Require the current user to be an admin.
 * Throws a redirect to "/" if not authenticated or not admin.
 * Use in route loaders: `await requireAdmin(request);`
 */
export async function requireAdmin(request: Request): Promise<void> {
  const { redirect } = await import("react-router");
  const { connectToDatabase } = await import("./dbConnection.server");
  const { UserModel } = await import("../db/User");

  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    throw redirect("/");
  }
  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select("isAdmin");
  if (!user?.isAdmin) {
    throw redirect("/");
  }
}

import {
  createMobileAuthCode,
  isMobileAuthChallenge,
} from "~/services/mobileAuthCode.server";
import { requireGameUser } from "~/utils/gameAuth.server";

export async function loader({ request }: { request: Request }): Promise<Response> {
  const user = await requireGameUser(request);
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const challengeCookie = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("mobile_auth_challenge="));
  const challenge = challengeCookie?.slice("mobile_auth_challenge=".length) ?? null;
  const callback = new URL("kandora://auth/complete");

  if (!isMobileAuthChallenge(challenge)) {
    callback.searchParams.set("error", "invalid_request");
  } else {
    try {
      const code = await createMobileAuthCode(
        { userId: user.sub, username: user.username },
        challenge
      );
      callback.searchParams.set("code", code);
    } catch (error) {
      console.error("Failed to create mobile authentication code:", error);
      callback.searchParams.set("error", "temporarily_unavailable");
    }
  }

  const headers = new Headers({ Location: callback.toString() });
  headers.append(
    "Set-Cookie",
    "mobile_auth_challenge=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  return new Response(null, {
    status: 302,
    headers,
  });
}
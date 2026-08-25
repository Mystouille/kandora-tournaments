import { createHash, randomBytes } from "node:crypto";
import { getRedisConnection } from "./redisConnection.server";

const CODE_TTL_SECONDS = 120;
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const KEY_PREFIX = "mobile-auth-code:";

const CONSUME_SCRIPT = `
local value = redis.call("GET", KEYS[1])
if not value then
  return false
end
local separator = string.find(value, ":", 1, true)
if not separator then
  return false
end
if string.sub(value, 1, separator - 1) ~= ARGV[1] then
  return false
end
redis.call("DEL", KEYS[1])
return string.sub(value, separator + 1)
`;

export interface MobileAuthCodePayload {
  userId: string;
  username: string;
}

export function isMobileAuthChallenge(value: string | null): value is string {
  return value !== null && CODE_PATTERN.test(value);
}

function codeKey(code: string): string {
  const digest = createHash("sha256").update(code).digest("hex");
  return `${KEY_PREFIX}${digest}`;
}

function verifierChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function createMobileAuthCode(
  payload: MobileAuthCodePayload,
  challenge: string
): Promise<string> {
  if (!isMobileAuthChallenge(challenge)) {
    throw new Error("Invalid mobile authentication challenge");
  }

  const redis = getRedisConnection();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = randomBytes(32).toString("base64url");
    const stored = `${challenge}:${JSON.stringify(payload)}`;
    const result = await redis.set(
      codeKey(code),
      stored,
      "EX",
      CODE_TTL_SECONDS,
      "NX"
    );
    if (result === "OK") {
      return code;
    }
  }
  throw new Error("Unable to allocate mobile authentication code");
}

export async function consumeMobileAuthCode(
  code: string,
  verifier: string
): Promise<MobileAuthCodePayload | null> {
  if (!CODE_PATTERN.test(code) || !CODE_PATTERN.test(verifier)) {
    return null;
  }

  const raw = await getRedisConnection().eval(
    CONSUME_SCRIPT,
    1,
    codeKey(code),
    verifierChallenge(verifier)
  );
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const payload = JSON.parse(raw) as Partial<MobileAuthCodePayload>;
    if (
      typeof payload.userId !== "string" ||
      payload.userId === "" ||
      typeof payload.username !== "string" ||
      payload.username === ""
    ) {
      return null;
    }
    return { userId: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}
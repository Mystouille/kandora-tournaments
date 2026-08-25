import { z } from "zod";
import { webAppPath } from "../shell";

const MOBILE_AUTH_SESSION_KEY = "kandora_mobile_auth_session_v1";
const MOBILE_AUTH_PENDING_KEY = "kandora_mobile_auth_pending_v1";
const PENDING_AUTH_LIFETIME_MS = 10 * 60 * 1000;
const VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const MobileAuthSessionSchema = z.object({
  token: z.string().min(1),
  username: z.string().min(1),
  expiresAt: z.number().finite(),
});

const PendingMobileAuthSchema = z.object({
  verifier: z.string().regex(VERIFIER_PATTERN),
  expiresAt: z.number().finite(),
});

const ExchangeResponseSchema = MobileAuthSessionSchema;
const SessionResponseSchema = z.object({
  authenticated: z.literal(true),
  expiresAt: z.number().finite(),
});

interface MobileAuthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type MobileAuthSession = z.infer<typeof MobileAuthSessionSchema>;

export class MobileAuthHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "MobileAuthHttpError";
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function removeItem(storage: MobileAuthStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
  }
}

export async function createMobileAuthRequest(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(verifierBytes);
  const challengeBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );
  return { verifier, challenge: base64Url(challengeBytes) };
}

export function savePendingMobileAuth(
  storage: MobileAuthStorage,
  verifier: string,
  now = Date.now()
): void {
  if (!VERIFIER_PATTERN.test(verifier)) {
    throw new Error("Invalid mobile authentication verifier");
  }
  storage.setItem(
    MOBILE_AUTH_PENDING_KEY,
    JSON.stringify({
      verifier,
      expiresAt: now + PENDING_AUTH_LIFETIME_MS,
    })
  );
}

export function loadPendingMobileAuthVerifier(
  storage: MobileAuthStorage,
  now = Date.now()
): string | null {
  try {
    const raw = storage.getItem(MOBILE_AUTH_PENDING_KEY);
    if (raw === null) {
      return null;
    }
    const pending = PendingMobileAuthSchema.parse(JSON.parse(raw) as unknown);
    if (pending.expiresAt <= now) {
      removeItem(storage, MOBILE_AUTH_PENDING_KEY);
      return null;
    }
    return pending.verifier;
  } catch {
    removeItem(storage, MOBILE_AUTH_PENDING_KEY);
    return null;
  }
}

export function clearPendingMobileAuth(storage: MobileAuthStorage): void {
  removeItem(storage, MOBILE_AUTH_PENDING_KEY);
}

export function loadMobileAuthSession(
  storage: MobileAuthStorage,
  now = Date.now()
): MobileAuthSession | null {
  try {
    const raw = storage.getItem(MOBILE_AUTH_SESSION_KEY);
    if (raw === null) {
      return null;
    }
    const session = MobileAuthSessionSchema.parse(JSON.parse(raw) as unknown);
    if (session.expiresAt <= now) {
      removeItem(storage, MOBILE_AUTH_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    removeItem(storage, MOBILE_AUTH_SESSION_KEY);
    return null;
  }
}

export function saveMobileAuthSession(
  storage: MobileAuthStorage,
  session: MobileAuthSession
): void {
  storage.setItem(
    MOBILE_AUTH_SESSION_KEY,
    JSON.stringify(MobileAuthSessionSchema.parse(session))
  );
}

export function clearMobileAuthSession(storage: MobileAuthStorage): void {
  removeItem(storage, MOBILE_AUTH_SESSION_KEY);
}

async function checkedJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new MobileAuthHttpError(
      `Mobile authentication failed (${response.status})`,
      response.status
    );
  }
  return response.json();
}

export async function exchangeMobileAuthCode(
  baseUrl: string,
  code: string,
  verifier: string,
  fetcher: typeof fetch = fetch
): Promise<MobileAuthSession> {
  const response = await fetcher(
    webAppPath(baseUrl, "/api/mobile/auth/exchange"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
    }
  );
  const session = ExchangeResponseSchema.parse(await checkedJson(response));
  if (session.expiresAt <= Date.now()) {
    throw new Error("The mobile authentication session has expired");
  }
  return session;
}

export async function verifyMobileAuthSession(
  baseUrl: string,
  session: MobileAuthSession,
  fetcher: typeof fetch = fetch
): Promise<MobileAuthSession> {
  const response = await fetcher(
    webAppPath(baseUrl, "/api/mobile/auth/session"),
    { headers: { Authorization: `Bearer ${session.token}` } }
  );
  const result = SessionResponseSchema.parse(await checkedJson(response));
  if (result.expiresAt <= Date.now()) {
    throw new MobileAuthHttpError("Mobile authentication expired", 401);
  }
  return { ...session, expiresAt: result.expiresAt };
}
import type { Seat } from "~/game/protocol/messages";

export interface ReplayDeepLinkState {
  seat?: Seat;
  round?: number;
  event?: number;
  review?: string;
}

export type MobileContentIntent =
  | { kind: "join-game"; matchId: string }
  | { kind: "start-solo"; matchId: string }
  | { kind: "spectate-match"; matchId: string }
  | { kind: "watch-live"; watchId: string }
  | {
      kind: "watch-replay";
      gameId: string;
      state: ReplayDeepLinkState;
    };

const MAX_ID_LENGTH = 256;
const MAX_REVIEW_ID_LENGTH = 128;
const PENDING_CONTENT_LINK_KEY = "kandora.mobile.pendingContentLink.v1";
const PENDING_CONTENT_LINK_TTL_MS = 30 * 60_000;

type ContentLinkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PendingMobileContentIntent {
  url: string;
  receivedAt: number;
  intent: MobileContentIntent;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}

function decodeIdentifier(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (
    decoded.length === 0 ||
    decoded.length > MAX_ID_LENGTH ||
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    hasControlCharacters(decoded)
  ) {
    return null;
  }
  return decoded;
}

function safeInteger(value: string | null): number | null {
  if (value === null || !/^-?\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function replayState(url: URL): ReplayDeepLinkState {
  const state: ReplayDeepLinkState = {};
  const seat = safeInteger(url.searchParams.get("seat"));
  if (seat === 0 || seat === 1 || seat === 2 || seat === 3) {
    state.seat = seat;
  }
  const round = safeInteger(url.searchParams.get("round"));
  if (round !== null && round > 0) {
    state.round = round;
  }
  const event = safeInteger(url.searchParams.get("event"));
  if (event !== null) {
    state.event = event;
  }
  const review = url.searchParams.get("review");
  if (
    review !== null &&
    review.length > 0 &&
    review.length <= MAX_REVIEW_ID_LENGTH
  ) {
    state.review = review;
  }
  return state;
}

function relativePathname(url: URL, trustedBaseUrl: URL): string | null {
  if (url.origin !== trustedBaseUrl.origin) {
    return null;
  }
  const basePath = trustedBaseUrl.pathname.replace(/\/$/, "");
  if (basePath !== "" && url.pathname !== basePath) {
    if (!url.pathname.startsWith(`${basePath}/`)) {
      return null;
    }
  }
  return url.pathname.slice(basePath.length) || "/";
}

export function parseMobileContentIntent(
  value: string,
  trustedBaseUrlValue: string
): MobileContentIntent | null {
  let url: URL;
  let trustedBaseUrl: URL;
  try {
    url = new URL(value);
    trustedBaseUrl = new URL(trustedBaseUrlValue);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (trustedBaseUrl.protocol !== "https:" &&
      trustedBaseUrl.protocol !== "http:")
  ) {
    return null;
  }
  const pathname = relativePathname(url, trustedBaseUrl);
  if (pathname === null) {
    return null;
  }

  const match =
    /^\/(game|spectate)\/([^/]+)\/?$/.exec(pathname) ??
    /^\/watch\/(live|replay)\/([^/]+)\/?$/.exec(pathname);
  if (match === null) {
    return null;
  }
  const identifier = decodeIdentifier(match[2]);
  if (identifier === null) {
    return null;
  }

  if (match[1] === "game") {
    if (url.searchParams.get("solo") === "1") {
      return { kind: "start-solo", matchId: identifier };
    }
    return { kind: "join-game", matchId: identifier };
  }
  if (match[1] === "spectate") {
    return { kind: "spectate-match", matchId: identifier };
  }
  if (match[1] === "live") {
    return { kind: "watch-live", watchId: identifier };
  }
  if (identifier === "tenhou-har") {
    return null;
  }
  return {
    kind: "watch-replay",
    gameId: identifier,
    state: replayState(url),
  };
}

export function mobileContentIntentKey(intent: MobileContentIntent): string {
  if (
    intent.kind === "join-game" ||
    intent.kind === "start-solo" ||
    intent.kind === "spectate-match"
  ) {
    return `${intent.kind}:${intent.matchId}`;
  }
  if (intent.kind === "watch-live") {
    return `${intent.kind}:${intent.watchId}`;
  }
  const { seat, round, event, review } = intent.state;
  return [
    intent.kind,
    intent.gameId,
    seat ?? "",
    round ?? "",
    event ?? "",
    review ?? "",
  ].join(":");
}

export function savePendingMobileContentUrl(
  storage: ContentLinkStorage,
  url: string,
  receivedAt = Date.now()
): void {
  storage.setItem(
    PENDING_CONTENT_LINK_KEY,
    JSON.stringify({ version: 1, url, receivedAt })
  );
}

export function clearPendingMobileContentUrl(
  storage: ContentLinkStorage
): void {
  storage.removeItem(PENDING_CONTENT_LINK_KEY);
}

export function loadPendingMobileContentIntent(
  storage: ContentLinkStorage,
  trustedBaseUrl: string,
  now = Date.now()
): PendingMobileContentIntent | null {
  const raw = storage.getItem(PENDING_CONTENT_LINK_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const stored = JSON.parse(raw) as {
      version?: unknown;
      url?: unknown;
      receivedAt?: unknown;
    };
    if (
      stored.version !== 1 ||
      typeof stored.url !== "string" ||
      typeof stored.receivedAt !== "number" ||
      !Number.isFinite(stored.receivedAt) ||
      stored.receivedAt > now + 60_000 ||
      now - stored.receivedAt > PENDING_CONTENT_LINK_TTL_MS
    ) {
      clearPendingMobileContentUrl(storage);
      return null;
    }
    const intent = parseMobileContentIntent(stored.url, trustedBaseUrl);
    if (intent === null) {
      clearPendingMobileContentUrl(storage);
      return null;
    }
    return { url: stored.url, receivedAt: stored.receivedAt, intent };
  } catch {
    clearPendingMobileContentUrl(storage);
    return null;
  }
}

import type { LocalMatchControllerState } from "./local/LocalMatchController";
import type { NearbyMatchControllerState } from "./nearby/NearbyMatchController";

export type MobileShellPage =
  | "home"
  | "lobby"
  | "online-room"
  | "nearby"
  | "replays"
  | "replay-viewer"
  | "game";
export type MobileStorageState = "loading" | "sqlite" | "memory" | "error";

export function normalizeWebAppUrl(
  value: string | undefined,
  options: { allowLoopback?: boolean } = {}
): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    const isLoopback =
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.");
    if (isLoopback && options.allowLoopback === false) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function webAppPath(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

export function isMobileAuthCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "kandora:" &&
      url.host === "auth" &&
      url.pathname === "/complete"
    );
  } catch {
    return false;
  }
}

export function nearbyPageAvailable(
  controllersReady: boolean,
  storageState: MobileStorageState
): boolean {
  return (
    controllersReady && (storageState === "sqlite" || storageState === "memory")
  );
}

export function hasPlayingMatch(
  localStatus: LocalMatchControllerState["status"],
  nearbyStatus: NearbyMatchControllerState["status"]
): boolean {
  return localStatus === "playing" || nearbyStatus === "playing";
}

export function backgroundResumeTarget(
  page: MobileShellPage,
  localStatus: LocalMatchControllerState["status"],
  nearbyRole: NearbyMatchControllerState["role"],
  nearbyStatus: NearbyMatchControllerState["status"]
): "solo" | "nearby-host" | null {
  if (page !== "game") {
    return null;
  }
  if (nearbyRole === "host" && nearbyStatus === "playing") {
    return "nearby-host";
  }
  return localStatus === "playing" ? "solo" : null;
}

export function isTransientPauseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("not quiescent") ||
    error.message.includes("uncheckpointable transition")
  );
}

export async function retryTransientPause(
  operation: () => Promise<void>,
  wait: () => Promise<void>,
  maximumAttempts = 30
): Promise<void> {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      if (!isTransientPauseError(error) || attempt === maximumAttempts) {
        throw error;
      }
      await wait();
    }
  }
}

export function mobileAuthCallbackResult(value: string): {
  code: string | null;
  error: string | null;
} | null {
  if (!isMobileAuthCallback(value)) {
    return null;
  }
  const url = new URL(value);
  return {
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
  };
}

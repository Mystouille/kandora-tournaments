import type { LocalMatchControllerState } from "./local/LocalMatchController";
import type { NearbyMatchControllerState } from "./nearby/NearbyMatchController";

export type MobileShellPage = "home" | "nearby" | "replays" | "game";
export type MobileStorageState =
  | "loading"
  | "sqlite"
  | "memory"
  | "error";

export function normalizeWebAppUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
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

export function nearbyPageAvailable(
  controllersReady: boolean,
  storageState: MobileStorageState
): boolean {
  return (
    controllersReady &&
    (storageState === "sqlite" || storageState === "memory")
  );
}

export function hasPlayingMatch(
  localStatus: LocalMatchControllerState["status"],
  nearbyStatus: NearbyMatchControllerState["status"]
): boolean {
  return localStatus === "playing" || nearbyStatus === "playing";
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
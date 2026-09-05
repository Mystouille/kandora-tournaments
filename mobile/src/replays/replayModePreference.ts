import type { ReplayLibraryMode } from "./replayLibrary";

const REPLAY_LIBRARY_MODE_KEY = "kandora.mobile.replays.mode.v1";

interface ReplayModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadReplayLibraryMode(
  storage: ReplayModeStorage | null
): ReplayLibraryMode | null {
  if (storage === null) {
    return null;
  }
  try {
    const value = storage.getItem(REPLAY_LIBRARY_MODE_KEY);
    return value === "offline" || value === "online" ? value : null;
  } catch {
    return null;
  }
}

export function saveReplayLibraryMode(
  storage: ReplayModeStorage | null,
  mode: ReplayLibraryMode
): void {
  try {
    storage?.setItem(REPLAY_LIBRARY_MODE_KEY, mode);
  } catch {}
}

export function defaultReplayLibraryMode(
  savedMode: ReplayLibraryMode | null,
  authenticated: boolean
): ReplayLibraryMode {
  return savedMode ?? (authenticated ? "online" : "offline");
}

import { describe, expect, it, vi } from "vitest";
import {
  defaultReplayLibraryMode,
  loadReplayLibraryMode,
  saveReplayLibraryMode,
} from "./replayModePreference";

describe("mobile replay mode preference", () => {
  it("defaults authenticated users to online without overriding a saved mode", () => {
    expect(defaultReplayLibraryMode(null, true)).toBe("online");
    expect(defaultReplayLibraryMode(null, false)).toBe("offline");
    expect(defaultReplayLibraryMode("offline", true)).toBe("offline");
    expect(defaultReplayLibraryMode("online", false)).toBe("online");
  });

  it("loads only valid modes and saves explicit choices", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };

    expect(loadReplayLibraryMode(storage)).toBeNull();
    saveReplayLibraryMode(storage, "online");
    expect(loadReplayLibraryMode(storage)).toBe("online");
    expect(storage.setItem).toHaveBeenCalledWith(
      "kandora.mobile.replays.mode.v1",
      "online"
    );
    values.set("kandora.mobile.replays.mode.v1", "invalid");
    expect(loadReplayLibraryMode(storage)).toBeNull();
  });
});

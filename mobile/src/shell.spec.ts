import { describe, expect, it } from "vitest";
import {
  hasPlayingMatch,
  isTransientPauseError,
  nearbyPageAvailable,
  normalizeWebAppUrl,
  retryTransientPause,
  webAppPath,
} from "./shell";

describe("mobile shell policy", () => {
  it("accepts only absolute HTTP web origins", () => {
    expect(normalizeWebAppUrl("https://play.example.com/")).toBe(
      "https://play.example.com"
    );
    expect(normalizeWebAppUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebAppUrl("/relative")).toBeNull();
    expect(normalizeWebAppUrl(undefined)).toBeNull();
  });

  it("builds web sign-in and lobby links from the configured origin", () => {
    expect(webAppPath("https://play.example.com", "/lobby")).toBe(
      "https://play.example.com/lobby"
    );
    expect(
      webAppPath(
        "https://play.example.com",
        "/sign-in?returnTo=%2Flobby"
      )
    ).toBe("https://play.example.com/sign-in?returnTo=%2Flobby");
  });

  it("unlocks Nearby only after controllers and local storage are ready", () => {
    expect(nearbyPageAvailable(false, "sqlite")).toBe(false);
    expect(nearbyPageAvailable(true, "loading")).toBe(false);
    expect(nearbyPageAvailable(true, "error")).toBe(false);
    expect(nearbyPageAvailable(true, "memory")).toBe(true);
    expect(nearbyPageAvailable(true, "sqlite")).toBe(true);
  });

  it("forces fullscreen for either local or Nearby active play", () => {
    expect(hasPlayingMatch("playing", "idle")).toBe(true);
    expect(hasPlayingMatch("idle", "playing")).toBe(true);
    expect(hasPlayingMatch("paused", "lobby")).toBe(false);
  });

  it("retries only transient checkpoint boundaries", async () => {
    let attempts = 0;
    let waits = 0;
    await retryTransientPause(
      () => {
        attempts += 1;
        if (attempts < 3) {
          return Promise.reject(new Error("playing state is not quiescent"));
        }
        return Promise.resolve();
      },
      () => {
        waits += 1;
        return Promise.resolve();
      }
    );
    expect({ attempts, waits }).toEqual({ attempts: 3, waits: 2 });
    expect(isTransientPauseError(new Error("permission denied"))).toBe(false);
    await expect(
      retryTransientPause(
        () => Promise.reject(new Error("permission denied")),
        () => Promise.resolve()
      )
    ).rejects.toThrow("permission denied");
  });
});
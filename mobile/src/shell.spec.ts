import { describe, expect, it } from "vitest";
import {
  backgroundResumeTarget,
  hasPlayingMatch,
  isMobileAuthCallback,
  isTransientPauseError,
  mobileAuthCallbackResult,
  nearbyPageAvailable,
  normalizeWebAppUrl,
  retryTransientPause,
  webAppPath,
} from "./shell";

describe("mobile background resume policy", () => {
  it("resumes only a match that this session backgrounded from Game", () => {
    expect(backgroundResumeTarget("game", "playing", "idle", "idle")).toBe(
      "solo"
    );
    expect(backgroundResumeTarget("game", "idle", "host", "playing")).toBe(
      "nearby-host"
    );
    expect(
      backgroundResumeTarget("home", "playing", "idle", "idle")
    ).toBeNull();
    expect(
      backgroundResumeTarget("game", "paused", "host", "paused")
    ).toBeNull();
  });
});

describe("mobile shell policy", () => {
  it("accepts only absolute HTTP web origins", () => {
    expect(normalizeWebAppUrl("https://play.example.com/")).toBe(
      "https://play.example.com"
    );
    expect(normalizeWebAppUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebAppUrl("/relative")).toBeNull();
    expect(normalizeWebAppUrl(undefined)).toBeNull();
  });

  it("rejects loopback origins for native builds", () => {
    expect(
      normalizeWebAppUrl("http://localhost:3000", { allowLoopback: false })
    ).toBeNull();
    expect(
      normalizeWebAppUrl("http://127.0.0.1:5173", { allowLoopback: false })
    ).toBeNull();
    expect(
      normalizeWebAppUrl("https://tournaments.tnt-sessions.com", {
        allowLoopback: false,
      })
    ).toBe("https://tournaments.tnt-sessions.com");
  });

  it("builds web sign-in and lobby links from the configured origin", () => {
    expect(webAppPath("https://play.example.com", "/lobby")).toBe(
      "https://play.example.com/lobby"
    );
    expect(
      webAppPath("https://play.example.com", "/sign-in?returnTo=%2Flobby")
    ).toBe("https://play.example.com/sign-in?returnTo=%2Flobby");
  });

  it("accepts only the exact Kandora auth completion deep link", () => {
    expect(isMobileAuthCallback("kandora://auth/complete")).toBe(true);
    expect(isMobileAuthCallback("kandora://auth/other")).toBe(false);
    expect(isMobileAuthCallback("https://auth/complete")).toBe(false);
    expect(
      mobileAuthCallbackResult("kandora://auth/complete?code=one-time")
    ).toEqual({ code: "one-time", error: null });
    expect(
      mobileAuthCallbackResult(
        "kandora://auth/complete?error=temporarily_unavailable"
      )
    ).toEqual({ code: null, error: "temporarily_unavailable" });
    expect(mobileAuthCallbackResult("https://auth/complete")).toBeNull();
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

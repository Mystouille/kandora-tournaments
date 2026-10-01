import { expect, test } from "@playwright/test";
import {
  DEFERRED_30FPS_BROWSER_PROFILES,
  DEFERRED_30FPS_BROWSER_REASON,
  NORMAL_FRAME_RATE_BROWSER_PROFILES,
} from "./browserProfiles";
import {
  assertAcceptedReceipt,
  authorityEvidence,
  browserEvidence,
  cleanupTimingPage,
  discardAfterRealReady,
  openTimingProfile,
  persistTimingEvidence,
  realReadyFrame,
  synchronizedClockError,
} from "./harnessDriver";

test.afterEach(async ({ page }) => cleanupTimingPage(page));

for (const profile of [
  ...NORMAL_FRAME_RATE_BROWSER_PROFILES,
  ...DEFERRED_30FPS_BROWSER_PROFILES,
]) {
  const scope =
    profile.framesPerSecond === 30
      ? "30 FPS browser evidence deferred"
      : "normal-frame-rate usable base and late Pixi input";
  test(`${scope}: ${profile.name}`, async ({ page }, testInfo) => {
    test.skip(profile.framesPerSecond === 30, DEFERRED_30FPS_BROWSER_REASON);
    await openTimingProfile(page, profile);
    const ready = await realReadyFrame(page);
    const first = await browserEvidence(page);
    const clock = await synchronizedClockError(page);
    await persistTimingEvidence(testInfo, "first-ready-frame-measurement", {
      scope: "normal-frame-rate-only",
      deferred30FpsBrowserEvidence: DEFERRED_30FPS_BROWSER_REASON,
      profile,
      ready,
      first,
      clock,
    });
    expect(first.degradedReasons).toEqual([]);
    expect(ready.window.baseEndsAt - ready.window.opensAt).toBe(5_000);
    expect(ready.baseRemainingMs).toBeGreaterThanOrEqual(4_900);
    expect(ready.baseRemainingMs).toBeLessThanOrEqual(5_000);
    expect(first.infoVisibleAt).not.toBeNull();
    expect(first.drawLandAt).not.toBeNull();
    expect(first.drawLandingCount).toBe(1);
    expect(ready.performanceAt).toBeGreaterThanOrEqual(
      first.drawLandAt ?? Infinity
    );
    expect(ready.performanceAt - (first.drawLandAt ?? NaN)).toBeLessThanOrEqual(
      100
    );
    expect(Math.abs(clock.errorMs)).toBeLessThanOrEqual(100);
    expect(
      Math.abs(clock.errorMs) + clock.referenceRoundTripMs / 2
    ).toBeLessThanOrEqual(100);
    const before = await authorityEvidence(page);
    expect(before.window?.id).toBe(ready.window.id);
    expect(before.window?.allowanceMs).toBe(ready.window.allowanceMs);
    expect(before.window?.expiresAt).toBe(ready.window.expiresAt);
    expect(ready.window.allowanceMs).toBeGreaterThanOrEqual(0);
    expect(ready.window.allowanceMs).toBeLessThanOrEqual(500);
    const accepted = await discardAfterRealReady(page, 4_975);
    const authority = await authorityEvidence(page);
    const usableMs =
      (accepted.submitted?.performanceAt ?? NaN) - ready.performanceAt;
    expect(usableMs).toBeGreaterThanOrEqual(4_900);
    expect(usableMs).toBeLessThanOrEqual(5_100);
    assertAcceptedReceipt(accepted, authority);
    expect(authority.receipts[0].bankAfterMs).toBeGreaterThanOrEqual(19_900);
    await persistTimingEvidence(
      testInfo,
      "normal-frame-rate-timing-measurement",
      {
        scope: "normal-frame-rate-only",
        deferred30FpsBrowserEvidence: DEFERRED_30FPS_BROWSER_REASON,
        profile,
        usableMs,
        clock,
        browser: accepted,
        authority,
      }
    );
  });
}

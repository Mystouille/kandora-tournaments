import { expect, test } from "@playwright/test";
import { DEGRADED_BROWSER_PROFILES } from "./browserProfiles";
import {
  assertAcceptedReceipt,
  authorityEvidence,
  browserEvidence,
  cleanupTimingPage,
  discardAfterRealReady,
  openTimingProfile,
  persistTimingEvidence,
  realReadyFrame,
} from "./harnessDriver";

test.afterEach(async ({ page }) => cleanupTimingPage(page));

for (const profile of DEGRADED_BROWSER_PROFILES) {
  test(`explicit beyond-promise diagnostic, not SC-002 sign-off: ${profile.name}`, async ({
    page,
  }, testInfo) => {
    await openTimingProfile(page, profile);
    const ready = await realReadyFrame(page);
    const first = await browserEvidence(page);
    expect(first.degradedReasons.length).toBeGreaterThan(0);
    expect(ready.window.baseEndsAt - ready.window.opensAt).toBe(5_000);
    expect(ready.window.budgetEndsAt - ready.window.baseEndsAt).toBe(20_000);
    expect(ready.window.allowanceMs).toBeGreaterThanOrEqual(0);
    expect(ready.window.allowanceMs).toBeLessThanOrEqual(500);
    if (profile.name === "beyond-cap-downlink") {
      expect(ready.baseRemainingMs).toBeLessThan(4_900);
    }
    const accepted = await discardAfterRealReady(page, 1_000);
    const authority = await authorityEvidence(page);
    assertAcceptedReceipt(accepted, authority);
    if (profile.stallMs) {
      expect(Math.max(...accepted.frameIntervalsMs)).toBeGreaterThanOrEqual(
        profile.stallMs - 100
      );
    }
    await persistTimingEvidence(testInfo, "degraded-profile-diagnostic", {
      supportedPromise: false,
      profile,
      reasons: first.degradedReasons,
      lostBaseMsAtFirstReadyFrame: 5_000 - ready.baseRemainingMs,
      browser: accepted,
      authority,
    });
  });
}

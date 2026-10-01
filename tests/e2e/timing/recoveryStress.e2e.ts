import { expect, test } from "@playwright/test";
import { NORMAL_FRAME_RATE_BROWSER_PROFILES } from "./browserProfiles";
import {
  authorityEvidence,
  browserEvidence,
  cleanupTimingPage,
  discardNow,
  openTimingProfile,
  persistTimingEvidence,
  realReadyFrame,
  synchronizedClockError,
} from "./harnessDriver";

test.afterEach(async ({ page }) => cleanupTimingPage(page));

for (const deltaMs of [300_000, -300_000]) {
  test(`a ${deltaMs} ms wall correction cannot replenish or consume the real decision`, async ({
    page,
  }) => {
    await openTimingProfile(page, NORMAL_FRAME_RATE_BROWSER_PROFILES[3]);
    const ready = await realReadyFrame(page);
    const correction = await page.evaluate((delta) => {
      if (!window.timingHarness) {
        throw new Error("Timing harness is unavailable");
      }
      return window.timingHarness.stepWallClock(delta);
    }, deltaMs);
    const { before, after, elapsedMs } = correction;
    expect(after.currentWindow?.id).toBe(ready.window.id);
    expect(after.currentWindow?.expiresAt).toBe(ready.window.expiresAt);
    expect(after.currentWindow?.allowanceMs).toBe(ready.window.allowanceMs);
    expect(after.bankMs).toBe(before.bankMs);
    expect(
      Math.abs(
        (after.currentRemainingMs ?? NaN) -
          (before.currentRemainingMs ?? NaN) +
          elapsedMs
      )
    ).toBeLessThanOrEqual(100);
    expect(
      Math.abs((await synchronizedClockError(page)).errorMs)
    ).toBeLessThanOrEqual(100);
    await discardNow(page);
    expect((await authorityEvidence(page)).receipts[0].accepted).toBe(true);
  });
}

test("browser foreground recovery refreshes probes but retains the same window and frozen allowance", async ({
  page,
}) => {
  await openTimingProfile(page, NORMAL_FRAME_RATE_BROWSER_PROFILES[7]);
  const ready = await realReadyFrame(page);
  const before = await browserEvidence(page);
  const after = await page.evaluate(async () => {
    if (!window.timingHarness) {
      throw new Error("Timing harness is unavailable");
    }
    return window.timingHarness.foregroundGap(1_100);
  });
  expect(after.ready?.performanceAt).toBe(ready.performanceAt);
  expect(after.currentWindow?.id).toBe(ready.window.id);
  expect(after.currentWindow?.baseEndsAt).toBe(ready.window.baseEndsAt);
  expect(after.currentWindow?.expiresAt).toBe(ready.window.expiresAt);
  expect(after.currentWindow?.allowanceMs).toBe(ready.window.allowanceMs);
  expect(after.currentRemainingMs).toBeLessThanOrEqual(
    (before.currentRemainingMs ?? NaN) - 900
  );
  expect(after.bankMs).toBe(before.bankMs);
  expect(after.drawLandingCount).toBe(1);
  expect(
    Math.abs((await synchronizedClockError(page)).errorMs)
  ).toBeLessThanOrEqual(100);
  await discardNow(page);
  expect((await authorityEvidence(page)).totalDiscards).toBe(1);
});

test("real saved checkpoint rebases partial bank elapsed twice into new epochs without granting a base or double debit", async ({
  page,
}, testInfo) => {
  await openTimingProfile(page, NORMAL_FRAME_RATE_BROWSER_PROFILES[2]);
  const ready = await realReadyFrame(page);
  await page.evaluate(async () => {
    if (!window.timingHarness) {
      throw new Error("Timing harness is unavailable");
    }
    await window.timingHarness.foregroundGap(5_750);
  });
  const before = await authorityEvidence(page);
  expect(before.window?.baseEndsAt).toBeLessThan(before.authorityNow);
  const restore = async () =>
    page.evaluate(async () => {
      if (!window.timingHarness) {
        throw new Error("Timing harness is unavailable");
      }
      return window.timingHarness.restoreEpoch();
    });
  const first = await restore();
  const second = await restore();
  expect(first.currentWindow?.id).toBe(ready.window.id);
  expect(second.currentWindow?.id).toBe(ready.window.id);
  expect(first.currentWindow?.clockEpoch).not.toBe(ready.window.clockEpoch);
  expect(second.currentWindow?.clockEpoch).not.toBe(
    first.currentWindow?.clockEpoch
  );
  expect(first.currentRemainingMs).toBe(0);
  expect(second.currentRemainingMs).toBe(0);
  expect(second.currentWindow?.allowanceMs).toBe(ready.window.allowanceMs);
  expect(second.currentWindow?.bankAtOpenMs).toBe(20_000);
  const rebased = await authorityEvidence(page);
  expect(
    (rebased.window?.expiresAt ?? NaN) - rebased.authorityNow
  ).toBeLessThanOrEqual(
    (before.window?.expiresAt ?? NaN) - before.authorityNow
  );
  const accepted = await discardNow(page);
  const authority = await authorityEvidence(page);
  expect(authority.totalDiscards).toBe(1);
  expect(authority.receipts).toHaveLength(1);
  expect(authority.receipts[0].accepted).toBe(true);
  expect(authority.receipts[0].clockEpoch).toBe(
    second.currentWindow?.clockEpoch
  );
  const debitMs = Math.max(
    0,
    authority.receipts[0].receivedAt -
      (second.currentWindow?.baseEndsAt ?? NaN) -
      ready.window.allowanceMs
  );
  expect(authority.receipts[0].bankAfterMs).toBe(20_000 - debitMs);
  expect(authority.receipts[0].bankAfterMs).toBeLessThan(20_000);
  await persistTimingEvidence(testInfo, "real-checkpoint-partial-bank-rebase", {
    before,
    first,
    second,
    accepted,
    authority,
  });
});

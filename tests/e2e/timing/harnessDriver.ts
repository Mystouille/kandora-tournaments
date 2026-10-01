import { expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { FairnessProfile } from "../../../app/game/testing/timing/fairnessProfiles";
import {
  installControlledTransport,
  type ControlledTransport,
} from "./controlledTransport";
import type {
  BrowserTimingEvidence,
  ReadyFrameEvidence,
  RoomEvidence,
} from "./harness/evidence";
import { DEFERRED_30FPS_BROWSER_REASON } from "./browserProfiles";

const owned = new WeakMap<
  Page,
  { transport: ControlledTransport; errors: string[] }
>();

export async function persistTimingEvidence(
  testInfo: TestInfo,
  name: string,
  evidence: unknown
): Promise<void> {
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(evidence, null, 2), "utf8");
  await testInfo.attach(name, { path, contentType: "application/json" });
}

export async function openTimingProfile(
  page: Page,
  profile: FairnessProfile
): Promise<void> {
  if (profile.framesPerSecond === 30) {
    throw new Error(DEFERRED_30FPS_BROWSER_REASON);
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const transport = await installControlledTransport(page, profile);
  owned.set(page, { transport, errors });
  await page.goto(`/?game=1&profile=${encodeURIComponent(profile.name)}`);
  await expect(page.getByLabel("Decision status")).toHaveText("Ready");
}

export async function cleanupTimingPage(page: Page): Promise<void> {
  const resources = owned.get(page);
  try {
    if (!page.isClosed()) {
      await page.evaluate(async () => {
        await window.timingHarness?.dispose();
      });
    }
  } finally {
    resources?.transport.dispose();
    owned.delete(page);
  }
  expect(resources?.errors ?? [], "browser runtime errors").toEqual([]);
}

export function realReadyFrame(page: Page): Promise<ReadyFrameEvidence> {
  return page.evaluate(async () => {
    const harness = window.timingHarness;
    if (!harness) {
      throw new Error("The isolated timing harness was not mounted");
    }
    return harness.ready();
  });
}

export function browserEvidence(page: Page): Promise<BrowserTimingEvidence> {
  return page.evaluate(() => {
    const harness = window.timingHarness;
    if (!harness) {
      throw new Error("The isolated timing harness was not mounted");
    }
    return harness.evidence();
  });
}

export function authorityEvidence(page: Page): Promise<RoomEvidence> {
  return page.evaluate(async () => {
    const harness = window.timingHarness;
    if (!harness) {
      throw new Error("The isolated timing harness was not mounted");
    }
    return harness.authority();
  });
}

export function synchronizedClockError(
  page: Page
): Promise<{ errorMs: number; referenceRoundTripMs: number }> {
  return page.evaluate(async () => {
    const harness = window.timingHarness;
    if (!harness) {
      throw new Error("The isolated timing harness was not mounted");
    }
    return harness.clockError();
  });
}

export function discardAfterRealReady(
  page: Page,
  elapsedMs: number
): Promise<BrowserTimingEvidence> {
  return page.evaluate(async (elapsed) => {
    const harness = window.timingHarness;
    if (!harness) {
      throw new Error("The isolated timing harness was not mounted");
    }
    return harness.discardAfterReady(elapsed);
  }, elapsedMs);
}

export function discardNow(page: Page): Promise<BrowserTimingEvidence> {
  return page.evaluate(async () => {
    const harness = window.timingHarness;
    if (!harness) {
      throw new Error("The isolated timing harness was not mounted");
    }
    return harness.discardNow();
  });
}

export function assertAcceptedReceipt(
  browser: BrowserTimingEvidence,
  authority: RoomEvidence
): void {
  const { submitted } = browser;
  expect(
    submitted,
    "a real Pixi semantic callback submitted the input"
  ).not.toBeNull();
  if (!submitted || !browser.ready) {
    throw new Error("There is no measured input/ready interval");
  }
  const receipts = authority.receipts.filter(
    (receipt) =>
      receipt.actionId === submitted.actionId &&
      receipt.windowId === submitted.intent.windowId
  );
  expect(receipts).toHaveLength(1);
  const receipt = receipts[0];
  expect(receipt.accepted).toBe(true);
  expect(receipt.clockEpoch).toBe(submitted.intent.clockEpoch);
  expect(authority.totalDiscards).toBe(1);
  expect(receipt.resolvedAt).toBeGreaterThanOrEqual(receipt.receivedAt);
  const timing = browser.ready.window;
  const chargedMs = Math.max(
    0,
    receipt.receivedAt - timing.baseEndsAt - timing.allowanceMs
  );
  expect(receipt.bankAfterMs).toBe(timing.bankAtOpenMs - chargedMs);
}

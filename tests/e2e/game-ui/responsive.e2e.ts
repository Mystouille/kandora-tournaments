import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ServerMessage,
} from "../../../app/game/protocol/messages";
import {
  fixtureEvents,
  fixtureMatchId,
  fixtureRoom,
  fixtureSnapshot,
  fixtureViewers,
} from "./responsiveFixture";

const harnessUrl = `/@fs/${fileURLToPath(
  new URL("./responsiveHarness.tsx", import.meta.url)
).replaceAll("\\", "/")}`;
const browserErrors = new WeakMap<Page, string[]>();
const browserWarnings = new WeakMap<Page, string[]>();
const publishedText = new WeakMap<Page, string>();
const liveMessages = new WeakMap<Page, (message: ServerMessage) => void>();
const existingEditorWarnings = new Set([
  "Warning: [antd: Divider] `type` is deprecated. Please use `orientation` instead.",
  "Warning: [antd: Modal] `focusTriggerAfterClose` is deprecated. Please use `focusable.focusTriggerAfterClose` instead.",
]);
const sizes = [
  [1920, 1080, 1],
  [1280, 900, 1],
  [1024, 768, 0.8],
  [800, 600, 0.75],
  [640, 360, 0.75],
  [390, 844, 0.75],
  [844, 390, 0.75],
] as const;

test.setTimeout(120_000);
test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  const warnings: string[] = [];
  browserWarnings.set(page, warnings);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      if (existingEditorWarnings.has(message.text())) {
        warnings.push(message.text());
      } else {
        errors.push(message.text());
      }
    }
  });
  await page.route("**/ui/*", (route) => {
    if (!route.request().isNavigationRequest()) {
      return route.continue();
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="${harnessUrl}"></script></body></html>`,
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/game/session") {
      await route.fulfill({
        json: { token: "browser-fixture", wsUrl: null, wsPath: "/ui-fixture" },
      });
      return;
    }
    if (path === "/api/game/enrichment") {
      await route.fulfill({ json: { seats: [] } });
      return;
    }
    if (path === "/api/telemetry") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === "/api/replay-reviews" && route.request().method() === "POST") {
      await route.fulfill({ json: { ok: true, shortId: "browser-review" } });
      return;
    }
    if (
      path === "/api/replay-reviews/browser-review" &&
      route.request().method() === "PUT"
    ) {
      const body = z
        .object({
          eventIndex: z.number(),
          text: z.string(),
          seat: z.number(),
        })
        .parse(route.request().postDataJSON());
      publishedText.set(page, body.text);
      await route.fulfill({
        json: {
          ok: true,
          seat: body.seat,
          reviewers: [{ user: "browser-reviewer", name: "Browser reviewer" }],
          edit: {
            eventIndex: body.eventIndex,
            text: body.text,
            author: "browser-reviewer",
            authorName: "Browser reviewer",
            colorIndex: 0,
            drawingBase64: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      });
      return;
    }
    errors.push(`Unexpected API request: ${path}`);
    await route.fulfill({
      status: 500,
      json: { error: "Unexpected fixture request" },
    });
  });
  await page.routeWebSocket("**/ui-fixture/**", (socket) => {
    const send = (message: ServerMessage): void => {
      socket.send(JSON.stringify(ServerMessageSchema.parse(message)));
    };
    socket.onMessage((raw) => {
      const message = ClientMessageSchema.parse(JSON.parse(String(raw)));
      if (message.type !== "hello") {
        return;
      }
      const spectating = message.spectate === true;
      if (spectating) {
        liveMessages.set(page, send);
      }
      send(fixtureRoom(spectating));
      send({
        type: "snapshot",
        seq: 0,
        state: fixtureSnapshot(spectating),
        legalActions: [],
      });
      send({
        type: "event",
        seq: fixtureEvents.length,
        events: fixtureEvents,
        legalActions: [],
      });
      send({ type: "viewer_state", viewers: fixtureViewers });
    });
  });
  await page.routeWebSocket(
    (url) => url.pathname === "/" && url.searchParams.has("token"),
    (socket) => {
      socket.send(JSON.stringify({ type: "connected" }));
    }
  );
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await page.screenshot({ path: testInfo.outputPath("failure.png") });
  }
  if (browserWarnings.get(page)?.length) {
    await testInfo.attach("existing-editor-deprecations", {
      body: JSON.stringify(browserWarnings.get(page)),
      contentType: "application/json",
    });
  }
  expect(browserErrors.get(page)).toEqual([]);
});

async function open(page: Page, mode: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/ui/${mode}?event=4`);
  await expect(
    page.getByRole("button", { name: "Settings", exact: true })
  ).toBeVisible({ timeout: 30_000 });
  if (mode !== "unscaled") {
    await expect(
      page.locator(".web-table-ui canvas:not([aria-label])")
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        page
          .locator(".web-table-ui")
          .first()
          .evaluate((element) => ({
            scale: element.style.getPropertyValue("--web-table-ui-scale"),
            width: element.clientWidth,
            height: element.clientHeight,
          }))
      )
      .toEqual({ scale: "1", width: 1280, height: 900 });
    await expect(page.locator(".web-table-ui-status")).toHaveCount(0);
    await expect(page.locator(".web-table-ui-diagnostics")).toHaveCount(0);
    await expect(page.locator(".web-table-ui-header")).not.toContainText(
      fixtureMatchId
    );
    await expect(page.locator(".web-table-ui-header")).not.toContainText(
      "conn:"
    );
  }
  if (mode === "match" || mode === "spectate") {
    await expect(
      page.getByRole("complementary", { name: "Current viewers" })
    ).toContainText("30");
  }
}

async function scaledDimensions(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".web-table-ui");
    const settings = document.querySelector<HTMLElement>(
      'button[aria-label="Settings"]'
    );
    const actions = document.querySelector<HTMLElement>(
      ".web-table-top-controls"
    );
    if (!root || !settings || !actions) {
      throw new Error("Responsive control groups are missing.");
    }
    return {
      scale: Number(root.style.getPropertyValue("--web-table-ui-scale")),
      settings: settings.getBoundingClientRect().height,
      actionsRight: actions.getBoundingClientRect().right,
    };
  });
}

for (const mode of ["match", "spectate", "replay"]) {
  test(`${mode}: sizes controls across window sizes without resetting menus`, async ({
    page,
  }, testInfo) => {
    await open(page, mode);
    const menuLabel =
      mode === "match" ? "Expand options menu" : "Open overlay panel";
    await page.getByRole("button", { name: menuLabel, exact: true }).click();
    const openMenuLabel =
      mode === "match" ? "Collapse options menu" : "Close overlay panel";

    for (const [width, height, scale] of sizes) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(async () => (await scaledDimensions(page)).scale)
        .toBe(scale);
      await expect
        .poll(() =>
          page
            .locator(".web-table-ui")
            .first()
            .evaluate((element) =>
              element.style.getPropertyValue("--web-table-ui-height")
            )
        )
        .toBe(`${height}px`);
      const actual = await scaledDimensions(page);
      expect(actual.settings).toBeCloseTo(44 * scale, 0);
      expect(actual.actionsRight).toBeCloseTo(width - 8 * scale, 0);
      await expect(
        page.getByRole("button", { name: openMenuLabel, exact: true })
      ).toBeVisible();

      const label =
        mode === "match"
          ? page.locator(".web-table-live-menu-label").first()
          : page.locator(".web-table-overlay-body button").first();
      expect(
        await label.evaluate((element) =>
          parseFloat(getComputedStyle(element).fontSize)
        )
      ).toBeGreaterThanOrEqual(12);

      if (mode !== "replay") {
        const viewers = page.getByRole("complementary", {
          name: "Current viewers",
        });
        expect((await viewers.boundingBox())?.width).toBeCloseTo(
          192 * scale,
          0
        );
        const header = await page
          .getByRole("button", { name: "Hide viewer list" })
          .boundingBox();
        expect(header?.height).toBeGreaterThanOrEqual(24);
        const menu = await page
          .getByRole("button", { name: openMenuLabel, exact: true })
          .boundingBox();
        expect(header!.y + header!.height).toBeLessThanOrEqual(menu!.y + 1);
        expect(
          await page
            .locator(".web-table-viewer-row")
            .first()
            .evaluate((element) =>
              parseFloat(getComputedStyle(element).fontSize)
            )
        ).toBeGreaterThanOrEqual(12);
      }
      await page.screenshot({
        path: testInfo.outputPath(`${mode}-${width}x${height}.png`),
      });
    }
    await page
      .getByRole("button", { name: openMenuLabel, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: menuLabel, exact: true })
    ).toBeVisible();
  });
}

test("spectator controls, drawer closing, viewer scrolling, and minimum scaling remain usable", async ({
  page,
}) => {
  await open(page, "spectate");
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(async () => (await scaledDimensions(page)).scale)
    .toBe(0.75);
  const floor = await scaledDimensions(page);
  await page.setViewportSize({ width: 640, height: 360 });
  await expect
    .poll(async () => (await scaledDimensions(page)).settings)
    .toBe(floor.settings);

  const viewers = page.locator(".web-table-viewer-list ul");
  await viewers.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(
    await viewers.evaluate((element) => element.scrollTop)
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Hide viewer list" }).click();
  await expect(page.locator(".web-table-viewer-row")).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(
    page.getByRole("button", { name: "Show viewer list" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Open overlay panel" }).click();
  await page
    .getByRole("button", { name: "Show tsumogiri", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show tsumogiri", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close overlay panel" }).click();
  await expect
    .poll(async () => {
      const drawer = await page
        .locator(".web-table-overlay-body")
        .boundingBox();
      return drawer!.x + drawer!.width;
    })
    .toBeLessThanOrEqual(1);

  await page.getByLabel("Focus seat").selectOption("2");
  await expect(page.getByLabel("Focus seat")).toHaveValue("2");
  await page
    .getByRole("button", { name: "Previous event", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Go live", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Go live", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Go live", exact: true })
  ).toBeHidden();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const compact = page.getByRole("switch", { name: "Compact table" });
  await expect(compact).toHaveAttribute("aria-checked", "false");
  await compact.click();
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(compact).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(compact).toBeHidden();
});

test("live controls stay clickable and UI-only sizing does not change the board", async ({
  page,
}) => {
  await open(page, "match");
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(async () => (await scaledDimensions(page)).scale)
    .toBe(0.75);
  const autoWin = page.getByRole("button", {
    name: "Auto win (off)",
    exact: true,
  });
  await autoWin.click();
  await expect(
    page.getByRole("button", { name: "Auto win (on)", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Show controls" })).toHaveCount(
    0
  );
  await page.keyboard.press("Escape");
  const canvas = page.locator(".web-table-ui canvas:not([aria-label])");
  const before = await canvas.boundingBox();
  const element = await canvas.elementHandle();
  await page.locator(".web-table-ui").evaluate((root: HTMLElement) => {
    root.style.setProperty("--web-table-ui-scale", "1");
  });
  expect(await canvas.boundingBox()).toEqual(before);
  expect(
    await canvas.evaluate((current, original) => current === original, element)
  ).toBe(true);
});

for (const mode of ["spectate", "replay"]) {
  test(`${mode}: hides only right-side controls and preserves viewer state`, async ({
    page,
  }) => {
    await open(page, mode);
    const navigation = page.locator(".web-table-ui-navigation");
    const counter = navigation.locator(":scope > span");
    const canvas = page.locator(".web-table-ui canvas:not([aria-label])");
    const originalCanvas = await canvas.elementHandle();
    await expect(navigation).toBeVisible();
    await page.getByLabel("Focus seat").selectOption("2");
    const previousCounter = await counter.innerText();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const toggle = page.getByRole("switch", {
      name: "Show controls",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(navigation).toHaveCSS("display", "none");
    await expect(page.getByLabel("Focus seat")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Settings", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open overlay panel" })
    ).toBeVisible();
    if (mode === "spectate") {
      await expect(
        page.getByRole("button", { name: "Hide viewer list" })
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("button", { name: "Copy share link" })
      ).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(navigation).toBeHidden();

    if (mode === "spectate") {
      const send = liveMessages.get(page);
      if (!send) {
        throw new Error("Spectator fixture connection is missing.");
      }
      send({
        type: "event",
        seq: fixtureEvents.length + 2,
        events: [
          { type: "draw", seat: 0, tile: "9p", wallRemaining: 65 },
          {
            type: "discard",
            seat: 0,
            tile: "9p",
            tsumogiri: true,
            discardSource: "draw",
          },
        ],
        legalActions: [],
      });
      await expect(counter).toHaveText(
        `${fixtureEvents.length + 2} / ${fixtureEvents.length + 2}`
      );
    } else {
      await expect(counter).toHaveText(previousCounter);
    }

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.press("Space");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(navigation).toBeVisible();
    await expect(page.getByLabel("Focus seat")).toHaveValue("2");
    expect(
      await canvas.evaluate(
        (current, original) => current === original,
        originalCanvas
      )
    ).toBe(true);
  });
}

test("replay text drafts and local editor popups survive resizing", async ({
  page,
}, testInfo) => {
  await open(page, "replay");
  await page
    .getByRole("button", { name: "Add text comment", exact: true })
    .click();
  const editor = page.locator(".web-table-review-editor .ProseMirror");
  await editor.fill("A review draft that must survive resizing.");
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(async () => (await scaledDimensions(page)).scale)
    .toBe(0.75);
  await expect(editor).toContainText(
    "A review draft that must survive resizing."
  );
  const editorBox = await page
    .locator(".web-table-review-editor")
    .boundingBox();
  expect(editorBox?.width).toBeCloseTo(615, 0);
  await page.getByRole("button", { name: /Tiles$/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => (await dialog.boundingBox())?.width)
    .toBeCloseTo(240, 0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(editor).toContainText(
    "A review draft that must survive resizing."
  );
  await page.screenshot({
    path: testInfo.outputPath("review-editor-small.png"),
  });
  await page
    .locator(".web-table-review-editor")
    .getByRole("button", { name: /Save$/ })
    .click();
  await expect(page.locator(".web-table-review-comments")).toContainText(
    "A review draft that must survive resizing."
  );
  await expect(page.locator(".web-table-top-action").first()).toContainText(
    "Publish"
  );
  await page.locator(".web-table-top-action").first().click();
  await expect
    .poll(() => publishedText.get(page))
    .toContain("A review draft that must survive resizing.");
  await expect(page.locator(".web-table-top-action").first()).not.toContainText(
    "Publish"
  );
});

test("shared controls outside the browser sizing scope retain their original sizes", async ({
  page,
}) => {
  await open(page, "unscaled");
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 640, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      (
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .boundingBox()
      )?.height
    ).toBe(44);
    expect(
      (await page.locator(".web-table-viewer-list").boundingBox())?.width
    ).toBe(192);
    expect(
      await page
        .locator(".web-table-clock-notice")
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
    ).toBe(12);
  }
});

test.describe("high-density display", () => {
  test.use({ deviceScaleFactor: 2 });
  test("uses CSS-pixel sizing independently of device pixel density", async ({
    page,
  }) => {
    await open(page, "spectate");
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect
      .poll(async () => (await scaledDimensions(page)).scale)
      .toBe(0.8);
    expect((await scaledDimensions(page)).settings).toBeCloseTo(35.2, 0);
  });
});

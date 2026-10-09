import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const harnessUrl = `/@fs/${fileURLToPath(
  new URL("./responsiveHarness.tsx", import.meta.url)
).replaceAll("\\", "/")}`;
const browserErrors = new WeakMap<Page, string[]>();
const sizes = [
  { width: 320, height: 480 },
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 568, height: 320 },
] as const;

test.setTimeout(60_000);
test.use({ viewport: { width: 320, height: 568 } });

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.route(
    (url) => url.pathname === "/mobile-ui",
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="${harnessUrl}"></script></body></html>`,
      })
  );
  await page.route("**/api/mobile/lobby", (route) =>
    route.fulfill({
      json: {
        presets: [
          {
            id: "m-league",
            rulesFamily: "riichi",
            displayName: "M League",
            description: "Standard four-player match",
          },
          {
            id: "mcr-ema",
            rulesFamily: "mcr",
            displayName: "MCR",
          },
        ],
        rooms: [
          {
            matchId: "room-1",
            status: "waiting",
            presetId: "m-league",
            rulesFamily: "riichi",
            playerCount: 4,
            sanmaType: "online",
            buuMode: false,
            seats: [
              { name: "A very long player name", isBot: false },
              null,
              null,
              null,
            ],
          },
        ],
        tenhouLiveGames: [],
      },
    })
  );
  await page.routeWebSocket(
    (url) => url.pathname === "/" && url.searchParams.has("token"),
    (socket) => {
      socket.send(JSON.stringify({ type: "connected" }));
    }
  );
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

async function open(page: Page, mode: string): Promise<void> {
  await page.goto(`/mobile-ui?mode=${mode}`);
}

async function expectWithinViewport(
  page: Page,
  locator: Locator
): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      }))
    )
    .toEqual(
      await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: window.innerWidth,
      }))
    );
}

test("lobby rooms and create dialog stay accessible at mobile sizes", async ({
  page,
}) => {
  await open(page, "lobby");
  await expect(page.getByText("Lobby", { exact: true })).toBeVisible();

  for (const size of sizes) {
    await page.setViewportSize(size);
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "Join" })
    );
    await expectNoHorizontalOverflow(page);
  }

  await page.getByRole("button", { name: "Create a game" }).click();
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expectWithinViewport(page, page.getByRole("dialog"));
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "Create game" })
    );
    const scroll = await page
      .locator(".rule-modal-scroll")
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      }));
    expect(scroll.overflowY).toBe("auto");
    expect(scroll.scrollHeight).toBeGreaterThanOrEqual(scroll.clientHeight);
    if (size.height <= 480) {
      expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    }
  }
});

test("online and nearby controls remain reachable", async ({ page }) => {
  await open(page, "online-room");
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page
      .getByRole("button", { name: "Start game" })
      .scrollIntoViewIfNeeded();
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "Start game" })
    );
    await expectNoHorizontalOverflow(page);
  }

  await open(page, "nearby");
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.getByRole("button", { name: "Join" }).scrollIntoViewIfNeeded();
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "Join" })
    );
    await expectNoHorizontalOverflow(page);
  }
});

test("replay filters and full-screen overlays stay within the viewport", async ({
  page,
}) => {
  await open(page, "replays");
  await page.getByRole("button", { name: "Filters" }).click();
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expectWithinViewport(
      page,
      page.getByRole("complementary", { name: "Replay filters" })
    );
  }

  await open(page, "resume-modal");
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expectWithinViewport(page, page.getByRole("dialog"));
  }
});

test("expanded game and replay menus fit 320px-wide screens", async ({
  page,
}) => {
  for (const mode of ["game-menu", "replay-menu"]) {
    await open(page, mode);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await expectWithinViewport(page, page.getByRole("complementary"));
      await expectNoHorizontalOverflow(page);
    }
  }
});

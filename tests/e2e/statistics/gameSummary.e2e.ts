import { fileURLToPath } from "node:url";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import sharp from "sharp";
import { fr } from "../../../app/i18n/fr";
import { gameSummaryFixture } from "./gameSummaryFixture";

const summaryPath = "/games/100000000000000000000001/summary";
const harnessUrl = `/@fs/${fileURLToPath(
  new URL("./gameSummaryHarness.tsx", import.meta.url)
).replaceAll("\\", "/")}`;
const portrait = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="210">
  <rect width="180" height="210" fill="#274669"/>
  <circle cx="90" cy="73" r="38" fill="#f0c5a2"/>
  <path d="M25 210v-42q0-48 65-48t65 48v42" fill="#bacbd5"/>
  <path d="M50 62q5-54 45-41 39 1 38 51l-15-20-56 4z" fill="#17232c"/>
</svg>`;
const teamLogo = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
  <circle cx="200" cy="200" r="190" fill="#00ff00"/>
  <path d="M200 8 392 200 200 392 8 200Z" fill="#0000ff"/>
  <path d="M200 65 335 200 200 335 65 200Z" fill="#ff0000"/>
  <path d="M200 110 290 200 200 290 110 200Z" fill="#ffffff"/>
  <path d="M180 140h25v50l40-50h30l-48 60 48 60h-30l-40-50v50h-25z" fill="#101010"/>
</svg>`;

test.setTimeout(60_000);
test.use({
  viewport: { width: 1440, height: 1000 },
  screenshot: "only-on-failure",
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/games?**", (route) => {
    const fixture = gameSummaryFixture();
    return route.fulfill({
      json: {
        total: 1,
        games: [
          {
            gameId: fixture.platformGameId,
            summaryGameId: fixture.id,
            startTime: fixture.startTime,
            endTime: fixture.endTime,
            platform: "majsoul",
            replayUrl: null,
            players: fixture.players.map((player) => ({
              userId: player.id,
              name: player.name,
              avatarUrl: null,
              leaguePicture: null,
              teamName: player.teamName,
              teamPicture: null,
              score: player.score,
              place: player.place,
              deltaPoints: player.gamePoints,
            })),
          },
        ],
      },
    });
  });
  await page.route("**/api/ongoing-games?**", (route) =>
    route.fulfill({ json: { games: [] } })
  );
  await page.route("**/summary-assets/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: route.request().url().endsWith("/team-watermark.svg")
        ? teamLogo
        : portrait,
    })
  );
  await page.route(
    /\/(?:summary-fixture\/games|games\/[^/]+\/summary)(?:\?|$)/,
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><body><div id="root"></div><script type="module" src="${harnessUrl}"></script></body></html>`,
      })
  );
});

async function download(page: Page, testInfo: TestInfo, name: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const result = await pending;
  const path = testInfo.outputPath(`${name}.png`);
  await result.saveAs(path);
  expect(result.suggestedFilename()).toMatch(/^game-summary-.*\.png$/);
  await expect(
    page.getByRole("button", { name: "Share", exact: true })
  ).toBeEnabled();
  return path;
}

async function logicalBounds(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const canvas = element.closest("[data-summary-canvas]");
      if (!canvas) {
        throw new Error("The element is not inside the export canvas");
      }
      const outer = canvas.getBoundingClientRect();
      const inner = element.getBoundingClientRect();
      const scale = 1920 / outer.width;
      return {
        left: (inner.left - outer.left) * scale,
        top: (inner.top - outer.top) * scale,
        width: inner.width * scale,
        height: inner.height * scale,
      };
    });
}

function colorCount(pixels: Buffer, red: number, green: number, blue: number) {
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      pixels[index] === red &&
      pixels[index + 1] === green &&
      pixels[index + 2] === blue
    ) {
      count++;
    }
  }
  return count;
}

function averagePixelDifference(first: Buffer, second: Buffer) {
  expect(first.length).toBe(second.length);
  let difference = 0;
  for (let index = 0; index < first.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      difference += Math.abs(first[index + channel] - second[index + channel]);
    }
  }
  return difference / ((first.length / 4) * 3);
}

test("blends cropped, team-tinted logo watermarks with a real alpha fade in all three PNGs", async ({
  page,
}, testInfo) => {
  await page.goto(`${summaryPath}?fixture=watermarks`);
  for (const [screen, label] of [
    ["stats", "Statistics"],
    ["points", "Points evolution"],
    ["standings", "League standings"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const banner = page.locator(".gs-identity").first();
    const watermark = banner.locator(".gs-team-watermark");
    await expect(page.locator(".gs-team-watermark")).toHaveCount(4);
    await expect(watermark).toHaveAttribute("aria-hidden", "true");
    await expect(watermark).toHaveCSS("mix-blend-mode", "luminosity");
    await expect(watermark).toHaveCSS("opacity", "0.24");
    await expect(watermark.locator("img")).toHaveCSS(
      "filter",
      "grayscale(1) contrast(1.12)"
    );
    await expect(watermark.locator("img")).toHaveAttribute("alt", "");
    await expect(banner).toHaveCSS("isolation", "isolate");
    await expect(banner).toHaveCSS("overflow", "hidden");
    const geometry = await watermark.locator("img").evaluate((image) => {
      const banner = image.closest(".gs-identity");
      if (!banner) {
        throw new Error("The watermark must belong to a banner");
      }
      return {
        logoWidth: image.getBoundingClientRect().width,
        bannerWidth: banner.getBoundingClientRect().width,
      };
    });
    expect(geometry.logoWidth).toBeGreaterThan(geometry.bannerWidth);
    const bounds = await logicalBounds(page, ".gs-identity");
    const decorated = await download(page, testInfo, `${screen}-watermark`);
    const hidden = await page.addStyleTag({
      content: ".gs-team-watermark { visibility: hidden !important; }",
    });
    const plain = await download(page, testInfo, `${screen}-without-watermark`);
    await hidden.evaluate((element) => {
      if (!element.parentNode) {
        throw new Error("The temporary watermark style is not attached");
      }
      element.parentNode.removeChild(element);
    });
    const leftRegion = {
      left: Math.round(bounds.left + bounds.width * 0.1),
      top: Math.round(bounds.top + bounds.height - 8),
      width: Math.floor(bounds.width * 0.35),
      height: 4,
    };
    const rightRegion = {
      ...leftRegion,
      left: Math.round(bounds.left + bounds.width * 0.695),
      width: 4,
    };
    const [leftMarked, leftPlain, rightMarked, rightPlain] = await Promise.all([
      sharp(decorated).extract(leftRegion).ensureAlpha().raw().toBuffer(),
      sharp(plain).extract(leftRegion).ensureAlpha().raw().toBuffer(),
      sharp(decorated).extract(rightRegion).ensureAlpha().raw().toBuffer(),
      sharp(plain).extract(rightRegion).ensureAlpha().raw().toBuffer(),
    ]);
    expect(averagePixelDifference(leftMarked, leftPlain)).toBeGreaterThan(1);
    // Masked compositing can round a channel by one 8-bit level.
    expect(averagePixelDifference(rightMarked, rightPlain)).toBeLessThanOrEqual(
      1
    );
    let teamTintedPixels = 0;
    for (let index = 0; index < leftMarked.length; index += 4) {
      if (
        leftMarked[index] > leftMarked[index + 1] &&
        leftMarked[index] > leftMarked[index + 2]
      ) {
        teamTintedPixels++;
      }
    }
    expect(teamTintedPixels / (leftMarked.length / 4)).toBeGreaterThan(0.95);
    for (const sourceColor of [
      [0, 255, 0],
      [0, 0, 255],
      [255, 0, 0],
    ]) {
      expect(
        colorCount(leftMarked, sourceColor[0], sourceColor[1], sourceColor[2])
      ).toBe(0);
    }
  }
});

test("keeps portraits and PNG export working when decorative team logos fail to load", async ({
  page,
}, testInfo) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") {
      warnings.push(message.text());
    }
  });
  await page.route("**/summary-assets/team-watermark-missing.svg", (route) =>
    route.abort("failed")
  );
  await page.goto(`${summaryPath}?fixture=missing-watermarks`);
  await expect(page.locator(".gs-identity-copy").first()).toContainText(
    "Alice Martin"
  );
  await expect(page.locator(".gs-team-watermark")).toHaveCount(0);
  await expect(page.locator(".gs-portrait img").first()).toHaveAttribute(
    "src",
    "/summary-assets/player-0.svg"
  );
  expect(
    warnings.some((warning) =>
      warning.includes("Team watermark could not be loaded")
    )
  ).toBe(true);
  const path = await download(page, testInfo, "missing-watermarks");
  expect(await sharp(path).metadata()).toMatchObject({
    width: 1920,
    height: 1080,
  });
});

test("opens from a completed card, switches screens, and restores the filtered page", async ({
  page,
}) => {
  await page.goto("/summary-fixture/games?filter=kept");
  await page.getByRole("link", { name: "Game summary" }).click();
  await expect(page).toHaveURL(
    /\/games\/100000000000000000000001\/summary\?from=/
  );
  await expect(page.locator("[data-summary-canvas]")).toHaveAttribute(
    "data-summary-canvas",
    "stats"
  );
  await expect(page.locator(".gs-final-points").first()).toContainText(
    "44,100"
  );
  await expect(
    page.getByRole("columnheader", { name: "Player", exact: true })
  ).toBeEmpty();
  await expect(
    page.getByRole("columnheader", { name: "Place", exact: true })
  ).toBeEmpty();
  const gameTimes = page.locator(".gs-date .gs-time-range time");
  await expect(gameTimes).toHaveCount(2);
  await expect(gameTimes.first()).toHaveAttribute(
    "datetime",
    new Date(gameSummaryFixture().startTime).toISOString()
  );
  await expect(gameTimes.last()).toHaveAttribute(
    "datetime",
    new Date(gameSummaryFixture().endTime!).toISOString()
  );
  await page
    .getByRole("button", { name: "Points evolution", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Points evolution" })
  ).toBeVisible();
  await expect(gameTimes).toHaveCount(2);
  await page
    .getByRole("button", { name: "League standings", exact: true })
    .click();
  const eliminated = page.locator('[data-standing-id="team-3"]');
  await expect(
    page.getByRole("columnheader", { name: "Place", exact: true })
  ).toBeEmpty();
  await expect(
    page.getByRole("columnheader", { name: "Team", exact: true })
  ).toBeEmpty();
  await expect(gameTimes).toHaveCount(2);
  await expect(eliminated).toContainText("Eliminated");
  await expect(eliminated.locator(".gs-standing-rank")).toHaveText("3");
  await expect(eliminated.locator("[data-summary-total]")).toHaveText("-");
  await expect(eliminated.locator("[data-summary-difference]")).toHaveText("-");
  await expect(eliminated.locator("[data-summary-games]")).toHaveText("-");
  await page.getByRole("link", { name: "Back to results" }).click();
  await expect(page).toHaveURL(/\/summary-fixture\/games\?filter=kept$/);
});

test("exports widescreen PNGs with portraits and chart lines but no controls", async ({
  page,
}, testInfo) => {
  await page.goto(summaryPath);
  await expect(page.locator(".gs-portrait img").first()).toBeVisible();
  await page.addStyleTag({
    content:
      ".gs-toolbar { background: rgb(255,0,255) !important; padding: 24px; }",
  });
  const statsPath = await download(page, testInfo, "statistics");
  expect(await sharp(statsPath).metadata()).toMatchObject({
    width: 1920,
    height: 1080,
    format: "png",
  });
  const statsPixels = await sharp(statsPath).ensureAlpha().raw().toBuffer();
  expect(colorCount(statsPixels, 255, 0, 255)).toBe(0);
  expect(colorCount(statsPixels, 39, 70, 105)).toBeGreaterThan(500);

  await page
    .getByRole("button", { name: "Points evolution", exact: true })
    .click();
  const chartBounds = await logicalBounds(page, "[data-summary-chart]");
  const chartPath = await download(page, testInfo, "points");
  expect(await sharp(chartPath).metadata()).toMatchObject({
    width: 1920,
    height: 1080,
  });
  const chartPixels = await sharp(chartPath)
    .extract({
      left: Math.round(chartBounds.left),
      top: Math.round(chartBounds.top),
      width: Math.round(chartBounds.width),
      height: Math.round(chartBounds.height),
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (const [red, green, blue] of [
    [239, 117, 75],
    [83, 201, 149],
    [116, 169, 255],
    [234, 200, 88],
  ]) {
    expect(colorCount(chartPixels, red, green, blue)).toBeGreaterThan(100);
  }
  expect(
    colorCount(
      await sharp(chartPath).ensureAlpha().raw().toBuffer(),
      255,
      0,
      255
    )
  ).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("points-page.png"),
    fullPage: true,
  });
});

test("exports the entire long table including its final eliminated row", async ({
  page,
}, testInfo) => {
  await page.goto(`${summaryPath}?fixture=long`);
  await page
    .getByRole("button", { name: "League standings", exact: true })
    .click();
  const rows = page.locator(".gs-standings-table tbody tr");
  await expect(rows).toHaveCount(140);
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toContainText("Last eliminated entrant");
  await expect(last.locator(".gs-standing-rank")).toHaveText("140");
  await expect(last.locator("[data-summary-total]")).toHaveText("-");
  await expect(last.locator("[data-summary-games]")).toHaveText("-");
  const nameBounds = await logicalBounds(
    page,
    '[data-standing-id="team-140"] .gs-identity-copy strong'
  );
  const path = await download(page, testInfo, "full-standings");
  const metadata = await sharp(path).metadata();
  expect(metadata.height).toBeGreaterThan(9000);
  expect(metadata.width).toBeLessThanOrEqual(1920);
  const scale = metadata.width! / 1920;
  expect((nameBounds.top + nameBounds.height) * scale).toBeLessThan(
    metadata.height!
  );
  const pixels = await sharp(path)
    .extract({
      left: Math.floor(nameBounds.left * scale),
      top: Math.floor(nameBounds.top * scale),
      width: Math.floor(nameBounds.width * scale),
      height: Math.floor(nameBounds.height * scale),
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  let textPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 75 && pixels[i + 1] > 75 && pixels[i + 2] > 75) {
      textPixels++;
    }
  }
  expect(textPixels).toBeGreaterThan(100);
  const footerHeight = Math.ceil(90 * scale);
  const footerPixels = await sharp(path)
    .extract({
      left: 0,
      top: metadata.height! - footerHeight,
      width: metadata.width!,
      height: footerHeight,
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  expect(colorCount(footerPixels, 165, 187, 176)).toBeGreaterThan(15);
});

test("keeps partial data explicit and individual standings accessible on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${summaryPath}?fixture=missing`);
  await expect(page.locator(".gs-inline-notice")).toContainText(
    "Detailed game records are not available"
  );
  await expect(page.locator(".gs-final-points").first()).toContainText(
    "44,100"
  );
  await page
    .getByRole("button", { name: "Points evolution", exact: true })
    .click();
  await expect(page.locator(".gs-unavailable")).toContainText(
    "Detailed game records"
  );
  await page.goto(`${summaryPath}?fixture=individual`);
  const switcher = page.getByRole("button", {
    name: "League standings",
    exact: true,
  });
  await switcher.focus();
  await page.keyboard.press("Enter");
  await expect(switcher).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("columnheader", { name: "Player", exact: true })
  ).toBeVisible();
  await expect(page.locator(".gs-standings-table")).toContainText(
    "Alice Martin"
  );
});

test("shows gaps and scheduled totals with rank-only colors in the table and PNG", async ({
  page,
}, testInfo) => {
  await page.goto(summaryPath);
  await page
    .getByRole("button", { name: "League standings", exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "Point difference", exact: true })
  ).toBeVisible();
  const leader = page.locator('[data-standing-id="team-1"]');
  const second = page.locator('[data-standing-id="team-2"]');
  const eliminated = page.locator('[data-standing-id="team-3"]');
  await expect(leader.locator("[data-summary-difference]")).toHaveText("-");
  await expect(second.locator("[data-summary-difference]")).toHaveText("79.5");
  await expect(leader.locator("[data-summary-games]")).toHaveText("12/14");
  await expect(page.locator(".gs-standings-caption")).toHaveCount(0);
  await expect(page.getByText("Whole league", { exact: true })).toHaveCount(0);
  await expect(leader.locator(".gs-standing-rank")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)"
  );
  await expect(leader.locator(".gs-standing-rank")).toHaveCSS(
    "background-color",
    "rgb(168, 20, 20)"
  );
  await expect(second.locator(".gs-standing-rank")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)"
  );
  await expect(second.locator(".gs-standing-rank")).toHaveCSS(
    "background-color",
    "rgb(101, 59, 22)"
  );
  await expect(page.locator("[data-rank-highlight]")).toHaveCount(1);
  await expect(leader.locator("[data-summary-total]")).not.toHaveCSS(
    "background-color",
    "rgb(168, 20, 20)"
  );
  await expect(second.locator("[data-summary-total]")).not.toHaveCSS(
    "background-color",
    "rgb(101, 59, 22)"
  );
  await expect(eliminated.locator(".gs-standing-rank")).toHaveText("3");
  await expect(eliminated.locator(".gs-standing-rank")).toHaveCSS(
    "background-color",
    "rgb(75, 83, 87)"
  );
  await expect(eliminated.locator("[data-summary-total]")).toHaveText("-");
  await expect(eliminated.locator("[data-summary-difference]")).toHaveText("-");
  await expect(eliminated.locator("[data-summary-games]")).toHaveText("-");

  const path = await download(page, testInfo, "standings");
  const pixels = await sharp(path).ensureAlpha().raw().toBuffer();
  expect(colorCount(pixels, 168, 20, 20)).toBeGreaterThan(2000);
  expect(colorCount(pixels, 101, 59, 22)).toBeGreaterThan(2000);
});

test("exports green/red chevrons beside totals while preserving point gaps", async ({
  page,
}, testInfo) => {
  await page.goto(`${summaryPath}?fixture=trends`);
  await page
    .getByRole("button", { name: "League standings", exact: true })
    .click();
  const up = page.locator(
    '[data-standing-id="team-1"] [data-summary-total] [data-point-trend="up"]'
  );
  const down = page.locator(
    '[data-standing-id="team-2"] [data-summary-total] [data-point-trend="down"]'
  );
  await expect(up).toHaveCSS("color", "rgb(124, 223, 176)");
  await expect(up).toHaveAttribute("title", "Points gained: +64.1");
  await expect(up.getByRole("img", { name: "Points gained" })).toBeVisible();
  await expect(down).toHaveCSS("color", "rgb(255, 146, 137)");
  await expect(down).toHaveAttribute("title", "Points lost: -10.2");
  await expect(down.getByRole("img", { name: "Points lost" })).toBeVisible();
  await expect(
    page.locator('[data-standing-id="team-2"] [data-summary-difference]')
  ).toHaveText("79.5");
  await expect(
    page.locator("[data-summary-difference] .gs-point-trend")
  ).toHaveCount(0);
  await expect(page.locator(".gs-eliminated .gs-point-trend")).toHaveCount(0);
  const path = await download(page, testInfo, "standings-trends");
  const pixels = await sharp(path).ensureAlpha().raw().toBuffer();
  expect(colorCount(pixels, 124, 223, 176)).toBeGreaterThan(20);
  expect(colorCount(pixels, 255, 146, 137)).toBeGreaterThan(20);

  await page.goto(`${summaryPath}?fixture=unchanged`);
  await page
    .getByRole("button", { name: "League standings", exact: true })
    .click();
  await expect(page.locator(".gs-point-trend")).toHaveCount(0);
});

test("highlights qualifying ranks before finals and omits unknown game totals", async ({
  page,
}) => {
  await page.goto(`${summaryPath}?fixture=qualifying`);
  await page
    .getByRole("button", { name: "League standings", exact: true })
    .click();
  await expect(page.locator('[data-rank-highlight="qualified"]')).toHaveCount(
    2
  );
  for (const rank of await page
    .locator('[data-rank-highlight="qualified"]')
    .all()) {
    await expect(rank).toHaveCSS("background-color", "rgb(168, 20, 20)");
    await expect(rank).toHaveAttribute("title", "Currently qualified");
  }
  await page.goto(`${summaryPath}?fixture=unscheduled`);
  await page
    .getByRole("button", { name: "League standings", exact: true })
    .click();
  await expect(
    page.locator('[data-standing-id="team-1"] [data-summary-games]')
  ).toHaveText("12");
});

test("localizes labels and handles long names without overflowing the canvas", async ({
  page,
}) => {
  await page.goto(`${summaryPath}?fixture=long-names&locale=fr`);
  await expect(
    page.getByRole("button", { name: "Partager", exact: true })
  ).toBeVisible();
  await expect(page.locator(".gs-stats-table")).toContainText(
    "Alexandria Montgomery-Wellington"
  );
  await expect(page.locator(".gs-stats-table")).toContainText(
    fr.gameSummary.dealIns
  );
  const fits = await page
    .locator("[data-summary-canvas]")
    .evaluate((element) => element.scrollHeight <= element.clientHeight + 1);
  expect(fits).toBe(true);
});

test("reports export failure and allows a successful retry", async ({
  page,
}, testInfo) => {
  await page.goto(summaryPath);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    let calls = 0;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (calls++ === 0) {
        throw new Error("Deliberate export failure");
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByText(/The image could not be exported/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Share", exact: true })
  ).toBeEnabled();
  await expect(page.getByText("Image downloaded", { exact: true })).toHaveCount(
    0
  );
  await download(page, testInfo, "retry");
});

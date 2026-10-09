import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import {
  DUPLICATE_GENERATION_VERSION,
  MatchModeConfigSchema,
} from "../../../app/game/protocol/matchMode";
import { GameVariantSchema } from "../../../app/game/protocol/seat";
import { RulesFamilySchema } from "../../../app/game/protocol/rulesFamily";
import { SpectatorDelayMsSchema } from "../../../app/game/protocol/spectatorDelay";

const harnessUrl = `/@fs/${fileURLToPath(
  new URL("./lobbySetupHarness.tsx", import.meta.url)
).replaceAll("\\", "/")}`;
const surfaces = ["web", "mobile", "nearby"] as const;
type Surface = (typeof surfaces)[number];
const browserErrors = new WeakMap<Page, string[]>();
const setupOutputSchema = z
  .object({
    ...GameVariantSchema.shape,
    rulesFamily: RulesFamilySchema,
    preset: z.string(),
    mode: MatchModeConfigSchema,
    spectatorDelayMs: SpectatorDelayMsSchema,
  })
  .strict();
const presetMetadataSchema = z.object({
  id: z.string(),
  rulesFamily: RulesFamilySchema,
  displayName: z.string(),
  description: z.string().optional(),
});

// Read data without registering extra tsx loaders in Playwright's shared worker.
const allPresets = [
  "tenhou-hanchan",
  "tenhou-tonpuusen",
  "buu-east",
  "ema",
  "jpml-hanchan",
  "m-league",
  "mcr-ema",
].map((id) =>
  presetMetadataSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../../app/game/rules/presets/${id}.json`, import.meta.url),
        "utf8"
      )
    )
  )
);
const selectablePresets = allPresets.filter(
  (preset) => !["tenhou-hanchan", "tenhou-tonpuusen"].includes(preset.id)
);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  let created: unknown;
  await page.route("**/lobby-setup/*", async (route) => {
    if (!route.request().isNavigationRequest()) {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="${harnessUrl}"></script></body></html>`,
    });
  });
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/game/rooms") {
      if (route.request().method() === "POST") {
        const setup = setupOutputSchema.parse(route.request().postDataJSON());
        created = setup;
        await route.fulfill({
          json: { matchId: "lobby-ui-created", ...setup },
        });
      } else {
        await route.fulfill({ json: { rooms: [] } });
      }
    } else if (pathname === "/api/game/active-match") {
      await route.fulfill({ json: { activeMatch: null } });
    } else if (pathname === "/api/mobile/lobby") {
      await route.fulfill({
        json: {
          presets: selectablePresets,
          rooms: [],
          tenhouLiveGames: [],
        },
      });
    } else {
      errors.push(`Unexpected lobby request: ${pathname}`);
      await route.fulfill({ status: 500 });
    }
  });
  await page.route("**/game/lobby-ui-created", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<output data-testid="created-setup">${JSON.stringify(created).replaceAll("<", "\\u003c")}</output>`,
    });
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

async function openSetup(page: Page, surface: Surface): Promise<void> {
  await page.setViewportSize(
    surface === "web"
      ? { width: 1280, height: 900 }
      : { width: 390, height: 844 }
  );
  await page.goto(`/lobby-setup/${surface}`);
  if (surface === "mobile") {
    await page
      .getByRole("button", { name: "Create a game", exact: true })
      .click();
  }
}

async function createSetup(page: Page, surface: Surface) {
  await page
    .getByRole("button", {
      name:
        surface === "web"
          ? "Create room"
          : surface === "mobile"
            ? "Create game"
            : "Host",
      exact: true,
    })
    .click();
  const output = page.getByTestId("created-setup");
  await expect(output).toBeVisible();
  return setupOutputSchema.parse(
    JSON.parse((await output.textContent()) ?? "")
  );
}

for (const surface of surfaces) {
  test(`${surface}: defaults to Riichi, Yonma, and M-League in hierarchical order`, async ({
    page,
  }, testInfo) => {
    await openSetup(page, surface);
    await expect(
      page.getByRole("radio", { name: "Riichi", exact: true })
    ).toBeChecked();
    const yonma = page.getByRole("radio", {
      name: "Yonma (4 players)",
      exact: true,
    });
    await expect(yonma).toBeChecked();
    const gameType = page.getByRole("combobox", {
      name: "Game type",
      exact: true,
    });
    await expect(gameType).toHaveValue("m-league");
    const catalog = surface === "nearby" ? allPresets : selectablePresets;
    await expect(gameType.locator("option")).toHaveText(
      catalog
        .filter((preset) => preset.rulesFamily === "riichi")
        .map((preset) => preset.displayName)
    );
    await expect(gameType.locator('option[value="mcr-ema"]')).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Sanma game type", exact: true })
    ).toHaveCount(0);
    const duplicate = page.getByRole("group", {
      name: "Duplicate",
      exact: true,
    });
    await expect(
      duplicate.getByRole("switch", { name: "Duplicate mode" })
    ).not.toBeChecked();
    await expect(
      page.getByLabel("Duplicate seed", { exact: true })
    ).toHaveCount(0);
    const gameTypeBounds = await gameType.boundingBox();
    const duplicateBounds = await duplicate.boundingBox();
    expect(gameTypeBounds).not.toBeNull();
    expect(duplicateBounds).not.toBeNull();
    expect(duplicateBounds!.y).toBeGreaterThan(gameTypeBounds!.y);
    await page.screenshot({
      path: testInfo.outputPath(`${surface}-default.png`),
    });
    expect(await createSetup(page, surface)).toEqual({
      preset: "m-league",
      rulesFamily: "riichi",
      playerCount: 4,
      sanmaType: "online",
      mode: { type: "normal" },
      spectatorDelayMs: 0,
    });
  });

  test(`${surface}: switches game types without mixing presets or losing Duplicate settings`, async ({
    page,
  }) => {
    await openSetup(page, surface);
    const gameType = page.getByRole("combobox", {
      name: "Game type",
      exact: true,
    });
    await gameType.selectOption("ema");
    await page
      .getByRole("radio", { name: "Sanma (3 players)", exact: true })
      .check();
    await expect(gameType).toHaveCount(0);
    const sanmaType = page.getByRole("combobox", {
      name: "Sanma game type",
      exact: true,
    });
    await expect(sanmaType.locator("option")).toHaveText(["Online", "Kansai"]);
    await sanmaType.selectOption("kansai");
    const duplicate = page.getByRole("switch", {
      name: "Duplicate mode",
      exact: true,
    });
    await duplicate.check();
    await page
      .getByLabel("Duplicate seed", { exact: true })
      .fill("Lobby Board");

    await page.getByRole("radio", { name: "MCR", exact: true }).check();
    await expect(
      page.getByRole("radio", { name: "Yonma (4 players)", exact: true })
    ).toHaveCount(0);
    await expect(gameType).toHaveCount(0);
    await expect(sanmaType).toHaveCount(0);
    await expect(duplicate).toBeChecked();
    await expect(
      page.getByLabel("Duplicate seed", { exact: true })
    ).toHaveValue("Lobby Board");

    await page.getByRole("radio", { name: "Riichi", exact: true }).check();
    await page
      .getByRole("radio", { name: "Yonma (4 players)", exact: true })
      .check();
    await expect(gameType).toHaveValue("ema");
    await page
      .getByRole("radio", { name: "Sanma (3 players)", exact: true })
      .check();
    await sanmaType.selectOption("kansai");
    await duplicate.uncheck();
    await expect(
      page.getByLabel("Duplicate seed", { exact: true })
    ).toHaveCount(0);
    await duplicate.check();
    await expect(
      page.getByLabel("Duplicate seed", { exact: true })
    ).toHaveValue("Lobby Board");
    expect(await createSetup(page, surface)).toMatchObject({
      preset: "m-league",
      rulesFamily: "riichi",
      playerCount: 3,
      sanmaType: "kansai",
      mode: {
        type: "duplicate",
        seed: "Lobby Board",
        generationVersion: DUPLICATE_GENERATION_VERSION,
      },
    });
  });

  test(`${surface}: creates MCR independently of the Riichi selectors`, async ({
    page,
  }, testInfo) => {
    await openSetup(page, surface);
    await page.getByRole("radio", { name: "MCR", exact: true }).check();
    await expect(
      page.getByRole("combobox", { name: "Game type", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Sanma game type", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("radio", { name: "Yonma (4 players)", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("switch", { name: "Duplicate mode" })
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${surface}-mcr.png`) });
    expect(await createSetup(page, surface)).toMatchObject({
      preset: "mcr-ema",
      rulesFamily: "mcr",
      playerCount: 4,
      sanmaType: "online",
      mode: { type: "normal" },
    });
  });
}

test("segmented choices support keyboard navigation and busy controls remain disabled", async ({
  page,
}) => {
  await openSetup(page, "web");
  await page.getByRole("radio", { name: "Riichi", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "MCR", exact: true })
  ).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("radio", { name: "Riichi", exact: true })
  ).toBeChecked();
  await page
    .getByRole("radio", { name: "Yonma (4 players)", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Sanma (3 players)", exact: true })
  ).toBeChecked();

  await page.goto("/lobby-setup/nearby?busy=1");
  for (const radio of await page.getByRole("radio").all()) {
    await expect(radio).toBeDisabled();
  }
  await expect(
    page.getByRole("combobox", { name: "Game type", exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole("switch", { name: "Duplicate mode" })
  ).toBeDisabled();
});

test("mobile selectors fit narrow screens with touch-sized choices", async ({
  page,
}, testInfo) => {
  await openSetup(page, "mobile");
  await page.setViewportSize({ width: 320, height: 720 });
  for (const name of [
    "Riichi",
    "MCR",
    "Yonma (4 players)",
    "Sanma (3 players)",
  ]) {
    const label = page.getByRole("radio", { name, exact: true }).locator("..");
    const bounds = await label.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  }
  const dialog = page.getByRole("dialog", { name: "Create a game" });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-narrow.png") });
});

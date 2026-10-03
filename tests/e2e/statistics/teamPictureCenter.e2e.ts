import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import type { TeamPicturePair } from "../../../app/types/pictures";

const leagueId = "200000000000000000000001";
const teamId = "400000000000000000000001";
const noPictureTeamId = "400000000000000000000002";
const adminPath = `/admin/online-tournaments/${leagueId}/edit-team-pictures`;
const harnessUrl = `/@fs/${fileURLToPath(new URL("./gameSummaryHarness.tsx", import.meta.url)).replaceAll("\\", "/")}`;
const image = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
  <rect width="400" height="400" fill="#152e3b"/>
  <rect y="80" width="400" height="70" fill="#efffff"/>
  <rect y="240" width="400" height="80" fill="#60d0b0"/>
</svg>`;

test.use({
  viewport: { width: 1200, height: 1000 },
  screenshot: "only-on-failure",
});

async function fixture(page: Page) {
  const state: {
    pictures: TeamPicturePair;
    patches: { teamId: string; fullPicture: string; summaryCenterY: number }[];
    failure: number;
  } = {
    pictures: {
      fullPicture: "/center-assets/full.svg",
      croppedPicture: "/center-assets/cropped.svg",
      summaryCenterY: 0.5,
    },
    patches: [],
    failure: 0,
  };
  await page.route("**/api/online-tournaments", (route) =>
    route.fulfill({
      json: [{ _id: leagueId, slug: "center-fixture" }],
    })
  );
  await page.route("**/api/online-tournaments/center-fixture", (route) =>
    route.fulfill({
      json: {
        _id: leagueId,
        name: "Center fixture",
        slug: "center-fixture",
        withTeams: true,
        teams: [
          {
            _id: teamId,
            simpleName: "focus",
            displayName: "Focus team",
            color: "#2ca02c",
            pictures: state.pictures,
          },
          {
            _id: noPictureTeamId,
            simpleName: "empty",
            displayName: "No picture team",
            pictures: null,
          },
        ],
      },
    })
  );
  await page.route("**/api/admin/league-team-picture", async (route) => {
    if (route.request().method() === "PATCH") {
      const body: {
        teamId: string;
        fullPicture: string;
        summaryCenterY: number;
      } = route.request().postDataJSON();
      state.patches.push(body);
      if (state.failure) {
        await route.fulfill({
          status: state.failure,
          json: { error: "Save failed" },
        });
        return;
      }
      expect(body.teamId).toBe(teamId);
      expect(body.fullPicture).toBe(state.pictures.fullPicture);
      state.pictures = {
        ...state.pictures,
        summaryCenterY: body.summaryCenterY,
      };
    } else {
      expect(route.request().method()).toBe("PUT");
      state.pictures = {
        fullPicture: "/center-assets/replacement.svg",
        croppedPicture: "/center-assets/replacement-crop.svg",
        summaryCenterY: 0.5,
      };
    }
    await route.fulfill({ json: { success: true, pictures: state.pictures } });
  });
  await page.route("**/center-assets/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: image,
    })
  );
  await page.route(
    /\/admin\/online-tournaments\/[^/]+\/edit-team-pictures(?:\?|$)/,
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body><div id="root"></div><script type="module" src="${harnessUrl}"></script></body></html>`,
      })
  );
  await page.goto(adminPath);
  return state;
}

async function openCenter(page: Page) {
  await page
    .locator(`[data-team-picture-id="${teamId}"]`)
    .getByRole("button", { name: "Center picture", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Center picture: Focus team",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Save center", exact: true })
  ).toBeEnabled();
  await dialog.locator(".team-picture-center-source").click({ trial: true });
  return dialog;
}

async function selectCenter(page: Page, ratio: number) {
  const frame = page.locator(".team-picture-center-source");
  const size = await frame.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  if (size.width === 0 || size.height === 0) {
    throw new Error("The source picture is not visible");
  }
  await frame.click({
    position: { x: size.width / 2, y: size.height * ratio },
  });
  await expect(page.locator("[data-center-line]")).toHaveAttribute(
    "data-center-line",
    String(ratio)
  );
}

test("saves a chosen horizontal line, previews all crops and reloads the stored center", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await expect(
    page
      .locator(`[data-team-picture-id="${noPictureTeamId}"]`)
      .getByRole("button", { name: "Center picture", exact: true })
  ).toBeDisabled();
  const dialog = await openCenter(page);
  await selectCenter(page, 0.25);
  await expect(dialog.locator(".gs-team-watermark img")).toHaveCount(3);
  for (const image of await dialog.locator(".gs-team-watermark img").all()) {
    await expect(image).toHaveAttribute("data-summary-center-y", "0.25");
    await expect(image).toBeVisible();
  }
  await dialog.screenshot({
    path: testInfo.outputPath("centering-dialog.png"),
  });
  await dialog
    .getByRole("button", { name: "Save center", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(state.pictures.summaryCenterY).toBe(0.25);
  expect(state.patches).toHaveLength(1);
  await page.reload();
  const reopened = await openCenter(page);
  await expect(
    reopened.getByRole("slider", { name: "Vertical center" })
  ).toHaveAttribute("aria-valuenow", "25");
  await expect(reopened.locator("[data-center-line]")).toHaveAttribute(
    "data-center-line",
    "0.25"
  );
});

test("does not allow saving when the full image cannot be loaded", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.route("**/center-assets/full.svg", (route) =>
    route.abort("failed")
  );
  await page
    .locator(`[data-team-picture-id="${teamId}"]`)
    .getByRole("button", { name: "Center picture", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Center picture: Focus team",
    exact: true,
  });
  await expect(
    dialog.getByText("The picture could not be loaded.", { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save center", exact: true })
  ).toBeDisabled();
  expect(state.patches).toHaveLength(0);
});

test("supports dragging, keyboard adjustment, reset and cancel without writing", async ({
  page,
}) => {
  const state = await fixture(page);
  const dialog = await openCenter(page);
  const frame = await dialog
    .locator(".team-picture-center-source")
    .boundingBox();
  if (!frame) {
    throw new Error("The source picture is not visible");
  }
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    frame.x + frame.width / 2,
    frame.y + frame.height * 0.75
  );
  await page.mouse.up();
  await expect(dialog.locator("[data-center-line]")).toHaveAttribute(
    "data-center-line",
    "0.75"
  );
  await dialog
    .getByRole("button", { name: "Reset to middle", exact: true })
    .click();
  const slider = dialog.getByRole("slider", { name: "Vertical center" });
  await expect(slider).toHaveAttribute("aria-valuenow", "50");
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(dialog.locator("[data-center-line]")).toHaveAttribute(
    "data-center-line",
    "0"
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.patches).toHaveLength(0);
  const reopened = await openCenter(page);
  await expect(reopened.locator("[data-center-line]")).toHaveAttribute(
    "data-center-line",
    "0.5"
  );
});

for (const status of [500, 409]) {
  test(`keeps a failed center save open without claiming success (${status})`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.failure = status;
    const dialog = await openCenter(page);
    await selectCenter(page, 0.75);
    await dialog
      .getByRole("button", { name: "Save center", exact: true })
      .click();
    await expect(
      page.getByText(
        status === 409
          ? "This team's picture has changed. Reload the page before centering it."
          : "Failed to save team picture",
        { exact: true }
      )
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(state.pictures.summaryCenterY).toBe(0.5);
    await expect(
      page.getByText("Picture center saved", { exact: true })
    ).toHaveCount(0);
  });
}

test("uses server-stored refs after uploading before saving a center", async ({
  page,
}) => {
  const state = await fixture(page);
  const card = page.locator(`[data-team-picture-id="${teamId}"]`);
  const bytes = await sharp({
    create: { width: 40, height: 80, channels: 4, background: "#31857b" },
  })
    .png()
    .toBuffer();
  await card.locator('input[type="file"]').setInputFiles({
    name: "new-team.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  const cropper = page.getByRole("dialog", {
    name: "Team Pictures",
    exact: true,
  });
  const upload = cropper.getByRole("button", { name: "Upload", exact: true });
  await expect(upload).toBeEnabled();
  await upload.click();
  await expect(
    page.getByText("Team picture saved successfully", { exact: true })
  ).toBeVisible();
  const dialog = await openCenter(page);
  await selectCenter(page, 0.75);
  await dialog
    .getByRole("button", { name: "Save center", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(state.patches[0].fullPicture).toBe("/center-assets/replacement.svg");
  expect(state.pictures.summaryCenterY).toBe(0.75);
});

import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { FocusedDiscardDrawingFrame } from "../../../app/game/client/pixi/geometry/reviewDrawingGeometry";
import type { Stroke } from "../../../app/game/replay/reviewDrawing";

const harnessUrl = `/@fs/${fileURLToPath(
  new URL("./drawingHarness.tsx", import.meta.url)
).replaceAll("\\", "/")}`;
const browserErrors = new WeakMap<Page, string[]>();

interface DrawingState {
  mode: string;
  frame: FocusedDiscardDrawingFrame | null;
  strokes: Stroke[];
  target: { x: number; y: number };
}

async function state(page: Page): Promise<DrawingState> {
  return JSON.parse(
    (await page.getByTestId("drawing-state").textContent()) ?? "{}"
  );
}

async function layout(page: Page, mode: string) {
  await page.getByLabel("Layout").selectOption(mode);
  await expect
    .poll(async () => {
      const value = await state(page);
      return value.mode === mode && value.frame !== null;
    })
    .toBe(true);
  await page.waitForTimeout(80);
}

async function drawCross(page: Page) {
  const { target } = await state(page);
  const board = (await page.getByTestId("board").boundingBox())!;
  const x = board.x + target.x;
  const y = board.y + target.y;
  for (const sign of [-1, 1]) {
    await page.mouse.move(x - 12, y - 12 * sign);
    await page.mouse.down();
    await page.mouse.move(x + 12, y + 12 * sign, { steps: 16 });
    await page.mouse.up();
  }
  await expect.poll(async () => (await state(page)).strokes.length).toBe(2);
}

async function expectAlignedCross(page: Page) {
  await expect
    .poll(async () => {
      const current = await state(page);
      const frame = current.frame;
      const board = await page.getByTestId("board").boundingBox();
      if (!frame || !board) {
        return Infinity;
      }
      const aspect = current.mode === "mobile" ? 1280 / 720 : 1000 / 926;
      const expectedWidth = Math.min(board.width, board.height * aspect);
      if (Math.abs(frame.table.w - expectedWidth) > 0.001) {
        return Infinity;
      }
      return page
        .getByLabel("Review drawing")
        .last()
        .evaluate(
          (element, { target, table }) => {
            const canvas = element as HTMLCanvasElement;
            const rect = canvas.getBoundingClientRect();
            const sx = canvas.width / rect.width;
            const sy = canvas.height / rect.height;
            const targetX = (target.x - table.x) * sx;
            const targetY = (target.y - table.y) * sy;
            const ctx = canvas.getContext("2d")!;
            let nearest = Infinity;
            const left = Math.floor(targetX) - 4;
            const top = Math.floor(targetY) - 4;
            const pixels = ctx.getImageData(left, top, 10, 10).data;
            for (let row = 0; row < 10; row++) {
              for (let column = 0; column < 10; column++) {
                const x = left + column;
                const y = top + row;
                if (pixels[(row * 10 + column) * 4 + 3] > 100) {
                  nearest = Math.min(
                    nearest,
                    Math.hypot(
                      (x + 0.5 - targetX) / sx,
                      (y + 0.5 - targetY) / sy
                    )
                  );
                }
              }
            }
            return nearest;
          },
          { target: current.target, table: frame.table }
        );
    })
    .toBeLessThanOrEqual(1);
  const current = await state(page);
  expect(
    current.strokes.every((stroke) => stroke.space === "focused-discard")
  ).toBe(true);
}

async function drawCircleAndLongStroke(page: Page) {
  const { target, frame } = await state(page);
  const board = (await page.getByTestId("board").boundingBox())!;
  const cx = board.x + target.x;
  const cy = board.y + target.y;
  await page.mouse.move(cx + 20, cy);
  await page.mouse.down();
  for (let step = 1; step <= 32; step++) {
    const angle = (step * Math.PI) / 16;
    await page.mouse.move(cx + Math.cos(angle) * 20, cy + Math.sin(angle) * 20);
  }
  await page.mouse.up();
  await page.mouse.move(
    board.x + frame!.table.x + 6,
    board.y + frame!.table.y + 6
  );
  await page.mouse.down();
  await page.mouse.move(cx - 50, cy - 50, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).strokes.length).toBe(4);
  const last = (await state(page)).strokes[3];
  expect(last.points[0].x).toBeLessThan(0);
  expect(last.points[0].y).toBeLessThan(0);
}

for (const dpr of [1, 2]) {
  test.describe(`focused discard drawings, DPR ${dpr}`, () => {
    test.setTimeout(120_000);
    test.use({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: dpr,
    });
    test.beforeEach(async ({ page }) => {
      const errors: string[] = [];
      browserErrors.set(page, errors);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/review-drawing-test", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html><body><div id="root"></div><script type="module" src="${harnessUrl}"></script></body></html>`,
        })
      );
      await page.goto("/review-drawing-test");
      await layout(page, "standard");
    });
    test.afterEach(async ({ page }) => {
      expect(browserErrors.get(page)).toEqual([]);
    });

    for (const author of ["standard", "compact"]) {
      test(`keeps ${author} marks on the riichi tile after save, reload and every layout`, async ({
        page,
      }) => {
        await layout(page, author);
        await drawCross(page);
        await drawCircleAndLongStroke(page);
        await page
          .getByRole("button", { name: "Save drawing", exact: true })
          .click();
        await page.reload();
        await layout(page, "standard");
        for (const viewer of ["standard", "compact", "mobile"]) {
          await layout(page, viewer);
          await expectAlignedCross(page);
          await page.setViewportSize({ width: 920, height: 700 });
          await expectAlignedCross(page);
          await page.setViewportSize({ width: 1280, height: 900 });
        }
        await page
          .getByRole("button", { name: "Second reviewer", exact: true })
          .click();
        await expect(page.getByLabel("Review drawing")).toHaveCount(2);
        const colors = await page
          .getByLabel("Review drawing")
          .evaluateAll((canvases) =>
            canvases.map((element) => {
              const canvas = element as HTMLCanvasElement;
              const ctx = canvas.getContext("2d")!;
              return ctx.strokeStyle;
            })
          );
        expect(colors).toEqual(["#3b82f6", "#f97316"]);
      });
    }

    test("restores an unpublished draft and cancels capture when the event changes", async ({
      page,
    }) => {
      await drawCross(page);
      await page.reload();
      await layout(page, "compact");
      await expectAlignedCross(page);
      await page
        .getByRole("button", { name: "Remove drawing", exact: true })
        .click();
      await expect.poll(async () => (await state(page)).strokes.length).toBe(0);
      const board = (await page.getByTestId("board").boundingBox())!;
      const { target } = await state(page);
      await page.mouse.move(board.x + target.x, board.y + target.y);
      await page.mouse.down();
      await page.mouse.move(board.x + target.x + 30, board.y + target.y + 30);
      await page
        .getByRole("button", { name: "Next event", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await page.mouse.up();
      expect((await state(page)).strokes).toHaveLength(0);
    });

    test("finishes a stroke on layout change and keeps cancellation separate from saved data", async ({
      page,
    }) => {
      await drawCross(page);
      await page
        .getByRole("button", { name: "Save drawing", exact: true })
        .click();
      const board = (await page.getByTestId("board").boundingBox())!;
      const { target } = await state(page);
      await page.mouse.move(board.x + target.x, board.y + target.y);
      await page.mouse.down();
      await page.mouse.move(board.x + target.x + 50, board.y + target.y + 40);
      await layout(page, "compact");
      await page.mouse.up();
      await expect.poll(async () => (await state(page)).strokes.length).toBe(3);
      await page
        .getByRole("button", { name: "Cancel drawing", exact: true })
        .click();
      expect((await state(page)).strokes).toHaveLength(2);
      await page.reload();
      await layout(page, "mobile");
      await expectAlignedCross(page);
      expect((await state(page)).strokes).toHaveLength(2);
    });
  });
}

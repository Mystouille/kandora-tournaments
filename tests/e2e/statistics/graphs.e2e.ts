import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { Series } from "../../../app/components/scoreEvolutionData";

const days = [
  "2026-08-30",
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
];
const series: Series[] = [
  {
    id: "team-1",
    label: "Team One",
    eliminatedAt: "2026-09-01",
    data: days.map((x, index) => ({ x, y: (index + 1) * 10 })),
  },
  {
    id: "team-2",
    label: "Team Two",
    data: days.map((x, index) => ({ x, y: (index + 1) * 5 })),
  },
];
const harnessUrl = `/@fs/${fileURLToPath(
  new URL("./graphsHarness.tsx", import.meta.url)
).replaceAll("\\", "/")}`;

test.use({
  viewport: { width: 1200, height: 1600 },
  screenshot: "only-on-failure",
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/score-evolution?**", (route) =>
    route.fulfill({ json: { series } })
  );
  await page.route("**/statistics-graphs", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><body>
        <div id="root"></div>
        <script type="module" src="${harnessUrl}"></script>
      </body></html>`,
    })
  );
  await page.goto("/statistics-graphs");
  await expectSelectedDay(page, 4);
});

async function expectSelectedDay(page: Page, index: number) {
  await expect(
    page.getByText(`Score Breakdown \u2014 ${days[index]}`, { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("slider")).toHaveAttribute(
    "aria-valuenow",
    String(index)
  );
}

async function clickDateSlice(page: Page, graphIndex: number, index: number) {
  const graph = page
    .locator("svg")
    .filter({ has: page.getByText("Date", { exact: true }) })
    .nth(graphIndex);
  await graph.scrollIntoViewIfNeeded();
  const graphBounds = await graph.boundingBox();
  const dateBounds = await graph
    .getByText(days[index], { exact: true })
    .boundingBox();
  if (!graphBounds || !dateBounds) {
    throw new Error("The graph or its date tick is not visible");
  }
  const position = {
    x: dateBounds.x + dateBounds.width / 2 - graphBounds.x,
    y: 60,
  };
  await graph.hover({ position });
  await expect(
    page.locator("strong").filter({ hasText: new RegExp(`^${days[index]}$`) })
  ).toBeVisible();
  await graph.click({ position });
}

async function expectHistogramScore(page: Page, value: number) {
  const label = page
    .locator("svg")
    .filter({ hasNot: page.getByText("Date", { exact: true }) })
    .getByText("Team One", { exact: true });
  await label.scrollIntoViewIfNeeded();
  await label.hover({ force: true });
  await expect(
    page.locator("strong").filter({ hasText: new RegExp(`^${value}$`) })
  ).toBeVisible();
}

test("all-phases charts preserve history and display the carry-over step", async ({
  page,
}) => {
  const carryOverDays = ["2026-08-15", "2026-09-01", "2026-09-15"];
  await page.route("**/api/score-evolution?**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("phaseFilter")).toBe(
      "both"
    );
    return route.fulfill({
      json: {
        series: [
          {
            id: "team-1",
            label: "Team One",
            data: carryOverDays.map((x, i) => ({ x, y: [60, 30, 90][i] })),
          },
          {
            id: "team-2",
            label: "Team Two",
            data: carryOverDays.map((x, i) => ({ x, y: [10, 5, 5][i] })),
          },
        ],
      },
    });
  });
  await page.reload();
  await expect(
    page.getByText(`Score Breakdown \u2014 ${carryOverDays[2]}`, {
      exact: true,
    })
  ).toBeVisible();
  await expectHistogramScore(page, 90);
  await page.getByRole("slider").focus();
  await page.getByRole("slider").press("Home");
  await expect(
    page.getByText(`Score Breakdown \u2014 ${carryOverDays[0]}`, {
      exact: true,
    })
  ).toBeVisible();
  await expectHistogramScore(page, 60);
  await page.getByRole("slider").focus();
  await page.getByRole("slider").press("ArrowRight");
  await expect(
    page.getByText(`Score Breakdown \u2014 ${carryOverDays[1]}`, {
      exact: true,
    })
  ).toBeVisible();
  await expectHistogramScore(page, 30);
});

for (const [graphIndex, graphName] of ["ranking", "score"].entries()) {
  test(`${graphName} slices update the histogram after slider use`, async ({
    page,
  }) => {
    await page.getByRole("slider").focus();
    await page.getByRole("slider").press("Home");
    await expectSelectedDay(page, 0);

    await clickDateSlice(page, graphIndex, 2);
    await expectSelectedDay(page, 2);
    await expectHistogramScore(page, 30);

    await clickDateSlice(page, graphIndex, 1);
    await expectSelectedDay(page, 1);
    await expectHistogramScore(page, 20);
  });

  test(`${graphName} slices seek replay and update the histogram after pausing`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const replay = page.getByRole("button");
    await replay.click();
    await expectSelectedDay(page, 0);
    await page.clock.runFor(1000);
    await expectSelectedDay(page, 1);

    await clickDateSlice(page, graphIndex, 3);
    await expectSelectedDay(page, 3);
    await page.clock.runFor(1000);
    await expectSelectedDay(page, 4);
    await replay.click();

    await clickDateSlice(page, graphIndex, 1);
    await expectSelectedDay(page, 1);
    await page.clock.runFor(2000);
    await expectSelectedDay(page, 1);
  });
}

import { expect, test } from "@playwright/test";

test("actual browser synchronizes with a real clock service", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Clock status")).toHaveText("Synchronized");
  await expect(page.getByLabel("Authority clock")).not.toHaveText("");
});

test("wall-clock skew does not jump the synchronized reference", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Clock status")).toHaveText("Synchronized");
  const before = Number(await page.getByLabel("Authority clock").innerText());
  await page.getByRole("button", { name: "Skew device wall clock" }).click();
  await page.getByRole("button", { name: "Refresh clock sample" }).click();
  await expect(page.getByLabel("Clock status")).toHaveText("Synchronized");
  const after = Number(await page.getByLabel("Authority clock").innerText());
  expect(after).toBeGreaterThanOrEqual(before);
  expect(after - before).toBeLessThan(5_000);
});

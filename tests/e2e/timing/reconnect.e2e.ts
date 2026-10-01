import { expect, test } from "@playwright/test";

test("a browser reconnect restores the window without granting a fresh budget", async ({
  page,
}) => {
  await page.goto("/?game=1");
  await expect(page.getByLabel("Decision status")).toHaveText("Ready");
  await expect
    .poll(async () =>
      Number(await page.getByLabel("Decision remaining").innerText())
    )
    .toBeLessThan(4_500);
  const before = Number(
    await page.getByLabel("Decision remaining").innerText()
  );
  await page.getByRole("button", { name: "Reconnect game" }).click();
  await expect(page.getByLabel("Decision status")).toHaveText("Ready");
  const after = Number(await page.getByLabel("Decision remaining").innerText());
  expect(after).toBeLessThanOrEqual(before);
  await page.locator("#table canvas").click({ button: "right" });
  await expect(page.getByLabel("Accepted discards")).toHaveText("1");
});

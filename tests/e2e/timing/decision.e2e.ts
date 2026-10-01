import { expect, test } from "@playwright/test";

test("real Pixi controls submit against the same authoritative ready window", async ({
  page,
}) => {
  await page.goto("/?game=1");
  await expect(page.getByLabel("Decision status")).toHaveText("Ready");
  const remaining = Number(
    await page.getByLabel("Budget at readiness").innerText()
  );
  expect(remaining).toBeGreaterThanOrEqual(4_900);
  expect(remaining).toBeLessThanOrEqual(5_000);
  await page.locator("#table canvas").click({ button: "right" });
  await expect(page.getByLabel("Accepted discards")).toHaveText("1");
  await expect(page.getByLabel("Time bank")).toHaveText("20000");
});

for (const roundTripMs of [0, 100, 300]) {
  test(`useful base time survives ${roundTripMs} ms transport latency`, async ({
    page,
  }) => {
    await page.routeWebSocket("**/timing/game/**", (client) => {
      const server = client.connectToServer();
      client.onMessage((message) => {
        setTimeout(() => server.send(message), roundTripMs / 2);
      });
      server.onMessage((message) => {
        setTimeout(() => client.send(message), roundTripMs / 2);
      });
    });
    await page.goto("/?game=1");
    await expect(page.getByLabel("Decision status")).toHaveText("Ready");
    expect(
      Number(await page.getByLabel("Budget at readiness").innerText())
    ).toBeGreaterThanOrEqual(4_900);
    await page
      .getByRole("button", { name: "Discard near base deadline" })
      .click();
    await expect(page.getByLabel("Accepted discards")).toHaveText("1", {
      timeout: 8_000,
    });
    expect(
      Number(await page.getByLabel("Time bank").innerText())
    ).toBeGreaterThanOrEqual(19_900);
  });
}

test("an unauthenticated browser cannot start a timed game", async ({
  page,
}) => {
  await page.goto("/?game=1&badAuth=1");
  await expect(page.getByLabel("Decision status")).toContainText("auth_failed");
  await expect(page.getByLabel("Accepted discards")).toHaveText("0");
});

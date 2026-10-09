import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { tsImport } from "tsx/esm/api";
import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ServerMessage,
} from "../../../app/game/protocol/messages";
import { MCR_CAPABILITY } from "../../../app/game/protocol/rulesFamily";
import type * as Authority from "./mcrAuthority";

const harnessUrl = `/@fs/${fileURLToPath(new URL("./mcrHarness.tsx", import.meta.url)).replaceAll("\\", "/")}`;
test.setTimeout(120_000);
test.use({ viewport: { width: 1280, height: 900 } });

let authority: typeof Authority;
test.beforeAll(async () => {
  const loaded: unknown = await tsImport("./mcrAuthority.ts", import.meta.url);
  if (
    typeof loaded !== "object" ||
    loaded === null ||
    !("authoritativeMcrFixture" in loaded) ||
    typeof loaded.authoritativeMcrFixture !== "function"
  ) {
    throw new Error("The MCR authority fixture did not load");
  }
  authority = loaded as typeof Authority;
});

test("creates, spectates, and replays an EMA MCR table", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let fixture: Awaited<
    ReturnType<typeof Authority.authoritativeMcrFixture>
  > | null = null;
  await page.route("**/mcr/*", async (route) => {
    if (!route.request().isNavigationRequest()) {
      return route.continue();
    }
    const log = fixture?.replay();
    const data = log
      ? {
          log,
          waitsByIndex: log.events.map(() => []),
          review: null,
          currentUserId: "fixture",
          currentUserName: "Fixture",
          seatEnrichment: [null, null, null, null],
        }
      : null;
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script>window.__mcrReplay=${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script type="module" src="${harnessUrl}"></script></body></html>`,
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/game/rooms") {
      fixture = await authority.authoritativeMcrFixture(
        route.request().postDataJSON()
      );
      expect(fixture.setup.rulesFamily).toBe("mcr");
      await route.fulfill({
        json: { matchId: fixture.match.matchId, ...fixture.setup },
      });
    } else if (path === "/api/game/session") {
      await route.fulfill({
        json: { token: "fixture", wsUrl: null, wsPath: "/mcr-fixture" },
      });
    } else if (path === "/api/game/enrichment") {
      await route.fulfill({ json: { seats: [] } });
    } else if (path === "/api/telemetry") {
      await route.fulfill({ status: 204 });
    } else {
      errors.push(`Unexpected API request: ${path}`);
      await route.fulfill({ status: 500 });
    }
  });
  await page.routeWebSocket("**/mcr-fixture/**", (socket) => {
    const send = (message: ServerMessage) =>
      socket.send(JSON.stringify(ServerMessageSchema.parse(message)));
    socket.onMessage((raw) => {
      const message = ClientMessageSchema.parse(JSON.parse(String(raw)));
      if (!fixture) {
        throw new Error("The fixture room has not been created");
      }
      if (message.type === "hello") {
        expect(message.mcrCapability).toBe(MCR_CAPABILITY);
        fixture.match.attachSpectator(send);
        send(fixture.match.buildRoomState(null));
        send(fixture.match.buildSpectatorSnapshot());
      } else if (message.type === "resync") {
        send(fixture.match.buildSpectatorSnapshot());
      }
    });
  });

  await page.goto("/mcr/setup");
  await page.getByRole("radio", { name: "MCR", exact: true }).check();
  await page.getByRole("button", { name: "Create table" }).click();
  await expect(page.getByTestId("mcr-state")).toContainText(
    '"rulesFamily":"mcr"'
  );
  await expect(page.getByTestId("mcr-state")).toContainText('"handCount":4');
  await expect(page.getByTestId("mcr-state")).not.toContainText(
    '"flowerCount":0'
  );
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mcr-live.png") });

  await page.goto("/mcr/replay");
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mcr/mobile");
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mcr-mobile.png") });
  expect(errors).toEqual([]);
});

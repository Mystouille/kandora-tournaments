import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { tsImport } from "tsx/esm/api";
import { clockSampleForProbe } from "../../../app/game/server/src/transport/clockSync";
import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ServerMessage,
} from "../../../app/game/protocol/messages";
import { SANMA_CAPABILITY } from "../../../app/game/protocol/sanma";
import type * as Authority from "./sanmaAuthority";

const harnessUrl = `/@fs/${fileURLToPath(new URL("./sanmaHarness.tsx", import.meta.url)).replaceAll("\\", "/")}`;
test.setTimeout(120_000);
test.use({ viewport: { width: 1280, height: 900 } });

let authority: typeof Authority;
test.beforeAll(async () => {
  const loaded: unknown = await tsImport(
    "./sanmaAuthority.ts",
    import.meta.url
  );
  if (
    typeof loaded !== "object" ||
    loaded === null ||
    !("authoritativeFixture" in loaded) ||
    typeof loaded.authoritativeFixture !== "function" ||
    !("onlineBoardSeed" in loaded) ||
    typeof loaded.onlineBoardSeed !== "function" ||
    !("advanceDealer" in loaded) ||
    typeof loaded.advanceDealer !== "function"
  ) {
    throw new Error("The TypeScript authority fixture did not load");
  }
  authority = loaded as typeof Authority;
});

for (const sanmaType of ["online", "kansai"] as const) {
  for (const duplicate of [false, true]) {
    test(`${sanmaType} ${duplicate ? "Duplicate" : "standard"} creation, live perspectives and native replay`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let fixture: Awaited<
        ReturnType<typeof Authority.authoritativeFixture>
      > | null = null;
      await page.route("**/sanma/*", async (route) => {
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
              seatEnrichment: [null, null, null],
            }
          : null;
        await route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script>window.__sanmaReplay=${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script type="module" src="${harnessUrl}"></script></body></html>`,
        });
      });
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/game/rooms") {
          fixture = await authority.authoritativeFixture(
            route.request().postDataJSON()
          );
          const setup = fixture.setup;
          expect(setup.playerCount).toBe(3);
          expect(setup.sanmaType).toBe(sanmaType);
          expect(setup.mode.type).toBe(duplicate ? "duplicate" : "normal");
          await route.fulfill({
            json: { matchId: fixture.match.matchId, ...setup },
          });
        } else if (path === "/api/game/session") {
          await route.fulfill({
            json: { token: "fixture", wsUrl: null, wsPath: "/sanma-fixture" },
          });
        } else if (path === "/api/game/enrichment") {
          await route.fulfill({ json: { seats: [] } });
        } else if (path === "/api/telemetry") {
          await route.fulfill({ status: 204 });
        } else {
          errors.push(`Unexpected API request: ${path}`);
          await route.fulfill({
            status: 500,
            json: { error: "unexpected_fixture_request" },
          });
        }
      });
      await page.routeWebSocket("**/sanma-fixture/**", (socket) => {
        const send = (message: ServerMessage) =>
          socket.send(JSON.stringify(ServerMessageSchema.parse(message)));
        socket.onMessage((raw) => {
          const message = ClientMessageSchema.parse(JSON.parse(String(raw)));
          if (!fixture) {
            throw new Error("The fixture room has not been created");
          }
          if (message.type === "hello") {
            expect(message.gameCapabilities).toContain(SANMA_CAPABILITY);
            fixture.match.attachSpectator(send);
            send(fixture.match.buildRoomState(null));
            send(fixture.match.buildSpectatorSnapshot());
          } else if (message.type === "clock_probe") {
            send(
              clockSampleForProbe(
                message,
                fixture.match.matchId,
                fixture.clock,
                fixture.clock.now()
              )
            );
          } else if (message.type === "resync") {
            send(fixture.match.buildSpectatorSnapshot());
          }
        });
      });
      await page.routeWebSocket(
        (url) => url.pathname === "/" && url.searchParams.has("token"),
        (socket) => {
          socket.send(JSON.stringify({ type: "connected" }));
        }
      );

      await page.goto("/sanma/setup");
      await expect(
        page.getByRole("switch", { name: "3-player" })
      ).not.toBeChecked();
      await page.getByRole("switch", { name: "3-player" }).check();
      await page
        .getByLabel("Sanma rules", { exact: true })
        .selectOption(sanmaType);
      if (duplicate) {
        await page.getByRole("switch", { name: "Duplicate mode" }).check();
        await page
          .getByLabel("Duplicate seed", { exact: true })
          .fill(
            sanmaType === "online" ? authority.onlineBoardSeed() : "Board-A"
          );
      }
      await page.getByRole("button", { name: "Create table" }).click();
      await expect(page.getByTestId("sanma-state")).toContainText(
        '"handCount":3'
      );
      await expect(page.locator("canvas").first()).toBeVisible();
      const focus = page.getByRole("combobox", { name: "Focus seat" });
      await expect(focus.locator("option")).toHaveCount(3);
      for (const seat of ["0", "1", "2"]) {
        await focus.selectOption(seat);
        await page.screenshot({
          path: testInfo.outputPath(`focus-${seat}.png`),
        });
      }
      await expect(page.getByTestId("sanma-state")).not.toContainText(
        '"nukiCount":0'
      );
      if (!fixture) {
        throw new Error("No authoritative match");
      }
      const match = (
        fixture as Awaited<ReturnType<typeof Authority.authoritativeFixture>>
      ).match;
      await authority.advanceDealer(match);
      await expect(page.getByTestId("sanma-state")).toContainText('"dealer":1');
      await expect(focus.locator("option")).toHaveCount(3);
      await page.goto("/sanma/replay");
      await expect(page.locator("canvas").first()).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/sanma/mobile");
      await expect(page.locator("canvas").first()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("mobile.png") });
      expect(errors).toEqual([]);
    });
  }
}

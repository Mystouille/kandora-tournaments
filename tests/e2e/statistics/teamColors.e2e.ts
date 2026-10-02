import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { TeamOption } from "../../../app/components/statistics/types";
import type { RankingEntry } from "../../../app/components/StatRankingCard";

const leagueId = "000000000000000000000100";
const teams: TeamOption[] = [
  { name: "Colored", color: "#123456" },
  { name: "Cleared", color: null },
  { name: "Legacy" },
  { name: "White", color: "#ffffff" },
  { name: "Black", color: "#000000" },
].map((team, index) => ({
  _id: String(index + 1).padStart(24, "0"),
  simpleName: `${team.name} Team`,
  displayName: `${team.name} Team`,
  ...("color" in team ? { color: team.color } : {}),
  leagueId,
  pictures: null,
  roster: { members: [String(index + 11).padStart(24, "0")], substitutes: [] },
}));
const users = teams.map((team) => ({
  _id: team.roster.members[0],
  name: team.displayName.replace("Team", "Player"),
  avatarUrl: null,
  majsoulName: null,
}));
const harnessUrl = `/@fs/${fileURLToPath(
  new URL("./teamColorsHarness.tsx", import.meta.url)
).replaceAll("\\", "/")}`;
const gradient =
  "linear-gradient(to right, rgb(18, 52, 86) 0%, rgba(18, 52, 86, 0) 100%)";
const days = ["2026-09-01", "2026-09-02", "2026-09-03"];

function ranking(id: string, label: string): RankingEntry {
  return {
    id,
    label,
    totalDora: 20,
    totalUraDora: 10,
    totalHan: 30,
    totalFu: 300,
    totalRyuukyoku: 5,
    totalOpened: 10,
    totalRounds: 40,
    gameCount: 10,
    roundsWon: 10,
    roundsDrawn: 5,
    avgDoraPerRoundWon: 2,
    avgUraDoraPerRoundWon: 1,
    avgHanPerRoundWon: 3,
    avgFuPerRoundWon: 30,
    avgRyuukyokuPerDraw: 1,
    callRate: 25,
    totalCalls: 12,
    avgCallsPerRound: 0.3,
    avgTenpaiTurn: 7,
    winRate: 25,
    tsumoRate: 50,
    totalTsumo: 5,
    totalDealIn: 2,
    dealInRate: 5,
    avgDealInValue: 4000,
    avgWinValue: 8000,
  };
}

function standing(index: number, teamMode: boolean) {
  const team = teams[index];
  const user = users[index];
  const player = {
    id: user._id,
    label: user.name,
    avatarUrl: null,
    leaguePicture: null,
    majsoulName: null,
    teamId: team._id,
    teamName: team.displayName,
    totalScore: 100 - index,
    rawPoints: 80,
    bonusPoints: 20,
    gameCount: 10,
    avgPlacement: 2,
    placements: [4, 3, 2, 1],
    yakumanCount: 0,
  };
  return teamMode
    ? {
        ...player,
        id: team._id,
        label: team.displayName,
        teamId: null,
        teamName: null,
        members: [player],
      }
    : player;
}

async function installFixtures(page: Page) {
  const requests: Array<{
    teams: Array<{ teamId: string | null; color?: string | null }>;
  }> = [];
  let rosterTeams = teams.map((team) => ({
    _id: team._id,
    simpleName: team.simpleName,
    displayName: team.displayName,
    color: team.color ?? null,
    players: [
      { userId: team.roster.members[0], isCaptain: true, isSubstitute: false },
    ],
  }));

  await page.route(
    /\/(?:online-tournaments\/team-colors\/statistics|admin\/online-tournaments\/[^/]+\/edit-roster)/,
    async (route) => {
      if (route.request().resourceType() !== "document") {
        await route.continue();
        return;
      }
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><body style="margin:0"><div id="root"></div><script type="module" src="${harnessUrl}"></script></body></html>`,
      });
    }
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const playerMode = url.searchParams.get("entityType") === "player";
    const entities = playerMode
      ? users.map((user, index) => ({
          id: user._id,
          label: user.name,
          teamName: teams[index].displayName,
        }))
      : teams.map((team) => ({ id: team._id, label: team.displayName }));

    if (url.pathname.endsWith("/admin/league-roster")) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        requests.push(body);
        rosterTeams = body.teams.map(
          (team: (typeof rosterTeams)[number] & { teamId: string }) => ({
            ...team,
            _id: team.teamId,
          })
        );
        await route.fulfill({
          json: { success: true, platformSync: { attempted: false } },
        });
        return;
      }
      await route.fulfill({
        json: {
          leagueId,
          leagueName: "Color Test",
          leagueSlug: "team-colors",
          platform: "TENHOU",
          isTeamMode: true,
          hasTournamentId: false,
          teams: rosterTeams,
          players: [],
          users,
        },
      });
      return;
    }
    if (url.pathname.endsWith("/statistics-filters")) {
      await route.fulfill({
        json: {
          league: {
            _id: leagueId,
            name: "Color Test",
            hasTeams: true,
            phaseCutoffTimes: [],
            hasFinalPhase: true,
            hasRegularPhase: true,
            configuration: null,
            earliestGameDate: days[0],
            latestGameDate: days[2],
          },
          teams,
          users,
          playerIds: users.map((user) => user._id),
          brackets: [],
          eliminatedTeams: [],
        },
      });
      return;
    }
    if (url.pathname.endsWith("/score-evolution")) {
      const selected = (
        url.searchParams.get(playerMode ? "playerIds" : "teamIds") ?? ""
      )
        .split(",")
        .filter(Boolean);
      await route.fulfill({
        json: {
          series: entities
            .filter(
              (entity) => selected.length === 0 || selected.includes(entity.id)
            )
            .map((entity, index) => ({
              id: entity.id,
              label: entity.label,
              data: days.map((x, day) => ({
                x,
                y: (5 - index) * (day + 1) * 10,
              })),
            })),
        },
      });
      return;
    }
    if (url.pathname.endsWith("/player-standings")) {
      await route.fulfill({
        json: {
          standings: teams.map((_, index) => standing(index, !playerMode)),
        },
      });
      return;
    }
    if (url.pathname.endsWith("/ranking-data")) {
      await route.fulfill({
        json: {
          rankings: entities.map((entity) => ranking(entity.id, entity.label)),
        },
      });
      return;
    }
    if (
      url.pathname.endsWith("/ongoing-games") ||
      url.pathname.endsWith("/games")
    ) {
      const ongoing = url.pathname.endsWith("/ongoing-games");
      await route.fulfill({
        json: {
          total: 1,
          liveSpectatingEnabled: false,
          games: [
            {
              gameId: ongoing ? "live-color-game" : "color-game",
              platform: "tenhou",
              startTime: "2026-09-02T12:00:00.000Z",
              endTime: null,
              replayUrl: null,
              status: ongoing ? "ongoing" : undefined,
              watchId: null,
              matchId: null,
              players: users.map((user, index) => ({
                userId: user._id,
                name: user.name,
                nickname: user.name,
                seat: index,
                avatarUrl: null,
                leaguePicture: null,
                teamName: teams[index].displayName,
                teamPicture: null,
                score: 35000 - index * 1000,
                place: index + 1,
                deltaPoints: 10 - index,
                isSub: false,
                isOfficialSub: false,
              })),
            },
          ],
        },
      });
      return;
    }
    if (url.pathname.endsWith("/yaku-map")) {
      await route.fulfill({
        json: {
          columns: entities.map((entity) => ({
            ...entity,
            name: entity.label,
          })),
          yakuCounts: {
            2: Object.fromEntries(entities.map((entity) => [entity.id, 4])),
          },
          totalRounds: Object.fromEntries(
            entities.map((entity) => [entity.id, 40])
          ),
          totalGames: Object.fromEntries(
            entities.map((entity) => [entity.id, 10])
          ),
        },
      });
      return;
    }
    if (url.pathname.endsWith("/bracket-scores")) {
      const phase = (selectedTeams: TeamOption[], groupIndex: number) => ({
        groupIndex,
        stageOrder: 0,
        advancingCount: 2,
        sources: groupIndex ? ["Color semifinal"] : [],
        gamesPlayed: 1,
        totalGames: 1,
        teamScores: Object.fromEntries(
          selectedTeams.map((team, index) => [team._id, 100 - index])
        ),
        slots: [...selectedTeams].reverse().map((team) => ({
          teamId: team._id,
          description: team.displayName,
          score: 100 - teams.indexOf(team),
        })),
        games: [
          {
            gameId: "bracket-color-game",
            startTime: "2026-09-02T12:00:00.000Z",
            replayUrl: null,
            players: selectedTeams.map((team, index) => ({
              teamId: team._id,
              teamName: team.displayName,
              playerName: users[index].name,
              platformName: null,
              avatarUrl: null,
              leaguePicture: null,
              score: 35000 - index * 1000,
              delta: 100 - index,
              place: index + 1,
              isSub: false,
            })),
          },
        ],
      });
      await route.fulfill({
        json: {
          phases: {
            "Color semifinal": phase(teams, 0),
            "Color final": phase(teams.slice(0, 2), 1),
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith("/telemetry")) {
      await route.fulfill({ status: 204 });
      return;
    }
    throw new Error(`Unexpected fixture API request: ${url.pathname}`);
  });
  return requests;
}

function panel(page: Page) {
  return page.getByRole("tabpanel");
}

async function showTab(page: Page, name: string) {
  const tab = page
    .getByRole("tab")
    .filter({ hasText: new RegExp(`^${name}$`) });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function expectGradient(target: Locator) {
  await expect(target).toHaveCSS("background-image", gradient);
}

function nameCell(scope: Locator, name: string) {
  return scope
    .getByText(name, { exact: true })
    .locator("xpath=ancestor::td[1]");
}

async function setMode(page: Page, name: "Teams" | "Players") {
  await page.getByRole("radiogroup").getByText(name, { exact: true }).click();
  await expect(page.getByRole("radio", { name, exact: true })).toBeChecked();
}

async function expectGraphColor(page: Page, color: string) {
  const line = panel(page).locator(`svg path[stroke="${color}"]`).first();
  await expect(line).toHaveAttribute("d", /^M/);
  await expect(
    panel(page)
      .locator("svg")
      .filter({ has: page.locator(`path[stroke="${color}"]`) })
      .first()
  ).toBeVisible();
}

test.use({
  viewport: { width: 1400, height: 1200 },
  screenshot: "only-on-failure",
});

for (const theme of ["light", "dark"]) {
  test(`team and player backgrounds across tabs (${theme})`, async ({
    page,
  }, testInfo) => {
    await installFixtures(page);
    await page.goto(
      `/online-tournaments/team-colors/statistics/standings?theme=${theme}`
    );
    const row = panel(page).locator(`tr[data-row-key="${teams[0]._id}"]`);
    await expectGradient(nameCell(row, "Colored Team"));
    await expect(row.locator("td").last()).toHaveCSS(
      "background-image",
      "none"
    );
    await expect(nameCell(panel(page), "Cleared Team")).toHaveCSS(
      "background-image",
      "none"
    );
    await expect(nameCell(panel(page), "Legacy Team")).toHaveCSS(
      "background-image",
      "none"
    );
    await expect(
      panel(page).getByText("White Team", { exact: true })
    ).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(
      panel(page).getByText("Black Team", { exact: true })
    ).toHaveCSS("color", "rgb(255, 255, 255)");
    await row.locator(".ant-table-row-expand-icon").click();
    await expectGradient(nameCell(panel(page), "Colored Player"));
    await setMode(page, "Players");
    await expectGradient(nameCell(panel(page), "Colored Player"));

    for (const tab of ["Rankings", "More Rankings"]) {
      await showTab(page, tab);
      const item = panel(page)
        .locator(".ant-list-item")
        .filter({ hasText: "Colored Player" })
        .first();
      await expectGradient(item.locator(":scope > div"));
      await item.hover();
      await expectGradient(item.locator(":scope > div"));
      await expect(
        panel(page)
          .locator(".ant-list-item")
          .filter({ hasText: "Cleared Player" })
          .first()
          .locator(":scope > div")
      ).toHaveCSS("background-image", "none");
    }
    await setMode(page, "Teams");
    await expectGradient(
      panel(page)
        .locator(".ant-list-item")
        .filter({ hasText: "Colored Team" })
        .first()
        .locator(":scope > div")
    );

    await showTab(page, "Games");
    const gameRows = panel(page)
      .getByText("Colored Player", { exact: true })
      .locator(
        'xpath=ancestor::div[contains(@style, "border-radius: 6px")][1]'
      );
    await expect(gameRows).toHaveCount(2);
    await expectGradient(gameRows.nth(0));
    await expectGradient(gameRows.nth(1));
    await page.screenshot({
      path: testInfo.outputPath(`games-${theme}.png`),
      fullPage: true,
    });

    await showTab(page, "Yaku Map");
    await expectGradient(
      panel(page).locator(`.ym-name[data-row="${teams[0]._id}"]`)
    );
    await panel(page).locator(`.ym-name[data-row="${teams[0]._id}"]`).click();
    await expectGradient(
      panel(page).locator(`.ym-name[data-row="${teams[0]._id}"]`)
    );
    await setMode(page, "Players");
    const playerCell = panel(page).locator(
      `.ym-name[data-row="${users[0]._id}"]`
    );
    await expect(playerCell).toHaveCSS("background-image", "none");
    await expect(playerCell.locator("..").locator("td").nth(1)).toHaveCSS(
      "background-color",
      "rgb(22, 119, 255)"
    );
  });

  test(`bracket gradients, qualification outline and solid headers (${theme})`, async ({
    page,
  }, testInfo) => {
    await installFixtures(page);
    await page.goto(
      `/online-tournaments/team-colors/statistics/bracket?theme=${theme}`
    );
    const semifinal = panel(page)
      .locator(".ant-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Color semifinal",
          exact: true,
        }),
      });
    const slot = semifinal
      .locator('div[style*="border-radius: 6px"]')
      .filter({ hasText: "Colored Team" });
    await expectGradient(slot);
    await expect(slot).toHaveCSS("border-top-width", "2px");
    await expect(slot).toHaveCSS(
      "border-top-color",
      theme === "light" ? "rgba(82, 196, 26, 0.45)" : "rgba(82, 196, 26, 0.35)"
    );
    await expect(slot).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(250, 250, 250)" : "rgb(20, 20, 20)"
    );
    const winner = panel(page)
      .locator(".ant-card")
      .filter({ hasText: "Colored Team" })
      .last();
    await expectGradient(winner);
    await semifinal.getByRole("button", { name: /Show details$/ }).click();
    const header = page.getByRole("columnheader", {
      name: /Colored Team$/,
    });
    await expect(header).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await expect(header).toHaveCSS("background-image", "none");
    await expect(header).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(
      page.getByRole("columnheader", { name: /White Team$/ })
    ).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(
      page.getByRole("columnheader", { name: /Cleared Team$/ })
    ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(
      page.getByRole("columnheader").filter({ hasText: /Team/ })
    ).toHaveText([
      "Black Team",
      "White Team",
      "Legacy Team",
      "Cleared Team",
      "Colored Team",
    ]);
    await page.screenshot({
      path: testInfo.outputPath(`bracket-${theme}.png`),
      fullPage: true,
    });
  });
}

test("graph colors stay stable after filtering and player colors stay independent", async ({
  page,
}) => {
  await installFixtures(page);
  await page.goto("/online-tournaments/team-colors/statistics/graphs");
  await expectGraphColor(page, "#123456");
  await page.getByRole("combobox").first().click();
  await page
    .locator(".ant-select-item-option-content")
    .getByText("Cleared Team", { exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expectGraphColor(page, "#ff7f0e");
  await expect(panel(page).locator('svg path[stroke="#123456"]')).toHaveCount(
    0
  );
  await setMode(page, "Players");
  await expectGraphColor(page, "#1f77b4");
  await expect(panel(page).locator('svg path[stroke="#123456"]')).toHaveCount(
    0
  );
});

test("the roster picker saves and clears colors across reloads", async ({
  page,
}) => {
  const requests = await installFixtures(page);
  await page.goto(`/admin/online-tournaments/${leagueId}/edit-roster`);
  const colored = page.getByRole("button", {
    name: "Team color: Colored Team",
    exact: true,
  });
  await expect(colored).toContainText("#123456");
  await expect(
    page.getByRole("button", { name: "Team color: Legacy Team", exact: true })
  ).toContainText("No color");
  await colored.click();
  await page.locator(".ant-color-picker-clear").click();
  await expect(colored).toContainText("No color");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /submit/i }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].teams[0].color).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Team color: Colored Team", exact: true })
  ).toContainText("No color");

  await colored.click();
  await page.locator(".ant-color-picker-hex-input input").fill("654321");
  await page.locator(".ant-color-picker-hex-input input").press("Enter");
  await expect(colored).toContainText("#654321");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /submit/i }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].teams[0].color).toBe("#654321");
  expect(requests[1].teams[2].color).toBeNull();
  await page.reload();
  await expect(colored).toContainText("#654321");
});

test("new roster teams get an editable default on a narrow viewport", async ({
  page,
}) => {
  await installFixtures(page);
  await page.setViewportSize({ width: 720, height: 960 });
  await page.goto(`/admin/online-tournaments/${leagueId}/edit-roster`);
  await page.getByRole("button", { name: /Create new team$/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("A new team with a long roster label");
  await dialog.getByRole("button", { name: /Create new team$|^OK$/ }).click();
  const picker = page.getByRole("button", {
    name: "Team color: A new team with a long roster label",
    exact: true,
  });
  await expect(picker).toContainText("#8c564b");
  await picker.click();
  await page.locator(".ant-color-picker-clear").click();
  await expect(picker).toContainText("No color");
});

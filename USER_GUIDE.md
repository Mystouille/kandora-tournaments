# Kandora Tournaments — Organizer & Admin Guide

This guide covers everything you can do in the web app **after installation is
finished** and the server is running (see [INSTALLATION.md](INSTALLATION.md) for
the setup itself). It focuses on the two most common jobs:

1. **Creating and configuring a tournament** (platform, format, dates, Discord).
2. **Managing players and teams** (importing rosters and changing them later).

Picture / presentation / statistics / viewer features are covered more briefly
at the end.

---

## 1. Roles & permissions

There are three levels of access:

| Role             | Who they are                                                                                          | What they can do                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Global admin** | A user with the admin flag (granted from the main Discord server's admin role in `SERVERS_JSON`).     | Create tournaments, and view/edit **any** tournament.                            |
| **League admin** | An **administrator of the Discord server** that a tournament is linked to (`discordConfig.serverId`). | Edit **that** tournament: presentation, roster, finals roster, pictures, format. |
| **Viewer**       | Any logged-in or anonymous visitor.                                                                   | Read-only access to public tournament pages, standings, statistics, replays.     |

Notes:

- If a tournament is **not linked to a Discord server**, only **global admins**
  can edit it.
- Editing controls (buttons) only appear on a tournament page when you have edit
  rights. Everyone else sees the same page read-only.

---

## 2. Where the admin actions live

Almost everything is reached from a tournament's own page. Open
`/online-tournaments`, click a tournament, and — when you have edit rights — you'll
see action buttons on each tab:

| Tab                                 | Buttons shown to editors                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Presentation**                    | Edit presentation                                                                                                              |
| **Rules**                           | (read-only tournament details)                                                                                                 |
| **Player list**                     | Import Roster · Edit Roster · Edit Team Pictures _(team mode)_ · Edit Player Pictures · _Save tables to Riichi City_ (RC only) |
| **Finals roster** _(if one exists)_ | Edit Finals Roster                                                                                                             |

Global admins also get a **Create new tournament** button on the tournaments
list (`/online-tournaments`).

Direct URLs (replace `{id}` with the tournament's id):

- Create: `/admin/online-tournaments/new`
- Edit presentation: `/admin/online-tournaments/{id}/edit-presentation`
- Import roster: `/admin/online-tournaments/{id}/import-teams`
- Edit roster: `/admin/online-tournaments/{id}/edit-roster`
- Edit finals roster: `/admin/online-tournaments/{id}/edit-finals-roster`
- Edit team pictures: `/admin/online-tournaments/{id}/edit-team-pictures`
- Edit player pictures: `/admin/online-tournaments/{id}/edit-player-pictures`

---

## 3. Creating a tournament

Go to **Create new tournament** (`/admin/online-tournaments/new`). The form has
three sections.

### 3.1 Platform & tournament

1. **Platform** — pick one of **Mahjong Soul**, **Riichi City**, **Tenhou**, or
   **IRL** (in-person, no online platform).
2. **Tournament ID** — enter the tournament/contest ID from the platform, then
   click **Validate**.
   - The **Kandora bot must be an admin** of that tournament on the platform.
     For Mahjong Soul and Riichi City the form shows the bot's ID so you can add
     it as a tournament admin first.
   - Validation confirms the bot's access, resolves the internal tournament ID,
     and auto-fills the tournament **name** when the platform provides it.
   - **Mahjong Soul only:** after validation, pick a **Season** (optional —
     defaults to season 1).
   - **IRL:** no validation; there is no online tournament to check against.
3. A **duplicate guard** prevents creating a second tournament for the same
   platform tournament (and season, for Mahjong Soul). You'll see the name of
   the existing one if there's a clash.

The rest of the form stays locked until validation succeeds (except for IRL).

### 3.2 League details

| Field                                       | Notes                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tournament name**                         | Pre-filled from the platform; editable. Must be unique.                                                                                                |
| **Start date & time** / **End date & time** | Required. Define the active window.                                                                                                                    |
| **Game rules**                              | `EMA`, `WRC`, `ONLINE`, `MLEAGUE`, or `INDONESIAN`.                                                                                                    |
| **Tournament format**                       | Optional structured format (phases + finals bracket). See [§4](#4-tournament-format-phases--brackets).                                                 |
| **Phase cutoff dates**                      | Appear automatically based on the format: a format with N regular phases shows **N−1** cutoffs; a single regular phase plus finals shows **1** cutoff. |
| **Team mode / Individual mode**             | Switch between team and individual play. If the chosen format already defines this, the format wins.                                                   |

### 3.3 Discord integration (optional)

Turn on **Publish on Discord** to have the bot post about this tournament:

1. **Discord server** — choose from the servers available to the bot.
2. **Channels** (all optional, grouped by category; channels the bot can't post
   to are flagged):
   - **Ranking channel** — standings the bot keeps updated.
   - **Result channel** — game results as they're hydrated.
   - **Admin channel** — admin notifications.
   - **Scheduling channel** — scheduling messages.
3. **Discord language** (`Français` / `English`) — affects **only** the text the
   bot posts in these channels. The website always uses each visitor's own
   language.

Click **Create Tournament** to finish. You'll be taken to the new tournament,
where you can import a roster.

---

## 4. Tournament format (phases & brackets)

The **tournament format** (a reusable "league type config") controls scoring and
structure. It's optional:

- **Off** → a simple league: cumulative scoring, no phases, no bracket.
- **On** → either pick an **existing saved format** or **create a new one**
  (you can also duplicate an existing one and edit it). Saved formats are
  reusable across tournaments.

A format is built from:

**Regular phase(s)** — one phase, or several ("multi-phase"). Each phase has a
**scoring type**:

- **Cumulative** — plain running total.
- **Team delta cap** — caps how much a team's delta counts, with a cap percentage
  and a minimum number of games before the cap applies.
- **Best consecutive window** — scores your best run of N consecutive games;
  optionally qualifies the top N of each faction.

In a multi-phase format, each phase also defines **progression** to the next
phase: how many players/teams **advance**, and what fraction of their score is
**retained** going into the next phase.

**Final phase (bracket)** — optional. It defines:

- A **score carry-over** fraction from the regular phase into the finals
  (0 = start finals from scratch).
- One or more **stages**, each with a game count, **direct seeds** (positions
  that start in this stage), and **advancement edges** from earlier stages
  (either "top N" or specific finishing "places"), plus an optional
  stage-to-stage score carry-over. Finals use bracket-delta scoring.

---

## 5. Editing a tournament after setup

### 5.1 Presentation text

On the **Presentation tab**, click **Edit presentation**. Edit the tournament's
description in **French** and **English** with a rich-text editor. Two save
options:

- **Save** — stores both languages as-is.
- **Save & translate** — stores them, then auto-translates FR → EN (when the
  French text isn't empty), if DeepL is configured.

### 5.2 What's fixed vs editable

- **Platform, tournament ID, and season** are chosen at creation and aren't
  changed afterward — create a new tournament if these change.
- **Presentation, roster, finals roster, pictures**, and (via the format) the
  structure/scoring can all be changed after setup.

---

## 6. Players & teams

This is the part you'll revisit most. There are two stages: **importing** the
initial roster, then **editing** it over time.

### 6.1 Importing a roster

Open **Import Roster** (`/admin/online-tournaments/{id}/import-teams`). Choose one
of two methods.

#### A) Import from platform

Pulls the team/player list straight from the platform's tournament configuration.

- Requires the tournament to have a platform tournament ID (set at creation).
- Each player is matched to an existing user by their platform identity
  (Mahjong Soul account ID, Riichi City user ID, or Tenhou username); users that
  don't exist yet are **created**.
- The preview marks each player as **existing** or **new**, and shows Discord
  link status. You can manually link a Discord account where one is missing.
- Review the preview, then **confirm** to import.

#### B) Import from CSV

Click **Import from CSV** and **upload** a `.csv` or `.txt` file (comma-separated).
**Do not include a header row** — every non-empty line is treated as a player.

**Team mode** — 5 columns:

```
teamName, displayName, friendId, discordId, substitute
Alpha, Team Alpha, 123456, 987654321000,
Alpha, Team Alpha, 234567, ,
Beta,  Team Beta,  345678, 876543210000, sub
```

**Individual mode** — 3 columns:

```
friendId, discordId, substitute
123456, 987654321000,
234567, , sub
```

Column meanings:

| Column                     | Meaning                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teamName` / `displayName` | _(team mode)_ Team key and display name. New teams are created as needed.                                                                                                                   |
| `friendId`                 | The player's **platform ID**: Mahjong Soul friend ID, Riichi City user ID, or Tenhou username. Mahjong Soul & Riichi City IDs are validated against the platform; Tenhou is accepted as-is. |
| `discordId`                | _(optional)_ Discord user ID, validated against the linked Discord server if there is one. Leave blank if unused.                                                                           |
| `substitute`               | _(optional)_ Marks a substitute. Truthy values: `sub`, `true`, `1`, `yes`, `s`.                                                                                                             |

The preview flags per-row problems (unknown platform ID, Discord user not on the
server, new vs existing user). Confirm to import.

> **Team-mode CSV import replaces all existing teams** for the tournament. Use
> **Edit Roster** (below) for incremental changes.

### 6.2 Changing a roster later — Edit Roster

Open **Edit Roster** (`/admin/online-tournaments/{id}/edit-roster`). This is the
tool for ongoing changes.

You can:

- **Add a player** to a team, either by **platform ID** (looked up and validated,
  creating the user if new) or by **name only** (an "unlinked" user with no
  platform account). The first player added to an empty team becomes the
  **captain**.
- **Set the captain** (exactly one per team) and toggle **Sub** (substitute) on
  each player.
- **Move a player** to another team, or **remove** them.
- **Rename a team** inline, or **create a new team** (team mode).
- **Edit a player's platform ID** — validated when you save.
- **Sync to platform** — when the tournament has a platform tournament ID, enable
  this to push the roster to the platform's team configuration on save. If the
  push fails, your changes are still saved locally and you're warned.

On save, the app checks that every non-empty team has exactly one captain, team
names aren't duplicated, and any changed platform IDs are valid.

### 6.3 Finals roster

Open **Edit Finals Roster** (`/admin/online-tournaments/{id}/edit-finals-roster`).

Each team has a separate **finals roster** — a subset of its regular roster used
only in the finals phase. Pick the **captain**, **members**, and **substitutes**
for the finals from the regular-roster players. Anyone left out does **not**
play the finals. This tab appears on the public page once a finals roster is set.

### 6.4 Official substitutes

For **individual (non-team) tournaments**, players marked as substitutes in the
**CSV import** are collected into a tournament-wide **Official Substitutes** pool.
They're shown on the tournament page and used by the Discord scheduling/`sub`
commands to fill empty seats. There's no separate editor — manage them through
the import.

### 6.5 Team & player pictures

- **Edit Team Pictures** _(team mode)_ — one image per team, shown at 256×256.
- **Edit Player Pictures** — one image per player, shown at 512×512. Player
  pictures are stored **per tournament**, so the same person can have different
  pictures in different tournaments.

For both: upload a **PNG, JPEG, or WebP** (up to ~1.2 MB), crop it to a square in
the built-in cropper, and save — or remove an existing picture. Player pictures
otherwise fall back to the platform avatar.

### 6.6 Riichi City — Save tables

For Riichi City bracket tournaments, the **Save tables to Riichi City** button on
the Player list tab pushes the computed table pairings to the Riichi City
tournament so the seats match your bracket.

---

## 7. Player self-service (linking platform identities)

So that imports can match people automatically, players link their own accounts
at **`/account`** after logging in with Discord:

- **Mahjong Soul** — enter your **friend ID** (validated; shows your nickname).
- **Riichi City** — enter your **user ID** (validated; shows your nickname).
- **Tenhou** — enter your **username** (self-reported, not validated).

Once linked, platform and CSV imports recognize the player and attach games to
the right account.

---

## 8. What viewers see

- **Tournaments list** (`/online-tournaments`) — name, dates, player and game
  counts.
- **Tournament page** (`/online-tournaments/{slug}`) — tabs for **Presentation**,
  **Rules**, **Player list**, and **Finals roster** (when set).
- **Results & statistics** (`/online-tournaments/{slug}/statistics`) — standings,
  score evolution, and per-metric leaderboards. See [§9](#9-the-statistics--results-page).
- **Live overlay** (`/live/{slug}/{stage}`) — a public, unauthenticated results
  overlay for a bracket stage, designed as an **OBS browser source**.
- **Replay viewer** (`/replays/{gameId}`) — replay a recorded game in the browser.

---

## 9. The statistics & results page

Open it from a tournament with the **Results & Statistics** button, or at
`/online-tournaments/{slug}/statistics`. The page has a **filter bar** at the top
that applies to every tab, and a set of **tabs** below it.

### 9.1 Filter bar

| Control                       | What it does                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Teams / Players** toggle    | Switch between analysing whole teams or individual players.                                                  |
| **Phase filter**              | For multi-phase tournaments, restrict to _All phases_ or a single **Phase N** (uses the phase cutoff dates). |
| **Team / player picker**      | Multi-select the entities to show, with **Select all** / **Deselect all**. Players are grouped by team.      |
| **Date range**                | Limit games to a start–end window.                                                                           |
| **Pin a player / Pin a team** | Highlight one entity so it stands out across charts and tables.                                              |
| **Min. games**                | Hide entities below a minimum number of games (used by rate-based views).                                    |
| **Auto-refresh (1 min)**      | Re-fetch data every minute — handy on a stream while games finish.                                           |

### 9.2 Tabs

| Tab                                      | Shows                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bracket** _(bracket tournaments only)_ | The finals bracket tree with per-stage scores and a **Watch replay in browser** action on played games.                                                              |
| **Graphs**                               | Score-evolution lines over time for the selected teams/players.                                                                                                      |
| **Listing**                              | The standings table — cumulative scores/placements for the current filter.                                                                                           |
| **Rankings**                             | Leaderboard cards for the main metrics (e.g. win rate, deal-in rate, average win value, riichi/calls). Cards can be reordered and hidden; your layout is remembered. |
| **More Rankings**                        | Additional, more detailed leaderboard cards (dora, ura-dora, han, fu, tenpai turn, ryuukyoku, tsumo rate, …).                                                        |
| **Games**                                | A list of individual games matching the filter, each with a **Replay** button and **Copy logs for Naga** (to paste into the NAGA AI analyser).                       |
| **Yaku Map**                             | A grid of how often each yaku is scored, respecting the **Min. games** threshold.                                                                                    |

Most tables and cards are sortable, and the **pinned** entity stays highlighted so
you can track one team or player across every view.

---

## 10. Discord bot

The bundled Discord bot gives organizers a tournament-control surface and gives
players self-service and practice tools. All commands are **localized** (English
/ French) and appear in Discord's slash-command menu once deployed.

> **Enabling the bot:** invite it to your server with the token/credentials from
> [INSTALLATION.md](INSTALLATION.md), then register the commands with
> `npx tsx scripts/deploy-commands.ts`. Per-tournament channels and language are
> set in the **Discord integration** step when creating a tournament ([§3.3](#33-discord-integration-optional)).

### 10.1 `/league …` — organizer controls _(server admins only)_

These drive the **finals / bracket** workflow and require the Discord
**Administrator** permission.

| Command                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/league startnext`**  | Start the next batch of bracket games: works out the next round for each ongoing stage and posts the scheduling messages. Run this first to open a round.                                                                                                                                                                                                                                                            |
| **`/league launch`**     | Check that every scheduled player is ready (accounts linked) and launch the games on the platform. Run after `startnext`.                                                                                                                                                                                                                                                                                            |
| **`/league cancelnext`** | Cancel the current scheduled round — removes the scheduling messages and their jobs. Use to undo a mis-scheduled round.                                                                                                                                                                                                                                                                                              |
| **`/league sub`**        | Register (or cancel) a substitution. Options: **`player`** (in-game ID to replace), **`substitute`** (in-game ID of the replacement), **`rounds`** (e.g. `2`, `2,3`, or `2-3`; defaults to the next round). **Swap `player`/`substitute` to cancel** an existing sub. The substitute must be on the team roster or in the official substitutes; the bracket must already be seeded. Mahjong Soul & Riichi City only. |

### 10.2 `/myinfo …` — player profile _(anyone)_

| Command              | What it does                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/myinfo update`** | Opens a form to set your **Tenhou** username. _(Mahjong Soul and Riichi City are linked on the web portal at `/account` — see [§7](#7-player-self-service-linking-platform-identities).)_ |
| **`/myinfo delete`** | Permanently delete your stored data after typing your Discord username to confirm. Past game records stay but show as anonymous.                                                          |

### 10.3 `[Kandora] Mahjong Info` — user context menu _(anyone)_

Right-click any member → **Apps → [Kandora] Mahjong Info** to privately view that
person's linked platform identities (Mahjong Soul / Riichi City / Tenhou names
and IDs). Useful for admins collecting in-game IDs before a `/league sub`.

### 10.4 `/mjg nanikiru` — hand analysis _(anyone)_

Post a hand and get its **shanten** and **ukeire** (useful tiles) analysis with a
rendered image.

- **`hand`** _(required)_ — tile notation, e.g. `12333s456p555m11z`: digits `1`–`9`
  followed by a suit — `m` (characters), `p` (dots), `s` (bamboo), `z` (honors).
  Dragons can also be written `[RWG]d` and winds `[ESWN]w`.
- **`doras`** — dora indicators, e.g. `1p4s`.
- **`seat`** — your wind (East/South/West/North); **`round`** — e.g. `S3`;
  **`turn`** — current turn.
- **`waits`** — `No` (default), `Yes` (show number of waits per discard), or
  `Full` (also list the wait tiles).
- **`thread`** — open a thread to discuss; **`spoiler`** — hide the wait info
  behind a spoiler.

### 10.5 `/quiz …` — practice quizzes _(anyone)_

Each quiz runs in its own thread.

| Command              | What it does                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`/quiz nanikiru`** | "What would you discard?" multiple-choice quiz. Options: **`nbrounds`** (required), **`mode`**, **`series`** (`Uzaku300` / `Uzaku301` / `UzakuGold`), **`timeout`**.                                         |
| **`/quiz chinitsu`** | Single-suit (all-one-suit) wait-reading quiz. Options: **`nbrounds`** (required), **`mode`**, **`suit`** (Manzu / Pinzu / Souzu, random by default), **`level`** (Easy / Normal / Difficult), **`timeout`**. |

**Modes:** **Explore** (no timer — react 👀 to reveal the answer), **First** (only
the first correct answer scores), **Race** (timed, default 30 s per question).

### 10.6 `/admin checknanikiru` — maintenance

Admin/QA helper that DMs you a specific nanikiru problem by its **`source`** id
(e.g. `300-Q-226`) to check its content.

---

## 11. Quick reference

| Task              | Page                                   | Who                 |
| ----------------- | -------------------------------------- | ------------------- |
| Create tournament | `/admin/online-tournaments/new`        | Global admin        |
| Edit presentation | Presentation tab → Edit presentation   | League/global admin |
| Import roster     | Player list tab → Import Roster        | League/global admin |
| Change roster     | Player list tab → Edit Roster          | League/global admin |
| Finals roster     | Finals roster tab → Edit Finals Roster | League/global admin |
| Team pictures     | Player list tab → Edit Team Pictures   | League/global admin |
| Player pictures   | Player list tab → Edit Player Pictures | League/global admin |
| Link my accounts  | `/account`                             | Any logged-in user  |

**Discord bot commands**

| Command                                               | Purpose                                         | Who          |
| ----------------------------------------------------- | ----------------------------------------------- | ------------ |
| `/league startnext` · `launch` · `cancelnext` · `sub` | Run the finals/bracket rounds and substitutions | Server admin |
| `/myinfo update` · `delete`                           | Set your Tenhou name / delete your data         | Anyone       |
| `[Kandora] Mahjong Info`                              | View a member's linked platform IDs             | Anyone       |
| `/mjg nanikiru`                                       | Hand shanten/ukeire analysis                    | Anyone       |
| `/quiz nanikiru` · `chinitsu`                         | Practice quizzes                                | Anyone       |
| `/admin checknanikiru`                                | Inspect a quiz problem (QA)                     | Anyone       |

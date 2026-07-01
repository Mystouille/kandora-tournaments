# Installation & Setup

This guide walks you through running a self-hosted instance of **Kandora
Tournaments** locally for development, or building it for production.

For a high-level overview of the architecture, see the [README](README.md).

---

## 1. Prerequisites

| Requirement        | Version / Notes                                                 |
| ------------------ | --------------------------------------------------------------- |
| **Node.js**        | 20 or later (matches the `node:20` Docker base image).          |
| **npm**            | Ships with Node. The repo is locked with `package-lock.json`.   |
| **Git**            | Required — the project uses two git **submodules** (see below). |
| **Docker** _(opt)_ | Easiest way to run the MongoDB + Redis backing services.        |
| **MongoDB**        | v7 (or a hosted cluster / Atlas connection string).             |
| **Redis**          | v7 (used by BullMQ for the scheduling / hydration queues).      |

### Native build dependencies

This app depends on [`canvas`](https://www.npmjs.com/package/canvas) and
[`sharp`](https://www.npmjs.com/package/sharp) for image rendering, which
compile against native libraries. If `npm install` fails building `canvas`,
install the system libraries first:

- **Debian / Ubuntu**

  ```bash
  sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev \
    libjpeg-dev libgif-dev librsvg2-dev
  ```

- **macOS (Homebrew)**

  ```bash
  brew install pkg-config cairo pango libpng jpeg giflib librsvg
  ```

- **Windows** — follow the
  [node-canvas Windows build guide](https://github.com/Automattic/node-canvas/wiki/Installation:-Windows).
  Using **Docker** or **WSL2** is the smoother path on Windows.

---

## 2. Clone the repository (with submodules)

The app pulls in two shared submodules:

- [`app/db`](app/db) → **kandora-core** (database models + shared mahjong types)
- [`app/game`](app/game) → **kandora-game** (game engine, renderer, replay viewer)

Clone the repo **recursively** so the submodules are checked out at the same time:

```bash
git clone --recurse-submodules https://github.com/Mystouille/kandora-tournaments.git
cd kandora-tournaments
```

> **Forgot `--recurse-submodules`?** If you already cloned without it (the
> `app/db` and `app/game` folders are empty), initialise the submodules with:
>
> ```bash
> npm run submodules:init
> # equivalent to: git submodule update --init --recursive
> ```

---

## 3. Install dependencies

```bash
npm install
```

---

## 4. Start the backing services (MongoDB + Redis)

The repo ships a `docker-compose.yml` that runs MongoDB 7 and Redis 7 with
persistent volumes:

```bash
docker compose up -d
```

This exposes:

- **MongoDB** on `localhost:27017`
- **Redis** on `localhost:6379`

Stop them with `docker compose down` (add `-v` to also wipe the data volumes).

> Prefer your own MongoDB/Redis (e.g. Atlas, a managed Redis)? Skip Docker and
> point `MONGODB_URI` / `REDIS_URL` at your own instances in the next step.

---

## 5. Configure environment variables

Copy the example file and edit it:

```bash
cp .env.example .env
```

Environment variables are loaded by [`config.ts`](config.ts) (via `dotenv`).
They are grouped so that optional integrations stay disabled until you fill them
in — only the **Core** group is mandatory.

### Core — required (the app will not start without these)

| Variable            | Description                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`       | MongoDB connection string, e.g. `mongodb://localhost:27017/kandora-tournaments`.                                                                     |
| `APP_BASE_URL`      | Public base URL of the app, e.g. `http://localhost:5173`. Used server-side to build OAuth callback URLs.                                             |
| `VITE_APP_BASE_URL` | Browser-exposed copy of `APP_BASE_URL`, inlined into the client bundle to build the Discord redirect URI client-side. **Must match `APP_BASE_URL`.** |
| `JWT_SECRET`        | Long random string used to sign session tokens. **Generate your own** (see below).                                                                   |

Generate a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **Optional SSO — `AUTH_COOKIE_DOMAIN`.** Set to a parent domain (e.g.
> `.example.com`) to share the login session across sub-domains. Only useful if
> you also run the Kandora portal under the same domain **with the same
> `JWT_SECRET`**. Leave unset for a normal host-only cookie (the default). See
> [`jwt.server.ts`](app/utils/jwt.server.ts).

### Redis — queues / scheduling

| Variable    | Description                                                                       |
| ----------- | --------------------------------------------------------------------------------- |
| `REDIS_URL` | Redis connection string, e.g. `redis://localhost:6379` (use `rediss://` for TLS). |

> The Redis connection helper also accepts `REDIS_URI`, `REDIS_PRIVATE_URL`,
> `REDIS_PUBLIC_URL`, or discrete `REDIS_HOST` / `REDIS_PORT` values, and
> `REDIS_TLS=true` forces TLS even without a `rediss://` URL. In **production**
> it refuses to connect to a `localhost` Redis — set a real `REDIS_URL`. See
> [`redisConnection.server.ts`](app/services/redisConnection.server.ts).

### Discord — login (OAuth) + bot _(optional, but needed for sign-in)_

Create an application at the
[Discord Developer Portal](https://discord.com/developers/applications).

| Variable                 | Description                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `VITE_DISCORD_CLIENT_ID` | Discord application **Client ID**. Exposed to the browser (powers the login button).                            |
| `DISCORD_CLIENT_SECRET`  | Discord application **Client Secret** (server-side only — keep secret).                                         |
| `DISCORD_BOT_TOKEN`      | Bot token (only needed if you run the Discord bot integration).                                                 |
| `SERVERS_JSON`           | JSON describing the Discord servers this instance manages + the role IDs that grant admin / editor permissions. |

In the Discord app's **OAuth2** settings, add this **redirect URI**:

```
<APP_BASE_URL>/auth/discord/callback
```

e.g. `http://localhost:5173/auth/discord/callback` for local development.

`SERVERS_JSON` is a single-line JSON string. Illustrative shape (the exact
schema is defined by the bot / permissions layer):

```jsonc
[
  {
    "guildId": "123456789012345678",
    "adminRoleIds": ["111111111111111111"],
    "editorRoleIds": ["222222222222222222"],
  },
]
```

### Game-platform connectors _(optional)_

These enable auto-hydration of results from external mahjong platforms. Leave
them blank to keep the connectors disabled. Set
`PLATFORM_CONNECTORS_DISABLED=true` to force them all off regardless of the
values below.

| Variable                       | Platform     | Description                                                                                                     |
| ------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `PLATFORM_CONNECTORS_DISABLED` | —            | `true` to force-disable all connectors.                                                                         |
| `MAJSOUL_UID`                  | Mahjong Soul | Account UID of the bot. Inspect the login process into majsoul and use the Data.UserInfo.UID2 from the response |
| `MAJSOUL_FRIENDID`             | Mahjong Soul | Mahjong Soul public friend ID of the bot                                                                        |
| `MAJSOUL_TOKEN`                | Mahjong Soul | Auth token. Inspect the login process into majsoul and use the Data.UserInfo.Token from the response            |
| `RIICHICITY_EMAIL`             | Riichi City  | Account email.                                                                                                  |
| `RIICHICITY_PASSWD`            | Riichi City  | Account password.                                                                                               |
| `RIICHICITY_FRIENDID`          | Riichi City  | Riichi City public friend ID of the bot                                                                         |
| `RIICHICITY_GUID`              | Riichi City  | A random string to identify the device used to log in, put what you want.                                       |

> Behind a firewall? Set `http_proxy` to route the outbound Majsoul WebSocket
> connection through an HTTPS proxy.

### Translation _(optional)_

| Variable        | Description                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `DEEPL_API_KEY` | DeepL API key. Enables auto-translation from French to English of tournament home pages when present. |

### Nanikiru quiz — Google Sheets _(optional)_

Powers the Discord bot's "what would you discard" quiz, which pulls its
questions from a Google Sheet. Requires a Google **service-account** JSON with
read access to the sheet. Both `NANIKIRU_SHEET_ID` and
`GOOGLE_SERVICE_ACCOUNT_JSON` must be set for the group to activate.

| Variable                      | Description                                                             |
| ----------------------------- | ----------------------------------------------------------------------- |
| `NANIKIRU_SHEET_ID`           | ID of the Google Sheet holding the quiz questions.                      |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service-account credentials JSON (single-line string) with read access. |

### In-app mahjong game _(optional)_

| Variable               | Description                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GAME_ENABLED`         | `true` to enable the built-in mahjong game routes. **Off by default** — game routes return 404 when unset.                                                                                   |
| `VITE_PUBLIC_BASE_URL` | Canonical public origin baked into in-game share links at **build** time. Set it for prod / mobile builds so shared URLs point at your public hostname instead of the client's local origin. |

### Workers _(optional)_

The league / scheduling / Discord-sync BullMQ workers can run inline in the web
process or as separate processes.

| Variable               | Description                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_INLINE_WORKER` | `true` to run the workers inline in the web process. Defaults to inline in production; in development run them separately with `npm run worker:league` / `npm run worker:scheduling`. |

### Uploads & deployment _(optional)_

| Variable     | Default                                              | Description                                                                                                                   |
| ------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `UPLOAD_DIR` | `.data/uploads` (dev) / `/data/uploads` (production) | Where team / player pictures are written. In production mount a **persistent volume** here, or uploads disappear on redeploy. |
| `BASE_PATH`  | `""`                                                 | Mount the app under a sub-path (e.g. behind a shared reverse proxy).                                                          |
| `PORT`       | `3000`                                               | Port the production server listens on (`npm run start`).                                                                      |

---

## 6. Run the app

### Development (hot reload)

```bash
npm run dev
```

The app starts on `http://localhost:3000` (or the host/port React Router
reports). Make sure MongoDB and Redis are running first (step 4).

### Production build

```bash
npm run build   # builds the client + server bundles into ./build
npm run start   # serves ./build/server/index.js
```

When building with Docker, the Discord client id must be passed at build time so
it can be baked into the client bundle:

```bash
docker build --build-arg VITE_DISCORD_CLIENT_ID=<your-client-id> -t kandora-tournaments .
docker run -p 3000:3000 --env-file .env kandora-tournaments
```

> `VITE_*` variables are inlined into the browser bundle at **build** time, so
> `VITE_DISCORD_CLIENT_ID` must be set when running `npm run build` /
> `docker build`, not only at runtime.

---

## 7. Useful scripts

| Script                      | Description                                               |
| --------------------------- | --------------------------------------------------------- |
| `npm run dev`               | Start the dev server.                                     |
| `npm run build`             | Production build.                                         |
| `npm run start`             | Serve the production build.                               |
| `npm run typecheck`         | `react-router typegen` + `tsc`.                           |
| `npm run lint`              | Run ESLint. `npm run lint:fix` to auto-fix.               |
| `npm run test`              | Run the Vitest suite.                                     |
| `npm run submodules:init`   | Check out the `kandora-core` + `kandora-game` submodules. |
| `npm run core:update`       | Update `app/db` to the latest `kandora-core` main.        |
| `npm run game:update`       | Update `app/game` to the latest `kandora-game` main.      |
| `npm run worker:league`     | Run the league hydration worker.                          |
| `npm run worker:scheduling` | Run the scheduling worker.                                |
| `npm run deploy:commands`   | Register the Discord slash commands.                      |

---

## 8. Updating submodules

To pull the latest models / game engine after they change upstream:

```bash
npm run core:update   # app/db  → kandora-core
npm run game:update   # app/game → kandora-game
```

Commit the updated submodule pointers afterwards if you want to pin the new
revisions.

---

## 9. Troubleshooting

- **`app/db` or `app/game` is empty** — the submodules were not checked out. Run
  `npm run submodules:init`.
- **`canvas` fails to compile during `npm install`** — install the native build
  dependencies from [section 1](#native-build-dependencies), then retry.
- **`Missing required environment variables: MONGODB_URI, APP_BASE_URL, JWT_SECRET`**
  — fill in the **Core** group in `.env` (step 5).
- **Redis "configured with a local host in production" error** — set a real
  `REDIS_URL` (not `localhost`) when `NODE_ENV=production`.
- **Discord login fails / redirect mismatch** — confirm the
  `<APP_BASE_URL>/auth/discord/callback` redirect URI is registered in the
  Discord Developer Portal and that `APP_BASE_URL` matches the URL you visit.

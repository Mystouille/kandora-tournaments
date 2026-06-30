# Kandora Tournaments

Self-hostable online mahjong **tournament platform** with **Discord bot**
integration. It lets a community run online leagues/tournaments across multiple
game platforms (Mahjong Soul, Riichi City, Tenhou), auto-hydrate game results,
post standings to Discord, and replay games in the browser.

This app is extracted from the Kandora portal so anyone can host their own
instance without using the original operator's server.

> **Status:** scaffolding in progress (Phase 1). The bot, backend services, and
> tournament UI are being migrated in.

## Architecture

- **React Router v7** full-stack app (SSR), deployed as a single service.
- **MongoDB** (via Mongoose) for persistence; **Redis** (BullMQ) for the
  scheduling/hydration/Discord-sync queues.
- **Discord OAuth** for login; admin/editor permissions come from Discord
  server roles (configured in `SERVERS_JSON`).
- Two shared **git submodules**:
  - [`app/db`](app/db) → **kandora-core**: database models + shared mahjong
    types/enums (data-only, no React).
  - [`app/game`](app/game) → **kandora-game**: the game engine, renderer, and
    replay components (powers the in-browser replay viewer).

## Getting started

> For detailed setup instructions (prerequisites, every environment variable,
> Docker, and troubleshooting) see [INSTALLATION.md](INSTALLATION.md).

```bash
# 1. Clone with submodules
git clone --recurse-submodules <this-repo-url>
cd kandora-tournaments
# (if you forgot --recurse-submodules:)
npm run submodules:init

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
#   then edit .env (MONGODB_URI, JWT_SECRET, Discord credentials, ...)

# 4. Start the backing services (Mongo + Redis)
docker compose up -d

# 5. Run the dev server
npm run dev
```

## Useful scripts

| Script                    | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `npm run dev`             | Start the dev server.                                     |
| `npm run build`           | Production build.                                         |
| `npm run start`           | Serve the production build.                               |
| `npm run typecheck`       | `react-router typegen` + `tsc`.                           |
| `npm run test`            | Run the Vitest suite.                                     |
| `npm run submodules:init` | Check out the `kandora-core` + `kandora-game` submodules. |
| `npm run core:update`     | Update `app/db` to the latest `kandora-core` main.        |
| `npm run game:update`     | Update `app/game` to the latest `kandora-game` main.      |

## License

TBD.

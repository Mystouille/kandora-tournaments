# BullMQ / Redis setup

The tournaments app uses **BullMQ** (backed by **Redis**) for its background-job
subsystem:

- **league** — polls the game platforms (Majsoul, Riichi City, Tenhou) for
  finished games and hydrates them
- **scheduling** — polls scheduling-message status for `/startNext` batches
- **discord-sync** — daily refresh of Discord display names / avatars

This file is a pointer; the full setup lives in
[INSTALLATION.md](INSTALLATION.md):

- **Run Redis (+ MongoDB) locally** —
  [§4 Start the backing services](INSTALLATION.md#4-start-the-backing-services-mongodb--redis)
  (`docker compose up -d`). VS Code users can also run the `docker:redis:up`
  task from [.vscode/tasks.json](.vscode/tasks.json).
- **Configure the connection** —
  [§ Redis — queues / scheduling](INSTALLATION.md#redis--queues--scheduling)
  (`REDIS_URL` and the accepted variants / TLS). See also the Redis block in
  [.env.example](.env.example).
- **Inline vs. separate worker processes** —
  [§ Workers](INSTALLATION.md#workers-optional) (`ENABLE_INLINE_WORKER`,
  `npm run worker:league`, `npm run worker:scheduling`).

## When the subsystem runs

Redis is the master switch (`isRedisConfigured()` in
[app/services/redisConnection.server.ts](app/services/redisConnection.server.ts)):

- **No Redis configured** → the whole subsystem is skipped; the app runs
  web-only.
- **Redis configured** → the **discord-sync** worker runs (it is
  platform-agnostic).
- **Redis configured _and_ `PLATFORM_CONNECTORS_DISABLED` is not `true`** →
  the **league** and **scheduling** workers also run (they drive the platform
  connectors). Tenhou needs no credentials, so it is polled whenever league
  polling is on.

Worker start-up is wired in
[app/services/serverInit.server.ts](app/services/serverInit.server.ts).

## Local Redis tasks (VS Code)

[.vscode/tasks.json](.vscode/tasks.json) provides: `redis:ensure-local`,
`docker:redis:up`, `docker:redis:down`, `redis:check`, `redis:stop-local`.

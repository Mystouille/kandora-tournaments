# Dockerfile for the tournaments-owned kandora game-server.
#
# Build context MUST be the repository root (the game-server pulls
# in shared code from `app/` and `config.ts`). On Railway set:
#   - Root Directory: /
#   - Dockerfile Path: game-server/Dockerfile
#
# Runs the TypeScript entry directly via `tsx` (same as `npm run
# game:server`). We keep dev dependencies installed in the runtime
# image because `tsx` lives in devDependencies — bundling/compiling
# would require a separate build pipeline we don't have yet.

# Railway does not check out git submodules, and its build context has no .git,
# so `app/core` (kandora-core) and `app/game` (kandora-game) arrive empty. Both are
# PUBLIC repos, so we clone them here and overlay them in the runtime stage below.
# NOTE: tracks each submodule's `main` branch, not the exact SHA pinned by the
# tournaments commit (the pin lives in this repo's gitlinks, which Railway strips).
FROM alpine/git:latest AS submodules
# RAILWAY_GIT_COMMIT_SHA changes on every deploy; referencing it busts the Docker
# layer cache so each deploy re-clones the latest submodule `main` (otherwise the
# clone layer is cached indefinitely and never picks up submodule updates).
ARG RAILWAY_GIT_COMMIT_SHA=local
COPY GAME_SERVER_VERSION /tmp/GAME_SERVER_VERSION
WORKDIR /submodules
RUN echo "submodule cache-bust: ${RAILWAY_GIT_COMMIT_SHA} $(cat /tmp/GAME_SERVER_VERSION)" \
    && git clone --depth 1 --branch main https://github.com/Mystouille/kandora-core.git core \
    && git clone --depth 1 --branch main https://github.com/Mystouille/kandora-game.git game \
    && rm -rf core/.git game/.git

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Native deps required by `canvas` (transitively pulled in by the
# shared `app/` codebase even though the game-server itself does
# not render images). Pre-installing the build toolchain here so
# `npm ci` can compile `canvas` from source.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
# Pin npm to the version that generated package-lock.json (see web Dockerfile).
# node:20's default npm (10.x) vs 11.x differ on Tailwind's bundled WASM optional
# deps, which otherwise makes `npm ci` fail with EUSAGE "lockfile out of sync".
RUN npm install -g npm@11.6.2
RUN npm ci

FROM node:20-slim AS runtime
WORKDIR /app
# Runtime shared libs for the prebuilt `canvas` binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
# NOTE: tournaments has no `basePathConfig.ts` (its `config.ts` reads BASE_PATH
# directly), so — unlike the portal game-server — we copy only `config.ts`.
COPY package.json package-lock.json tsconfig.json config.ts ./
COPY app ./app
# Overlay the cloned submodule contents (see the `submodules` stage above);
# Railway leaves app/core and app/game empty.
COPY --from=submodules /submodules/core ./app/core
COPY --from=submodules /submodules/game ./app/game
COPY game-server ./game-server

ENV NODE_ENV=production
ENV GAME_SERVER_PORT=8787
EXPOSE 8787

# Use `tsx` from local node_modules so we don't depend on a global
# install. Same entry as `npm run game:server`.
CMD ["node", "--enable-source-maps", "./node_modules/tsx/dist/cli.mjs", "game-server/index.ts"]

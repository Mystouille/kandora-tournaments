# Railway does not check out git submodules, and its build context has no .git,
# so `app/db` (kandora-core) and `app/game` (kandora-game) arrive empty. Both are
# PUBLIC repos, so we clone them here and overlay them onto the source tree below.
# NOTE: this tracks each submodule's `main` branch, not the exact SHA pinned by the
# tournaments commit (the pin lives in this repo's gitlinks, which Railway strips).
FROM alpine/git:latest AS submodules
# RAILWAY_GIT_COMMIT_SHA changes on every deploy; referencing it busts the Docker
# layer cache so each deploy re-clones the latest submodule `main` (otherwise the
# clone layer is cached indefinitely and never picks up submodule updates).
ARG RAILWAY_GIT_COMMIT_SHA=local
WORKDIR /submodules
RUN echo "submodule cache-bust: ${RAILWAY_GIT_COMMIT_SHA}" \
    && git clone --depth 1 --branch main https://github.com/Mystouille/kandora-core.git db \
    && git clone --depth 1 --branch main https://github.com/Mystouille/kandora-game.git game \
    && rm -rf db/.git game/.git

FROM node:20-slim AS development-dependencies-env
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev && rm -rf /var/lib/apt/lists/*
# Pin npm to the version that generated package-lock.json. node:20's default
# npm (10.x) and npm 11.x disagree on how optional/bundled deps (e.g. tiptap's
# @floating-ui/dom and Tailwind's @tailwindcss/oxide-wasm32-wasi) are recorded,
# which makes `npm ci` fail with EUSAGE "lockfile out of sync". Keep this in
# lockstep with the npm used locally.
RUN npm install -g npm@11.6.2
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci
COPY . /app
# Overlay the cloned submodule contents (see the `submodules` stage above);
# Railway leaves app/db and app/game empty.
COPY --from=submodules /submodules/db /app/app/db
COPY --from=submodules /submodules/game /app/app/game

FROM node:20-slim AS production-dependencies-env
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev && rm -rf /var/lib/apt/lists/*
# Keep npm in lockstep with the version used to generate package-lock.json
# (see note in the development-dependencies-env stage above).
RUN npm install -g npm@11.6.2
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:20-slim AS build-env
ARG VITE_DISCORD_CLIENT_ID
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID
COPY --from=development-dependencies-env /app /app
WORKDIR /app
RUN npm run build

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 && rm -rf /var/lib/apt/lists/*
COPY ./package.json package-lock.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
# `react-router-serve`'s .bin symlink isn't created under `npm ci --omit=dev`:
# @react-router/serve is a peerOptional of the dev-only @react-router/dev, so npm
# flags it "peer" and skips bin-linking when dev deps are omitted. Invoke the bin
# directly via node (scripts/start.cjs), which also adds graceful SIGTERM handling
# for zero-downtime redeploys.
COPY ./scripts/start.cjs /app/scripts/start.cjs
WORKDIR /app
EXPOSE 3000
CMD ["node", "scripts/start.cjs", "./build/server/index.js"]

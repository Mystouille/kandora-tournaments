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
WORKDIR /app
EXPOSE 3000
CMD ["npm", "run", "start"]

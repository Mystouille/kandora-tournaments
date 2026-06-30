FROM node:20-slim AS development-dependencies-env
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev && rm -rf /var/lib/apt/lists/*
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci
COPY . /app

FROM node:20-slim AS production-dependencies-env
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev && rm -rf /var/lib/apt/lists/*
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

FROM node:26-alpine AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docs/package.json docs/package.json

RUN pnpm install --frozen-lockfile --filter docs...

COPY docs docs

RUN pnpm --filter docs run build

FROM nginx:1.29-alpine

COPY --from=build /app/docs/dist /usr/share/nginx/html

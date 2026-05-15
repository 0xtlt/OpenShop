FROM node:26-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@11.1.0

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile --ignore-scripts=false

FROM deps AS build

COPY . .
RUN pnpm run build

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app ./

EXPOSE 3000

CMD ["pnpm", "exec", "pm2-runtime", "start", "ecosystem.config.cjs"]

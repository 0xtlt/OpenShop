# AGENTS.md

## Cursor Cloud specific instructions

These notes cover non-obvious setup/run caveats for this repo in the Cursor Cloud VM. For standard commands, see `README.md`, `package.json` scripts, and `.github/workflows/ci.yml`.

### Toolchain
- Node **26** and pnpm **11.21.0** are required (`engines` enforce `>=26 <27` / `>=11 <12`). They are preinstalled and made the default by symlinks in `/usr/local/cargo/bin` (which wins on `PATH` over the sandbox's built-in Node). `node -v` should report `v26.x`; if it reports v22, the symlinks are missing.
- The startup update script runs `pnpm install` then `pnpm --filter openshop run build:cli`.

### PostgreSQL (the only external service)
- Postgres **17** is installed natively (Docker is NOT installed — do not use `docker compose up`).
- It is not auto-started on boot. Start it with: `sudo pg_ctlcluster 17 main start` (check with `pg_isready -h localhost -U openshop`).
- The role and databases already exist (persisted in the cluster): role `openshop`/`openshop`, databases `openshop` and `openshop_test`. Connection string: `postgresql://openshop:openshop@localhost:5432/openshop`.

### The `openshop` CLI must be built
- The workspace CLI (`packages/openshop`) runs from `dist/`, which is gitignored. The demo app's `dev`/`build`/`test` all shell out to the `openshop` binary, which errors with "Built CLI not found" if `dist/` is missing.
- The update script builds it. If you edit `packages/openshop/src`, rebuild with `pnpm --filter openshop run build:cli` — the demo `dev` server hot-reloads the app but does NOT rebuild the framework CLI itself.

### Running the demo app (the end-to-end product)
- From the repo root: `pnpm run dev`. This pushes the Drizzle schema, then starts the API server (`:3001`), the Vite admin UI (`:3000`, which proxies `/api`, `/auth`, `/webhooks`, `/proxy`, `/mcp`, `/health` to the API), and an in-process worker + cron scheduler. Postgres must be running.
- `apps/demo/.env` is required for dev (gitignored). It needs `DATABASE_URL`, `ENCRYPTION_KEY` (64 hex chars), and `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` (dummy values are fine for local API/testing).
- The admin UI is an **embedded Shopify app** (Shopify App Bridge). It only renders inside the Shopify admin iframe, so opening `http://localhost:3000` directly in a browser will not initialize. To exercise the backend without a Shopify store: call the API with a HS256 session JWT signed by `SHOPIFY_API_SECRET` (`aud` = `SHOPIFY_API_KEY`, `iss`/`dest` = `https://<shop>.myshopify.com`). For a real embedded run, use `pnpm --filter openshop-demo run shopify` with a Shopify Partner app + development store.

### Tests
- All test suites need Postgres running with `DATABASE_URL` set. Framework integration tests use the `openshop_test` database; demo tests require pushing the demo schema first (`drizzle-kit push`, as `coverage:demo` does). See `.github/workflows/ci.yml` for the authoritative sequence.

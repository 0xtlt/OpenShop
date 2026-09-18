# Contributing to OpenShop

Use the [app tutorial](https://docs.openshop.run/tutorials/first-app/) to build an
integration. Clone this repository when changing the framework, demo, or docs.

## Set up the repository

Install Node.js 26 and pnpm 11.21.0, then run:

```bash
git clone https://github.com/0xtlt/OpenShop.git
cd OpenShop
pnpm install --frozen-lockfile
pnpm --filter openshop run build:cli
```

The local `openshop` binary loads built files from `packages/openshop/dist`.
Rebuild the CLI after changing framework source before exercising it in the demo.

| Workspace | Purpose |
| --- | --- |
| `packages/openshop` | Framework, CLI, minimal template, and framework tests |
| `apps/demo` | Integration app used to exercise framework features |
| `docs` | Astro/Starlight documentation at `docs.openshop.run` |

## Work on documentation

No database or Shopify credentials are needed:

```bash
pnpm --filter docs run dev
pnpm --filter docs run check
```

The first command runs a long-lived development server; run the check separately.
See [the documentation guide](docs/README.md) for content structure, previewing,
link checks, and examples.

## Run the demo

Start PostgreSQL 17 using the repository's Docker Compose setup:

```bash
docker compose up -d postgres
```

On its first initialization, the container creates `openshop` and `openshop_test`.
If your environment supplies PostgreSQL directly, create both databases with the
matching role instead. See [AGENTS.md](AGENTS.md) for Cursor Cloud specifics.

Create `apps/demo/.env` with `DATABASE_URL` and a persistent development
`ENCRYPTION_KEY` (generate one with `openssl rand -hex 32`). For an embedded run,
link the demo to your development Shopify app and store, then run:

```bash
pnpm --filter openshop-demo run shopify
```

This starts Shopify CLI and OpenShop together. Open the preview inside Shopify
admin. `pnpm run dev` starts OpenShop directly when you only need the backend;
it does not provide an authenticated embedded Shopify session.

## Validate a change

For framework or demo changes, build the CLI and run the repository checks:

```bash
pnpm --filter openshop run build:cli
pnpm run check
```

With PostgreSQL running and the test databases available, run relevant suites:

```bash
pnpm run coverage:unit
pnpm run coverage:integration
pnpm run coverage:demo
```

Keep test databases separate from production. The demo suite pushes its schema;
framework integration tests use `openshop_test`. For packaging or template
changes, also run `pnpm --filter openshop run smoke:pack`.
[CI](.github/workflows/ci.yml) defines the full validation sequence.

## Open a pull request

Describe the user-visible problem and resulting behavior, then list the checks
you ran and any untested external setup. Keep unrelated changes separate. Update
the relevant tutorial, guide, reference, or explanation when behavior changes.

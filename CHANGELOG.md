# Changelog

All notable changes to OpenShop will be documented in this file.

## [0.0.12-beta.0] - 2026-09-21

### Changed

- Rebuilt the documentation around Diátaxis: tutorials, how-to guides,
  explanation, and reference. The README now points into those docs, and a
  link checker covers the documentation site.
- Relicensed OpenShop from Elastic License 2.0 to the MIT License, with
  copyright held by Thomas Tastet (2026).

### Fixed

- Saved providers now show as configured before a health check runs. A
  provider with every required field saved no longer appears as
  "Not configured" until someone runs Test connection.

## [0.0.11-beta.0] - 2026-09-18

### Added

- Added experimental custom admin pages (opt-in via
  `experimental.customPages`). Apps can add Preact screens under
  `admin/pages`; OpenShop discovers them from the filesystem and bundles
  them into the embedded admin UI.
- Added typed loader and action contracts with authenticated custom-page
  RPC, authorization, navigation, and lifecycle hooks via `openshop/admin`.
- Added demo reviews pages, reference documentation in
  `custom-admin-pages.mdx`, and tests covering discovery, routing,
  authorization, RPC, and admin function helpers.

### Fixed

- Upgraded the documentation site to Astro 7.3.3 and Starlight 0.42.1 so
  the lockfile resolves `devalue` 5.9.2 and `pnpm audit --audit-level moderate`
  no longer fails on GHSA-9rgm-9g3h-6x36.

## [0.0.4-beta.0] - 2026-08-12

### Changed

- Updated framework, demo, documentation, generated-template, build, and test
  dependencies to their latest compatible releases.
- Updated pnpm to 11.21.0 across local development, CI, documentation builds,
  and generated application containers.
- Added a 24-hour dependency release-age safeguard to keep newly published
  packages quarantined until they pass the repository's supply-chain policy.

### Fixed

- Resolved all known dependency vulnerabilities, including advisories in Hono,
  `brace-expansion`, `js-yaml`, and `nanoid`.
- Aligned dependency overrides with patched releases and regenerated the
  lockfile with a clean peer-dependency graph.

## [0.0.3-beta.0] - 2026-07-29

### Added

- Added complete Admin API, public SDK, environment, authentication, operations,
  architecture, security, logging, error, versioning, upgrade, and
  troubleshooting documentation.
- Added detailed contracts and end-to-end examples for flows, providers,
  databases, GraphQL codegen, proxy routes, webhooks, Shopify Functions, MCP,
  testing, and production deployment.
- Added documentation sitemap, canonical URLs, `robots.txt`, `llms.txt`, social
  metadata, structured data, and a branded no-index 404 page.
- Added packaged-scaffold verification to CI.

### Changed

- The project generator now injects the package's own version into generated
  applications instead of relying on a manually maintained template version.
- Documentation nginx redirects are relative so HTTPS reverse proxies do not
  receive an HTTP downgrade location.
- The first-app tutorial now covers PostgreSQL, environment configuration,
  Shopify CLI linking, migrations, and a complete smoke flow.
- Updated Hono, Astro, Sharp, and vulnerable transitive dependencies to their
  patched releases.

### Fixed

- Fixed the generated project's dependency on the unpublished `openshop@0.1.1`.
- Fixed an incorrect Shopify GraphQL response example.
- Fixed production instructions that placed the blocking web and worker
  processes sequentially in one shell.

## [0.0.2-beta.0] - 2026-06-30

### Added

- Published the first beta release under the `beta` npm dist-tag.
- Added a dedicated Starlight documentation site and deployment Dockerfile for `docs.openshop.run`.
- Added new documentation sections for first app setup, Shopify app configuration, providers, flows, proxy routes, production deployment, testing, CLI, database, webhooks, MCP, GraphQL codegen, and project structure.
- Added generated app import aliases such as `#app`, `#flows/*`, `#providers/*`, and related aliases to avoid relative `../` imports in app code.

### Changed

- Reworked the README and package README around the generated-app workflow instead of cloning the framework repository.
- Updated package metadata so the npm package homepage points to `https://openshop.run/`.
- Normalized the CLI bin path metadata for npm publishing.
- Reorganized docs into guide, tutorial, and reference sections.

### Fixed

- Fixed the docs deployment Dockerfile to install pnpm before building.
- Clarified the license terms reference in the README files.

## [0.0.1] - 2026-06-30

### Added

- Initial OpenShop package release.
- Added the `openshop` CLI for generating and running OpenShop apps.
- Added typed app definitions, providers, flows, background workers, cron scheduling, webhooks, proxy routes, Shopify Functions helpers, Admin GraphQL support, and the embedded admin UI.
- Added PostgreSQL storage with Drizzle schema helpers and app-owned migrations.
- Added package metadata, repository links, and npm publishing configuration.

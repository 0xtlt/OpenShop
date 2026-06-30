# Changelog

All notable changes to OpenShop will be documented in this file.

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

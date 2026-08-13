---
title: Versioning
description: Beta compatibility expectations for OpenShop packages, templates, configuration, and migrations.
---

OpenShop is currently beta. Until `1.0`, minor or prerelease updates can change
public TypeScript APIs, configuration, generated template files, database
migrations, CLI behavior, and documented workflows.

## Pinning policy

- Applications should pin an exact OpenShop version while evaluating an update.
- Commit `pnpm-lock.yaml` and generated migrations.
- Deploy web and worker from the same lockfile and build.
- Do not assume `openshop init` updates an existing project.

The package version used to generate a project and the dependency written into
that project's `package.json` must refer to a published compatible release.
OpenShop's smoke tests should scaffold into an empty directory, install, lint,
test, and build the result before publication.

## Compatibility surfaces

| Surface | Compatibility check |
| --- | --- |
| TypeScript SDK | Run type-checking and application tests. |
| Generated template | Compare scripts, aliases, TOML, Docker, PM2, and Drizzle files. |
| Configuration | Start the app so runtime validation checks registered names and positive numeric options. |
| Database | Generate and review SQL; test forward migration and application rollback compatibility. |
| GraphQL codegen | Regenerate operations against the configured Shopify API schema. |
| Web and worker | Deploy the exact same package and config version. |

See [Upgrade OpenShop](/guides/upgrade/) for the step-by-step procedure.

## Publishing

Maintainers cut npm releases from GitHub Actions with **Release npm**. The
workflow is manual (`workflow_dispatch`) and never publishes on push to `main`.

Choose a bump mode:

- `auto` reads conventional commits since the published npm version (`feat` →
  minor, `fix` / `perf` / `revert` / `deps` → patch, breaking changes → major).
- `current` publishes the version already in `packages/openshop/package.json`,
  which must be newer than the version on npm.
- `patch`, `minor`, and `major` bump from the published npm version.

The resolved version is applied only for the publish job. It is not committed
back to `main`. Releases are tagged `vX.Y.Z`, published to the npm `latest`
dist-tag, and recorded as a GitHub Release.

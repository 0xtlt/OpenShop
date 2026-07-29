---
title: Upgrade OpenShop
description: Upgrade the OpenShop package, generated files, and database schema safely.
---

OpenShop is beta software. Read the repository changelog and test an upgrade in
a non-production environment before changing production.

## Upgrade procedure

1. Record the current package version and create a database backup.

   ```bash
   pnpm why openshop
   ```

2. Update to an explicit version first. Avoid an unreviewed range change in the
   same deployment.

   ```bash
   pnpm add openshop@<version>
   ```

3. Compare the current project with
   `packages/openshop/templates/minimal/` in the matching release. Generated
   projects are not rewritten automatically. Review package scripts, Shopify
   TOML, `Dockerfile`, `ecosystem.config.cjs`, TypeScript aliases, and Drizzle
   configuration.

4. Regenerate application-owned artifacts.

   ```bash
   pnpm run codegen
   pnpm exec openshop migrate generate --name=upgrade
   pnpm exec openshop migrate check
   pnpm run lint
   pnpm run test
   pnpm run build
   ```

5. Review and commit generated SQL. Apply it once before deploying the new web
   and worker processes.

   ```bash
   pnpm exec openshop migrate
   ```

6. Deploy web and worker from the same build and package version. Run a smoke
   flow, inspect its checkpoints, and verify the embedded admin.

## Rollback boundary

Application processes can be rolled back only while the database schema remains
compatible with the older version. Once a destructive migration is applied,
restore a backup or use a reviewed forward fix. Prefer additive migrations
during rolling upgrades.

## Template drift

`openshop init` creates a new project from the version bundled in the installed
package. It does not update existing projects. Keep local template changes
explicit so later upgrades can distinguish application choices from generated
defaults.

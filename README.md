# OpenShop

[![npm version](https://img.shields.io/npm/v/openshop.svg?logo=npm)](https://www.npmjs.com/package/openshop)

Build Shopify integrations in TypeScript with background flows, configurable
service providers, and an embedded admin UI.

[Documentation](https://docs.openshop.run/) · [Website](https://openshop.run/) ·
[Changelog](https://github.com/0xtlt/OpenShop/blob/main/CHANGELOG.md)

OpenShop is in beta. APIs, generated files, and workflows may change before `1.0`.

## Start here

Follow [Build your first app](https://docs.openshop.run/tutorials/first-app/) to
set up PostgreSQL, create a project, install it on a Shopify development store,
and run the sample integration. You will need Node.js 26, pnpm 11, PostgreSQL 17,
Shopify CLI, and access to a development store.

Create an application from the published template:

```bash
pnpm dlx openshop init my-app
cd my-app
pnpm install
```

Continue with the tutorial to configure storage and link the Shopify app before
running `pnpm run shopify`.

## How it fits together

- **Providers** define external API methods and credential fields. OpenShop builds
  a configuration form for each shop and supplies configured connectors at runtime.
- **Flows** define background work in named steps. OpenShop queues runs, stores
  checkpoints, applies retry policies, and exposes execution logs.
- **App configuration** registers flows, providers, schedules, and HTTP features.
  Shopify OAuth and the embedded admin are handled by the framework.

In production, a web service accepts requests and queues work; a separate worker
executes it. PostgreSQL stores installations, credentials, runs, and checkpoints.
See [Architecture](https://docs.openshop.run/concepts/architecture/) for the model
and [Deploy to production](https://docs.openshop.run/guides/deploy-production/)
for build, migration, and process setup.

## Find the right documentation

| Your goal | Start here |
| --- | --- |
| Learn OpenShop by building something | [Tutorials](https://docs.openshop.run/tutorials/) |
| Connect a service, extend an app, test, or deploy | [How-to guides](https://docs.openshop.run/guides/) |
| Look up APIs, configuration, or CLI commands | [Reference](https://docs.openshop.run/reference/) |
| Understand retries, architecture, or shop isolation | [Explanation](https://docs.openshop.run/concepts/) |
| Diagnose a problem | [Troubleshooting](https://docs.openshop.run/guides/troubleshooting/) |

## Contribute

This repository contains the framework (`packages/openshop`), a demo app
(`apps/demo`), and the documentation site (`docs`). See
[CONTRIBUTING.md](CONTRIBUTING.md) for development and checks, and
[docs/README.md](docs/README.md) for documentation structure and writing guidance.

## License

OpenShop is source-available under the Elastic License 2.0.

You may use, modify, and redistribute OpenShop, including for internal production use and client projects. You may not provide OpenShop to third parties as a hosted or managed service where users get access to a substantial set of OpenShop's features.

Read the LICENSE file for the full terms.

---
title: Configure Shopify apps
description: Configure a single Shopify app or several apps sharing one OpenShop deployment.
---

Use this guide after creating an OpenShop project. For local linking and your
first installation, follow the [first-app tutorial](/tutorials/first-app/).

## 1. Choose the deployment shape

Use single-app mode for one Shopify client ID. Use explicit multi-app mode when
one deployment must serve several Shopify apps with the same scopes and app code.
See [Shop and app isolation](/concepts/shop-isolation/) for the data boundary.

### One Shopify app

Keep `shopify.apps` unset. Supply these through the production process environment:

```dotenv
SHOPIFY_API_KEY=your-client-id
SHOPIFY_API_SECRET=your-client-secret
HOST=https://your-app.example.com
```

Set the requested scopes in the linked `shopify.app.toml` or in `shopify.scopes`.
During local development, Shopify CLI supplies the app credentials and tunnel
URL when you run `pnpm run shopify`.

### Several Shopify apps

Link a TOML file for each Shopify app with Shopify CLI, then register the files
under stable handles in `openshop.config.ts`:

```ts
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'

export default app.defineConfig({
  shopify: {
    scopes: 'read_products,read_orders',
    apps: {
      retail: {
        toml: 'shopify.app.retail.toml',
        apiSecret: process.env.SHOPIFY_RETAIL_API_SECRET!,
      },
      wholesale: {
        toml: 'shopify.app.wholesale.toml',
        apiSecret: process.env.SHOPIFY_WHOLESALE_API_SECRET!,
      },
    },
  },
  flows: { syncOrders },
})
```

Provide each secret through the process environment. Keep API keys unique and
use each app's own secret. Include the TOML files in the deployed project;
OpenShop reads their client IDs and URLs at runtime. Each `application_url`
should point to the public OpenShop origin.

If your platform manages the client IDs directly, replace a `toml` entry with
`apiKey` and `appUrl`:

```ts
retail: {
  apiKey: process.env.SHOPIFY_RETAIL_API_KEY!,
  apiSecret: process.env.SHOPIFY_RETAIL_API_SECRET!,
  appUrl: 'https://your-app.example.com',
},
```

Use either `toml` or `apiKey` per entry. Keep global scopes identical for all apps.
The [configuration reference](/reference/configuration/#shopify) lists every
field and its resolution rules.

## 2. Deploy the Shopify configuration

Deploying the OpenShop server does not update Shopify's app configuration.
Release each relevant TOML with Shopify CLI:

```bash
shopify app deploy --config shopify.app.retail.toml
shopify app deploy --config shopify.app.wholesale.toml
```

For single-app mode, use the linked single-app config instead. Verify application
and callback URLs, webhook subscriptions, and app proxy settings. Requested scope
changes may need Shopify approval and renewed authorization by the merchant.

## 3. Verify each installation

Install each app from Shopify, then open it in Shopify admin. With Shopify
managed installation, the launch carries a session token that OpenShop
exchanges for the app's offline token, whatever its handle, `default` included.
See [Embedded installation](/reference/authentication/#embedded-installation).

To start OAuth yourself, for multiple apps, name the app handle:

```text
https://your-app.example.com/auth?shop=example.myshopify.com&app=retail
```

For each configured app, complete installation, open its embedded admin, save its
provider configuration, and run a harmless flow. Confirm the credentials and runs
appear only in the intended app/shop context.

If authentication fails, compare the selected client ID, secret, public URL, and
handle with [Authentication](/reference/authentication/) and
[Troubleshooting](/guides/troubleshooting/).

## Use a development store without OAuth

A development store of the organization that owns the app can get its token
without OAuth, through Shopify's client credentials grant. Install the app on
the store once. When the store opens the app in Shopify admin, OpenShop tries
the grant with that app's own credentials before redirecting to OAuth, in
single-app and multi-app mode alike; a store of another organization is
refused and keeps OAuth, and the refusal is not attempted again for an hour.
Only a launch Shopify signed within 90 seconds of the server's clock starts the
grant. A refusal met by background work before the app was installed never
holds back that launch.

For crons and `__global__` flows, which have no request from Shopify, set
`SHOPIFY_CLIENT_CREDENTIALS_SHOP` to the store's `<name>.myshopify.com` domain.
In multi-app mode it uses the `default` handle. OpenShop then requests and
renews that store's token itself, including after the database is recreated.
See [Client credentials](/reference/authentication/#client-credentials-development-stores).

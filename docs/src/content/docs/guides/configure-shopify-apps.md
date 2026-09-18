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

For multiple apps, start installation with an explicit app handle:

```text
https://your-app.example.com/auth?shop=example.myshopify.com&app=retail
```

For each configured app, complete installation, open its embedded admin, save its
provider configuration, and run a harmless flow. Confirm the credentials and runs
appear only in the intended app/shop context.

If authentication fails, compare the selected client ID, secret, public URL, and
handle with [Authentication](/reference/authentication/) and
[Troubleshooting](/guides/troubleshooting/).

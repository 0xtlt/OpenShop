---
title: Add a custom admin page
description: Add an experimental embedded admin screen with a typed server loader.
---

Use this guide to add a **Store** page to an existing app. It displays the trusted
shop identity returned by a server loader. You need a running app installed on a
development store.

:::caution[Experimental API]
Custom admin pages require `experimental.customPages`. Check the
[custom admin page reference](/reference/custom-admin-pages/) when upgrading.
:::

## 1. Create the server loader

Create `admin/pages/store/actions.server.ts`:

```ts
import { defineAdminLoader } from 'openshop/admin'

export const storeSummary = defineAdminLoader({
  handler: async ({ shop, shopifyApp }) => ({ shop, shopifyApp }),
})
```

The loader receives the identity verified by OpenShop. Keep database access,
provider credentials, and other server-only work in this file.

## 2. Create the page

Create `admin/pages/store/page.tsx`:

```tsx
import { defineAdminPage, useLoader } from 'openshop/admin'
import { storeSummary } from './actions.server.ts'

function Store() {
  const summary = useLoader(storeSummary, undefined)

  return (
    <s-page heading="Store">
      {summary.loading && <s-spinner accessibilityLabel="Loading store" />}
      {summary.error && <s-banner tone="critical">{summary.error.message}</s-banner>}
      {summary.data && <s-paragraph>{summary.data.shop}</s-paragraph>}
    </s-page>
  )
}

export default defineAdminPage({ title: 'Store', component: Store })
```

OpenShop rewrites the page-local loader import to a typed browser stub. The
browser calls the loader with a fresh Shopify session token.

## 3. Enable navigation

Add this option to the existing `app.defineConfig()` call in
`openshop.config.ts`, keeping its flows and other settings:

```ts
experimental: {
  customPages: {
    navigation: [{ label: 'Store', path: '/store' }],
  },
},
```

Restart the development command after adding the page files. Open the app from
Shopify admin and select **Store**. You should see the current shop domain.
Run `pnpm run lint` and `pnpm run build` to verify both types and browser/server
boundaries before deployment.

## Restrict access when adding business data

This example is available to authenticated app users. For narrower access, add
`pageAccess` and loader/action `authorize` policies as described in the
[authorization reference](/reference/custom-admin-pages/#authorization-and-errors).
When querying app-owned tables, filter by the trusted shop and app identity;
Drizzle does not add those filters automatically.

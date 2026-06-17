import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  integrations: [
    starlight({
      title: 'OpenShop',
      description: 'Shopify integration framework documentation.',
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { label: 'Overview', slug: 'index' },
            { label: 'Getting Started', slug: 'getting-started' },
            { label: 'Configuration', slug: 'configuration' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'Flows', slug: 'flows' },
            { label: 'Providers', slug: 'providers' },
            { label: 'GraphQL Codegen', slug: 'graphql-codegen' },
            { label: 'Database & Migrations', slug: 'database' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { label: 'Proxy Routes', slug: 'proxy-routes' },
            { label: 'Customer Account Extensions', slug: 'customer-account-extensions' },
            { label: 'Webhooks', slug: 'webhooks' },
            { label: 'Shopify Functions', slug: 'shopify-functions' },
          ],
        },
        {
          label: 'Operations',
          items: [
            { label: 'Testing', slug: 'testing' },
            { label: 'Production', slug: 'production' },
          ],
        },
      ],
    }),
  ],
})

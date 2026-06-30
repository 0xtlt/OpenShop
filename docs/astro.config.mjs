// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'OpenShop',
			logo: {
				light: './src/assets/openshop-logo.svg',
				dark: './src/assets/openshop-logo-dark.svg',
				alt: 'OpenShop',
				replacesTitle: true,
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/0xtlt/OpenShop' }],
			sidebar: [
				{
					label: 'Start Here',
					items: [
						{ label: 'Overview', slug: 'index' },
						{ label: 'Build your first app', slug: 'tutorials/first-app' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Configure Shopify apps', slug: 'guides/configure-shopify-apps' },
						{ label: 'Define a provider', slug: 'guides/define-provider' },
						{ label: 'Define a flow', slug: 'guides/define-flow' },
						{ label: 'Add proxy routes', slug: 'guides/add-proxy-routes' },
						{ label: 'Test an app', slug: 'guides/test-app' },
						{ label: 'Deploy to production', slug: 'guides/deploy-production' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Project structure', slug: 'reference/project-structure' },
						{ label: 'Configuration', slug: 'reference/configuration' },
						{ label: 'Flows', slug: 'reference/flows' },
						{ label: 'Providers', slug: 'reference/providers' },
						{ label: 'Database and migrations', slug: 'reference/database' },
						{ label: 'GraphQL codegen', slug: 'reference/graphql-codegen' },
						{ label: 'Proxy routes', slug: 'reference/proxy-routes' },
						{ label: 'Webhooks', slug: 'reference/webhooks' },
						{ label: 'Shopify Functions', slug: 'reference/shopify-functions' },
						{ label: 'MCP', slug: 'reference/mcp' },
						{ label: 'CLI commands', slug: 'reference/cli' },
					],
				},
			],
		}),
	],
});

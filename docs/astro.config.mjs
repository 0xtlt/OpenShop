// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.openshop.run',
	integrations: [
		sitemap(),
		starlight({
			title: 'OpenShop',
			head: [
				{ tag: 'meta', attrs: { property: 'og:image', content: 'https://docs.openshop.run/social-card.svg' } },
				{ tag: 'meta', attrs: { property: 'og:image:alt', content: 'OpenShop documentation' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: 'https://docs.openshop.run/social-card.svg' } },
				{ tag: 'meta', attrs: { name: 'twitter:image:alt', content: 'OpenShop documentation' } },
				{
					tag: 'script',
					attrs: { type: 'application/ld+json' },
					content: JSON.stringify({
						'@context': 'https://schema.org',
						'@type': 'SoftwareApplication',
						name: 'OpenShop',
						applicationCategory: 'DeveloperApplication',
						operatingSystem: 'Node.js',
						url: 'https://openshop.run/',
						codeRepository: 'https://github.com/0xtlt/OpenShop',
					}),
				},
			],
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
						{ label: 'Architecture', slug: 'concepts/architecture' },
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
						{ label: 'Operate an app', slug: 'guides/operate-app' },
						{ label: 'Deploy to production', slug: 'guides/deploy-production' },
						{ label: 'Troubleshooting', slug: 'guides/troubleshooting' },
						{ label: 'Upgrade OpenShop', slug: 'guides/upgrade' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Project structure', slug: 'reference/project-structure' },
						{ label: 'Configuration', slug: 'reference/configuration' },
						{ label: 'Environment variables', slug: 'reference/environment-variables' },
						{ label: 'Authentication', slug: 'reference/authentication' },
						{ label: 'Public SDK', slug: 'reference/sdk' },
						{ label: 'Admin API', slug: 'reference/admin-api' },
						{ label: 'Flows', slug: 'reference/flows' },
						{ label: 'Providers', slug: 'reference/providers' },
						{ label: 'Database and migrations', slug: 'reference/database' },
						{ label: 'GraphQL codegen', slug: 'reference/graphql-codegen' },
						{ label: 'Proxy routes', slug: 'reference/proxy-routes' },
						{ label: 'Webhooks', slug: 'reference/webhooks' },
						{ label: 'Shopify Functions', slug: 'reference/shopify-functions' },
						{ label: 'MCP', slug: 'reference/mcp' },
						{ label: 'CLI commands', slug: 'reference/cli' },
						{ label: 'Logging', slug: 'reference/logging' },
						{ label: 'Errors', slug: 'reference/errors' },
						{ label: 'Security', slug: 'reference/security' },
						{ label: 'Versioning', slug: 'reference/versioning' },
					],
				},
			],
		}),
	],
});

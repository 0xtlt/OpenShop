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
			customCss: ['./src/styles/custom.css'],
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
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/0xtlt/OpenShop' },
				{ icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/openshop' },
			],
			editLink: { baseUrl: 'https://github.com/0xtlt/OpenShop/edit/main/docs/' },
			sidebar: [
				{ label: 'Overview', slug: 'index' },
				{
					label: 'Tutorials',
					items: [
						{ label: 'Tutorials overview', slug: 'tutorials' },
						{ label: '1. Build your first app', slug: 'tutorials/first-app' },
						{ label: '2. Build a checkpointed flow', slug: 'tutorials/checkpointed-flow' },
					],
				},
				{
					label: 'How-to guides',
					items: [
						{ label: 'Find a guide', slug: 'guides' },
						{
							label: 'Build an integration',
							collapsed: true,
							items: [
								{ slug: 'guides/configure-shopify-apps' },
								{ slug: 'guides/define-provider' },
								{ slug: 'guides/define-flow' },
								{ slug: 'guides/handle-webhooks' },
							],
						},
						{
							label: 'Extend and test',
							collapsed: true,
							items: [
								{ slug: 'guides/add-proxy-routes' },
								{ slug: 'guides/add-server-route' },
								{ slug: 'guides/add-admin-page' },
								{ slug: 'guides/test-app' },
							],
						},
						{
							label: 'Deploy and operate',
							collapsed: true,
							items: [
								{ slug: 'guides/manage-migrations' },
								{ slug: 'guides/deploy-production' },
								{ slug: 'guides/operate-app' },
								{ slug: 'guides/troubleshooting' },
								{ slug: 'guides/upgrade' },
							],
						},
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Reference overview', slug: 'reference' },
						{
							label: 'Project and configuration',
							collapsed: true,
							items: [
								{ slug: 'reference/project-structure' },
								{ slug: 'reference/configuration' },
								{ slug: 'reference/environment-variables' },
								{ slug: 'reference/cli' },
								{ slug: 'reference/sdk' },
							],
						},
						{
							label: 'Background work and storage',
							collapsed: true,
							items: [
								{ slug: 'reference/flows' },
								{ slug: 'reference/providers' },
								{ slug: 'reference/database' },
								{ slug: 'reference/logging' },
								{ slug: 'reference/errors' },
								{ slug: 'reference/testing' },
							],
						},
						{
							label: 'Shopify and HTTP',
							collapsed: true,
							items: [
								{ slug: 'reference/authentication' },
								{ slug: 'reference/admin-api' },
								{ slug: 'reference/graphql-codegen' },
								{ slug: 'reference/proxy-routes' },
								{ slug: 'reference/server-routes' },
								{ slug: 'reference/webhooks' },
								{ slug: 'reference/shopify-functions' },
								{ slug: 'reference/custom-admin-pages' },
								{ slug: 'reference/mcp' },
							],
						},
						{
							label: 'Security and compatibility',
							collapsed: true,
							items: [
								{ slug: 'reference/security' },
								{ slug: 'reference/versioning' },
							],
						},
					],
				},
				{
					label: 'Explanation',
					items: [
						{ label: 'Explanation overview', slug: 'concepts' },
						{ slug: 'concepts/building-blocks' },
						{ slug: 'concepts/architecture' },
						{ slug: 'concepts/checkpoints-and-retries' },
						{ slug: 'concepts/shop-isolation' },
					],
				},
			],

		}),
	],
});

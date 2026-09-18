# OpenShop documentation

The public site is built with Astro and Starlight and served at
[docs.openshop.run](https://docs.openshop.run/). Content lives in
`src/content/docs/`; navigation is explicit in `astro.config.mjs`.

## Preview and validate

From the repository root, with Node.js 26 and pnpm 11.21.0:

```bash
pnpm install --frozen-lockfile
pnpm --filter docs run dev
```

Open the local URL printed by Astro (normally `http://localhost:4321`). In a
separate terminal, run:

```bash
pnpm --filter docs run check
```

This builds the site and search index, runs the link-checker tests, and checks
internal links, heading anchors, navigation coverage, and `public/llms.txt`.
The check does not make external HTTP requests or execute code samples.
Run `pnpm --filter docs run preview` to inspect the production build.

## Choose a page by reader need

The information architecture follows [Diátaxis](https://diataxis.fr/). Keep each
page focused on one documentation purpose:

| Section | Reader need | Content contract |
| --- | --- | --- |
| `tutorials/` | Learn through a guided experience | One complete path, concrete prerequisites, actions, observable results, and a next lesson |
| `guides/` | Complete a specific task in an existing app | State the goal and starting conditions, give the procedure, then verify the result |
| `reference/` | Look up an exact contract | Options, types, defaults, return values, constraints, and failure behavior |
| `concepts/` | Understand how or why something works | Explain relationships, tradeoffs, and boundaries with examples |

The navigation calls `concepts/` **Explanation** and `guides/` **How-to guides**.
Existing routes are retained so published links remain valid. Section landing
pages connect the four reading modes; reference groups make a long API index
scannable.

The approach also draws on [Django's progressive getting-started path](https://docs.djangoproject.com/en/5.2/intro/)
and [BullMQ's focused retry guidance](https://docs.bullmq.io/guide/retrying-failing-jobs).
Use them as structural inspiration; OpenShop's implementation is the source of
truth for its behavior. The home page uses Starlight
[LinkCard](https://starlight.astro.build/components/link-cards/) components for
actual navigable cards.

## Write a useful page

- Write in English. Define OpenShop terms when first introducing them and use the
  same names throughout: provider definition, saved configuration, connector,
  flow definition, and run are different things.
- Start with what the reader can accomplish or look up. Use task titles such as
  “Manage migrations” for guides. Keep long explanations outside procedures.
- Name the working directory and file to create or edit. Say whether a snippet
  replaces a file or is added to existing configuration. Preserve other app
  settings in incremental examples.
- Give copyable commands and complete imports. Identify placeholders and partial
  snippets. Avoid silent HTTP failures, non-JSON step results, and unscoped
  database examples.
- Tell readers what success looks like. Separate development from production:
  `dev` starts a worker; `start` does not. Production commands need injected
  environment variables and committed migrations.
- Put each option/default table in one reference page. Link to it from guides and
  explanations instead of copying it. Add reciprocal links between the practical
  guide and its API reference.
- Treat Shopify configuration, permissions, and API versions as external
  contracts. Link the relevant official Shopify page and check it when editing.
- Make experimental status and actual runtime limitations visible where the
  reader makes the relevant choice. Do not imply guarantees the code does not make.

## Add or move a page

1. Add Markdown or MDX with a `title` and a useful `description` in frontmatter.
2. Add it to the appropriate section index and `astro.config.mjs` sidebar group.
3. Update `public/llms.txt` with the canonical URL and title.
4. Add links from related pages. Use root-relative site links and stable heading
   anchors, such as `/reference/flows/#checkpointed-steps`.
5. Preserve existing URLs where possible. If a route must change, add and verify
   a redirect with the actual static hosting setup; updating the sidebar is not
   a redirect.
6. Run the docs check and inspect the rendered page on desktop and a narrow
   viewport, including code blocks, tables, navigation, and search.

Do not commit `dist/`, `.astro/`, or generated Pagefind files. Keep the repository
and npm READMEs short and route readers into the documentation. Contributor setup
belongs in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Validate technical examples

Check commands against `packages/openshop/bin/cli.ts`, generated files against
`packages/openshop/templates/minimal`, and behavior against framework source and
tests. For changed TypeScript examples, compile them in a generated app using the
workspace package; for a new tutorial, exercise its full path where the required
services are available. Report any Shopify or production setup you could not test
in the PR instead of claiming end-to-end validation.

import { chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: {
    cli: resolve(root, 'bin', 'cli.ts'),
    index: resolve(root, 'src', 'index.ts'),
    vite: resolve(root, 'src', 'vite', 'codegen-plugin.ts'),
    test: resolve(root, 'src', 'test', 'index.ts'),
    schema: resolve(root, 'src', 'db', 'schema.ts'),
    drizzle: resolve(root, 'src', 'db', 'drizzle-config.ts'),
    eslint: resolve(root, 'src', 'eslint', 'config.ts'),
    graphql: resolve(root, 'src', 'graphql', 'config.ts'),
    'api-process': resolve(root, 'src', 'cli', 'api-process.ts'),
  },
  outdir: resolve(root, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
})

chmodSync(resolve(root, 'dist', 'cli.js'), 0o755)

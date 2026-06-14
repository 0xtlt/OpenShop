import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(resolve(tmpdir(), 'openshop-pack-'))
const tarballDir = resolve(tmp, 'tarball')
const consumerDir = resolve(tmp, 'consumer')

mkdirSync(tarballDir)
mkdirSync(consumerDir)

try {
  execFileSync('pnpm', ['pack', '--pack-destination', tarballDir], { cwd: root, stdio: 'inherit' })
  const [tarball] = readdirSync(tarballDir)
  const tarballPath = resolve(tarballDir, tarball)
  const tarballEntries = execFileSync('tar', ['-tf', tarballPath], { encoding: 'utf8' }).split('\n')
  if (tarballEntries.some((entry) => entry.startsWith('package/drizzle/'))) {
    throw new Error('Package tarball must not include prebuilt framework migrations under package/drizzle/')
  }

  const publicExports = ['openshop', 'openshop/vite', 'openshop/test', 'openshop/schema', 'openshop/drizzle', 'openshop/eslint', 'openshop/graphql']

  writeFileSync(resolve(consumerDir, 'package.json'), JSON.stringify({
    name: 'openshop-pack-smoke',
    private: true,
    type: 'module',
    scripts: {
      check: 'tsc --noEmit',
    },
    dependencies: {
      openshop: tarballPath,
      arktype: '^2.2.0',
      pg: '^8.20.0',
    },
    devDependencies: {
      typescript: '^5.9.0',
      '@types/node': 'latest',
      '@graphql-eslint/eslint-plugin': 'latest',
      eslint: 'latest',
      'typescript-eslint': 'latest',
    },
  }, null, 2))

  writeFileSync(resolve(consumerDir, 'pnpm-workspace.yaml'), [
    'allowBuilds:',
    '  esbuild: true',
    '',
  ].join('\n'))

  writeFileSync(resolve(consumerDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['index.ts'],
  }, null, 2))

  writeFileSync(resolve(consumerDir, 'index.ts'), `
import { defineOpenShop, defineProvider, cron } from 'openshop'
import { openshopCodegen } from 'openshop/vite'
import { createTestContext } from 'openshop/test'
import { defineModel, text } from 'openshop/schema'
import { frameworkSchemaPath } from 'openshop/drizzle'
import { eslintConfig } from 'openshop/eslint'
import { graphqlConfig } from 'openshop/graphql'

const model = defineModel('items', { title: text('title').notNull() })
const provider = defineProvider({
  name: 'warehouse',
  ui: { fields: { apiUrl: { type: 'text', label: 'API URL' } } },
  methods: { async push(_config, _rows: unknown[]) {} },
})

const app = defineOpenShop({
  providers: { warehouse: provider },
})

const flow = app.defineFlow({
  name: 'sync',
  async run({ connectors }) {
    await connectors.warehouse.push([])
  },
})

app.defineConfig({
  flows: { sync: flow },
  crons: [{ schedule: cron('*/5 * * * *'), flow: 'sync' }],
})

graphqlConfig()
void openshopCodegen
void createTestContext
void frameworkSchemaPath
void eslintConfig
void model
`)

  execFileSync('pnpm', ['install', '--ignore-scripts=false'], { cwd: consumerDir, stdio: 'inherit' })
  execFileSync('pnpm', ['run', 'check'], { cwd: consumerDir, stdio: 'inherit' })
  execFileSync('node', [
    '--input-type=module',
    '--eval',
    `for (const specifier of ${JSON.stringify(publicExports)}) await import(specifier)`,
  ], { cwd: consumerDir, stdio: 'inherit' })
  execFileSync('pnpm', ['exec', 'openshop'], { cwd: consumerDir, stdio: 'pipe' })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

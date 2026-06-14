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
import { defineConfig, defineFlow, defineProvider, cron } from 'openshop'
import { defineModel, text } from 'openshop/schema'
import { graphqlConfig } from 'openshop/graphql'

const model = defineModel('items', { title: text('title').notNull() })
const flow = defineFlow({ name: 'sync', async run() {} })
const provider = defineProvider({
  name: 'warehouse',
  ui: { fields: { apiUrl: { type: 'text', label: 'API URL' } } },
  methods: { async push(_config, _rows: unknown[]) {} },
})

defineConfig({
  providers: { warehouse: provider },
  flows: { sync: flow },
  crons: [{ schedule: cron('*/5 * * * *'), flow: 'sync' }],
})

graphqlConfig()
void model
`)

  execFileSync('pnpm', ['install', '--ignore-scripts=false'], { cwd: consumerDir, stdio: 'inherit' })
  execFileSync('pnpm', ['run', 'check'], { cwd: consumerDir, stdio: 'inherit' })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

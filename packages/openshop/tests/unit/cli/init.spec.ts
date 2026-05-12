import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from '@japa/runner'
import { runInit, toPackageName } from '../../../src/cli/init.ts'

async function withTempDir(fn: (dir: string) => Promise<void> | void) {
  const dir = mkdtempSync(resolve(tmpdir(), 'openshop-init-'))
  const previousCwd = process.cwd()
  const previousExitCode = process.exitCode ?? 0
  process.chdir(dir)
  process.exitCode = 0
  try {
    await fn(dir)
  } finally {
    process.chdir(previousCwd)
    process.exitCode = previousExitCode
    rmSync(dir, { recursive: true, force: true })
  }
}

async function expectInitFailure(assert: any, target?: string) {
  try {
    await runInit(target)
    assert.fail('Expected runInit to fail')
  } catch (error) {
    assert.instanceOf(error, Error)
  }
}

test.group('init cli', () => {
  test('creates a minimal pnpm project', async ({ assert }) => {
    await withTempDir(async () => {
      const result = await runInit('My App')

      const packageJson = JSON.parse(readFileSync(resolve(result.targetDir, 'package.json'), 'utf8')) as {
        name: string
        scripts: Record<string, string>
        dependencies: Record<string, string>
        devDependencies: Record<string, string>
      }

      const shopifyWeb = readFileSync(resolve(result.targetDir, 'shopify.web.toml'), 'utf8')

      assert.equal(packageJson.name, 'my-app')
      assert.equal(packageJson.scripts.dev, 'openshop dev')
      assert.equal(packageJson.scripts.shopify, 'shopify app dev --skip-dependencies-installation')
      assert.equal(packageJson.dependencies.openshop, '^0.1.0')
      assert.notProperty(packageJson.devDependencies, 'tsx')
      assert.notInclude(JSON.stringify(packageJson), 'workspace:*')
      assert.notInclude(JSON.stringify(packageJson), 'bun')
      assert.include(shopifyWeb, 'dev = "pnpm run dev"')
      assert.include(readFileSync(resolve(result.targetDir, '.gitignore'), 'utf8'), 'node_modules/')
      assert.exists(readFileSync(resolve(result.targetDir, 'openshop.config.ts'), 'utf8'))
      assert.exists(readFileSync(resolve(result.targetDir, 'flows', 'syncOrders.ts'), 'utf8'))
      assert.exists(readFileSync(resolve(result.targetDir, 'providers', 'warehouse.ts'), 'utf8'))
    })
  })

  test('fails when target is missing', async ({ assert }) => {
    await withTempDir(async () => {
      await expectInitFailure(assert)
      assert.equal(process.exitCode, 1)
    })
  })

  test('refuses a non-empty target directory', async ({ assert }) => {
    await withTempDir(async () => {
      mkdirSync('existing')
      writeFileSync(resolve('existing', 'file.txt'), 'content')

      await expectInitFailure(assert, 'existing')
      assert.equal(process.exitCode, 1)
    })
  })

  test('allows an existing empty target directory', async ({ assert }) => {
    await withTempDir(async () => {
      mkdirSync('existing')

      const result = await runInit('existing')

      assert.equal(result.packageName, 'existing')
      assert.exists(readFileSync(resolve(result.targetDir, 'package.json'), 'utf8'))
    })
  })

  test('normalizes folder names into npm-safe package names', ({ assert }) => {
    assert.equal(toPackageName('My Cool App!'), 'my-cool-app')
    assert.equal(toPackageName('__'), 'openshop-app')
  })
})

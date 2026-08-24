import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { build } from 'esbuild'

export const serverBuildDir = 'dist/openshop/server'
export const serverConfigFile = 'openshop.config.js'

function findFiles(dir: string, extensions: Set<string>): string[] {
  const files: string[] = []

  function walk(current: string) {
    for (const entry of readdirSync(current)) {
      if (entry.startsWith('_')) continue

      const full = resolve(current, entry)
      const stat = statSync(full)

      if (stat.isDirectory()) {
        walk(full)
        continue
      }

      if (extensions.has(entry.slice(entry.lastIndexOf('.')))) {
        files.push(full)
      }
    }
  }

  walk(dir)
  return files
}

export function resolveBuiltConfig(cwd = process.cwd()) {
  return resolve(cwd, serverBuildDir, serverConfigFile)
}

export function resolveBuiltProxyDir(cwd = process.cwd()) {
  return resolve(cwd, serverBuildDir, 'proxy')
}

export function resolveBuiltRoutesDir(cwd = process.cwd()) {
  return resolve(cwd, serverBuildDir, 'routes')
}

export async function loadBuiltConfig(cwd = process.cwd()): Promise<import('#types').OpenShopConfig> {
  const configPath = resolveBuiltConfig(cwd)
  if (!existsSync(configPath)) {
    throw new Error(`Compiled OpenShop server config not found at ${configPath}. Run \`openshop build\` first.`)
  }

  const mod = await import(configPath)
  return mod.default ?? mod
}

export async function buildServerApp(cwd = process.cwd()) {
  const configPath = resolve(cwd, 'openshop.config.ts')
  if (!existsSync(configPath)) {
    throw new Error(`OpenShop config not found at ${configPath}`)
  }

  const outDir = resolve(cwd, serverBuildDir)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const common = {
    bundle: true,
    platform: 'node' as const,
    format: 'esm' as const,
    target: 'node26',
    packages: 'external' as const,
    sourcemap: true,
    absWorkingDir: cwd,
    logLevel: 'silent' as const,
  }

  await build({
    ...common,
    entryPoints: [configPath],
    outfile: resolve(outDir, serverConfigFile),
  })

  for (const directory of ['proxy', 'routes']) {
    const sourceDir = resolve(cwd, directory)
    if (!existsSync(sourceDir)) continue

    const entries = findFiles(sourceDir, new Set(['.ts', '.js']))
    if (entries.length === 0) continue

    await build({
      ...common,
      entryPoints: entries,
      outdir: resolve(outDir, directory),
      outbase: sourceDir,
      entryNames: '[dir]/[name]',
    })
  }

  const relativeOut = relative(cwd, outDir)
  console.log(`[openshop] Server build complete → ${relativeOut}`)
}

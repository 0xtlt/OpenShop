import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLACEHOLDER_EXTENSIONS = new Set(['.json', '.ts', '.js', '.cjs', '.toml', '.md', '.gitignore', '.dockerignore'])

export interface InitResult {
  targetDir: string
  packageName: string
  appName: string
}

function packageRoot() {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', '..'),
    resolve(here, '..'),
    resolve(here, '..', 'packages', 'openshop'),
  ]

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'templates', 'minimal'))) return candidate
  }

  throw new Error('OpenShop template directory not found.')
}

export function toPackageName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[._]+/g, '')

  return normalized || 'openshop-app'
}

function isEmptyDir(path: string): boolean {
  return !existsSync(path) || readdirSync(path).length === 0
}

function replacePlaceholders(path: string, replacements: Record<string, string>) {
  const stats = statSync(path)
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path)) replacePlaceholders(resolve(path, entry), replacements)
    return
  }

  const shouldReplace = [...PLACEHOLDER_EXTENSIONS].some((extension) => path.endsWith(extension))
  if (!shouldReplace) return

  let content = readFileSync(path, 'utf8')
  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.replaceAll(placeholder, value)
  }
  writeFileSync(path, content)
}

export async function runInit(target?: string): Promise<InitResult> {
  if (!target) {
    console.error('Usage: openshop init <dir>')
    process.exitCode = 1
    throw new Error('Missing target directory')
  }

  const targetDir = resolve(process.cwd(), target)
  if (!isEmptyDir(targetDir)) {
    console.error(`[openshop] Target directory is not empty: ${targetDir}`)
    process.exitCode = 1
    throw new Error('Target directory is not empty')
  }

  mkdirSync(targetDir, { recursive: true })

  const appName = basename(targetDir)
  const packageName = toPackageName(appName)
  const templateDir = resolve(packageRoot(), 'templates', 'minimal')

  cpSync(templateDir, targetDir, { recursive: true, errorOnExist: false })
  const gitignoreTemplate = resolve(targetDir, '_gitignore')
  if (existsSync(gitignoreTemplate)) renameSync(gitignoreTemplate, resolve(targetDir, '.gitignore'))
  const dockerignoreTemplate = resolve(targetDir, '_dockerignore')
  if (existsSync(dockerignoreTemplate)) renameSync(dockerignoreTemplate, resolve(targetDir, '.dockerignore'))

  replacePlaceholders(targetDir, {
    __APP_NAME__: appName,
    __PACKAGE_NAME__: packageName,
  })

  console.log(`[openshop] Created ${appName} in ${targetDir}`)
  console.log('')
  console.log('Next steps:')
  console.log(`  cd ${target}`)
  console.log('  pnpm install')
  console.log('  pnpm run shopify')

  return { targetDir, packageName, appName }
}

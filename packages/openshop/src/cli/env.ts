import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
  if (!match) return null

  const key = match[1]!
  let value = match[2] ?? ''

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }

  return [key, value]
}

export function loadEnvFile(cwd: string): void {
  const envPath = resolve(cwd, '.env')
  if (!existsSync(envPath)) return

  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line)
    if (!parsed) continue

    const [key, value] = parsed
    process.env[key] ??= value
  }
}

#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const c8Require = createRequire(require.resolve('c8/package.json'))
const defaultExclude = c8Require('@istanbuljs/schema/default-exclude')
const defaultExtension = c8Require('@istanbuljs/schema/default-extension')
const { outputReport } = c8Require('./lib/commands/report')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const c8Config = rootPackage.c8 ?? {}

const rawArgs = process.argv.slice(2)
const options = {
  clean: true,
  cwd: root,
  reporter: undefined,
  tempDirectory: c8Config['temp-directory'] ?? 'coverage/tmp',
  reportsDir: c8Config['reports-dir'] ?? 'coverage',
}

let mode = 'run'
let command = []

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index]

  if (arg === 'report') {
    mode = 'report'
    continue
  }

  if (arg === '--') {
    command = rawArgs.slice(index + 1)
    break
  }

  if (arg === '--clean') {
    options.clean = true
    continue
  }

  if (arg === '--clean=false') {
    options.clean = false
    continue
  }

  if (arg === '--cwd') {
    options.cwd = resolve(root, rawArgs[++index])
    continue
  }

  if (arg.startsWith('--cwd=')) {
    options.cwd = resolve(root, arg.slice('--cwd='.length))
    continue
  }

  if (arg === '--temp-directory') {
    options.tempDirectory = rawArgs[++index]
    continue
  }

  if (arg.startsWith('--temp-directory=')) {
    options.tempDirectory = arg.slice('--temp-directory='.length)
    continue
  }

  if (arg === '--reporter') {
    options.reporter = rawArgs[++index]
    continue
  }

  if (arg.startsWith('--reporter=')) {
    options.reporter = arg.slice('--reporter='.length)
    continue
  }

  if (arg === '--reports-dir') {
    options.reportsDir = rawArgs[++index]
    continue
  }

  if (arg.startsWith('--reports-dir=')) {
    options.reportsDir = arg.slice('--reports-dir='.length)
    continue
  }

  command = rawArgs.slice(index)
  break
}

const tempDirectory = resolve(root, options.tempDirectory)
const reporter = options.reporter ?? c8Config.reporter ?? 'text'
const reporters = Array.isArray(reporter) ? reporter : [reporter]

const reportArgs = {
  include: c8Config.include ?? [],
  exclude: c8Config.exclude ?? defaultExclude,
  extension: c8Config.extension ?? defaultExtension,
  excludeAfterRemap: c8Config['exclude-after-remap'] ?? false,
  reporter,
  'reports-dir': resolve(root, options.reportsDir),
  reporterOptions: c8Config.reporterOptions ?? {},
  tempDirectory,
  watermarks: c8Config.watermarks,
  resolve: c8Config.resolve ?? '',
  omitRelative: c8Config.omitRelative ?? true,
  wrapperLength: c8Config.wrapperLength,
  all: c8Config.all ?? false,
  allowExternal: c8Config.allowExternal ?? false,
  src: c8Config.src?.map((src) => resolve(root, src)),
  skipFull: c8Config.skipFull ?? false,
  excludeNodeModules: c8Config.excludeNodeModules ?? true,
  mergeAsync: c8Config.mergeAsync ?? false,
}

async function runCommand() {
  if (command.length === 0) {
    throw new Error('Missing command after c8 options')
  }

  if (options.clean) {
    await rm(tempDirectory, { recursive: true, force: true })
  }
  await mkdir(tempDirectory, { recursive: true })

  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_V8_COVERAGE: tempDirectory,
    },
  })

  const code = await new Promise((resolveCode, reject) => {
    child.on('error', reject)
    child.on('close', resolveCode)
  })

  if (!reporters.includes('none')) {
    await outputReport(reportArgs)
  }

  process.exitCode = typeof code === 'number' ? code : 1
}

if (mode === 'report') {
  await outputReport(reportArgs)
} else {
  await runCommand()
}

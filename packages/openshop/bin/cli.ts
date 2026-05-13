#!/usr/bin/env node
export {}

const command = process.argv[2]

switch (command) {
  case 'init': {
    const { runInit } = await import('../src/cli/init.ts')
    try {
      await runInit(process.argv[3])
    } catch (error) {
      if (!process.exitCode) console.error(error)
      process.exit(process.exitCode || 1)
    }
    break
  }
  case 'dev': {
    const { startDev } = await import('../src/cli/dev.ts')
    await startDev()
    break
  }
  case 'worker': {
    const { startWorker } = await import('../src/cli/worker.ts')
    const concurrency = Number(process.argv.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? 5)
    await startWorker({ concurrency })
    break
  }
  case 'migrate': {
    const {
      baselineProjectMigrations,
      migrateFrameworkSchema,
      migrateProjectSchema,
      migrateSchema,
      printMigrationStatus,
    } = await import('../src/cli/schema.ts')
    const { closeDb } = await import('../src/db/client.ts')
    try {
      const subcommand = process.argv[3]
      const baselineArg = process.argv.find((arg) => arg === '--baseline' || arg.startsWith('--baseline='))
      const toArg = process.argv.find((arg) => arg.startsWith('--to='))

      if (subcommand === 'project') {
        if (baselineArg || toArg) {
          const baselineTo = baselineArg?.startsWith('--baseline=')
            ? baselineArg.slice('--baseline='.length)
            : toArg?.slice('--to='.length)
          await baselineProjectMigrations(process.cwd(), { to: baselineTo })
        } else {
          await migrateProjectSchema(process.cwd())
        }
      } else if (subcommand === 'status') {
        await printMigrationStatus(process.cwd())
      } else if (subcommand === 'framework') {
        await migrateFrameworkSchema(process.cwd())
      } else if (!subcommand) {
        await migrateSchema(process.cwd())
      } else {
        console.error(`[openshop] Unknown migrate command: ${subcommand}`)
        process.exitCode = 1
      }
    } finally {
      await closeDb()
    }
    break
  }
  case 'codegen': {
    const { runCodegen } = await import('../src/cli/codegen.ts')
    await runCodegen(false)
    break
  }
  case 'codegen:watch': {
    const { runCodegen } = await import('../src/cli/codegen.ts')
    await runCodegen(true)
    break
  }
  case 'build': {
    const { runBuild } = await import('../src/cli/build.ts')
    await runBuild()
    break
  }
  case 'start': {
    const { startProd } = await import('../src/cli/start.ts')
    await startProd()
    break
  }
  case 'test': {
    const { runTests } = await import('../src/cli/test.ts')
    await runTests(process.argv.slice(3))
    break
  }
  default:
    console.log(`
  openshop - Shopify integration framework

  Commands:
    init <dir>                  Scaffold a new OpenShop project
    dev                         Start dev server (API + UI + worker + hot-reload)
    worker [--concurrency=N]    Start worker only (production, scalable)
    migrate                     Apply OpenShop framework and project migrations
    migrate framework           Apply OpenShop framework migrations only
    migrate project             Apply project migrations from ./drizzle
    migrate status              Show framework and project migration status
    build                       Build for production
    start                       Start production server (API + UI, no worker)
    codegen                     Generate TypeScript types from GraphQL queries
    codegen:watch               Watch mode — regenerate types on file changes

  Usage:
    openshop init my-app
    openshop dev
    openshop worker --concurrency=10
    openshop migrate
    openshop migrate framework
    openshop migrate project
    openshop migrate status
    openshop test [suite]          Run tests (suites: unit, flows, api, proxy)
    openshop build && openshop start
`)
}

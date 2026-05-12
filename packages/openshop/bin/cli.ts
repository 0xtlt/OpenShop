#!/usr/bin/env node
export {}

const command = process.argv[2]

switch (command) {
  case 'init': {
    const { runInit } = await import('../src/cli/init.js')
    try {
      await runInit(process.argv[3])
    } catch (error) {
      if (!process.exitCode) console.error(error)
      process.exit(process.exitCode || 1)
    }
    break
  }
  case 'dev': {
    const { startDev } = await import('../src/cli/dev.js')
    await startDev()
    break
  }
  case 'worker': {
    const { startWorker } = await import('../src/cli/worker.js')
    const concurrency = Number(process.argv.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? 5)
    await startWorker({ concurrency })
    break
  }
  case 'migrate': {
    const { migrateSchema } = await import('../src/cli/schema.js')
    const { closeDb } = await import('../src/db/client.js')
    try {
      await migrateSchema(process.cwd())
    } finally {
      await closeDb()
    }
    break
  }
  case 'codegen': {
    const { runCodegen } = await import('../src/cli/codegen.js')
    await runCodegen(false)
    break
  }
  case 'codegen:watch': {
    const { runCodegen } = await import('../src/cli/codegen.js')
    await runCodegen(true)
    break
  }
  case 'build': {
    const { runBuild } = await import('../src/cli/build.js')
    await runBuild()
    break
  }
  case 'start': {
    const { startProd } = await import('../src/cli/start.js')
    await startProd()
    break
  }
  case 'test': {
    const { runTests } = await import('../src/cli/test.js')
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
    migrate                     Apply OpenShop framework migrations
    build                       Build for production
    start                       Start production server (API + UI, no worker)
    codegen                     Generate TypeScript types from GraphQL queries
    codegen:watch               Watch mode — regenerate types on file changes

  Usage:
    openshop init my-app
    openshop dev
    openshop worker --concurrency=10
    openshop migrate
    openshop test [suite]          Run tests (suites: unit, flows, api, proxy)
    openshop build && openshop start
`)
}

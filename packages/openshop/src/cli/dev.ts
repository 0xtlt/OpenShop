import { resolve, dirname } from 'node:path'
import { fork, type ChildProcess } from 'node:child_process'
import { watch, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pushSchema } from './schema-push.ts'
import { ApiProcessRestartCoordinator } from './dev-restart.ts'
import { loadEnvFile } from './env.ts'
import { runCodegenOnce } from '../vite/codegen-utils.ts'

function currentDir() {
  return dirname(fileURLToPath(import.meta.url))
}

function resolvePackagePath(...parts: string[]) {
  const here = currentDir()
  const candidates = [
    resolve(here, ...parts),
    resolve(here, '..', ...parts),
    resolve(here, '..', 'src', ...parts),
  ]

  const found = candidates.find(existsSync)
  return found ?? candidates[0]!
}

const viteDefaultAllowedOrigins = /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/

export async function startDev() {
  const cwd = process.cwd()
  loadEnvFile(cwd)

  const port = Number(process.env.PORT) || 3000
  const apiPort = port + 1

  console.log('[openshop] Starting dev server...')

  try {
    runCodegenOnce(cwd, { optional: true })
  } catch (e) {
    console.error('[openshop] Codegen failed:', e)
    process.exit(1)
  }

  // 1. Database setup — push schema via drizzle-kit
  process.env.DATABASE_URL ??= 'postgresql://openshop:openshop@localhost:5432/openshop'

  try {
    pushSchema(cwd)
  } catch (e) {
    console.error('[openshop] Schema push failed:', e)
    process.exit(1)
  }
  console.log('[openshop] Database initialized')

  // 2. API server runs in a subprocess (fresh module cache on each restart)
  const apiProcessPath = resolvePackagePath(existsSync(resolve(currentDir(), 'api-process.ts')) ? 'api-process.ts' : 'api-process.js')
  let viteServer: import('vite').ViteDevServer | null = null

  function spawnApiProcess(reloadBrowser: boolean) {
    const env = { ...process.env, OPENSHOP_API_PORT: String(apiPort) }
    const apiProcess = fork(apiProcessPath, [], { cwd, stdio: 'inherit', env })
    const ready = new Promise<void>((resolve, reject) => {
      const onMessage = (msg: unknown) => {
        if (msg !== 'ready') return
        cleanup()
        resolve()
      }

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup()
        reject(new Error(`API process exited before ready (code=${code}, signal=${signal})`))
      }

      const cleanup = () => {
        apiProcess.off('message', onMessage)
        apiProcess.off('exit', onExit)
      }

      apiProcess.on('message', onMessage)
      apiProcess.once('exit', onExit)
    })

    apiProcess.on('message', (msg) => {
      if (msg === 'ready') {
        console.log(`[openshop] API server running on http://localhost:${apiPort}`)
        if (reloadBrowser && viteServer) {
          viteServer.ws.send({ type: 'full-reload', path: '*' })
        }
      }
    })

    apiProcess.on('exit', (code) => {
      if (code && code !== 0) console.error(`[openshop] API process exited with code ${code}`)
    })

    return { process: apiProcess, ready }
  }

  const initialApiProcess = spawnApiProcess(false)
  void initialApiProcess.ready.catch(() => {})

  const restartCoordinator = new ApiProcessRestartCoordinator<ChildProcess>({
    spawn: () => spawnApiProcess(true),
    onQueuedRestart: (reason) => {
      console.log(`[openshop] Reload already in progress — queued one more restart for ${reason}`)
    },
    onRestartStart: (reason, currentProcess) => {
      const pid = currentProcess?.pid ? ` (pid=${currentProcess.pid})` : ''
      console.log(`[openshop] ${reason} changed — restarting API${pid}...`)
    },
    onListenerClosed: (process, via) => {
      const pid = process.pid ? ` pid=${process.pid}` : ''
      console.log(`[openshop] Previous API listener closed via ${via}${pid}`)
    },
    onListenerCloseTimeout: (process) => {
      const pid = process.pid ? ` (pid=${process.pid})` : ''
      console.warn(`[openshop] Timed out waiting for API listener to close${pid}; waiting for process exit`)
    },
    onRespawn: (process) => {
      const pid = process.pid ? ` (pid=${process.pid})` : ''
      console.log(`[openshop] API process respawned${pid}`)
    },
    onForceKill: (process) => {
      const pid = process.pid ? ` (pid=${process.pid})` : ''
      console.warn(`[openshop] Force-killing stale API process${pid}`)
    },
  }, initialApiProcess.process)

  // 3. Watch all user directories — restart API subprocess on changes
  const watchDirs = ['flows', 'providers', 'functions', 'webhooks', 'proxy']
    .map((d) => resolve(cwd, d))
    .filter(existsSync)

  let reloadTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleReload(source: string) {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(async () => {
      try {
        await restartCoordinator.requestRestart(source)
        console.log('[openshop] Reloaded.')
      } catch (error) {
        console.error('[openshop] Failed to restart API process:', error)
      }
    }, 500)
  }

  for (const dir of watchDirs) {
    try {
      watch(dir, { recursive: true }, (_, filename) => {
        if (filename && !filename.startsWith('.')) scheduleReload(filename)
      })
    } catch { /* dir might not exist */ }
  }

  // Watch config file itself
  const configPath = resolve(cwd, 'openshop.config.ts')
  try {
    watch(configPath, () => scheduleReload('openshop.config.ts'))
  } catch { /* */ }

  console.log('[openshop] Watching for changes (flows, providers, functions, webhooks, proxy, config)')

  // Graceful shutdown
  const shutdown = () => {
    restartCoordinator.currentProcess?.kill('SIGTERM')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // 4. Start Vite dev server for the admin UI (stays in parent — HMR works)
  const uiRoot = resolvePackagePath('ui')

  try {
    const { createServer } = await import('vite')
    const preact = (await import('@preact/preset-vite')).default

    viteServer = await createServer({
      root: uiRoot,
      server: {
        port,
        allowedHosts: true,
        cors: {
          origin: viteDefaultAllowedOrigins,
          preflightContinue: true,
        },
        proxy: {
          '/api': `http://localhost:${apiPort}`,
          '/proxy': `http://localhost:${apiPort}`,
          '/ext': `http://localhost:${apiPort}`,
          '/auth': `http://localhost:${apiPort}`,
          '/webhooks': `http://localhost:${apiPort}`,
          '/mcp': {
            target: `http://localhost:${apiPort}`,
            bypass(req) {
              if (req.method === 'GET' || req.method === 'HEAD') return req.url
            },
          },
          '/health': `http://localhost:${apiPort}`,
        },
        headers: {
          'Content-Security-Policy': "frame-ancestors https://*.myshopify.com https://admin.shopify.com http://localhost:*;",
        },
      },
      plugins: [
        {
          name: 'openshop-app-bridge',
          transformIndexHtml(html) {
            const apiKey = process.env.SHOPIFY_API_KEY ?? ''
            return html
              .replace('<meta name="shopify-api-key" content="" />', `<meta name="shopify-api-key" content="${apiKey}" />`)
              .replace(
                'src="https://cdn.shopify.com/shopifycloud/app-bridge.js"',
                `data-api-key="${apiKey}" src="https://cdn.shopify.com/shopifycloud/app-bridge.js"`,
              )
          },
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              const url = req.url ?? ''
              const isMcpRpcRequest = url.startsWith('/mcp') && req.method !== 'GET' && req.method !== 'HEAD'
              if (
                url.startsWith('/@') ||
                url.startsWith('/api') ||
                url.startsWith('/proxy') ||
                url.startsWith('/ext') ||
                url.startsWith('/auth') ||
                url.startsWith('/webhooks') ||
                isMcpRpcRequest ||
                url.startsWith('/health') ||
                url.startsWith('/node_modules') ||
                url.includes('.') ||
                req.headers.host?.includes('localhost')
              ) {
                return next()
              }

              const secFetchDest = req.headers['sec-fetch-dest']
              const referer = req.headers['referer'] ?? ''
              const isIframe = secFetchDest === 'iframe'
              const isFromShopify = referer.includes('myshopify.com') || referer.includes('admin.shopify.com')
              const hasShopParam = url.includes('shop=')

              if (!isIframe && !isFromShopify && !hasShopParam) {
                res.statusCode = 403
                res.setHeader('Content-Type', 'text/plain')
                res.end('Access denied. This app must be accessed through the Shopify admin.')
                return
              }

              next()
            })
          },
        },
        (await import('../vite/codegen-plugin.ts')).openshopCodegen(),
        preact(),
      ],
    })

    await viteServer.listen()
    console.log(`[openshop] Admin UI running on http://localhost:${port}`)
    console.log('[openshop] Ready.')
  } catch (error) {
    console.error('[openshop] Failed to start Vite dev server:', error)
    process.exit(1)
  }
}

import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildServerApp } from './app-build.ts'

function resolvePackagePath(...parts: string[]) {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, ...parts),
    resolve(here, '..', ...parts),
    resolve(here, '..', 'src', ...parts),
  ]

  const found = candidates.find(existsSync)
  return found ?? candidates[0]!
}

export async function runBuild() {
  const cwd = process.cwd()

  console.log('[openshop] Building for production...')

  try {
    await buildServerApp(cwd)
  } catch (error) {
    console.error('[openshop] Server build failed:', error)
    process.exit(1)
  }

  // 2. Vite build
  const uiRoot = resolvePackagePath('ui')
  const outDir = resolve(cwd, 'dist', 'ui')

  try {
    const { build } = await import('vite')
    const preact = (await import('@preact/preset-vite')).default
    const { openshopCodegen } = await import('../vite/codegen-plugin.ts')

    await build({
      root: uiRoot,
      build: {
        outDir,
        emptyOutDir: true,
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
        },
        openshopCodegen(),
        preact(),
      ],
    })
  } catch (error) {
    console.error('[openshop] Vite build failed:', error)
    process.exit(1)
  }

  console.log(`[openshop] Build complete → ${outDir}`)
  console.log('[openshop] Run `openshop start` to serve in production.')
}

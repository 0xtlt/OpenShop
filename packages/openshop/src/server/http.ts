import type { ServerType } from '@hono/node-server'

export async function closeHttpServer(server: ServerType | null | undefined, timeoutMs = 5_000): Promise<void> {
  if (!server) return

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Timed out closing HTTP server after ${timeoutMs}ms`))
    }, timeoutMs)

    const finish = (error?: Error | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (error && 'code' in error && error.code === 'ERR_SERVER_NOT_RUNNING') {
        resolve()
        return
      }

      if (error) {
        reject(error)
        return
      }

      resolve()
    }

    try {
      server.close(finish)
      callOptionalServerMethod(server, 'closeIdleConnections')
      callOptionalServerMethod(server, 'closeAllConnections')
    } catch (error) {
      clearTimeout(timer)
      reject(error)
    }
  })
}

function callOptionalServerMethod(server: ServerType, method: 'closeIdleConnections' | 'closeAllConnections') {
  if (!(method in server)) return

  const candidate = Reflect.get(server, method)
  if (typeof candidate === 'function') {
    candidate.call(server)
  }
}

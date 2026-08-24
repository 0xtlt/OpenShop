import { test } from '@japa/runner'
import { stripCorsResponseHeaders } from '../../../src/cli/dev-cors.ts'

test('removes Vite CORS headers while preserving unrelated response headers', ({ assert }) => {
  const headers = new Map<string, string | string[]>([
    ['access-control-allow-origin', 'http://localhost:3000'],
    ['access-control-allow-methods', 'GET,HEAD,PUT,PATCH,POST,DELETE'],
    ['access-control-allow-headers', 'content-type'],
    ['vary', 'Origin, Access-Control-Request-Headers, Accept-Encoding'],
    ['x-route-header', 'preserved'],
  ])

  stripCorsResponseHeaders({
    getHeader: (name) => headers.get(name.toLowerCase()),
    setHeader: (name, value) => { headers.set(name.toLowerCase(), value) },
    removeHeader: (name) => { headers.delete(name.toLowerCase()) },
  })

  assert.isFalse(headers.has('access-control-allow-origin'))
  assert.isFalse(headers.has('access-control-allow-methods'))
  assert.isFalse(headers.has('access-control-allow-headers'))
  assert.equal(headers.get('vary'), 'Accept-Encoding')
  assert.equal(headers.get('x-route-header'), 'preserved')
})

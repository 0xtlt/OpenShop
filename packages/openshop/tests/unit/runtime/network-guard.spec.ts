import { test } from '@japa/runner'
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import { installNetworkGuard, type NetworkGuard } from '../../network-guard.ts'

test.group('network guard', (group) => {
  let guard: NetworkGuard

  // A second guard over the bootstrap's: it refuses first, so the run's own
  // guard never records these on purpose refused addresses.
  group.each.setup(() => {
    guard = installNetworkGuard()
    return () => guard.restore()
  })

  test('refuses sockets, TLS sockets and client requests to a non-local host', ({ assert }) => {
    assert.throws(() => net.connect({ host: 'example.invalid', port: 443 }), /must not reach the network/)
    assert.throws(() => net.createConnection(443, 'example.invalid'), /must not reach the network/)
    assert.throws(() => tls.connect({ host: 'example.invalid', port: 443 }), /must not reach the network/)
    assert.throws(() => new http.ClientRequest('http://example.invalid/'), /must not reach the network/)
    assert.deepEqual(guard.blocked, ['example.invalid:443', 'example.invalid:443', 'example.invalid:443', 'http://example.invalid/'])
  })

  test('lets a socket to a local host through', async ({ assert }) => {
    const server = net.createServer((socket) => socket.end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as net.AddressInfo
      const socket = net.connect({ host: '127.0.0.1', port })
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('error', reject)
      })
      socket.destroy()
      assert.deepEqual(guard.blocked, [])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

import { app } from '#app'

export default app.defineRoute({
  auth: 'none',
  GET: () => Response.json({ ok: true, source: 'server-route' }),
})

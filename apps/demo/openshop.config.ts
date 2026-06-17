import { app } from './openshop.app.ts'
import { syncOrders } from './flows/syncOrders.ts'
import { countVariants } from './flows/countVariants.ts'
import { volumeDiscount } from './functions/volumeDiscount.ts'
import { ordersCreate } from './webhooks/ordersCreate.ts'
import { appUninstalled } from './webhooks/appUninstalled.ts'

export default app.defineConfig({
  flows: { syncOrders, countVariants },
  functions: { volumeDiscount },

  mcp: {
    permissions: {
      custom: {
        'demo:read_status': {
          label: 'Read demo status',
          description: 'Allows MCP tokens to read a small demo status payload.',
          group: 'Demo',
          riskLevel: 'low',
        },
      },
    },
    tools: {
      'demo.status': {
        description: 'Read a small OpenShop demo status payload.',
        requiredPermissions: ['demo:read_status'],
        riskLevel: 'low',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        run: ({ shop, appHandle }) => ({
          content: [{ type: 'text', text: `Demo app is reachable for ${shop} (${appHandle}).` }],
          structuredContent: { ok: true, shop, appHandle },
        }),
      },
    },
    resources: {
      'openshop://demo/mcp': {
        name: 'Demo MCP guide',
        description: 'Example resource exposed by the demo app.',
        mimeType: 'text/markdown',
        requiredPermissions: [],
        read: () => [
          '# Demo MCP',
          '',
          'Create an MCP token from the OpenShop admin, grant `demo:read_status`, then call `demo.status`.',
          'Core tools such as `openshop.logs.search` are available through OpenShop itself.',
        ].join('\n'),
      },
    },
  },

  webhooks: {
    'orders/create': ordersCreate,
    'app/uninstalled': appUninstalled,
  },

  crons: [
    { name: 'Quick sync', schedule: '*/5 * * * *', flow: 'syncOrders', input: { limit: 10 } },
    { name: 'Nightly full sync', schedule: '0 2 * * *', flow: 'syncOrders', input: { limit: 1000 }, shops: 'all' },
  ],

  onError: async (error, context) => {
    console.error(`[openshop:error] Flow "${context?.flow}" failed:`, error.message)
  },
})

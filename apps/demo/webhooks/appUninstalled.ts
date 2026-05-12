import { defineWebhook } from 'openshop'

export const appUninstalled = defineWebhook({
  async run({ shop }) {
    console.log(`[webhook] App uninstalled from ${shop}`)
  },
})

import { app } from '../openshop.app.ts'

export const appUninstalled = app.defineWebhook({
  async run({ shop }) {
    console.log(`[webhook] App uninstalled from ${shop}`)
  },
})

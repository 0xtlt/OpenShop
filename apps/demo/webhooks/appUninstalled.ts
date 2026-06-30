import { app } from '#app'

export const appUninstalled = app.defineWebhook({
  async run({ shop }) {
    console.log(`[webhook] App uninstalled from ${shop}`)
  },
})

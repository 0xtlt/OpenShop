declare global {
  interface Window {
    shopify?: { idToken(): Promise<string>; toast?: { show(message: string, opts?: { duration?: number }): void } }
  }
}

/**
 * Authenticated fetch — includes the App Bridge session token
 * in all API requests when running inside Shopify admin.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)

  // Get session token from App Bridge (if available)
  try {
    const shopify = window.shopify
    if (shopify?.idToken) {
      const token = await shopify.idToken()
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      }
    }
  } catch {
    // Not in Shopify admin context, continue without token
  }

  return fetch(path, { ...init, headers })
}

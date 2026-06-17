declare global {
  interface Window {
    shopify?: {
      idToken(): Promise<string>
      toast?: {
        show(message: string, opts?: {
          action?: string
          duration?: number
          isError?: boolean
          onAction?: () => void
          onDismiss?: () => void
        }): string
      }
    }
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

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    const message = data && typeof data === 'object' && 'error' in data
      ? String((data as { error: unknown }).error)
      : `Request failed with ${res.status}`
    throw new Error(message)
  }

  return data as T
}

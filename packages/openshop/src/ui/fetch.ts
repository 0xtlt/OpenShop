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

export function apiErrorMessage(data: unknown, status: number): string {
  if (typeof data !== 'object' || data === null || !('error' in data)) {
    return `Request failed with ${status}`
  }
  const error = (data as { error: unknown }).error
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error
    && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return `Request failed with ${status}`
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    throw new Error(apiErrorMessage(data, res.status))
  }

  return data as T
}

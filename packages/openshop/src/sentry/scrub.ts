const SENSITIVE_QUERY_KEY = /^(id_token|session|hmac|signature|token|code|client_secret|api_secret|authorization)$/i
const SENSITIVE_KEY_PART = /secret|token|password|authorization|hmac|signature/i

export function isSensitiveQueryKey(key: string): boolean {
  return SENSITIVE_QUERY_KEY.test(key) || SENSITIVE_KEY_PART.test(key)
}

export function redactUrl(url: string): string {
  try {
    const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)
    const parsed = hasProtocol ? new URL(url) : new URL(url, 'http://openshop.invalid')
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) parsed.searchParams.set(key, '[Filtered]')
    }
    if (!hasProtocol) return `${parsed.pathname}${parsed.search}${parsed.hash}`
    return parsed.toString()
  } catch {
    return url
  }
}

export interface ScrubbableSentryEvent {
  request?: {
    url?: string
    query_string?: string | Record<string, string> | null
  }
}

export function scrubSentryEvent<T extends ScrubbableSentryEvent>(event: T): T {
  const request = event.request
  if (!request) return event

  if (request.url) request.url = redactUrl(request.url)

  if (typeof request.query_string === 'string') {
    if (request.url) {
      try {
        request.query_string = new URL(request.url).search.replace(/^\?/, '')
      } catch {
        request.query_string = redactQueryString(request.query_string)
      }
    } else {
      request.query_string = redactQueryString(request.query_string)
    }
  } else if (request.query_string && typeof request.query_string === 'object') {
    for (const key of Object.keys(request.query_string)) {
      if (isSensitiveQueryKey(key)) request.query_string[key] = '[Filtered]'
    }
  }

  return event
}

function redactQueryString(queryString: string): string {
  const params = new URLSearchParams(queryString)
  for (const key of [...params.keys()]) {
    if (isSensitiveQueryKey(key)) params.set(key, '[Filtered]')
  }
  return params.toString()
}

interface MutableResponseHeaders {
  getHeader(name: string): number | string | string[] | undefined
  setHeader(name: string, value: string | string[]): void
  removeHeader(name: string): void
}

const corsHeaders = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'Access-Control-Allow-Credentials',
  'Access-Control-Expose-Headers',
  'Access-Control-Max-Age',
]

const corsVaryValues = new Set(['origin', 'access-control-request-headers'])

export function stripCorsResponseHeaders(response: MutableResponseHeaders): void {
  for (const header of corsHeaders) response.removeHeader(header)

  const vary = response.getHeader('Vary')
  if (vary === undefined) return

  const values = (Array.isArray(vary) ? vary : [String(vary)])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value && !corsVaryValues.has(value.toLowerCase()))

  if (values.length === 0) {
    response.removeHeader('Vary')
  } else {
    response.setHeader('Vary', values.join(', '))
  }
}

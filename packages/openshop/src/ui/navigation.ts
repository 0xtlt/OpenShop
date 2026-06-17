const navigationSelector = 's-link[href], a[href], s-button[href]'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const safeSegmentPattern = /^[A-Za-z0-9_-]+$/
const reservedPrefixes = ['/api', '/auth', '/webhooks', '/proxy', '/ext', '/health']

type RouteFn = (path: string) => void
type OriginGetter = () => string
type EventTargetWithHref = {
  matches(selector: string): boolean
  getAttribute(name: string): string | null
}

export type NavigateDocument = Pick<Document, 'addEventListener' | 'removeEventListener'>

function isEventTargetWithHref(value: unknown): value is EventTargetWithHref {
  if (!value || typeof value !== 'object') return false
  const target = value as Partial<EventTargetWithHref>
  return typeof target.matches === 'function'
    && typeof target.getAttribute === 'function'
    && target.matches(navigationSelector)
}

function isReservedPath(pathname: string): boolean {
  return reservedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function isSafeSegment(segment: string): boolean {
  return safeSegmentPattern.test(segment)
}

function isAllowedUiPath(pathname: string): boolean {
  if (pathname === '/') return true
  if (isReservedPath(pathname)) return false

  const segments = pathname.split('/').filter(Boolean)
  const [section, second, third, ...rest] = segments
  if (!section || rest.length > 0) return false

  switch (section) {
    case 'flows':
      return segments.length === 1 || (segments.length === 2 && isSafeSegment(second!))
    case 'runs':
      return segments.length === 2 && uuidPattern.test(second!)
    case 'crons':
    case 'providers':
    case 'mcp':
      return segments.length === 1
    case 'functions':
      return segments.length === 1
        || (segments.length === 2 && isSafeSegment(second!))
        || (segments.length === 3 && isSafeSegment(second!) && third!.length > 0)
    default:
      return false
  }
}

export function hrefToInternalRoute(href: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(href, origin)
  } catch {
    return null
  }

  if (url.origin !== origin) return null
  if (!isAllowedUiPath(url.pathname)) return null

  return `${url.pathname}${url.search}${url.hash}`
}

export function findShopifyNavigateHref(event: Event): string | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
  for (const target of path) {
    if (!isEventTargetWithHref(target)) continue
    return target.getAttribute('href')
  }
  return null
}

export function createShopifyNavigateHandler(route: RouteFn, getOrigin: OriginGetter): EventListener {
  return (event: Event) => {
    const href = findShopifyNavigateHref(event)
    if (!href) return

    const internalRoute = hrefToInternalRoute(href, getOrigin())
    if (!internalRoute) return

    event.preventDefault()
    route(internalRoute)
  }
}

export function addShopifyNavigateListener(
  route: RouteFn,
  doc: NavigateDocument = document,
  getOrigin: OriginGetter = () => window.location.origin,
): () => void {
  const handler = createShopifyNavigateHandler(route, getOrigin)
  doc.addEventListener('shopify:navigate', handler)
  return () => doc.removeEventListener('shopify:navigate', handler)
}

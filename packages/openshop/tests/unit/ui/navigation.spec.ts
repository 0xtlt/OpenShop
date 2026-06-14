import { test } from '@japa/runner'
import {
  createShopifyNavigateHandler,
  findShopifyNavigateHref,
  hrefToInternalRoute,
} from '../../../src/ui/navigation.ts'

const origin = 'https://example.test'
const validRunId = '550e8400-e29b-41d4-a716-446655440000'

function navElement(tag: 's-link' | 'a' | 's-button' | 'div', href: string | null) {
  return {
    matches(selector: string) {
      if (!href) return false
      return selector.split(',').map((item) => item.trim()).includes(`${tag}[href]`)
    },
    getAttribute(name: string) {
      return name === 'href' ? href : null
    },
  }
}

class FakeNavigateEvent {
  defaultPrevented = false
  private readonly path: unknown[]

  constructor(path: unknown[]) {
    this.path = path
  }

  composedPath() {
    return this.path
  }

  preventDefault() {
    this.defaultPrevented = true
  }
}

test.group('hrefToInternalRoute', () => {
  test('accepts allowed app routes', ({ assert }) => {
    assert.equal(hrefToInternalRoute('/', origin), '/')
    assert.equal(hrefToInternalRoute('/flows', origin), '/flows')
    assert.equal(hrefToInternalRoute('/flows/syncPrescriptions?q=failed#latest', origin), '/flows/syncPrescriptions?q=failed#latest')
    assert.equal(hrefToInternalRoute(`/runs/${validRunId}`, origin), `/runs/${validRunId}`)
    assert.equal(hrefToInternalRoute('/functions/discounts/new', origin), '/functions/discounts/new')
    assert.equal(hrefToInternalRoute('/functions/discounts/gid%3A%2F%2Fshopify%2FDiscountNode%2F1', origin), '/functions/discounts/gid%3A%2F%2Fshopify%2FDiscountNode%2F1')
  })

  test('rejects external and special-scheme URLs', ({ assert }) => {
    assert.isNull(hrefToInternalRoute('https://evil.test/runs/550e8400-e29b-41d4-a716-446655440000', origin))
    assert.isNull(hrefToInternalRoute('//evil.test/runs/550e8400-e29b-41d4-a716-446655440000', origin))
    assert.isNull(hrefToInternalRoute('javascript:alert(1)', origin))
    assert.isNull(hrefToInternalRoute('data:text/html,x', origin))
    assert.isNull(hrefToInternalRoute('https://admin.shopify.com/store/x', origin))
    assert.isNull(hrefToInternalRoute('app:bar', origin))
    assert.isNull(hrefToInternalRoute('shopify:admin/api/graphql.json', origin))
    assert.isNull(hrefToInternalRoute('mailto:test@example.test', origin))
    assert.isNull(hrefToInternalRoute('tel:+33123456789', origin))
  })

  test('rejects server-reserved and unknown paths', ({ assert }) => {
    assert.isNull(hrefToInternalRoute('/api/runs', origin))
    assert.isNull(hrefToInternalRoute('/auth?shop=x', origin))
    assert.isNull(hrefToInternalRoute('/webhooks/orders/create', origin))
    assert.isNull(hrefToInternalRoute('/proxy/dashboard', origin))
    assert.isNull(hrefToInternalRoute('/ext/dashboard', origin))
    assert.isNull(hrefToInternalRoute('/health', origin))
    assert.isNull(hrefToInternalRoute('/admin', origin))
    assert.isNull(hrefToInternalRoute('/%2F%2Fevil.test', origin))
  })

  test('rejects traversal and invalid route params', ({ assert }) => {
    assert.isNull(hrefToInternalRoute('/flows/../auth', origin))
    assert.isNull(hrefToInternalRoute('/runs/not-a-uuid', origin))
    assert.isNull(hrefToInternalRoute('/flows/sync/orders', origin))
    assert.isNull(hrefToInternalRoute('/functions/discounts/new/extra', origin))
  })
})

test.group('shopify navigate handler', () => {
  test('finds href from a navigation element in the composed path', ({ assert }) => {
    const event = new FakeNavigateEvent([
      {},
      navElement('s-link', `/runs/${validRunId}`),
    ]) as unknown as Event

    assert.equal(findShopifyNavigateHref(event), `/runs/${validRunId}`)
  })

  test('routes internal links and prevents default navigation', ({ assert }) => {
    const routed: string[] = []
    const event = new FakeNavigateEvent([
      {},
      navElement('s-link', `/runs/${validRunId}`),
    ])
    const handler = createShopifyNavigateHandler((path) => routed.push(path), () => origin)

    handler(event as unknown as Event)

    assert.deepEqual(routed, [`/runs/${validRunId}`])
    assert.isTrue(event.defaultPrevented)
  })

  test('ignores non-navigation elements with href-like attributes', ({ assert }) => {
    const routed: string[] = []
    const event = new FakeNavigateEvent([navElement('div', `/runs/${validRunId}`)])
    const handler = createShopifyNavigateHandler((path) => routed.push(path), () => origin)

    handler(event as unknown as Event)

    assert.deepEqual(routed, [])
    assert.isFalse(event.defaultPrevented)
  })

  test('leaves external links to native navigation', ({ assert }) => {
    const routed: string[] = []
    const event = new FakeNavigateEvent([navElement('s-link', 'https://admin.shopify.com/store/x')])
    const handler = createShopifyNavigateHandler((path) => routed.push(path), () => origin)

    handler(event as unknown as Event)

    assert.deepEqual(routed, [])
    assert.isFalse(event.defaultPrevented)
  })
})

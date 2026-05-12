import { test } from '@japa/runner'
import { parseLogQuery, matchesLogFilters, logSearchText, applyContextExpansion } from '#server/log-query'

test.group('parseLogQuery', () => {
  test('free text becomes contains filter', ({ assert }) => {
    const { filters } = parseLogQuery('hello')
    assert.lengthOf(filters, 1)
    assert.equal(filters[0].op, 'contains')
    assert.equal(filters[0].value, 'hello')
  })

  test('|= creates contains filter', ({ assert }) => {
    const { filters } = parseLogQuery('|= "order"')
    assert.lengthOf(filters, 1)
    assert.equal(filters[0].op, 'contains')
    assert.equal(filters[0].value, 'order')
  })

  test('!= creates excludes filter', ({ assert }) => {
    const { filters } = parseLogQuery('!= "retry"')
    assert.lengthOf(filters, 1)
    assert.equal(filters[0].op, 'excludes')
    assert.equal(filters[0].value, 'retry')
  })

  test('|~ creates regex filter', ({ assert }) => {
    const { filters } = parseLogQuery('|~ "order-\\d+"')
    assert.lengthOf(filters, 1)
    assert.equal(filters[0].op, 'regex')
    assert.equal(filters[0].value, 'order-\\d+')
  })

  test('multiple filters combined', ({ assert }) => {
    const { filters } = parseLogQuery('|= "order" != "retry" |~ "id-\\d+"')
    assert.lengthOf(filters, 3)
    assert.equal(filters[0].op, 'contains')
    assert.equal(filters[1].op, 'excludes')
    assert.equal(filters[2].op, 'regex')
  })

  test('C:N sets both before and after context', ({ assert }) => {
    const { context } = parseLogQuery('hello C:3')
    assert.equal(context.before, 3)
    assert.equal(context.after, 3)
  })

  test('A:N and B:N set independently', ({ assert }) => {
    const { context } = parseLogQuery('B:2 A:5')
    assert.equal(context.before, 2)
    assert.equal(context.after, 5)
  })

  test('last:5m sets from date', ({ assert }) => {
    const before = Date.now()
    const { time } = parseLogQuery('last:5m')
    assert.isDefined(time.from)
    const diff = before - time.from!.getTime()
    assert.isBelow(diff, 5 * 60_000 + 100)
    assert.isAbove(diff, 5 * 60_000 - 100)
  })

  test('from: and to: set date range', ({ assert }) => {
    const { time } = parseLogQuery('from:2026-03-01 to:2026-03-02')
    assert.isDefined(time.from)
    assert.isDefined(time.to)
    assert.equal(time.from!.toISOString().slice(0, 10), '2026-03-01')
    assert.equal(time.to!.toISOString().slice(0, 10), '2026-03-02')
  })

  test('between: sets both from and to', ({ assert }) => {
    const { time } = parseLogQuery('between:2026-01-01,2026-02-01')
    assert.isDefined(time.from)
    assert.isDefined(time.to)
  })

  test('empty string returns no filters', ({ assert }) => {
    const { filters } = parseLogQuery('')
    assert.lengthOf(filters, 0)
  })
})

test.group('logSearchText', () => {
  test('combines message and payload', ({ assert }) => {
    const text = logSearchText({ message: 'Fetching orders', payload: { limit: 10 } })
    assert.include(text, 'fetching orders')
    assert.include(text, 'limit=10')
  })

  test('handles null message', ({ assert }) => {
    const text = logSearchText({ message: null, payload: null })
    assert.equal(text, '')
  })

  test('ignores array payloads', ({ assert }) => {
    const text = logSearchText({ message: 'test', payload: [1, 2, 3] })
    assert.equal(text, 'test')
  })
})

test.group('matchesLogFilters', () => {
  const log = { message: 'Fetching orders from Shopify', payload: { limit: 10, shop: 'test.myshopify.com' } }

  test('contains filter matches', ({ assert }) => {
    assert.isTrue(matchesLogFilters(log, [{ op: 'contains', value: 'orders' }]))
  })

  test('contains filter rejects', ({ assert }) => {
    assert.isFalse(matchesLogFilters(log, [{ op: 'contains', value: 'products' }]))
  })

  test('excludes filter works', ({ assert }) => {
    assert.isTrue(matchesLogFilters(log, [{ op: 'excludes', value: 'error' }]))
    assert.isFalse(matchesLogFilters(log, [{ op: 'excludes', value: 'orders' }]))
  })

  test('regex filter matches', ({ assert }) => {
    assert.isTrue(matchesLogFilters(log, [{ op: 'regex', value: 'limit=\\d+' }]))
  })

  test('invalid regex returns false', ({ assert }) => {
    assert.isFalse(matchesLogFilters(log, [{ op: 'regex', value: '[invalid' }]))
  })

  test('multiple filters are AND-ed', ({ assert }) => {
    assert.isTrue(matchesLogFilters(log, [
      { op: 'contains', value: 'orders' },
      { op: 'excludes', value: 'error' },
    ]))
    assert.isFalse(matchesLogFilters(log, [
      { op: 'contains', value: 'orders' },
      { op: 'contains', value: 'products' },
    ]))
  })
})

test.group('applyContextExpansion', () => {
  const items = [
    { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' },
  ]

  test('no context returns matched ids only', ({ assert }) => {
    const matched = new Set(['c'])
    const result = applyContextExpansion(items, matched, { before: 0, after: 0 })
    assert.deepEqual([...result], ['c'])
  })

  test('C:1 expands 1 before and 1 after', ({ assert }) => {
    const matched = new Set(['c'])
    const result = applyContextExpansion(items, matched, { before: 1, after: 1 })
    assert.isTrue(result.has('b'))
    assert.isTrue(result.has('c'))
    assert.isTrue(result.has('d'))
    assert.equal(result.size, 3)
  })

  test('does not overflow boundaries', ({ assert }) => {
    const matched = new Set(['a'])
    const result = applyContextExpansion(items, matched, { before: 5, after: 0 })
    assert.equal(result.size, 1) // only 'a', nothing before
  })

  test('multiple matches expand independently', ({ assert }) => {
    const matched = new Set(['a', 'e'])
    const result = applyContextExpansion(items, matched, { before: 0, after: 1 })
    assert.isTrue(result.has('a'))
    assert.isTrue(result.has('b'))
    assert.isTrue(result.has('e'))
    assert.equal(result.size, 3) // a, b (after a), e (no after)
  })
})

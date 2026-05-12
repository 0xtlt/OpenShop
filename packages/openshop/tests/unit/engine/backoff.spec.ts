import { test } from '@japa/runner'
import {
  DEFAULT_RETRY_POLICY,
  resolveRetryPolicy,
  computeBackoffMs,
  computeNextRetryAt,
} from '#engine/backoff'

test.group('resolveRetryPolicy', () => {
  test('returns defaults with no overrides', ({ assert }) => {
    const policy = resolveRetryPolicy()
    assert.deepEqual(policy, DEFAULT_RETRY_POLICY)
  })

  test('merges a single partial override', ({ assert }) => {
    const policy = resolveRetryPolicy({ maxAttempts: 5 })
    assert.equal(policy.maxAttempts, 5)
    assert.equal(policy.initialIntervalMs, DEFAULT_RETRY_POLICY.initialIntervalMs)
  })

  test('last override wins', ({ assert }) => {
    const policy = resolveRetryPolicy({ maxAttempts: 5 }, { maxAttempts: 10 })
    assert.equal(policy.maxAttempts, 10)
  })

  test('undefined overrides are skipped', ({ assert }) => {
    const policy = resolveRetryPolicy(undefined, { maxAttempts: 7 }, undefined)
    assert.equal(policy.maxAttempts, 7)
  })
})

test.group('computeBackoffMs', () => {
  const policy = DEFAULT_RETRY_POLICY

  test('attempt 1 returns initialIntervalMs', ({ assert }) => {
    assert.equal(computeBackoffMs(1, policy), 1_000)
  })

  test('attempt 2 doubles', ({ assert }) => {
    assert.equal(computeBackoffMs(2, policy), 2_000)
  })

  test('attempt 5 is 16s', ({ assert }) => {
    assert.equal(computeBackoffMs(5, policy), 16_000)
  })

  test('large attempt is capped at maxIntervalMs', ({ assert }) => {
    assert.equal(computeBackoffMs(20, policy), 30_000)
  })
})

test.group('computeNextRetryAt', () => {
  const policy = DEFAULT_RETRY_POLICY

  test('returns a Date when attempts remain', ({ assert }) => {
    const result = computeNextRetryAt(0, policy, null)
    assert.instanceOf(result, Date)
  })

  test('returns null when maxAttempts reached', ({ assert }) => {
    assert.isNull(computeNextRetryAt(3, policy, null))
  })

  test('returns null when next retry exceeds deadline', ({ assert }) => {
    const deadline = new Date(Date.now() + 100) // 100ms from now
    const result = computeNextRetryAt(0, policy, deadline) // delay would be 1000ms
    assert.isNull(result)
  })

  test('returns Date when deadline is far enough', ({ assert }) => {
    const deadline = new Date(Date.now() + 60_000)
    const result = computeNextRetryAt(0, policy, deadline)
    assert.instanceOf(result, Date)
  })
})

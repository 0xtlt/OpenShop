import type { RetryPolicy } from '#types'

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialIntervalMs: 1_000,
  backoffCoefficient: 2,
  maxIntervalMs: 30_000,
}

export function resolveRetryPolicy(
  ...overrides: Array<Partial<RetryPolicy> | undefined>
): RetryPolicy {
  let policy = { ...DEFAULT_RETRY_POLICY }
  for (const o of overrides) {
    if (o) policy = { ...policy, ...o }
  }
  return policy
}

export function computeBackoffMs(attempt: number, policy: RetryPolicy): number {
  const delay = policy.initialIntervalMs * Math.pow(policy.backoffCoefficient, attempt - 1)
  return Math.min(Math.round(delay), policy.maxIntervalMs)
}

export function computeNextRetryAt(
  attempts: number,
  policy: RetryPolicy,
  deadlineAt: Date | null,
): Date | null {
  if (attempts >= policy.maxAttempts) return null
  const delayMs = computeBackoffMs(attempts, policy)
  const nextAt = new Date(Date.now() + delayMs)
  if (deadlineAt && nextAt >= deadlineAt) return null
  return nextAt
}

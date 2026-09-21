import type { BadgeTone, ProviderSummary } from './types'

export function providerConnectionStatus(
  provider: Pick<ProviderSummary, 'configured' | 'lastCheckOk'>,
): { tone: BadgeTone; label: string } {
  if (!provider.configured) return { tone: 'warning', label: 'Not configured' }
  if (provider.lastCheckOk === true) return { tone: 'success', label: 'Connected' }
  if (provider.lastCheckOk === false) return { tone: 'critical', label: 'Error' }
  return { tone: 'info', label: 'Configured' }
}

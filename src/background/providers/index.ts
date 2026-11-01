import type { Provider } from '@shared/types'
import { getSettings } from '../storage'
import { createAnthropicProvider } from './anthropic'
import { createOpenAiCompatibleProvider } from './openai-compatible'
import { ProviderError, type AiProvider, type UsageListener } from './types'
import { t } from '@shared/i18n'

export * from './types'
export { DEFAULT_GENERATE_MODEL, DEFAULT_REVIEW_MODEL } from './anthropic'

export async function createProvider(
  provider: Provider,
  onUsage?: UsageListener,
): Promise<AiProvider> {
  switch (provider.type) {
    case 'anthropic':
      return createAnthropicProvider(provider, onUsage)
    case 'openai-compatible':
      return createOpenAiCompatibleProvider(provider, onUsage)
  }
}

/** Resolves the provider the user has selected, or explains why there isn't one. */
export async function resolveActiveProvider(
  /** Receives the provider record with each call, so a recorder can price it. */
  onUsage?: (call: Parameters<UsageListener>[0], provider: Provider) => void,
): Promise<AiProvider> {
  const settings = await getSettings()
  if (settings.providers.length === 0) {
    throw new ProviderError(
      t('bgNoAiProviderIsSetUp'),
      'no-credential',
      false,
    )
  }

  const active =
    settings.providers.find((p) => p.id === settings.activeProviderId) ??
    settings.providers[0]

  if (!active) {
    throw new ProviderError(t('bgNoAiProviderIsSelected'), 'no-credential', false)
  }
  return createProvider(active, onUsage && ((call) => onUsage(call, active)))
}

import type { Provider } from '@shared/types'
import { getSettings } from '../storage'
import { createAnthropicProvider } from './anthropic'
import { createOpenAiCompatibleProvider } from './openai-compatible'
import { ProviderError, type AiProvider } from './types'

export * from './types'
export { DEFAULT_GENERATE_MODEL, DEFAULT_REVIEW_MODEL } from './anthropic'

export async function createProvider(provider: Provider): Promise<AiProvider> {
  switch (provider.type) {
    case 'anthropic':
      return createAnthropicProvider(provider)
    case 'openai-compatible':
      return createOpenAiCompatibleProvider(provider)
  }
}

/** Resolves the provider the user has selected, or explains why there isn't one. */
export async function resolveActiveProvider(): Promise<AiProvider> {
  const settings = await getSettings()
  if (settings.providers.length === 0) {
    throw new ProviderError(
      'No AI provider is set up yet. Add one in settings to start generating transforms.',
      'no-credential',
      false,
    )
  }

  const active =
    settings.providers.find((p) => p.id === settings.activeProviderId) ??
    settings.providers[0]

  if (!active) {
    throw new ProviderError('No AI provider is selected.', 'no-credential', false)
  }
  return createProvider(active)
}

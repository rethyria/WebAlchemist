/**
 * How much a model reasons before it answers, as a setting of each provider.
 *
 * Anthropic accepts the effort levels low, medium, high, xhigh and max in
 * `output_config.effort`. Only low, medium and high are offered here, because
 * those are the levels that OpenAI-compatible endpoints take in
 * `reasoning_effort`, so one setting means the same on both provider types.
 * The choice 'default' sends no effort field, and the model then uses its own
 * default.
 */

export type EffortLevel = 'low' | 'medium' | 'high'
export type EffortChoice = EffortLevel | 'default'

/** The choices in the order the settings page lists them. */
export const EFFORT_CHOICES: readonly EffortChoice[] = ['low', 'medium', 'high', 'default']

/**
 * The value that a provider without the settings is given. It matches what
 * the adapter did before the settings existed: Anthropic requests always
 * carried effort high, and requests to OpenAI-compatible endpoints carried no
 * reasoning field, which many endpoints reject.
 */
export function defaultEffort(type: 'anthropic' | 'openai-compatible'): EffortChoice {
  return type === 'anthropic' ? 'high' : 'default'
}

export function isEffortChoice(value: unknown): value is EffortChoice {
  return typeof value === 'string' && (EFFORT_CHOICES as readonly string[]).includes(value)
}

/**
 * The effort of a side question, which is one level below the effort of
 * brewing: high gives medium, medium gives low, low stays low, and the model
 * default stays the model default. A side question is a short answer, so it
 * does not need the full effort of writing code. With the default brewing
 * effort of high this is the medium that side questions always used.
 */
export function askEffortFor(brew: EffortChoice): EffortChoice {
  if (brew === 'high') return 'medium'
  if (brew === 'medium' || brew === 'low') return 'low'
  return 'default'
}

/** The level to send, or undefined when the field is to be left out. */
export function effortToSend(choice: EffortChoice): EffortLevel | undefined {
  return choice === 'default' ? undefined : choice
}

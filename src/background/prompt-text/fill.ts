/**
 * Fills the placeholders of a prompt text. A placeholder is a name in capital
 * letters and underscores between double braces, such as {{NONCE}}. The helper
 * throws when the text names a placeholder that has no value, when a value is
 * given for a name the text does not use, and when the text holds a brace pair
 * that is not a valid placeholder. The text is not evaluated as code in any way.
 *
 * The Markdown files end with one newline, as editors write them. That final
 * newline is not part of the prompt and is removed.
 */
export function fillPrompt(template: string, values: Readonly<Record<string, string>> = {}): string {
  const text = template.endsWith('\n') ? template.slice(0, -1) : template
  const used = new Set<string>()
  const filled = text.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`Prompt placeholder {{${name}}} has no value.`)
    }
    used.add(name)
    return values[name] as string
  })
  const stray = text.replace(/\{\{[A-Z_]+\}\}/g, '')
  if (stray.includes('{{') || stray.includes('}}')) {
    throw new Error('Prompt text holds a malformed placeholder.')
  }
  for (const name of Object.keys(values)) {
    if (!used.has(name)) throw new Error(`Prompt value ${name} is not used by the text.`)
  }
  return filled
}

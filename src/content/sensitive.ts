/**
 * Whether the page has a password field or a payment field.
 *
 * Kept apart from extractContext (context.ts): a test pins which DOM members
 * that extractor reads, and this check must not add to what is read there or
 * to what is sent to the provider. It reads only whether such a field exists
 * and never a field's value.
 */

/** True when an autocomplete value names payment data: a token starting with "cc-". */
export function isPaymentAutocomplete(value: string | null): boolean {
  return (value ?? '').toLowerCase().split(/\s+/).some((token) => token.startsWith('cc-'))
}

export function pageHasSensitiveFields(root: ParentNode = document): boolean {
  if (root.querySelector('input[type="password" i]')) return true
  for (const input of root.querySelectorAll('input[autocomplete]')) {
    if (isPaymentAutocomplete(input.getAttribute('autocomplete'))) return true
  }
  return false
}

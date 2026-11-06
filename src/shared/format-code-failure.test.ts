import { describe, expect, it, vi } from 'vitest'

vi.mock('js-beautify/js/lib/beautify.js', () => ({
  default: {
    js_beautify: (code: string) => {
      if (code === 'empty') return '  '
      throw new Error('formatter failed')
    },
  },
}))
vi.mock('js-beautify/js/lib/beautify-css.js', () => ({
  default: {
    css_beautify: () => {
      throw new Error('formatter failed')
    },
  },
}))

const { formatCode, formatGeneration } = await import('./format-code')

describe('a formatter that fails', () => {
  it('keeps the original JavaScript', () => {
    expect(formatCode('a=1', 'js')).toBe('a=1')
  })

  it('keeps the original CSS', () => {
    expect(formatCode('a{b:c}', 'css')).toBe('a{b:c}')
  })

  it('keeps the original code when the output is empty', () => {
    expect(formatCode('empty', 'js')).toBe('empty')
  })

  it('keeps the original generation result', () => {
    const result = { kind: 'js' as const, code: 'a=1' }
    expect(formatGeneration(result)).toBe(result)
  })
})

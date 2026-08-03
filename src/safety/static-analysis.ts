/**
 * Deterministic pass over generated JavaScript, run before the code is ever
 * executed and before the model review.
 *
 * WHAT THIS IS FOR
 * ----------------
 * This is a *detection* aid, not the enforcement boundary. Enforcement is the
 * per-world Content Security Policy set via userScripts.configureWorld(),
 * which blocks external connections at runtime no matter what the code says or
 * what any analysis concluded.
 *
 * Static analysis exists because it is free, it always runs, and — unlike the
 * model review — nothing written on a webpage can talk it out of its answer.
 *
 * KNOWN LIMITATION, STATED PLAINLY
 * --------------------------------
 * Fully dynamic access (`window[a + b]()`) cannot be resolved without running
 * the code. We detect and flag *that we could not analyse it* rather than
 * pretending the code is clean. Combined with the CSP, an unanalysable call is
 * still unable to reach the network.
 */

import { parse } from 'acorn'
import type { Node } from 'acorn'
import type { Capability, StaticFinding } from '@shared/types'

interface Rule {
  /** Dotted path as written in source, e.g. "navigator.sendBeacon". */
  path: string
  capability: Capability | null
  severity: 'block' | 'warn'
  explanation: string
}

/**
 * Code-from-string constructs are always blocking: they have no legitimate use
 * in a page transform, and they defeat the rest of this analysis by moving the
 * real behaviour into a string this pass cannot see.
 */
const CODE_FROM_STRING: Rule[] = [
  {
    path: 'eval',
    capability: null,
    severity: 'block',
    explanation: 'Runs code built at runtime, which cannot be reviewed before it executes.',
  },
  {
    path: 'Function',
    capability: null,
    severity: 'block',
    explanation: 'Builds a new function from text, which cannot be reviewed before it executes.',
  },
]

const CAPABILITY_RULES: Rule[] = [
  {
    path: 'fetch',
    capability: 'network',
    severity: 'warn',
    explanation: 'Sends a network request.',
  },
  {
    path: 'XMLHttpRequest',
    capability: 'network',
    severity: 'warn',
    explanation: 'Sends a network request.',
  },
  {
    path: 'WebSocket',
    capability: 'network',
    severity: 'warn',
    explanation: 'Opens a persistent network connection.',
  },
  {
    path: 'EventSource',
    capability: 'network',
    severity: 'warn',
    explanation: 'Opens a persistent network connection.',
  },
  {
    path: 'navigator.sendBeacon',
    capability: 'network',
    severity: 'warn',
    explanation: 'Sends data to a server in the background.',
  },
  {
    path: 'document.cookie',
    capability: 'cookies',
    severity: 'warn',
    explanation: "Reads or writes this site's cookies, which can include your session.",
  },
  {
    path: 'localStorage',
    capability: 'storage',
    severity: 'warn',
    explanation: "Reads or writes this site's stored data.",
  },
  {
    path: 'sessionStorage',
    capability: 'storage',
    severity: 'warn',
    explanation: "Reads or writes this site's stored data.",
  },
  {
    path: 'indexedDB',
    capability: 'storage',
    severity: 'warn',
    explanation: "Reads or writes this site's stored database.",
  },
]

const RULES_BY_PATH = new Map<string, Rule>(
  [...CODE_FROM_STRING, ...CAPABILITY_RULES].map((r) => [r.path, r]),
)

/** Timer functions that execute a string argument as code. */
const STRING_EXECUTING_TIMERS = new Set(['setTimeout', 'setInterval'])

interface Positioned {
  type: string
  start: number
  end: number
  loc?: { start: { line: number; column: number } }
  [key: string]: unknown
}

function lineCol(node: Positioned): { line: number; column: number } {
  return node.loc
    ? { line: node.loc.start.line, column: node.loc.start.column + 1 }
    : { line: 0, column: 0 }
}

/**
 * Renders a MemberExpression chain back to dotted source form, but only when
 * every link is statically known. Returns null for anything computed, which
 * the caller reports as unanalysable rather than clean.
 */
function staticPath(node: Positioned): string | null {
  if (node.type === 'Identifier') return node['name'] as string
  if (node.type === 'ThisExpression') return null
  if (node.type !== 'MemberExpression') return null

  if (node['computed'] === true) return null
  const object = staticPath(node['object'] as Positioned)
  const property = node['property'] as Positioned
  if (object === null || property.type !== 'Identifier') return null

  const name = property['name'] as string
  // `window.fetch` and `globalThis.fetch` are the same thing as bare `fetch`.
  if (object === 'window' || object === 'globalThis' || object === 'self') return name
  return `${object}.${name}`
}

function walk(node: unknown, visit: (n: Positioned) => void): void {
  if (node === null || typeof node !== 'object') return
  const candidate = node as Positioned
  if (typeof candidate.type === 'string') visit(candidate)

  for (const key of Object.keys(node as object)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue
    const value = (node as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit)
    } else if (value && typeof value === 'object') {
      walk(value, visit)
    }
  }
}

export interface AnalysisOutcome {
  findings: StaticFinding[]
  /** Capabilities the code actually uses, derived from the findings. */
  usedCapabilities: Capability[]
  /** True when the source could not be parsed; treated as blocking. */
  parseError?: string
}

export function analyseJavaScript(source: string): AnalysisOutcome {
  let ast: Node
  try {
    ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: true,
    })
  } catch (error) {
    return {
      findings: [
        {
          line: 0,
          column: 0,
          api: '(parse)',
          capability: null,
          severity: 'block',
          explanation: `This code could not be parsed, so it cannot be checked: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      usedCapabilities: [],
      parseError: error instanceof Error ? error.message : String(error),
    }
  }

  const findings: StaticFinding[] = []
  const seen = new Set<string>()

  const record = (node: Positioned, rule: Rule) => {
    const { line, column } = lineCol(node)
    const key = `${line}:${column}:${rule.path}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({
      line,
      column,
      api: rule.path,
      capability: rule.capability,
      severity: rule.severity,
      explanation: rule.explanation,
    })
  }

  walk(ast, (node) => {
    // Dynamic import is its own node type, not a call to an identifier.
    if (node.type === 'ImportExpression') {
      record(node, {
        path: 'import()',
        capability: 'network',
        severity: 'warn',
        explanation: 'Loads and runs code from another location.',
      })
      return
    }

    // setTimeout("...") / setInterval("...") execute their string argument.
    if (node.type === 'CallExpression') {
      const callee = staticPath(node['callee'] as Positioned)
      const args = node['arguments'] as Positioned[] | undefined
      const first = args?.[0]
      if (
        callee !== null &&
        STRING_EXECUTING_TIMERS.has(callee) &&
        first &&
        (first.type === 'Literal' || first.type === 'TemplateLiteral')
      ) {
        const isString = first.type === 'TemplateLiteral' || typeof first['value'] === 'string'
        if (isString) {
          record(node, {
            path: `${callee}(string)`,
            capability: null,
            severity: 'block',
            explanation:
              'Runs code supplied as text, which cannot be reviewed before it executes.',
          })
        }
      }
    }

    if (node.type === 'Identifier' || node.type === 'MemberExpression') {
      // Skip identifiers that are property names or declarations rather than reads.
      const path = staticPath(node)
      if (path !== null) {
        const rule = RULES_BY_PATH.get(path)
        if (rule) record(node, rule)
        return
      }

      // Computed access we cannot resolve. Report the gap honestly instead of
      // reporting clean. The world CSP still constrains what it can reach.
      if (node.type === 'MemberExpression' && node['computed'] === true) {
        const property = node['property'] as Positioned
        // `arr[0]` and `arr[i]` are ordinary indexing, not obfuscation.
        const looksLikeIndexing =
          property.type === 'Literal' && typeof property['value'] === 'number'
        if (!looksLikeIndexing) {
          record(node, {
            path: '(dynamic property access)',
            capability: null,
            severity: 'warn',
            explanation:
              'Reads a property whose name is decided while running, so this check cannot tell what it accesses.',
          })
        }
      }
    }
  })

  const usedCapabilities = [
    ...new Set(
      findings
        .map((f) => f.capability)
        .filter((c): c is Capability => c !== null),
    ),
  ]

  return { findings, usedCapabilities }
}

/**
 * Raises capability findings from warn to block when the transform did not
 * declare that capability. A declared capability the user approved is an
 * expected use; an undeclared one is a rejection, not a judgement call.
 */
export function applyCapabilityPolicy(
  outcome: AnalysisOutcome,
  declared: Capability[],
): { findings: StaticFinding[]; undeclared: Capability[] } {
  const declaredSet = new Set(declared)
  const undeclared = outcome.usedCapabilities.filter((c) => !declaredSet.has(c))
  const undeclaredSet = new Set(undeclared)

  const findings = outcome.findings.map((finding) =>
    finding.capability !== null && undeclaredSet.has(finding.capability)
      ? { ...finding, severity: 'block' as const }
      : finding,
  )

  return { findings, undeclared }
}

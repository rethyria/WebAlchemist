/**
 * Turns a file received from outside into transform records the importer's own
 * extension may store, and describes what an import would do before it is
 * confirmed (#56).
 *
 * A file is someone else's text. Whatever it says about itself is not
 * trusted: the record is built again from the fields an import may take
 * (name, kind, match pattern, intent, rationale, anchor and, for CSS, code)
 * and every field that decides how the extension treats the record is set by
 * the importer. The checks that need the browser (the CSS check, the shape
 * check on a record) are passed in, so this module needs neither storage nor
 * `browser` and a test can call it directly.
 */

import { assessMatch } from '@shared/import-match'
import { originPermissionFor } from '@shared/match'
import type { Anchor, Transform, TransformKind } from '@shared/types'

export interface PlannedTransform {
  name: string
  kind: TransformKind
  match: string
  /** The sites the pattern covers, in words. Empty when the record is refused for its pattern. */
  sites: string
  /** The origin permission the import asks for, or null when the record is refused. */
  origin: string | null
  /**
   * What the file says the transform is for. It was written by the author of
   * the file, so the preview shows it as theirs and never as the user's.
   */
  intent: string
  status: 'import' | 'duplicate' | 'refused'
  /** Why the record is refused or its code is not imported. */
  reason?: string
  /** True when the record is imported without code and has to be regenerated. */
  needsRegeneration: boolean
  /** True when the record holds code that the user has to approve before it runs. */
  needsApproval: boolean
}

export interface ImportPlan {
  items: PlannedTransform[]
  /** The records to store, in file order, for the items whose status is `import`. Ids and order are set by the caller. */
  records: Transform[]
}

export interface PlanDeps {
  isValid: (value: unknown) => value is Transform
  /** The explanation when the CSS fails the check for the importer's settings, or null when it passes. */
  cssProblem: (transform: Pick<Transform, 'code' | 'match'>) => string | null
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

/** The anchor's known fields only. */
function cleanAnchor(anchor: Anchor): Anchor {
  return {
    tag: anchor.tag,
    classes: strings(anchor.classes),
    ...(typeof anchor.id === 'string' ? { id: anchor.id } : {}),
    ...(typeof anchor.role === 'string' ? { role: anchor.role } : {}),
    ...(typeof anchor.text === 'string' ? { text: anchor.text } : {}),
    path: anchor.path,
    landmarks: strings(anchor.landmarks),
    selector: anchor.selector,
  }
}

/**
 * The record an import stores for one incoming record.
 *
 * Set here and not copied from the file: `id`, `order` (assigned when stored),
 * `createdAt` and `updatedAt`; `enabled`, always false, so nothing runs until
 * the user turns it on; `origin`, always `imported`; `world`, always the user
 * script world, so a file cannot ask for the page's own context; `capabilities`,
 * empty until the code is regenerated and reviewed here; and `approvedCssUrls`,
 * which an approval in someone else's file cannot give. Fields the type does
 * not name, such as a container id, are not copied.
 */
export function sanitiseIncoming(incoming: Transform, now: number): Transform {
  const js = incoming.kind === 'js'
  return {
    id: '',
    name: incoming.name,
    enabled: false,
    order: 0,
    match: incoming.match.trim(),
    kind: incoming.kind,
    origin: 'imported',
    ...(js ? { world: 'USER_SCRIPT' as const } : {}),
    capabilities: [],
    intent: incoming.intent,
    ...(Number.isInteger(incoming.scopeDepth) && (incoming.scopeDepth ?? 0) >= 0
      ? { scopeDepth: incoming.scopeDepth as number }
      : {}),
    rationale: {
      targets: text(incoming.rationale.targets),
      approach: text(incoming.rationale.approach),
      assumptions: strings(incoming.rationale.assumptions),
    },
    anchor: cleanAnchor(incoming.anchor),
    code: js ? '' : incoming.code,
    createdAt: now,
    updatedAt: now,
  }
}

async function sha256(parts: unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Hashes that identify a transform's content for duplicate detection: its
 * name, kind and match pattern with its code (CSS, and JavaScript that has
 * code) or its intent (JavaScript). A JavaScript transform that has code gets
 * both, so a file that carries only the intent still matches it.
 */
export async function contentHashes(
  t: Pick<Transform, 'name' | 'kind' | 'match' | 'code' | 'intent'>,
): Promise<string[]> {
  const head = [t.name, t.kind, t.match.trim()]
  const byCode = await sha256([...head, 'code', t.code])
  if (t.kind === 'css') return [byCode]
  const byIntent = await sha256([...head, 'intent', t.intent])
  return t.code === '' ? [byIntent] : [byCode, byIntent]
}

/**
 * Decides what an import would do with every record in the file, without
 * storing anything. `existing` is what is stored now. The same function backs
 * the preview and the import, so what the user confirmed is what is stored.
 */
export async function planImport(
  incoming: unknown[],
  existing: Transform[],
  deps: PlanDeps,
  now: number,
): Promise<ImportPlan> {
  const seen = new Set<string>()
  for (const t of existing) for (const hash of await contentHashes(t)) seen.add(hash)

  const items: PlannedTransform[] = []
  const records: Transform[] = []

  for (const raw of incoming) {
    if (!deps.isValid(raw)) {
      const fallback = (field: string): string =>
        typeof raw === 'object' && raw !== null ? text((raw as Record<string, unknown>)[field]) : ''
      items.push({
        name: fallback('name') || 'Unnamed record',
        kind: (raw as { kind?: unknown } | null)?.kind === 'js' ? 'js' : 'css',
        match: fallback('match'),
        sites: '',
        origin: null,
        intent: '',
        status: 'refused',
        reason: 'The record is missing a field or has a field of the wrong type.',
        needsRegeneration: false,
        needsApproval: false,
      })
      continue
    }

    const base = {
      name: raw.name,
      kind: raw.kind,
      match: raw.match.trim(),
      intent: raw.intent,
      needsRegeneration: false,
      needsApproval: false,
    }
    const assessed = assessMatch(raw.match)
    if (!assessed.ok) {
      items.push({ ...base, sites: '', origin: null, status: 'refused', reason: assessed.reason })
      continue
    }
    const hashes = await contentHashes(raw)
    if (hashes.some((hash) => seen.has(hash))) {
      items.push({
        ...base,
        sites: assessed.sites,
        origin: originPermissionFor(raw.match.trim()),
        status: 'duplicate',
        reason: 'A transform with the same name, kind, sites and content is already saved.',
      })
      continue
    }
    for (const hash of hashes) seen.add(hash)

    const record = sanitiseIncoming(raw, now)
    let reason: string | undefined
    if (record.kind === 'css') {
      const problem = deps.cssProblem(record)
      if (problem !== null) {
        record.code = ''
        reason = `The CSS is not imported because it fails the CSS check. ${problem}`
      }
    }
    const needsRegeneration = record.code === ''
    items.push({
      ...base,
      sites: assessed.sites,
      origin: originPermissionFor(record.match),
      status: 'import',
      ...(reason === undefined ? {} : { reason }),
      needsRegeneration,
      needsApproval: false,
    })
    records.push(record)
  }
  return { items, records }
}

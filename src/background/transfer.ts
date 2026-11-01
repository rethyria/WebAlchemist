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

import { excludedHostForPattern } from '@shared/excluded-sites'
import { assessMatch } from '@shared/import-match'
import { originPermissionFor } from '@shared/match'
import {
  ACCENTS,
  type Accent,
  type Anchor,
  type Capability,
  type ExecutionWorld,
  type HealthCheckMode,
  type SettingsFields,
  type Transform,
  type TransformKind,
} from '@shared/types'
import { t } from '@shared/i18n'

/** Which kind of file an export is. A share carries no JavaScript code; a backup does. */
export type ExportMode = 'share' | 'backup'

/** The settings a backup holds and a restore may apply. See backupSettingsOf. */
export interface BackupSettings {
  accent: Accent
  healthCheckMode: HealthCheckMode
}

const HEALTH_MODES: readonly HealthCheckMode[] = ['every-load', 'once-per-session', 'manual']
const CAPABILITIES: readonly Capability[] = ['network', 'storage', 'cookies']

/**
 * The settings from a backup file that a restore may apply, or null when the
 * file holds none that are valid. Only the accent colour and the health check
 * mode are taken. Providers and their addresses are not, because an address in
 * a file could send the user's credentials to another server. The per-site CSS
 * mode is not, because an import must not switch on a less strict mode. The
 * stop-all switch and the vault lock time are not, because a file could turn
 * protection off.
 */
export function backupSettingsOf(bundle: { settings?: unknown }): BackupSettings | null {
  const value = bundle.settings
  if (typeof value !== 'object' || value === null) return null
  const { accent, healthCheckMode } = value as Record<string, unknown>
  if (!ACCENTS.includes(accent as Accent)) return null
  if (!HEALTH_MODES.includes(healthCheckMode as HealthCheckMode)) return null
  return { accent: accent as Accent, healthCheckMode: healthCheckMode as HealthCheckMode }
}

export function settingsFieldsOf(settings: BackupSettings): SettingsFields {
  return { accent: settings.accent, healthCheckMode: settings.healthCheckMode }
}

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
  /** The world restored code runs in. Present only when `needsApproval` is true. */
  world?: ExecutionWorld
  /** The JavaScript that is restored, for the preview to show. Present only when `needsApproval` is true. */
  code?: string
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
  /** The explanation when restored JavaScript fails static analysis, or null when it passes. */
  jsProblem: (transform: Pick<Transform, 'code' | 'capabilities'>) => string | null
  /** The importer's list of excluded sites. A record whose pattern reaches one is refused. */
  excludedSites?: readonly string[]
}

/** The most distinct origins one import asks the browser for access to. */
export const MAX_IMPORT_ORIGINS = 20

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
 * script world, so a share file cannot ask for the page's own context (a
 * backup keeps `MAIN` when the record says so, and the record then waits for
 * approval of the code and the world); `mainApprovedByUser` and
 * `worldResetFromModel`, which only the extension's own approval sets; `capabilities`,
 * empty until the code is regenerated and reviewed here (a backup keeps the
 * declared ones, limited to the three known names); and `approvedCssUrls`,
 * which an approval in someone else's file cannot give. Fields the type does
 * not name, such as a container id, are not copied.
 */
export function sanitiseIncoming(
  incoming: Transform,
  now: number,
  /**
   * True for a backup, which keeps the JavaScript code and the capabilities it
   * declared. The record is still disabled and marked as awaiting approval by
   * the caller; a backup does not make the code trusted.
   */
  keepScript = false,
): Transform {
  const js = incoming.kind === 'js'
  const keep = js && keepScript
  return {
    id: '',
    name: incoming.name,
    enabled: false,
    order: 0,
    match: incoming.match.trim(),
    kind: incoming.kind,
    origin: 'imported',
    ...(js ? { world: keep && incoming.world === 'MAIN' ? ('MAIN' as const) : ('USER_SCRIPT' as const) } : {}),
    capabilities: keep
      ? CAPABILITIES.filter((c) => Array.isArray(incoming.capabilities) && incoming.capabilities.includes(c))
      : [],
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
    code: js && !keepScript ? '' : incoming.code,
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
  mode: ExportMode = 'share',
): Promise<ImportPlan> {
  const seen = new Set<string>()
  for (const t of existing) for (const hash of await contentHashes(t)) seen.add(hash)

  const items: PlannedTransform[] = []
  const records: Transform[] = []
  const origins = new Set<string>()

  for (const raw of incoming) {
    if (!deps.isValid(raw)) {
      const fallback = (field: string): string =>
        typeof raw === 'object' && raw !== null ? text((raw as Record<string, unknown>)[field]) : ''
      items.push({
        name: fallback('name') || t('bgUnnamedRecord'),
        kind: (raw as { kind?: unknown } | null)?.kind === 'js' ? 'js' : 'css',
        match: fallback('match'),
        sites: '',
        origin: null,
        intent: '',
        status: 'refused',
        reason: t('bgTheRecordIsMissingAField'),
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
    // Before any permission is asked for: the user said never to ask for access
    // to these sites, and a file must not be able to ask on their behalf.
    const excluded = excludedHostForPattern(deps.excludedSites ?? [], raw.match.trim())
    if (excluded !== null) {
      items.push({
        ...base,
        sites: '',
        origin: null,
        status: 'refused',
        reason: t('bgThePatternReachesWhichIsOn', excluded),
      })
      continue
    }
    // The code the record would hold if stored: none for JavaScript in a share,
    // so that a file which carries code anyway matches on its description.
    const effective = { ...raw, code: raw.kind === 'js' && mode === 'share' ? '' : raw.code }
    const hashes = await contentHashes(effective)
    if (hashes.some((hash) => seen.has(hash))) {
      items.push({
        ...base,
        sites: assessed.sites,
        origin: originPermissionFor(raw.match.trim()),
        status: 'duplicate',
        reason: t('bgATransformWithTheSameName'),
      })
      continue
    }
    // One prompt asks for every origin in the import, so a file cannot ask for
    // a long list of sites that the user would have to read before approving.
    const origin = originPermissionFor(raw.match.trim())
    if (origin !== null && !origins.has(origin) && origins.size >= MAX_IMPORT_ORIGINS) {
      items.push({
        ...base,
        sites: assessed.sites,
        origin: null,
        status: 'refused',
        reason: t('bgThisFileAsksForAccessTo', MAX_IMPORT_ORIGINS),
      })
      continue
    }
    if (origin !== null) origins.add(origin)
    for (const hash of hashes) seen.add(hash)

    const record = sanitiseIncoming(raw, now, mode === 'backup')
    let reason: string | undefined
    let needsApproval = false
    if (record.kind === 'css') {
      const problem = deps.cssProblem(record)
      if (problem !== null) {
        record.code = ''
        reason = t('bgTheCssIsNotImportedBecause', problem)
      }
    }
    if (record.kind === 'js' && record.code !== '') {
      // Restored code is checked as if it had just been written, and a failure
      // leaves the record without code. Passing does not make it trusted: the
      // record waits for the user's approval of this code.
      const problem = deps.jsProblem(record)
      if (problem !== null) {
        record.code = ''
        record.capabilities = []
        reason = t('bgTheCodeIsNotRestoredBecause', problem)
      } else {
        record.awaitsApproval = true
        needsApproval = true
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
      needsApproval,
      ...(needsApproval ? { code: record.code, world: record.world ?? 'USER_SCRIPT' } : {}),
    })
    records.push(record)
  }
  return { items, records }
}

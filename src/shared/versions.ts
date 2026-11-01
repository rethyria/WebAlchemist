/** Wording for the versions of a transform that the editor lists. */

import type { Capability, Transform, TransformSource, TransformVersion } from './types'
import { t } from './i18n'

/** What produced a version, in the words the editor shows. */
export function sourceLabel(source: TransformSource | undefined): string {
  switch (source) {
    case 'generation':
      return t('sourceGeneration')
    case 'repair':
      return t('sourceRepair')
    case 'ai-edit':
      return t('sourceAiEdit')
    case 'hand-edit':
      return t('sourceHandEdit')
    default:
      return t('sourceUnknown')
  }
}

/** One line of the comparison shown before a version is restored. */
export interface VersionDifference {
  label: string
  current: string
  version: string
  /** Stated in words as well as shown, so that the table does not rely on colour. */
  status: string
}

function worldLabel(kind: Transform['kind'], world: Transform['world']): string {
  if (kind !== 'js') return t('versionWorldNotCss')
  return (world ?? 'USER_SCRIPT') === 'MAIN'
    ? t('versionWorldMain')
    : t('versionWorldIsolated')
}

function capabilityLabel(capabilities: readonly Capability[]): string {
  return capabilities.length === 0 ? t('capabilitiesNone') : [...capabilities].sort().join(', ')
}

/**
 * What differs between the saved transform and a version of it, for the
 * confirmation shown before a restore. A restore brings back the match
 * pattern, capabilities and world as well as the code, so each is listed next
 * to the current value, including those the user may have removed on purpose.
 */
export function compareWithCurrent(current: Transform, version: TransformVersion): VersionDifference[] {
  const rows: Omit<VersionDifference, 'status'>[] = [
    { label: t('versionRowMatch'), current: current.match, version: version.match },
    {
      label: t('versionRowCapabilities'),
      current: capabilityLabel(current.capabilities),
      version: capabilityLabel(version.capabilities),
    },
    {
      label: t('versionRowWorld'),
      current: worldLabel(current.kind, current.world),
      version: worldLabel(current.kind, version.world),
    },
  ]
  return rows.map((row) => ({ ...row, status: row.current === row.version ? t('versionSame') : t('versionDifferent') }))
}

/**
 * True when restoring this version puts a JavaScript transform in the MAIN
 * world, which the user has to confirm after reading the risks (issue 53).
 */
export function restoreNeedsMainConfirmation(
  kind: Transform['kind'],
  version: Pick<TransformVersion, 'world'>,
): boolean {
  return kind === 'js' && version.world === 'MAIN'
}

/**
 * The message to show when a restore may not go ahead yet, or null when it
 * may. A MAIN version is refused until the user has confirmed the risks.
 */
export function restoreRefusal(
  kind: Transform['kind'],
  version: Pick<TransformVersion, 'world'>,
  mainConfirmed: boolean,
): string | null {
  if (restoreNeedsMainConfirmation(kind, version) && !mainConfirmed) {
    return t('restoreMainRefusal')
  }
  return null
}

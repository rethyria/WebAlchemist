/**
 * Records which code the user was shown in the approval panel, so that saving
 * can refuse code that is not that code.
 *
 * An approval is a one-time token. The review (or the approval of hand-written
 * code) returns it to the page that asked, the page sends it back with the
 * save, and it is deleted when the save succeeds. It is tied to the transform
 * id and the match pattern as well as to the code, so an approval given for one
 * transform on one site cannot be used to save the same code for another
 * transform or another site, and it cannot be used twice. Before this, an
 * approval stayed valid for the whole session and was tied only to the code and
 * the world (found in the review of a60086e).
 *
 * Without a record, `save-transform` accepts whatever code its message carries
 * as long as static analysis passes. The panel's approval then belongs to no
 * particular code: a later change that lets the code be edited after the
 * review, or any other sender, could save code the reviewer and the user never
 * saw.
 *
 * What is recorded is a SHA-256 hash of the code and the execution world, with
 * the capabilities that were declared and the verdict. Capabilities are kept
 * beside the hash instead of inside it because refusing a capability is a
 * normal step in the panel and changes nothing about the code: an approval for
 * a set of capabilities stands for any subset of them, since a smaller set
 * allows less. A larger set has no approval.
 *
 * The records live in session storage, which survives the background script
 * being suspended while the user reads the panel and is cleared when the
 * browser closes. They are a guard against the code and the approval coming
 * apart. They are not a defence against another extension page, which can
 * ask for an approval itself.
 */

import { stableJson } from '@shared/config'
import type { Capability, ConfigField, ExecutionWorld, Transform } from '@shared/types'

const KEY = 'wa-approvals'
/** Enough for many sessions of work; bounded so session storage cannot grow without limit. */
const MAX_RECORDS = 200

export type ApprovalVerdict = 'match' | 'mismatch' | 'uncertain' | 'user-written'

/** What a token is tied to besides the code: the transform and the sites it applies to. */
export interface ApprovalBinding {
  transformId: string
  match: string
  /**
   * The settings the code reads. They are part of what was reviewed, so the
   * hash covers them. The values the user sets are not: a value edit needs no
   * review, because the analysis treats every value as arbitrary text.
   */
  configFields?: ConfigField[] | undefined
}

interface Approval {
  token: string
  transformId: string
  match: string
  hash: string
  capabilities: Capability[]
  verdict: ApprovalVerdict
  at: number
}

export async function hashCode(
  code: string,
  world: ExecutionWorld | undefined,
  configFields?: readonly ConfigField[] | undefined,
): Promise<string> {
  // The fields are written with their keys in sorted order, so two copies of
  // the same fields give the same hash. Setting values are not in the hash.
  const bytes = new TextEncoder().encode(
    `[${JSON.stringify(code)},${JSON.stringify(world ?? 'USER_SCRIPT')},${stableJson(configFields ?? [])}]`,
  )
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function read(): Promise<Approval[]> {
  const stored = await browser.storage.session.get(KEY)
  return (stored[KEY] as Approval[] | undefined) ?? []
}

/**
 * Records an approval and returns its one-time token. A new approval for the
 * same code, capabilities, transform and match replaces the earlier one, so
 * asking again for a review invalidates the token the previous review gave.
 */
export async function recordApproval(
  code: string,
  world: ExecutionWorld | undefined,
  capabilities: Capability[],
  verdict: ApprovalVerdict,
  binding: ApprovalBinding,
): Promise<string> {
  const hash = await hashCode(code, world, binding.configFields)
  const token = crypto.randomUUID()
  const kept = (await read()).filter(
    (a) =>
      !(
        a.hash === hash &&
        a.transformId === binding.transformId &&
        a.match === binding.match &&
        sameSet(a.capabilities, capabilities)
      ),
  )
  kept.push({
    token,
    transformId: binding.transformId,
    match: binding.match,
    hash,
    capabilities: [...capabilities],
    verdict,
    at: Date.now(),
  })
  await browser.storage.session.set({ [KEY]: kept.slice(-MAX_RECORDS) })
  return token
}

/**
 * True when the token was issued for this exact code and world, for this
 * transform and match pattern, and covers at least these capabilities. Does not
 * use the token up; `spendApproval` does that once the save has succeeded.
 */
export async function isApproved(
  token: string | undefined,
  code: string,
  world: ExecutionWorld | undefined,
  capabilities: Capability[],
  binding: ApprovalBinding,
  /** When given, the stored verdict must be this one; a preview asks for 'match'. */
  options: { verdict?: ApprovalVerdict } = {},
): Promise<boolean> {
  if (!token) return false
  const hash = await hashCode(code, world, binding.configFields)
  return (await read()).some(
    (a) =>
      a.token === token &&
      a.hash === hash &&
      a.transformId === binding.transformId &&
      a.match === binding.match &&
      (options.verdict === undefined || a.verdict === options.verdict) &&
      capabilities.every((c) => a.capabilities.includes(c)),
  )
}

/** Deletes a token, so it cannot be used for a second save. */
export async function spendApproval(token: string): Promise<void> {
  const kept = (await read()).filter((a) => a.token !== token)
  await browser.storage.session.set({ [KEY]: kept })
}

function sameSet(a: Capability[], b: Capability[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c))
}

/**
 * Whether a JavaScript transform may be saved: its code is what is already
 * stored, or it is code that was approved.
 *
 * Unchanged code, with the same match pattern and world and no new capability,
 * is let through so that renaming a transform does not need a new review.
 * Capabilities count as unchanged when they are a subset of the stored ones,
 * because dropping a capability (refusing it in the panel) allows less than
 * before.
 */
export async function mayBeSaved(
  stored: Transform | undefined,
  incoming: Transform,
  token: string | undefined,
): Promise<boolean> {
  const world = incoming.world ?? 'USER_SCRIPT'
  const unchanged =
    stored !== undefined &&
    stored.kind === 'js' &&
    stored.code === incoming.code &&
    // Where the code runs is part of what was reviewed, so widening the match
    // pattern is not a rename.
    stored.match === incoming.match &&
    (stored.world ?? 'USER_SCRIPT') === world &&
    // The fields are part of what was reviewed, so a change to them is a change
    // of code. The values are not, and are not compared.
    stableJson(stored.configFields ?? []) === stableJson(incoming.configFields ?? []) &&
    incoming.capabilities.every((c) => stored.capabilities.includes(c))
  return (
    unchanged ||
    isApproved(token, incoming.code, incoming.world, incoming.capabilities, {
      transformId: incoming.id,
      match: incoming.match,
      configFields: incoming.configFields,
    })
  )
}

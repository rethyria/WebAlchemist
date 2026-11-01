/**
 * Records which code the user was shown in the approval panel, so that saving
 * can refuse code that is not that code.
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

import type { Capability, ExecutionWorld, Transform } from '@shared/types'

const KEY = 'wa-approvals'
/** Enough for many sessions of work; bounded so session storage cannot grow without limit. */
const MAX_RECORDS = 200

export type ApprovalVerdict = 'match' | 'mismatch' | 'uncertain' | 'user-written'

interface Approval {
  hash: string
  capabilities: Capability[]
  verdict: ApprovalVerdict
  at: number
}

export async function hashCode(code: string, world: ExecutionWorld | undefined): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([code, world ?? 'USER_SCRIPT']))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function read(): Promise<Approval[]> {
  const stored = await browser.storage.session.get(KEY)
  return (stored[KEY] as Approval[] | undefined) ?? []
}

export async function recordApproval(
  code: string,
  world: ExecutionWorld | undefined,
  capabilities: Capability[],
  verdict: ApprovalVerdict,
): Promise<void> {
  const hash = await hashCode(code, world)
  const kept = (await read()).filter(
    (a) => !(a.hash === hash && sameSet(a.capabilities, capabilities)),
  )
  kept.push({ hash, capabilities: [...capabilities], verdict, at: Date.now() })
  await browser.storage.session.set({ [KEY]: kept.slice(-MAX_RECORDS) })
}

/** True when this exact code and world were approved with at least these capabilities. */
export async function isApproved(
  code: string,
  world: ExecutionWorld | undefined,
  capabilities: Capability[],
): Promise<boolean> {
  const hash = await hashCode(code, world)
  return (await read()).some(
    (a) => a.hash === hash && capabilities.every((c) => a.capabilities.includes(c)),
  )
}

function sameSet(a: Capability[], b: Capability[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c))
}

/**
 * Whether a JavaScript transform may be saved: its code is what is already
 * stored, or it is code that was approved.
 *
 * Unchanged code is let through so that renaming a transform does not need a
 * new review. Capabilities count as unchanged when they are a subset of the
 * stored ones, because dropping a capability (refusing it in the panel) allows
 * less than before.
 */
export async function mayBeSaved(
  stored: Transform | undefined,
  incoming: Transform,
): Promise<boolean> {
  const world = incoming.world ?? 'USER_SCRIPT'
  const unchanged =
    stored !== undefined &&
    stored.kind === 'js' &&
    stored.code === incoming.code &&
    (stored.world ?? 'USER_SCRIPT') === world &&
    incoming.capabilities.every((c) => stored.capabilities.includes(c))
  return unchanged || isApproved(incoming.code, incoming.world, incoming.capabilities)
}

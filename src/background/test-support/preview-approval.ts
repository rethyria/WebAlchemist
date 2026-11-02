/**
 * Test helper: completes a `preview-js` message with the fields the background
 * now requires, which are the address the sidebar expects and the approval
 * token of a model review that matched (#55).
 *
 * The approval record is written into the session store a test uses, in the
 * format approvals.ts reads, so no model call is made. A test of a refusal
 * passes `over` to change one field after the record was written.
 */

import { hashCode, type ApprovalVerdict } from '../approvals'

export interface PreviewMessageInput {
  type: 'preview-js'
  tabId: number
  transform: any
  expectedUrl?: string
  approvalToken?: string
}

export async function approvedPreviewMessage(
  session: Map<string, unknown>,
  message: PreviewMessageInput,
  tabUrl: string | undefined,
  verdict: ApprovalVerdict = 'match',
): Promise<PreviewMessageInput & { expectedUrl: string; approvalToken: string }> {
  const token = `token-${Math.random().toString(36).slice(2)}`
  const records = (session.get('wa-approvals') as unknown[] | undefined) ?? []
  records.push({
    token,
    transformId: message.transform.id,
    match: message.transform.match,
    hash: await hashCode(message.transform.code, message.transform.world, message.transform.configFields),
    capabilities: [...(message.transform.capabilities ?? [])],
    verdict,
    at: Date.now(),
  })
  session.set('wa-approvals', records)
  return {
    ...message,
    expectedUrl: message.expectedUrl ?? tabUrl ?? '',
    approvalToken: message.approvalToken ?? token,
  }
}

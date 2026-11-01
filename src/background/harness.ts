/**
 * Wraps a JS transform in the harness that makes it survive re-renders.
 *
 * Registered user scripts run once at document_idle. Sites built on React, Vue,
 * or similar reconcile the DOM afterwards and overwrite anything the transform
 * did, so re-application is required — and re-application is exactly what makes
 * idempotency mandatory rather than merely good practice.
 *
 * The observer is scoped to a landmark near the target rather than to
 * `document`. A document-wide subtree observer on a busy site fires thousands
 * of times per second, and re-running every transform on each is a visible
 * performance problem on precisely the heavy sites that need transforms most.
 */

import type { Transform } from '@shared/types'
import { errorAttributeName } from '@shared/script-errors'

function jsString(value: string): string {
  return JSON.stringify(value)
}

export function wrapTransform(transform: Transform): string {
  const scopeCandidates = [
    ...transform.anchor.landmarks,
    'main',
    'body',
  ].map(jsString)

  return `(() => {
  'use strict';
  const NAME = ${jsString(transform.name)};
  const SCOPES = [${scopeCandidates.join(', ')}];
  // Where the last error is recorded for the content script to read. The page
  // can read and forge it, so it is for diagnostics only (see script-errors.ts).
  const ERROR_ATTRIBUTE = ${jsString(errorAttributeName(transform.id))};

  const apply = () => {
    try {
      // The code runs in its own function so that an early return ends only
      // the code, not the clearing step below, and so that a top-level let or
      // const in the code cannot shadow the names this wrapper uses.
      (() => {
${transform.code}
      })();
      // A run that finishes clears an earlier error, so a failure that a later
      // run fixes is not reported.
      try { document.documentElement.removeAttribute(ERROR_ATTRIBUTE); } catch (_) {}
    } catch (error) {
      console.error('[Web Alchemist] transform failed:', NAME, error);
      try {
        const text = String((error && error.message) || error);
        document.documentElement.setAttribute(ERROR_ATTRIBUTE, text.slice(0, 500));
      } catch (_) { /* the document cannot be written; the console line remains */ }
    }
  };

  // Coalesce bursts of mutations into one application per frame. Without this,
  // a re-render that touches 200 nodes would run the transform 200 times.
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  };

  const findScope = () => {
    for (const selector of SCOPES) {
      try {
        const found = document.querySelector(selector);
        if (found) return found;
      } catch (_) { /* selector no longer parses against this document */ }
    }
    return document.body;
  };

  apply();

  const scope = findScope();
  if (scope) {
    new MutationObserver(schedule).observe(scope, { childList: true, subtree: true });
  }
})();`
}

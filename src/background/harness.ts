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

import { pathMatcherFor } from '@shared/match'
import type { Transform } from '@shared/types'

function jsString(value: string): string {
  return JSON.stringify(value)
}

export function wrapTransform(transform: Transform): string {
  const scopeCandidates = [
    ...transform.anchor.landmarks,
    'main',
    'body',
  ].map(jsString)

  const matcher = pathMatcherFor(transform.match)

  return `(() => {
  'use strict';
  const NAME = ${jsString(transform.name)};
  const SCOPES = [${scopeCandidates.join(', ')}];

  /*
   * The path check that matchesUrl makes for the CSS side. A browser match
   * pattern compares the path together with the query, so a wildcard in the
   * pattern can match across the start of the query and register the script
   * on a page the CSS does not apply to. Running the same check here makes
   * the two agree. The host and scheme are already limited by the
   * registration.
   */
  const PATH_FORMS = ${JSON.stringify(matcher.forms)};
  const PATTERN_HAS_QUERY = ${matcher.hasQuery};
  const pathAgrees = () => {
    const path = location.pathname;
    const trimmed = path.replace(/\\/+$/, '') || '/';
    return PATH_FORMS.some((source) => [path, trimmed].some((form) =>
      new RegExp(source).test(PATTERN_HAS_QUERY ? form + location.search : form)));
  };
  if (!pathAgrees()) return;

  const apply = () => {
    try {
      ${transform.code}
    } catch (error) {
      console.error('[Web Alchemist] transform failed:', NAME, error);
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

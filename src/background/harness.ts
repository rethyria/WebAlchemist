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
import { errorAttributeName } from '@shared/script-errors'

function jsString(value: string): string {
  return JSON.stringify(value)
}

/**
 * `errorToken` is the random part of the error marker's name, made by
 * error-tokens.ts when the script is registered.
 */
export function wrapTransform(transform: Transform, errorToken: string): string {
  const scopeCandidates = [
    ...transform.anchor.landmarks,
    'main',
    'body',
  ].map(jsString)

  const scopeAttempts = scopeCandidates
    .map(
      (selector) => `    try {
      const found = document.querySelector(${selector});
      if (found) return found;
    } catch (_) { /* selector no longer parses against this document */ }`,
    )
    .join('\n')

  const matcher = pathMatcherFor(transform.match)
  const errorName = jsString(errorAttributeName(errorToken))

  return `(() => {
  'use strict';
  const NAME = ${jsString(transform.name)};
  // The last error is recorded in an attribute for the content script to read.
  // The page can read and forge it, so it is for diagnostics only (see
  // script-errors.ts). The attribute name is written out at each use and is
  // not held in a variable: the static analysis refuses a name that is decided
  // while running, and this code is checked as well.

  // True only after this script wrote the marker. A successful run touches the
  // attribute only then: removing it on every run would let a page that
  // watches removeAttribute see the name on every run.
  let wroteMarker = false;

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
      // The code runs in its own function so that an early return ends only
      // the code, not the clearing step below, and so that a top-level let or
      // const in the code cannot shadow the names this wrapper uses.
      (() => {
${transform.code}
      })();
      // A run that finishes clears an earlier error, so a failure that a later
      // run fixes is not reported.
      if (wroteMarker) {
        wroteMarker = false;
        try { document.documentElement.removeAttribute(${errorName}); } catch (_) {}
      }
    } catch (error) {
      console.error('[Web Alchemist] transform failed:', NAME, error);
      try {
        const text = String((error && error.message) || error);
        document.documentElement.setAttribute(${errorName}, text.slice(0, 500));
        wroteMarker = true;
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

  // One written-out selector per attempt: the static analysis refuses a
  // selector that is not written out, and this code is checked as well.
  const findScope = () => {
${scopeAttempts}
    return document.body;
  };

  apply();

  const scope = findScope();
  if (scope) {
    new MutationObserver(schedule).observe(scope, { childList: true, subtree: true });
  }
})();`
}

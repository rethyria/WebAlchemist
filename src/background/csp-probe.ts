/**
 * The transform used to verify the user script world CSP.
 *
 * This is a normal transform in every respect — it goes through
 * `registerTransform`, so it gets the same world, the same
 * `cspForCapabilities` output, and the same harness as anything the model
 * writes. A probe that took a shortcut would be testing the shortcut.
 *
 * `capabilities` is empty, which is the case that matters: an undeclared
 * transform must not be able to reach the network at all.
 */

import type { Transform } from '@shared/types'

export const PROBE_ORIGIN = 'http://localhost:8787/*'
const TARGET = 'http://localhost:8787/egress'

/*
 * Each attempt is wrapped so one failing synchronously does not stop the
 * rest. What is recorded here is only diagnostic — the server decides the
 * verdict by observing which requests actually arrive.
 */
const PROBE_CODE = `
const target = ${JSON.stringify(TARGET)};
const seen = {};
const note = (name, value) => { seen[name] = String(value); };
const url = (via) => target + '?via=' + via;

try { fetch(url('fetch')).then(() => note('fetch', 'resolved'), (e) => note('fetch', e.name + ': ' + e.message)); }
catch (e) { note('fetch', 'threw ' + e.name); }

try {
  const xhr = new XMLHttpRequest();
  xhr.onload = () => note('xhr', 'loaded');
  xhr.onerror = () => note('xhr', 'error event');
  xhr.open('GET', url('xhr'));
  xhr.send();
} catch (e) { note('xhr', 'threw ' + e.name); }

try {
  const ws = new WebSocket('ws://localhost:8787/egress?via=websocket');
  ws.onopen = () => note('websocket', 'opened');
  ws.onerror = () => note('websocket', 'error event');
} catch (e) { note('websocket', 'threw ' + e.name); }

try { note('beacon', navigator.sendBeacon(url('beacon')) ? 'queued' : 'refused'); }
catch (e) { note('beacon', 'threw ' + e.name); }

try {
  const es = new EventSource(url('eventsource'));
  es.onopen = () => note('eventsource', 'opened');
  es.onerror = () => note('eventsource', 'error event');
} catch (e) { note('eventsource', 'threw ' + e.name); }

try {
  const img = new Image();
  img.onload = () => note('image', 'loaded');
  img.onerror = () => note('image', 'error event');
  img.src = url('image');
} catch (e) { note('image', 'threw ' + e.name); }

// Give the asynchronous attempts a moment to settle, then publish through the
// DOM — the only channel to the page, which reports to the server.
setTimeout(() => {
  const node = document.getElementById('wa-csp-results');
  if (node) node.textContent = JSON.stringify(seen, null, 2);
}, 2500);
`

export function buildProbeTransform(): Transform {
  const now = Date.now()
  return {
    id: 'wa-csp-probe',
    name: 'CSP probe',
    enabled: true,
    order: now,
    match: 'localhost:8787/*',
    kind: 'js',
    origin: 'manual',
    world: 'USER_SCRIPT',
    // The whole point. Nothing declared means nothing permitted.
    capabilities: [],
    intent: 'Attempt every form of network egress, to prove the world CSP blocks them.',
    rationale: {
      targets: 'The probe page at localhost:8787.',
      approach: 'Fires fetch, XHR, WebSocket, sendBeacon, EventSource and an image load.',
      assumptions: ['The verification server is listening on port 8787.'],
    },
    anchor: {
      tag: 'body',
      classes: [],
      path: 'body',
      landmarks: ['body'],
      selector: 'body',
    },
    code: PROBE_CODE,
    createdAt: now,
    updatedAt: now,
  }
}

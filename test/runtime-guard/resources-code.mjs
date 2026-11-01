/**
 * The code that runs in the world for resources.mjs (#139): routes that load a
 * resource or reach a page object and that are not features of the window by
 * name. Each entry records whether the route could be used from the world, and
 * the server's log says whether a request left.
 */
export const REPORT_ATTRIBUTE = 'data-wa-rg'
export const SERVER = 'http://localhost:8791'

export const RESOURCE_MEASURE = `(async () => {
const out = {};
const B = ${JSON.stringify(SERVER)} + '/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = async (name, fn) => { try { out[name] = 'works: ' + String(await fn()) } catch (e) { out[name] = 'blocked: ' + (e && e.name) } };
const viaFetch = (W, tag) => { W.fetch(B + 'x?via=' + tag).catch(() => {}); return 'fetch called' };

// Page objects reached through the Xray waiver, and the sandbox helpers.
await t('waiver: document', () => viaFetch(document.wrappedJSObject.defaultView, 'waiver_document'));
await t('waiver: navigator', () => navigator.wrappedJSObject.sendBeacon(B + 'x?via=waiver_navigator'));
await t('waiver: location', () => typeof location.wrappedJSObject);
await t('waiver: history', () => typeof history.wrappedJSObject);
await t('waiver: prototype of Node', () => Node.prototype.wrappedJSObject.constructor.constructor('return 9')());
await t('waiver: body element, reaching its window', () => viaFetch(document.body.wrappedJSObject.ownerDocument.defaultView, 'waiver_body'));
await t('waiver: body element, reaching the page Function', () => document.body.wrappedJSObject.constructor.constructor('return 10')());
await t('waiver: new element', () => viaFetch(document.createElement('div').wrappedJSObject.ownerDocument.defaultView, 'waiver_newelement'));
await t('waiver: target of an event', () => { let r = 'no event'; document.body.addEventListener('wa-w', (e) => { try { r = viaFetch(e.target.wrappedJSObject.ownerDocument.defaultView, 'waiver_event') } catch (x) { r = 'threw ' + x.name } }); document.body.dispatchEvent(new Event('wa-w')); if (r.startsWith('threw')) throw new Error(r); return r });
await t('waiver: XPCNativeWrapper.unwrap(document)', () => viaFetch(XPCNativeWrapper.unwrap(document).defaultView, 'waiver_xpc'));
await t('helper: exportFunction', () => typeof exportFunction);
await t('helper: cloneInto', () => typeof cloneInto);
await t('helper: createObjectIn', () => typeof createObjectIn);
await t('helper: importFunction', () => typeof importFunction);
await t('helper: Components', () => typeof Components);
await t('helper: XPCNativeWrapper', () => typeof XPCNativeWrapper);

// Loads that the world's CSP does not stop.
await t('FontFace loaded', async () => { const f = new FontFace('wafont', 'url(' + B + 'font.woff2?via=fontface)'); await Promise.race([f.load().catch(() => {}), sleep(1500)]); return f.status });
await t('audioWorklet.addModule', async () => { const c = new AudioContext(); await Promise.race([c.audioWorklet.addModule(B + 'worklet.js?via=audioworklet').catch(() => {}), sleep(1500)]); return 'called' });
await t('navigator.storage.getDirectory (origin private file system)', async () => { const d = await navigator.storage.getDirectory(); const f = await d.getFileHandle('wa-opfs', { create: true }); const w = await f.createWritable(); await w.write('x'); await w.close(); await d.removeEntry('wa-opfs'); return 'wrote a file' });
await t('form.submit()', () => { const f = document.createElement('form'); f.action = B + 'form?via=form_submit'; f.method = 'POST'; f.target = 'wa_existing'; document.body.appendChild(f); f.submit(); return 'submitted' });
await sleep(600);
await t('form.requestSubmit()', () => { const f = document.createElement('form'); f.action = B + 'form?via=form_requestsubmit'; f.method = 'POST'; f.target = 'wa_existing'; document.body.appendChild(f); f.requestSubmit(); return 'submitted' });
await sleep(600);
await t('click on a submit button', () => { const f = document.createElement('form'); f.action = B + 'form?via=form_click'; f.method = 'POST'; f.target = 'wa_existing'; const b = document.createElement('button'); b.type = 'submit'; f.appendChild(b); document.body.appendChild(f); b.click(); return 'clicked' });
await t('video poster', () => { const v = document.createElement('video'); v.poster = B + 'p.png?via=poster'; document.body.appendChild(v); return 'inserted' });
await t('link rel=modulepreload', () => { const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = B + 'm.js?via=modulepreload'; document.head.appendChild(l); return 'inserted' });
await t('link rel=prefetch', () => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = B + 'x?via=prefetch'; document.head.appendChild(l); return 'inserted' });
await sleep(1500);
document.documentElement.setAttribute(${JSON.stringify(REPORT_ATTRIBUTE)}, JSON.stringify(out));
})()`

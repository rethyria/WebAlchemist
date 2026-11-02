/**
 * The code that runs in the world for styles.mjs (#139, requests made by
 * stylesheet text). Each route puts CSS that loads an address into a document by
 * one path. The CSS is `#wa_<tag> { background-image: url(<server>?via=<tag>) }`
 * for an element with that id, so the server's log, and not this code, says
 * whether the browser asked for the address. A route that throws is refused; a
 * route that does not throw may still not have sent a request, which is why the
 * server is the oracle.
 */
export const REPORT_ATTRIBUTE = 'data-wa-rg'

export const styleMeasure = (prefix = '', via = 's', attribute = REPORT_ATTRIBUTE) => `(async () => {
${prefix}
const out = { routes: {}, forms: {}, guardMs: typeof globalThis.__guardMs === 'number' ? globalThis.__guardMs : null };
const B = 'http://localhost:8791/s?via=${via}_';
const describe = (e) => (e && e.name) + ': ' + String(e && e.message).slice(0, 40);
const NS_SVG = 'http://www.w3.org/2000/svg';
const target = (tag) => { const d = document.createElement('div'); d.id = 'wa_' + tag; d.style.width = '12px'; d.style.height = '12px'; d.textContent = 'x'; document.body.appendChild(d); return d };
const urlCss = (tag) => '#wa_' + tag + ' { background-image: url(' + B + tag + ') }';
const benign = (tag) => '#wa_' + tag + ' { width: 12px; height: 12px }';
const route = (name, fn) => { const tag = name; target(tag); try { fn(tag); out.routes[name] = 'no error' } catch (e) { out.routes[name] = 'refused (' + describe(e) + ')' } };
const styleIn = (css) => { const s = document.createElement('style'); if (css !== undefined) s.textContent = css; document.head.appendChild(s); return s };
const ruleOf = (tag) => { const s = styleIn(benign(tag)); return s.sheet.cssRules[0] };

// Text paths of a style element.
route('s_textContent', (t) => { styleIn().textContent = urlCss(t) });
route('s_innerHTML', (t) => { styleIn().innerHTML = urlCss(t) });
route('s_innerText', (t) => { styleIn().innerText = urlCss(t) });
route('s_appendChild_text', (t) => { styleIn().appendChild(document.createTextNode(urlCss(t))) });
route('s_append_string', (t) => { styleIn().append(urlCss(t)) });
route('s_prepend_string', (t) => { styleIn().prepend(urlCss(t)) });
route('s_insertAdjacentText', (t) => { styleIn().insertAdjacentText('beforeend', urlCss(t)) });
route('s_replaceChildren', (t) => { styleIn(benign(t)).replaceChildren(urlCss(t)) });
route('s_insertBefore_text', (t) => { styleIn(benign(t)).insertBefore(document.createTextNode(urlCss(t)), null) });
route('s_replaceChild_text', (t) => { const s = styleIn(benign(t)); s.replaceChild(document.createTextNode(urlCss(t)), s.firstChild) });
route('s_text_data', (t) => { styleIn(benign(t)).firstChild.data = urlCss(t) });
route('s_text_nodeValue', (t) => { styleIn(benign(t)).firstChild.nodeValue = urlCss(t) });
route('s_text_textContent', (t) => { styleIn(benign(t)).firstChild.textContent = urlCss(t) });
route('s_text_appendData', (t) => { styleIn(benign(t)).firstChild.appendData(' ' + urlCss(t)) });
route('s_text_insertData', (t) => { styleIn(benign(t)).firstChild.insertData(0, urlCss(t) + ' ') });
route('s_text_replaceData', (t) => { const n = styleIn(benign(t)).firstChild; n.replaceData(0, n.length, urlCss(t)) });
route('s_text_replaceWith_string', (t) => { styleIn(benign(t)).firstChild.replaceWith(urlCss(t)) });
route('s_text_after_string', (t) => { styleIn(benign(t)).firstChild.after(urlCss(t)) });
route('s_text_before_string', (t) => { styleIn(benign(t)).firstChild.before(urlCss(t)) });
route('s_range_insertNode', (t) => { const s = styleIn(benign(t)); const r = document.createRange(); r.selectNodeContents(s); r.insertNode(document.createTextNode(urlCss(t))) });
route('s_text_splitText_then_data', (t) => { const n = styleIn(benign(t)).firstChild; const m = n.splitText(n.length); m.data = urlCss(t) });
route('s_built_before_insertion', (t) => { const s = document.createElement('style'); s.textContent = urlCss(t); document.head.appendChild(s) });
route('s_built_before_insertion_via_append_node', (t) => { const s = document.createElement('style'); s.appendChild(document.createTextNode(urlCss(t))); document.body.append(s) });
route('s_cloneNode_of_a_style_with_text', (t) => { const s = document.createElement('style'); s.appendChild(document.createTextNode('/* ' + t + ' */')); const c = s.cloneNode(true); c.firstChild.data = urlCss(t); document.head.appendChild(c) });
route('s_svg_style_textContent', (t) => { const s = document.createElementNS(NS_SVG, 'style'); s.textContent = urlCss(t); document.documentElement.appendChild(s) });
route('s_existing_page_style_append', (t) => { const s = document.getElementById('pagestyle'); s.textContent += ' ' + urlCss(t) });
route('s_existing_page_style_appendChild', (t) => { document.getElementById('pagestyle').appendChild(document.createTextNode(' ' + urlCss(t))) });
route('s_shadow_style', (t) => { const h = document.createElement('div'); document.body.appendChild(h); const sr = h.attachShadow({ mode: 'open' }); const s = document.createElement('style'); s.textContent = '#wa_' + t + ' { background-image: url(' + B + t + ') }'; sr.appendChild(s); const i = document.createElement('div'); i.id = 'wa_' + t; i.style.width = '12px'; i.style.height = '12px'; sr.appendChild(i) });
// Markup that holds a style element.
route('m_innerHTML', (t) => { const h = document.createElement('div'); document.body.appendChild(h); h.innerHTML = '<style>' + urlCss(t) + '</style>' });
route('m_insertAdjacentHTML', (t) => { const h = document.createElement('div'); document.body.appendChild(h); h.insertAdjacentHTML('beforeend', '<style>' + urlCss(t) + '</style>') });
route('m_outerHTML', (t) => { const h = document.createElement('div'); document.body.appendChild(h); h.outerHTML = '<style>' + urlCss(t) + '</style>' });
route('m_createContextualFragment', (t) => { document.head.appendChild(document.createRange().createContextualFragment('<style>' + urlCss(t) + '</style>')) });
route('m_DOMParser_node_appended', (t) => { document.head.appendChild(new DOMParser().parseFromString('<head><style>' + urlCss(t) + '</style>', 'text/html').head.firstChild) });
route('m_template_content', (t) => { const tp = document.createElement('template'); tp.innerHTML = '<style>' + urlCss(t) + '</style>'; document.head.appendChild(tp.content) });
route('m_setHTMLUnsafe', (t) => { const h = document.createElement('div'); document.body.appendChild(h); h.setHTMLUnsafe('<style>' + urlCss(t) + '</style>') });
route('m_shadow_innerHTML', (t) => { const h = document.createElement('div'); document.body.appendChild(h); const sr = h.attachShadow({ mode: 'open' }); sr.innerHTML = '<style>' + urlCss(t) + '</style><div id="wa_' + t + '" style="width:12px;height:12px">x</div>' });
// The sheet's own text paths.
route('c_insertRule', (t) => { const s = styleIn(benign(t)); s.sheet.insertRule(urlCss(t), 0) });
route('c_insertRule_import', (t) => { const s = styleIn(benign(t)); s.sheet.insertRule('@import url(' + B + t + ');', 0) });
route('c_addRule_legacy', (t) => { const s = styleIn(benign(t)); s.sheet.addRule('#wa_' + t, 'background-image: url(' + B + t + ')') });
route('c_grouping_insertRule', (t) => { const s = styleIn('@media all { ' + benign(t) + ' }'); s.sheet.cssRules[0].insertRule(urlCss(t), 0) });
route('c_constructed_replaceSync', (t) => { const sh = new CSSStyleSheet(); sh.replaceSync(urlCss(t)); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh] });
route('c_constructed_replace', (t) => { const sh = new CSSStyleSheet(); sh.replace(urlCss(t)); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh] });
route('c_constructed_insertRule', (t) => { const sh = new CSSStyleSheet(); sh.insertRule(urlCss(t)); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh] });
route('c_constructed_in_shadow', (t) => { const h = document.createElement('div'); document.body.appendChild(h); const sr = h.attachShadow({ mode: 'open' }); const i = document.createElement('div'); i.id = 'wa_' + t; i.style.width = '12px'; i.style.height = '12px'; i.textContent = 'x'; sr.appendChild(i); const sh = new CSSStyleSheet(); sh.replaceSync(urlCss(t)); sr.adoptedStyleSheets = [sh] });
route('c_sheet_made_in_another_document', (t) => { const d = document.implementation.createHTMLDocument('x'); const s = d.createElement('style'); s.textContent = urlCss(t); d.head.appendChild(s); const sh = new CSSStyleSheet(); sh.replaceSync(s.textContent); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh] });
// A declaration of a rule that is already in a sheet.
route('d_setProperty', (t) => { ruleOf(t).style.setProperty('background-image', 'url(' + B + t + ')') });
route('d_cssText', (t) => { ruleOf(t).style.cssText = 'background-image: url(' + B + t + ')' });
route('d_property_setter', (t) => { ruleOf(t).style.backgroundImage = 'url(' + B + t + ')' });
route('d_shorthand_setter', (t) => { ruleOf(t).style.background = 'url(' + B + t + ')' });
route('d_custom_property', (t) => { const r = ruleOf(t); r.style.setProperty('--u', 'url(' + B + t + ')'); r.style.setProperty('background-image', 'var(--u)') });
route('m_inline_style_attribute_in_markup', (t) => { const h = document.createElement('div'); document.body.appendChild(h); h.innerHTML = '<div id="wa_' + t + 'x" style="width:12px;height:12px;background-image:url(' + B + t + ')">x</div>' });
// Less direct paths.
route('x_setter_from_descriptor', (t) => { Object.getOwnPropertyDescriptor(Node.prototype, 'textContent').set.call(styleIn(), urlCss(t)) });
route('x_execCommand_insertText', (t) => { const s = styleIn(benign(t)); s.contentEditable = 'true'; s.focus(); const r = document.createRange(); r.selectNodeContents(s); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('insertText', false, urlCss(t)) });
route('d_fontface_descriptor_src', (t) => { const s = styleIn('@font-face { font-family: wd_' + t + '; src: local(Arial) } #wa_' + t + ' { font-family: wd_' + t + ' }'); s.sheet.cssRules[0].style.src = 'url(' + B + t + ')' });
route('d_fontface_setProperty_src', (t) => { const s = styleIn('@font-face { font-family: wd_' + t + '; src: local(Arial) } #wa_' + t + ' { font-family: wd_' + t + ' }'); s.sheet.cssRules[0].style.setProperty('src', 'url(' + B + t + ')') });
route('d_keyframe_declaration', (t) => { const s = styleIn('@keyframes k_' + t + ' { from { width: 1px } to { width: 2px } } #wa_' + t + ' { animation: k_' + t + ' 10s }'); s.sheet.cssRules[0].cssRules[0].style.backgroundImage = 'url(' + B + t + ')' });
route('d_page_rule_or_nested', (t) => { const s = styleIn('#wa_' + t + ' { & span { color: red } }'); s.sheet.cssRules[0].cssRules[0].style.backgroundImage = 'url(' + B + t + ')' });
// Controls for the world's own policy: an inline style is governed by the world's CSP.
route('i_inline_style_cssText', (t) => { document.getElementById('wa_' + t).style.cssText = 'background-image: url(' + B + t + ')' });
route('i_inline_style_setAttribute', (t) => { document.getElementById('wa_' + t).setAttribute('style', 'background-image: url(' + B + t + ')') });
// Forms of the text, all through textContent.
const form = (name, css, extra) => { const tag = 'f_' + name; target(tag); try { const s = document.createElement('style'); s.textContent = css(tag); document.head.appendChild(s); if (extra) extra(tag); out.forms[name] = 'no error' } catch (e) { out.forms[name] = 'refused (' + describe(e) + ')' } };
form('url', (t) => '#wa_' + t + ' { background-image: url(' + B + t + ') }');
form('url_quoted', (t) => '#wa_' + t + " { background-image: url('" + B + t + "') }");
form('url_uppercase', (t) => '#wa_' + t + ' { background-image: URL(' + B + t + ') }');
form('import_url', (t) => '@import url(' + B + t + ');');
form('import_string', (t) => '@import "' + B + t + '";');
form('font_face', (t) => '@font-face { font-family: wf_' + t + '; src: url(' + B + t + ') } #wa_' + t + ' { font-family: wf_' + t + ' }');
form('image_set', (t) => '#wa_' + t + ' { background-image: image-set("' + B + t + '" 1x) }');
form('webkit_image_set', (t) => '#wa_' + t + ' { background-image: -webkit-image-set(url(' + B + t + ') 1x) }');
form('escape_in_url', (t) => '#wa_' + t + ' { background-image: u\\\\72l(' + B + t + ') }');
form('escape_in_import', (t) => '@\\\\69mport url(' + B + t + ');');
form('escape_in_import_string', (t) => '@\\\\69mport "' + B + t + '";');
form('list_style_image', (t) => '#wa_' + t + ' { list-style-image: url(' + B + t + ') }');
form('cursor', (t) => '#wa_' + t + ' { cursor: url(' + B + t + '), auto }');
form('content_url', (t) => '#wa_' + t + '::before { content: url(' + B + t + ') }');
form('split_over_two_writes', (t) => '@imp', (t) => { const s = document.head.lastElementChild; s.textContent += 'ort url(' + B + t + ');' });
form('split_over_two_text_nodes', (t) => '/* x */', (t) => { const s = document.head.lastElementChild; s.appendChild(document.createTextNode('@import url(' + B + t + ');')) });
form('data_url_only', (t) => '#wa_' + t + ' { background-image: url(data:image/gif;base64,R0lGODlhAQABAAAAACw=) }');
form('plain_rule', (t) => '#wa_' + t + ' { color: red; content: "\\\\201C" }');
await new Promise((r) => setTimeout(r, 2500));
document.documentElement.setAttribute(${JSON.stringify(attribute)}, JSON.stringify(out));
})()`

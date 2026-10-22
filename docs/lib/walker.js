// Runs inside a rendered page (headless Chrome, the web app's sandboxed iframe, or the bookmarklet).
// Walks every text node, decides whether a sighted person can see it, and groups the invisible
// text by the element that hides it. Self-contained so it can be shipped via toString().
export function scanDom(doc, score, opts) {
  opts = opts || {};
  const win = doc.defaultView;
  const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, TITLE: 1, META: 1, LINK: 1 };
  const segments = [];
  let visibleChars = 0;
  let hiddenChars = 0;
  const visibleParts = [];
  const styleCache = new Map();
  const cs = (el) => {
    let s = styleCache.get(el);
    if (!s) { s = win.getComputedStyle(el); styleCache.set(el, s); }
    return s;
  };
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  const meaningful = (t) => /[\p{L}\p{N}]{2,}/u.test(t);

  function path(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      let p = e.tagName.toLowerCase();
      if (e.id) { p += '#' + e.id; parts.unshift(p); break; }
      const cls = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      parts.unshift(p);
    }
    return parts.join(' > ');
  }
  function parseColor(c) {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
  }
  function lum(c) {
    const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function effectiveBg(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = cs(e);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null; // can't judge over images/gradients
      const c = parseColor(s.backgroundColor);
      if (c && c.a > 0.95) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  function visibleEl(el) {
    if (el.checkVisibility) return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = cs(e);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.opacity === '0') return false;
    }
    return true;
  }
  // Why is this element invisible (checkVisibility said no)? Returns [reason, hidingRoot].
  function whyInvisible(el) {
    let root = el;
    let reason = 'not rendered';
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = cs(e);
      if (s.display === 'none') { reason = 'display:none'; root = e; }
      else if (s.opacity === '0' && reason === 'not rendered') { reason = 'opacity:0'; root = e; }
      else if ((s.visibility === 'hidden' || s.visibility === 'collapse') && reason === 'not rendered') { reason = 'visibility:hidden'; root = e; }
      else if (s.contentVisibility === 'hidden' && reason === 'not rendered') { reason = 'content-visibility:hidden'; root = e; }
    }
    // Climb to the outermost element that is still hidden for the same cause, so one hidden
    // block becomes one finding.
    while (root.parentElement && root.parentElement !== doc.body && !visibleEl(root.parentElement)) root = root.parentElement;
    const det = root.closest && root.closest('details:not([open])');
    if (det) reason = (reason === 'not rendered' ? 'display:none' : reason) + ' (collapsed <details>)';
    else if (root.closest && root.closest('dialog:not([open])')) reason += ' (closed <dialog>)';
    else if (root.hasAttribute && root.hasAttribute('hidden')) reason += ' ([hidden] attribute)';
    return [reason, root];
  }
  function geometryReason(node, el) {
    const range = doc.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) return ['zero size', el];
    const r = range.getBoundingClientRect();
    const sx = win.scrollX, sy = win.scrollY;
    const de = doc.documentElement;
    const W = Math.max(de.scrollWidth, win.innerWidth), H = Math.max(de.scrollHeight, win.innerHeight);
    const L = r.left + sx, T = r.top + sy;
    if (L + r.width <= 0 || T + r.height <= 0 || L >= W || T >= H) return ['off-screen (' + Math.round(L) + ',' + Math.round(T) + ')', el];
    // Clipping by an ancestor with overflow != visible, or by clip / clip-path.
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (let e = el; e && e.nodeType === 1 && e !== doc.body; e = e.parentElement) {
      const s = cs(e);
      if (s.clip && /rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(s.clip) && s.position === 'absolute') return [srOnly(e) ? 'screen-reader-only' : 'clip:rect(0 0 0 0)', e];
      if (s.clipPath && /inset\(\s*(50|100)%|circle\(\s*0/.test(s.clipPath)) return [srOnly(e) ? 'screen-reader-only' : 'clip-path', e];
      if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const er = e.getBoundingClientRect();
        box = { l: Math.max(box.l, er.left), t: Math.max(box.t, er.top), r: Math.min(box.r, er.right), b: Math.min(box.b, er.bottom) };
        if (box.r - box.l < 1 || box.b - box.t < 1) {
          return [er.width <= 2 && er.height <= 2 ? (srOnly(e) ? 'screen-reader-only' : 'clipped to 1px box') : 'clipped by overflow:hidden', e];
        }
      }
    }
    return null;
  }
  function srOnly(e) {
    const c = (typeof e.className === 'string' ? e.className : '');
    return /\b(sr-only|visually-hidden|screen-reader|screenreader|a11y-hidden|assistive|offscreen|hidden-visually|u-hidden-visually|vh)\b/i.test(c);
  }
  function styleReason(el) {
    const s = cs(el);
    const fs = parseFloat(s.fontSize);
    if (fs < 3) return ['font-size ' + s.fontSize, el];
    const c = parseColor(s.color);
    if (c && c.a < 0.05) return ['transparent text', el];
    if (c) {
      const bg = effectiveBg(el);
      if (bg) {
        const l1 = lum(c), l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (ratio < 1.12) return ['text colour matches background (contrast ' + ratio.toFixed(2) + ':1)', el];
      }
    }
    if (s.transform && /matrix\(\s*0(\.0+)?,\s*0(\.0+)?,\s*0(\.0+)?,\s*0(\.0+)?/.test(s.transform)) return ['transform: scale(0)', el];
    return null;
  }

  const groups = new Map(); // root element -> segment
  const rootNode = doc.body || doc.documentElement;
  if (!rootNode) return { visibleChars: 0, hiddenChars: 0, segments: [], visibleText: opts.collectVisible ? '' : undefined, empty: true };
  const tw = doc.createTreeWalker(rootNode, 4 /* SHOW_TEXT */);
  let node;
  while ((node = tw.nextNode())) {
    const el = node.parentElement;
    if (!el) continue;
    let skip = false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) { if (SKIP[e.tagName.toUpperCase()]) { skip = true; break; } }
    if (skip) continue;
    const text = norm(node.data);
    if (!text) continue;
    let why = null;
    if (!visibleEl(el)) why = whyInvisible(el);
    else why = geometryReason(node, el) || styleReason(el);
    if (!why) {
      visibleChars += text.length;
      if (opts.collectVisible) visibleParts.push(text);
      continue;
    }
    hiddenChars += text.length;
    const [reason, root] = why;
    let g = groups.get(root);
    if (!g) { g = { reason, where: path(root), parts: [] }; groups.set(root, g); }
    g.parts.push(text);
  }
  for (const g of groups.values()) {
    const text = g.parts.join(' ');
    if (!meaningful(text)) continue;
    segments.push({ kind: 'hidden-text', reason: g.reason, where: g.where, text, chars: text.length, directive: score(text) });
  }
  // Text that never renders as page text but sits in the DOM: comments, noscript, templates,
  // and long human-language strings inside inline JSON / JS.
  const extra = [];
  const ctw = doc.createTreeWalker(doc.documentElement, 128 /* SHOW_COMMENT */);
  while ((node = ctw.nextNode())) {
    const t = norm(node.data);
    if (meaningful(t) && t.length >= 12) extra.push({ kind: 'comment', reason: 'HTML comment', where: node.parentElement ? path(node.parentElement) : 'document', text: t });
  }
  for (const el of Array.from(doc.querySelectorAll('noscript, template'))) {
    const t = norm(el.tagName === 'TEMPLATE' ? el.content.textContent : el.textContent.replace(/<[^>]+>/g, ' '));
    if (meaningful(t)) extra.push({ kind: el.tagName.toLowerCase(), reason: '<' + el.tagName.toLowerCase() + '>', where: path(el), text: t });
  }
  for (const el of Array.from(doc.querySelectorAll('script'))) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (el.src || /module/.test(type) && !el.textContent) continue;
    const src = el.textContent || '';
    if (src.length < 20) continue;
    const re = /"((?:[^"\\]|\\.){30,4000})"/g;
    let m;
    let n = 0;
    while ((m = re.exec(src)) && n < 5000) {
      n++;
      let t;
      try { t = JSON.parse('"' + m[1] + '"'); } catch (e) { continue; }
      t = norm(t.replace(/<[^>]+>/g, ' '));
      if (t.split(' ').length < 6 || !/[a-z一-鿿]/i.test(t) || /^(https?:|data:|[\w.$-]+\(|function\b)/.test(t)) continue;
      extra.push({ kind: 'script-string', reason: 'string inside <script' + (type ? ' type="' + type + '"' : '') + '>', where: path(el), text: t, onlyIfDirective: true });
    }
  }
  for (const el of Array.from(doc.querySelectorAll('[alt], [title], [aria-label], meta[name="description"], meta[property="og:description"]'))) {
    for (const a of ['alt', 'title', 'aria-label', 'content']) {
      const v = el.getAttribute(a);
      if (v && v.length >= 20) extra.push({ kind: 'attribute', reason: a + '="…" attribute', where: path(el), text: norm(v), onlyIfDirective: true });
    }
  }
  const hiddenTexts = segments.map((s) => s.text);
  for (const x of extra) {
    const d = score(x.text);
    if (x.onlyIfDirective && !d.directive) continue;
    // A script that builds a hidden element contains the same sentence; report it once.
    if (x.kind === 'script-string' && hiddenTexts.some((t) => t.includes(x.text))) continue;
    delete x.onlyIfDirective;
    segments.push(Object.assign(x, { chars: x.text.length, directive: d }));
  }
  return {
    visibleChars,
    hiddenChars,
    segments,
    visibleText: opts.collectVisible ? visibleParts.join('\n') : undefined,
  };
}

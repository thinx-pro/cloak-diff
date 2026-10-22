// Static mode: no browser. Parses the HTML, applies inline styles plus simple rules from <style>
// blocks, and reports text a browser would not show. Fast and dependency-free, but it cannot see
// external stylesheets, JavaScript-built DOM, or layout (use --render for those).
import { parseHtml } from './html.js';
import { directiveScore } from './directive.js';

const SR_CLASS = /\b(sr-only|visually-hidden|screen-reader|screenreader|a11y-hidden|assistive|hidden-visually|u-hidden-visually)\b/i;
const NOT_RENDERED = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'template']);

function parseDecls(s) {
  const out = {};
  for (const part of String(s || '').split(';')) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    const name = part.slice(0, k).trim().toLowerCase();
    const val = part.slice(k + 1).replace(/!important/i, '').trim().toLowerCase();
    if (name) out[name] = val;
  }
  return out;
}

function stripAtBlocks(css) {
  // Drop @media/@supports/@keyframes/... blocks entirely (responsive and print rules would be noise).
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@', i);
    if (at === -1) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const brace = css.indexOf('{', at);
    const semi = css.indexOf(';', at);
    if (semi !== -1 && (brace === -1 || semi < brace)) { i = semi + 1; continue; }
    if (brace === -1) break;
    let depth = 1;
    let j = brace + 1;
    for (; j < css.length && depth; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; }
    i = j;
  }
  return out;
}

function parseSelector(sel) {
  // Returns [{compound, combinator}] right-to-left, or null if unsupported.
  if (/[:~+*]/.test(sel)) return null;
  const tokens = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const parts = [];
  let comb = ' ';
  for (const t of tokens) {
    if (t === '>') { comb = '>'; continue; }
    const c = { tag: null, id: null, classes: [], attrs: [] };
    const re = /([#.]?)([\w-]+)|\[([\w-]+)(?:([~|^$*]?=)["']?([^"'\]]*)["']?)?\]/g;
    let m;
    let consumed = '';
    while ((m = re.exec(t))) {
      consumed += m[0];
      if (m[3]) c.attrs.push([m[3].toLowerCase(), m[4] || null, m[5]]);
      else if (m[1] === '#') c.id = m[2];
      else if (m[1] === '.') c.classes.push(m[2]);
      else c.tag = m[2].toLowerCase();
    }
    if (consumed.length !== t.length) return null;
    parts.push({ c, comb });
    comb = ' ';
  }
  return parts.reverse();
}

function matchCompound(el, c) {
  if (el.type !== 'element') return false;
  if (c.tag && el.tag !== c.tag) return false;
  if (c.id && el.attrs.id !== c.id) return false;
  if (c.classes.length) {
    const cls = ` ${(el.attrs.class || '').trim().split(/\s+/).join(' ')} `;
    for (const k of c.classes) if (!cls.includes(` ${k} `)) return false;
  }
  for (const [name, op, val] of c.attrs) {
    if (!(name in el.attrs)) return false;
    if (op === '=' && el.attrs[name] !== val) return false;
  }
  return true;
}

function matches(el, parts) {
  if (!matchCompound(el, parts[0].c)) return false;
  let e = el;
  for (let k = 1; k < parts.length; k++) {
    const comb = parts[k - 1].comb;
    if (comb === '>') {
      e = e.parent;
      if (!e || !matchCompound(e, parts[k].c)) return false;
    } else {
      e = e.parent;
      while (e && !matchCompound(e, parts[k].c)) e = e.parent;
      if (!e) return false;
    }
  }
  return true;
}

function collectRules(doc) {
  const rules = [];
  const walk = (n) => {
    if (n.type !== 'element') return;
    if (n.tag === 'style') {
      const css = stripAtBlocks((n.children[0]?.text || '').replace(/\/\*[\s\S]*?\*\//g, ''));
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m;
      while ((m = re.exec(css))) {
        const decls = parseDecls(m[2]);
        if (!Object.keys(decls).length) continue;
        for (const s of m[1].split(',')) {
          const parts = parseSelector(s);
          if (parts && parts.length) rules.push({ parts, decls, sel: s.trim() });
        }
      }
    }
    n.children.forEach(walk);
  };
  walk(doc);
  return rules;
}

const px = (v) => {
  const m = /^(-?[\d.]+)(px|em|rem|%)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'em' || m[2] === 'rem' ? n * 16 : n;
};

function colorKey(v) {
  if (!v) return null;
  v = v.replace(/\s+/g, '');
  const named = { white: '#ffffff', black: '#000000', '#fff': '#ffffff', '#000': '#000000' };
  if (named[v]) return named[v];
  const m = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/.exec(v);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return 'transparent';
    return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
  }
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('');
  return v;
}

function hidingReason(el, style) {
  const a = el.attrs;
  if ('hidden' in a && a.hidden !== 'until-found') return '[hidden] attribute';
  if (style.display === 'none') return 'display:none';
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return 'visibility:hidden';
  if (style.opacity !== undefined && parseFloat(style.opacity) === 0) return 'opacity:0';
  if (style['content-visibility'] === 'hidden') return 'content-visibility:hidden';
  const fs = px(style['font-size']);
  if (fs !== null && fs < 3 && !/%/.test(style['font-size'])) return 'font-size ' + style['font-size'];
  if (colorKey(style.color) === 'transparent') return 'transparent text';
  if (/rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(style.clip || '')) return SR_CLASS.test(a.class || '') ? 'screen-reader-only' : 'clip:rect(0 0 0 0)';
  if (/inset\(\s*(50|100)%|circle\(\s*0/.test(style['clip-path'] || '')) return SR_CLASS.test(a.class || '') ? 'screen-reader-only' : 'clip-path';
  if (/^(absolute|fixed)$/.test(style.position || '')) {
    for (const k of ['left', 'top', 'right']) {
      const v = px(style[k]);
      if (v !== null && v <= -500) return `off-screen (${k}: ${style[k]})`;
    }
  }
  const ti = px(style['text-indent']);
  if (ti !== null && ti <= -500) return `off-screen (text-indent: ${style['text-indent']})`;
  const w = px(style.width), h = px(style.height), mh = px(style['max-height']);
  const clipsOverflow = /hidden|clip/.test(style.overflow || '');
  if (clipsOverflow && ((w !== null && w <= 1) || (h !== null && h <= 1) || (mh !== null && mh <= 1))) return SR_CLASS.test(a.class || '') ? 'screen-reader-only' : 'clipped to 1px box';
  if (/scale\(\s*0(\.0+)?\s*\)/.test(style.transform || '')) return 'transform: scale(0)';
  return null;
}

function where(el) {
  const parts = [];
  for (let e = el; e && e.tag !== '#document' && parts.length < 4; e = e.parent) {
    let p = e.tag;
    if (e.attrs.id) { parts.unshift(p + '#' + e.attrs.id); break; }
    const cls = (e.attrs.class || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) p += '.' + cls.join('.');
    parts.unshift(p);
  }
  return parts.join(' > ');
}

const norm = (t) => t.replace(/\s+/g, ' ').trim();
const meaningful = (t) => /[\p{L}\p{N}]{2,}/u.test(t);

export function scanHtmlStatic(html, opts = {}) {
  const doc = parseHtml(html);
  const rules = collectRules(doc);
  const groups = new Map();
  const visible = [];
  let visibleChars = 0;
  let hiddenChars = 0;
  const extras = [];

  // Index rules by the rightmost compound's id / first class / tag so each element only
  // tests plausible rules. Source order is kept by sorting candidate indexes.
  const index = new Map();
  rules.forEach((r, i) => {
    const c = r.parts[0].c;
    const key = c.id ? 'id:' + c.id : c.classes.length ? 'cls:' + c.classes[0] : c.tag ? 'tag:' + c.tag : '*';
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(i);
  });
  const styleOf = (el) => {
    const s = {};
    const keys = ['*', 'tag:' + el.tag];
    if (el.attrs.id) keys.push('id:' + el.attrs.id);
    for (const k of (el.attrs.class || '').trim().split(/\s+/)) if (k) keys.push('cls:' + k);
    const cand = [];
    for (const k of keys) { const l = index.get(k); if (l) cand.push(...l); }
    cand.sort((x, y) => x - y);
    for (const i of cand) if (matches(el, rules[i].parts)) Object.assign(s, rules[i].decls);
    Object.assign(s, parseDecls(el.attrs.style));
    return s;
  };

  // hidden: { reason, root } inherited from the nearest hiding ancestor.
  // bg: nearest declared background colour, for same-colour text.
  const walk = (node, hidden, bg) => {
    if (node.type === 'comment') {
      const t = norm(node.text);
      if (meaningful(t) && t.length >= 12) extras.push({ kind: 'comment', reason: 'HTML comment', where: node.parent ? where(node.parent) : 'document', text: t });
      return;
    }
    if (node.type === 'text') {
      const t = norm(node.text);
      if (!t) return;
      if (hidden) {
        hiddenChars += t.length;
        let g = groups.get(hidden.root);
        if (!g) { g = { reason: hidden.reason, where: where(hidden.root), parts: [] }; groups.set(hidden.root, g); }
        g.parts.push(t);
      } else {
        visibleChars += t.length;
        visible.push(t);
      }
      return;
    }
    if (node.type !== 'element') return;
    const tag = node.tag;
    if (tag === 'script') {
      scriptStrings(node, extras);
      return;
    }
    if (tag === 'noscript' || tag === 'template') {
      const t = norm(collectText(node).replace(/<[^>]+>/g, ' '));
      if (meaningful(t)) extras.push({ kind: tag, reason: `<${tag}>`, where: where(node), text: t });
      return;
    }
    if (tag !== '#document' && NOT_RENDERED.has(tag)) {
      if (tag === 'head') node.children.forEach((c) => c.type !== 'text' && walk(c, hidden, bg));
      return;
    }
    for (const a of ['alt', 'title', 'aria-label']) {
      if (node.attrs[a] && node.attrs[a].length >= 20) extras.push({ kind: 'attribute', reason: `${a}="…" attribute`, where: where(node), text: norm(node.attrs[a]), onlyIfDirective: true });
    }
    if (tag === 'meta' && /description/.test(node.attrs.name || node.attrs.property || '') && node.attrs.content) {
      extras.push({ kind: 'attribute', reason: 'content="…" attribute', where: where(node), text: norm(node.attrs.content), onlyIfDirective: true });
    }
    let h = hidden;
    let b = bg;
    if (!h && tag !== '#document') {
      const style = styleOf(node);
      if (style['background-color'] || style.background) {
        const c = colorKey(style['background-color'] || (/^#[0-9a-f]{3,6}$|^rgb|^(white|black)$/.test(style.background || '') ? style.background : null));
        if (c && c !== 'transparent') b = c;
      }
      const r = hidingReason(node, style);
      if (r) h = { reason: r, root: node };
      else if (style.color && b && colorKey(style.color) === b) h = { reason: `text colour matches background (${b})`, root: node };
      if (tag === 'dialog' && !('open' in node.attrs)) h = { reason: 'display:none (closed <dialog>)', root: node };
    }
    if (tag === 'details' && !('open' in node.attrs) && !h) {
      for (const c of node.children) {
        if (c.type === 'element' && c.tag === 'summary') walk(c, h, b);
        else walk(c, { reason: 'display:none (collapsed <details>)', root: node }, b);
      }
      return;
    }
    for (const c of node.children) walk(c, h, b);
  };
  walk(doc, null, null);

  const segments = [];
  for (const g of groups.values()) {
    const text = g.parts.join(' ');
    if (!meaningful(text)) continue;
    segments.push({ kind: 'hidden-text', reason: g.reason, where: g.where, text, chars: text.length, directive: directiveScore(text) });
  }
  for (const x of extras) {
    const d = directiveScore(x.text);
    if (x.onlyIfDirective && !d.directive) continue;
    delete x.onlyIfDirective;
    segments.push({ ...x, chars: x.text.length, directive: d });
  }
  return { mode: 'static', visibleChars, hiddenChars, segments, visibleText: opts.collectVisible ? visible.join('\n') : undefined };
}

function collectText(node) {
  if (node.type === 'text') return node.text;
  if (node.type !== 'element') return '';
  return node.children.map(collectText).join(' ');
}

function scriptStrings(node, extras) {
  const type = (node.attrs.type || '').toLowerCase();
  if (node.attrs.src) return;
  const src = node.children[0]?.text || '';
  if (src.length < 20) return;
  const re = /"((?:[^"\\]|\\.){30,4000})"/g;
  let m;
  let n = 0;
  while ((m = re.exec(src)) && n < 5000) {
    n++;
    let t;
    try { t = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    t = norm(t.replace(/<[^>]+>/g, ' '));
    if (t.split(' ').length < 6 || !/[a-z一-鿿]/i.test(t) || /^(https?:|data:|[\w.$-]+\(|function\b)/.test(t)) continue;
    extras.push({ kind: 'script-string', reason: `string inside <script${type ? ` type="${type}"` : ''}>`, where: where(node), text: t, onlyIfDirective: true });
  }
}

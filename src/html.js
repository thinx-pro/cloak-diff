// A small, forgiving HTML parser: enough structure to know which text sits inside which
// element, with attributes, comments and raw-text elements. Not a spec-complete HTML5 parser.

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'plaintext']);
// Opening one of these closes an open <p>/<li>/... the way browsers do.
const AUTO_CLOSE = {
  p: new Set('address article aside blockquote details div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul'.split(' ')),
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  option: new Set(['option', 'optgroup']),
  tr: new Set(['tr']),
  td: new Set(['td', 'th', 'tr']),
  th: new Set(['td', 'th', 'tr']),
};

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•', trade: '™', laquo: '«', raquo: '»', zwj: '‍', zwnj: '‌' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    const v = ENT[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function parseHtml(html) {
  const root = { type: 'element', tag: '#document', attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  const n = html.length;
  const push = (node) => { node.parent = cur; cur.children.push(node); };
  const close = (tag) => {
    for (let e = cur; e && e !== root; e = e.parent) {
      if (e.tag === tag) { cur = e.parent; return; }
    }
  };
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { push({ type: 'text', text: decodeEntities(html.slice(i)) }); break; }
    if (lt > i) push({ type: 'text', text: decodeEntities(html.slice(i, lt)) });
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const stop = end === -1 ? n : end;
      push({ type: 'comment', text: html.slice(lt + 4, stop) });
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const tag = html.slice(lt + 2, end === -1 ? n : end).trim().toLowerCase().split(/\s/)[0];
      if (tag) close(tag);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const m = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) { push({ type: 'text', text: '<' }); i = lt + 1; continue; }
    // Find the end of the tag, respecting quoted attribute values.
    let j = lt + m[0].length;
    let q = null;
    for (; j < n; j++) {
      const c = html[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    const tag = m[1].toLowerCase();
    const inner = html.slice(lt + m[0].length, j);
    const selfClosing = /\/\s*$/.test(inner);
    const el = { type: 'element', tag, attrs: parseAttrs(inner.replace(/\/\s*$/, '')), children: [], parent: null };
    i = j + 1;
    const ac = AUTO_CLOSE;
    for (const open of Object.keys(ac)) {
      if (ac[open].has(tag)) {
        // only close if the open element is the current one or its direct ancestor chain up to a block
        for (let e = cur; e && e !== root; e = e.parent) {
          if (e.tag === open) { cur = e.parent; break; }
          if (/^(div|section|article|ul|ol|table|tbody|body|td|th|li|dl)$/.test(e.tag)) break;
        }
      }
    }
    push(el);
    if (VOID.has(tag) || selfClosing) continue;
    if (RAW.has(tag)) {
      const endRe = new RegExp('</' + tag + '\\s*>', 'i');
      const rest = html.slice(i);
      const em = endRe.exec(rest);
      const body = em ? rest.slice(0, em.index) : rest;
      el.children.push({ type: 'text', text: tag === 'script' || tag === 'style' ? body : decodeEntities(body), parent: el, raw: true });
      i = em ? i + em.index + em[0].length : n;
      continue;
    }
    cur = el;
  }
  return root;
}

export function textOf(node) {
  if (node.type === 'text') return node.text;
  if (node.type !== 'element') return '';
  return node.children.map(textOf).join(node.tag === 'br' ? '\n' : '');
}

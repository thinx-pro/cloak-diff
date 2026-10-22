// Generate README screenshots with headless Chrome and check the web app for console errors.
// Usage: node scripts/screenshot.js <docs-base-url>   (e.g. http://127.0.0.1:8765/ while serving docs/)
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withPage } from '../src/render.js';
import { bookmarkletSource } from '../docs/bookmarklet.js';

const base = process.argv[2] || 'http://127.0.0.1:8765/';
const p = (rel) => fileURLToPath(new URL('../' + rel, import.meta.url));
const save = (rel, b64) => { writeFileSync(p(rel), Buffer.from(b64, 'base64')); console.log('wrote', rel); };

async function shotOf(send, selector) {
  const r = await send('Runtime.evaluate', { expression: `JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`, returnByValue: true });
  const b = JSON.parse(r.result.value);
  const pad = 0;
  return (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad, scale: 1 } })).data;
}

// 1. Web app with the example loaded, desktop and phone widths.
for (const [w, h, name] of [[1280, 1150, 'assets/web.png'], [375, 1800, 'assets/web-mobile.png']]) {
  await withPage(base + '#example', { width: w, height: h, wait: 2500 }, async ({ send, errors }) => {
    const r = await send('Runtime.evaluate', { expression: 'JSON.stringify({stat: document.querySelector(".stat")?.textContent, bad: document.querySelectorAll(".seg.bad").length, overflow: document.documentElement.scrollWidth > window.innerWidth})', returnByValue: true });
    console.log(name, r.result.value, 'console errors:', JSON.stringify(errors));
    await send('Runtime.evaluate', { expression: 'document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)' });
    await new Promise((res) => setTimeout(res, 200));
    save(name, (await send('Page.captureScreenshot', { format: 'png' })).data);
  });
}

// 2. Bookmarklet panel on the example page.
await withPage(pathToFileURL(p('examples/hidden-instructions.html')).href, { width: 1280, height: 760, wait: 300 }, async ({ send, errors }) => {
  const src = decodeURIComponent(bookmarkletSource().slice('javascript:'.length));
  const r = await send('Runtime.evaluate', { expression: src });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  await new Promise((res) => setTimeout(res, 300));
  console.log('bookmarklet console errors:', JSON.stringify(errors));
  save('assets/bookmarklet.png', (await send('Page.captureScreenshot', { format: 'png' })).data);
});

// 3. CLI output rendered as a terminal window.
const bin = p('bin/cloak-diff.js');
const run = spawnSync(process.execPath, [bin, p('examples/hidden-instructions.html'), '--static'], { env: { PATH: process.env.PATH, FORCE_COLOR: '1' }, encoding: 'utf8' });
const out = run.stdout.replace(p('examples/hidden-instructions.html'), 'examples/hidden-instructions.html').replace(/\d+\.\d s\)/, '0.0 s)');
const COLORS = { 31: '#ff7b72', 32: '#56d364', 33: '#e3b341', 35: '#d2a8ff', 36: '#79c0ff' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let html = '';
let open = 0;
for (const part of out.split(/(\x1b\[[0-9;]*m)/)) {
  const m = part.match(/^\x1b\[([0-9;]*)m$/);
  if (!m) { html += esc(part); continue; }
  const code = Number(m[1]);
  if (code === 0) { html += '</span>'.repeat(open); open = 0; continue; }
  html += `<span style="${code === 1 ? 'font-weight:700' : code === 2 ? 'opacity:.6' : COLORS[code] ? 'color:' + COLORS[code] : ''}">`;
  open++;
}
const page = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117}
.win{margin:20px;border-radius:10px;background:#161b22;box-shadow:0 8px 30px rgba(0,0,0,.5);overflow:hidden;width:980px}
.bar{height:28px;background:#21262d;display:flex;align-items:center;padding-left:12px;gap:8px}
.bar i{width:12px;height:12px;border-radius:50%;display:inline-block}
pre{margin:0;padding:14px 18px 18px;color:#e6edf3;font:12.5px/1.5 "SF Mono",Menlo,Consolas,monospace;white-space:pre-wrap}
</style><div class="win"><div class="bar"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i></div><pre><span style="color:#8b949e">$ npx github:thinx-pro/cloak-diff examples/hidden-instructions.html --static</span>
${html}</pre></div>`;
writeFileSync(p('assets/demo.html'), page);
await withPage(pathToFileURL(p('assets/demo.html')).href, { width: 1040, height: 1400, wait: 200 }, async ({ send }) => {
  save('assets/demo.png', await shotOf(send, '.win'));
});
console.log('cli exit', run.status);

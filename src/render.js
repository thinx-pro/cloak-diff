// Render mode: drive a local Chrome/Chromium over the DevTools protocol (no Puppeteer), let the
// page run its JavaScript, then evaluate the same walker the web app uses.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { scanDom } from './walker.js';
import { directiveScore } from './directive.js';

export function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const mac = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ];
  const win = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of process.platform === 'darwin' ? mac : process.platform === 'win32' ? win : []) if (existsSync(p)) return p;
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const n of names) if (dir && existsSync(join(dir, n))) return join(dir, n);
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(dir, proc, timeout = 15000) {
  const file = join(dir, 'DevToolsActivePort');
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (proc.exitCode !== null) throw new Error('Chrome exited early (code ' + proc.exitCode + ')');
    if (existsSync(file)) {
      const [port, path] = readFileSync(file, 'utf8').split('\n');
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    }
    await sleep(50);
  }
  throw new Error('Timed out waiting for Chrome DevTools port');
}

function cdp(url) {
  if (typeof WebSocket === 'undefined') throw new Error('--render needs Node.js 22 or newer (global WebSocket)');
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools')));
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      const msg = { id: ++id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
      return new Promise((resolve, reject) => pending.set(msg.id, { resolve, reject }));
    },
    on(fn) { listeners.push(fn); },
    close() { try { ws.close(); } catch {} },
  };
}

/**
 * Render `target` (http(s) URL or file:// URL) and scan it.
 * opts: { wait, userAgent, width, height, collectVisible, timeout }
 */
export async function scanRendered(target, opts = {}) {
  return withPage(target, opts, async ({ send, loaded }) => {
    const expr = `(${scanDom.toString()})(document, ${directiveScore.toString()}, ${JSON.stringify({ collectVisible: !!opts.collectVisible })})`;
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
    if (res.exceptionDetails) throw new Error('Scan failed in page: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    const out = res.result.value;
    const info = await send('Runtime.evaluate', { expression: 'JSON.stringify({url: location.href, title: document.title})', returnByValue: true });
    return Object.assign(out, JSON.parse(info.result.value), { mode: 'render', loaded });
  });
}

/** Open `target` in headless Chrome, wait for load + opts.wait, then call fn({ send, loaded, errors }). */
export async function withPage(target, opts, fn) {
  const chrome = opts.chrome || findChrome();
  if (!chrome) throw new Error('No Chrome/Chromium found. Set CHROME_PATH, or use --static.');
  const dir = mkdtempSync(join(tmpdir(), 'cloak-diff-'));
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', '--hide-scrollbars',
    'about:blank',
  ];
  if (process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  let client;
  try {
    client = cdp(await waitForPort(dir, proc));
    await client.ready;
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => client.send(m, p, sessionId);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: opts.width || 1280, height: opts.height || 900, deviceScaleFactor: 1, mobile: false });
    if (opts.userAgent) await send('Network.setUserAgentOverride', { userAgent: opts.userAgent });
    let loaded = false;
    const errors = [];
    client.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Page.loadEventFired') loaded = true;
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    const nav = await send('Page.navigate', { url: target });
    if (nav.errorText) throw new Error(`Navigation failed: ${nav.errorText}`);
    const t0 = Date.now();
    const timeout = opts.timeout || 30000;
    while (!loaded && Date.now() - t0 < timeout) await sleep(100);
    await sleep(opts.wait ?? 1500); // let client-side rendering settle
    return await fn({ send, loaded, errors });
  } finally {
    if (client) {
      try { await client.send('Browser.close'); } catch {}
      client.close();
    }
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(3000)]);
    if (proc.exitCode === null) proc.kill('SIGKILL');
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

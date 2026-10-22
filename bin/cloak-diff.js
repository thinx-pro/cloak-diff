#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { scan, compareBots, isUrl, VERSION, BOT_UAS } from '../src/index.js';
import { renderTerminal, renderMarkdown, renderBots, failed } from '../src/report.js';

const HELP = `cloak-diff ${VERSION}
Find text on a web page that people can't see but scrapers, RAG pipelines and AI agents will read.

Usage
  cloak-diff <url | file.html | ->  [options]

Modes
  (default)         render in local Chrome/Chromium if found (Node 22+), else static
  --render          require a real render (runs page JavaScript, applies all CSS)
  --static          parse HTML only: inline styles + <style> rules, no network beyond the page
  --compare-bots    fetch as a browser and as ${Object.keys(BOT_UAS).join(' / ')}; show text only crawlers get

Output
  --json            machine-readable result
  --md              Markdown report (for issues / PR comments)
  --strip           print only the text a person can see (use as a scraping filter)
  --all             list every hidden block, not just the top 8

Options
  --fail-on <x>     exit 1 when: directive (default) | hidden | never
  --wait <ms>       extra settle time after load in render mode (default 1500)
  --user-agent <s>  user agent for the page request
  -h, --help        show help
  -v, --version     show version

Exit codes: 0 = pass, 1 = --fail-on condition met, 2 = error.

Examples
  npx github:thinx-pro/cloak-diff https://example.com
  npx github:thinx-pro/cloak-diff page.html --static --md > report.md
  curl -s https://example.com | npx github:thinx-pro/cloak-diff - --strip
`;

function parseArgs(argv) {
  const o = { mode: 'auto', failOn: 'directive', inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '--render') o.mode = 'render';
    else if (a === '--static') o.mode = 'static';
    else if (a === '--compare-bots') o.compareBots = true;
    else if (a === '--json') o.json = true;
    else if (a === '--md') o.md = true;
    else if (a === '--strip') o.strip = true;
    else if (a === '--all') o.all = true;
    else if (a === '--fail-on') { o.failOn = val(); if (!/^(directive|hidden|never)$/.test(o.failOn)) throw new Error('--fail-on must be directive, hidden or never'); }
    else if (a === '--wait') o.wait = Number(val());
    else if (a === '--user-agent') o.userAgent = val();
    else if (a.startsWith('-') && a !== '-') throw new Error(`Unknown option ${a} (see --help)`);
    else o.inputs.push(a);
  }
  return o;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  if (o.help) { process.stdout.write(HELP); return 0; }
  if (o.version) { console.log(VERSION); return 0; }
  if (o.inputs.length !== 1) { process.stderr.write(HELP); return 2; }
  const input = o.inputs[0];

  if (o.compareBots) {
    if (!isUrl(input)) { console.error('--compare-bots needs an http(s) URL'); return 2; }
    const cmp = await compareBots(input);
    console.log(o.json ? JSON.stringify(cmp, null, 2) : renderBots(cmp));
    const dir = cmp.bots.some((b) => b.onlyBot.some((x) => x.directive.directive));
    return o.failOn !== 'never' && dir ? 1 : 0;
  }

  const opts = { mode: o.mode, wait: o.wait, userAgent: o.userAgent, collectVisible: !!o.strip };
  if (input === '-') {
    if (o.mode === 'render') { console.error('--render needs a URL or file, not stdin'); return 2; }
    opts.html = readFileSync(0, 'utf8');
  }
  const t0 = Date.now();
  const result = await scan(input === '-' ? 'stdin' : input, opts);
  const ms = Date.now() - t0;
  if (o.strip) process.stdout.write((result.visibleText || '') + '\n');
  else if (o.json) console.log(JSON.stringify({ version: VERSION, ...result }, null, 2));
  else if (o.md) console.log(renderMarkdown(result));
  else console.log(renderTerminal(result, { all: o.all, ms, failOn: o.failOn, width: process.stdout.columns || 110 }));
  return failed(result, o.failOn) ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error('cloak-diff: ' + (e && e.message || e)); process.exit(2); });

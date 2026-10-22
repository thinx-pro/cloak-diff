// Public API.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanHtmlStatic } from './static.js';
import { scanRendered, findChrome } from './render.js';
import { directiveScore } from './directive.js';

export { scanHtmlStatic, scanRendered, findChrome, directiveScore };
export const VERSION = '0.1.0';

export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// User-agent strings as published by each crawler's operator. Sites that verify crawlers by IP
// will (correctly) not treat these requests as the real bot.
export const BOT_UAS = {
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
  ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
};

export function isUrl(s) { return /^https?:\/\//i.test(s); }

export async function fetchHtml(url, userAgent = BROWSER_UA) {
  const res = await fetch(url, { headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' }, redirect: 'follow' });
  const html = await res.text();
  return { status: res.status, url: res.url, html };
}

/** Summarise a raw scan into counts used by every output format. */
export function summarize(scan) {
  const segs = scan.segments;
  const directive = segs.filter((s) => s.directive.directive);
  const total = scan.visibleChars + scan.hiddenChars;
  return {
    visibleChars: scan.visibleChars,
    hiddenChars: scan.hiddenChars,
    hiddenShare: total ? scan.hiddenChars / total : 0,
    hiddenSegments: segs.filter((s) => s.kind === 'hidden-text').length,
    otherSegments: segs.filter((s) => s.kind !== 'hidden-text').length,
    directiveCount: directive.length,
  };
}

/**
 * Scan a URL, a local file path, or raw HTML.
 * opts.mode: 'auto' | 'render' | 'static'
 */
export async function scan(input, opts = {}) {
  const mode = opts.mode || 'auto';
  const useRender = mode === 'render' || (mode === 'auto' && !opts.html && findChrome() && typeof WebSocket !== 'undefined');
  let result;
  if (opts.html !== undefined) {
    result = scanHtmlStatic(opts.html, opts);
    result.url = input || 'stdin';
  } else if (useRender) {
    const target = isUrl(input) ? input : pathToFileURL(resolve(input)).href;
    result = await scanRendered(target, opts);
  } else if (isUrl(input)) {
    const r = await fetchHtml(input, opts.userAgent);
    result = scanHtmlStatic(r.html, opts);
    Object.assign(result, { url: r.url, status: r.status });
  } else {
    result = scanHtmlStatic(readFileSync(input, 'utf8'), opts);
    result.url = input;
  }
  if (mode === 'auto' && !useRender && opts.html === undefined) result.note = 'static mode (no Chrome found or Node < 22): external CSS and JavaScript-built content are not evaluated';
  result.summary = summarize(result);
  return result;
}

const sentences = (text) => String(text || '')
  .split(/(?<=[.!?。！？])\s+|\n+/)
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter((s) => s.length >= 25 && /[\p{L}]{3,}/u.test(s));

function allText(scan) {
  return [scan.visibleText || '', ...scan.segments.filter((s) => s.kind === 'hidden-text' || s.kind === 'noscript').map((s) => s.text)].join('\n');
}

/** Fetch the page as a browser and as each AI crawler; report text only the crawlers receive. */
export async function compareBots(url, bots = Object.keys(BOT_UAS)) {
  const base = await fetchHtml(url, BROWSER_UA);
  const baseScan = scanHtmlStatic(base.html, { collectVisible: true });
  const baseSet = new Set(sentences(allText(baseScan)));
  const out = { url, browser: { status: base.status, bytes: base.html.length }, bots: [] };
  for (const name of bots) {
    const r = await fetchHtml(url, BOT_UAS[name]);
    const s = scanHtmlStatic(r.html, { collectVisible: true });
    const botSents = sentences(allText(s));
    const botSet = new Set(botSents);
    const onlyBot = [...botSet].filter((x) => !baseSet.has(x));
    const onlyBrowser = [...baseSet].filter((x) => !botSet.has(x));
    out.bots.push({
      name,
      status: r.status,
      bytes: r.html.length,
      onlyBot: onlyBot.map((text) => ({ text, directive: directiveScore(text) })),
      onlyBrowserCount: onlyBrowser.length,
    });
  }
  return out;
}

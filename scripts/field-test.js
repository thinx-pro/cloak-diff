// Field test: render a list of public pages and record what cloak-diff flags.
// Usage: node scripts/field-test.js <out.json> [a|b] [static]
// Measures false positives on ordinary sites (not expected to contain hidden instructions).
// List A was used to fix three over-eager rules; list B was chosen afterwards and only measured.
import { writeFileSync } from 'node:fs';
import { scan } from '../src/index.js';

const SITES_A = [
  'https://example.com/',
  'https://en.wikipedia.org/wiki/Prompt_injection',
  'https://github.com/about',
  'https://news.ycombinator.com/',
  'https://developer.mozilla.org/en-US/docs/Web/CSS/display',
  'https://docs.python.org/3/tutorial/index.html',
  'https://www.bbc.com/news',
  'https://www.theverge.com/',
  'https://www.apple.com/',
  'https://www.microsoft.com/en-us/',
  'https://stripe.com/',
  'https://www.notion.com/',
  'https://faq.whatsapp.com/2138577903196467/',
  'https://support.google.com/accounts/answer/32046',
  'https://help.netflix.com/en/node/407',
  'https://support.apple.com/en-us/102581',
  'https://stackoverflow.com/questions/11227809',
  'https://www.reuters.com/',
  'https://www.shopify.com/',
  'https://openai.com/',
  'https://www.anthropic.com/',
  'https://vercel.com/',
];

// Chosen after the rule fixes; leans towards pages that *discuss* prompt injection and AI.
const SITES_B = [
  'https://genai.owasp.org/llmrisk/llm01-prompt-injection/',
  'https://simonwillison.net/tags/prompt-injection/',
  'https://en.wikipedia.org/wiki/Large_language_model',
  'https://arxiv.org/abs/2302.12173',
  'https://www.wired.com/',
  'https://www.nytimes.com/',
  'https://edition.cnn.com/',
  'https://www.theguardian.com/international',
  'https://www.imdb.com/',
  'https://www.espn.com/',
  'https://www.booking.com/',
  'https://www.etsy.com/',
  'https://www.npmjs.com/package/react',
  'https://pypi.org/project/requests/',
  'https://github.com/nodejs/node',
  'https://dev.to/',
  'https://www.gov.uk/',
  'https://www.irs.gov/',
  'https://www.nature.com/',
  'https://help.instagram.com/',
  'https://www.mozilla.org/en-US/firefox/',
  'https://docs.anthropic.com/',
];

const SITES = process.argv[3] === 'b' ? SITES_B : SITES_A;
const out = [];
const mode = process.argv.includes('static') ? 'static' : 'render';
for (const url of SITES) {
  const t0 = Date.now();
  try {
    const r = await scan(url, { mode, wait: 2500, timeout: 25000 });
    const s = r.summary;
    const flagged = r.segments.filter((x) => x.directive.directive).map((x) => ({ reason: x.reason, kind: x.kind, where: x.where, text: x.text.slice(0, 400), hits: x.directive.hits }));
    out.push({ url, title: r.title, ms: Date.now() - t0, ...s, flagged });
    console.log(`${url}  visible=${s.visibleChars} hidden=${s.hiddenChars} blocks=${s.hiddenSegments} directive=${s.directiveCount}`);
    for (const f of flagged) console.log(`   ⚠ [${f.reason}] ${f.text.slice(0, 160)}`);
  } catch (e) {
    out.push({ url, error: String(e.message || e) });
    console.log(`${url}  ERROR ${e.message}`);
  }
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 2));

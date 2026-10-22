// Terminal, Markdown and JSON output.
const useColor = () => process.env.FORCE_COLOR === '1' || (process.stdout.isTTY && !process.env.NO_COLOR);
const paint = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = { bold: paint(1), dim: paint(2), red: paint(31), green: paint(32), yellow: paint(33), magenta: paint(35), cyan: paint(36) };

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const num = (n) => n.toLocaleString('en-US');
const pct = (x) => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';

export function failed(result, failOn) {
  if (failOn === 'never') return false;
  if (failOn === 'hidden') return result.summary.hiddenSegments > 0;
  return result.summary.directiveCount > 0;
}

export function renderTerminal(result, { all = false, ms, failOn = 'directive', width = 100 } = {}) {
  const s = result.summary;
  const lines = [];
  lines.push(`${c.bold('cloak-diff')}  ${result.url}${result.title ? c.dim('  “' + clip(result.title, 50) + '”') : ''}  ${c.dim('(' + result.mode + (ms !== undefined ? ', ' + (ms / 1000).toFixed(1) + ' s' : '') + ')')}`);
  if (result.note) lines.push(c.dim('note: ' + result.note));
  lines.push(`Visible text ${c.bold(num(s.visibleChars))} chars · hidden ${c.bold(num(s.hiddenChars))} chars (${pct(s.hiddenShare)}) in ${s.hiddenSegments} block${s.hiddenSegments === 1 ? '' : 's'} · ${s.directiveCount ? c.red(c.bold(s.directiveCount + ' model-directed')) : c.green('0 model-directed')} instruction${s.directiveCount === 1 ? '' : 's'}`);
  lines.push('');
  const dir = result.segments.filter((x) => x.directive.directive).sort((a, b) => b.directive.score - a.directive.score);
  if (dir.length) {
    lines.push(c.red(c.bold('⚠ Hidden text that reads like instructions to a model')) + c.dim('  (people can’t see it; scrapers and agents read it)'));
    dir.forEach((x, i) => {
      lines.push(`${c.bold(String(i + 1).padStart(2) + '.')} ${c.yellow(x.reason)}  ${c.dim(x.where)}`);
      lines.push('    ' + c.magenta('“' + clip(x.text, 600) + '”'));
      lines.push('    ' + c.dim(`score ${x.directive.score} · ${x.directive.hits.join(' · ')}`));
    });
    lines.push('');
  }
  const rest = result.segments.filter((x) => !x.directive.directive).sort((a, b) => b.chars - a.chars);
  if (rest.length) {
    const shown = all ? rest : rest.slice(0, 8);
    lines.push(c.bold('Other hidden text') + c.dim(all ? ` (${rest.length})` : ` (top ${shown.length} of ${rest.length} by length; --all lists every block)`));
    for (const x of shown) {
      lines.push(`  ${c.dim(String(x.chars).padStart(6))}  ${c.cyan(clip(x.reason, 34).padEnd(34))}  ${c.dim(clip(x.where, 30).padEnd(30))}  ${clip(x.text, Math.max(50, width - 80))}`);
    }
    lines.push('');
  }
  const bad = failed(result, failOn);
  lines.push(bad
    ? c.red(c.bold(`FAIL`)) + ` — ${failOn === 'hidden' ? s.hiddenSegments + ' hidden block(s)' : s.directiveCount + ' hidden block(s) read like instructions to a model'} (--fail-on ${failOn})`
    : c.green(c.bold('PASS')) + c.dim(` — no ${failOn === 'hidden' ? 'hidden text' : 'model-directed hidden text'} found`));
  return lines.join('\n');
}

export function renderMarkdown(result) {
  const s = result.summary;
  const esc = (t) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const out = [];
  out.push(`## cloak-diff: ${result.url}`, '');
  out.push(`- Mode: ${result.mode}`);
  out.push(`- Visible text: ${num(s.visibleChars)} chars; hidden: ${num(s.hiddenChars)} chars (${pct(s.hiddenShare)}) in ${s.hiddenSegments} blocks`);
  out.push(`- Hidden text that reads like instructions to a model: **${s.directiveCount}**`, '');
  const dir = result.segments.filter((x) => x.directive.directive);
  if (dir.length) {
    out.push('| # | How it is hidden | Where | Text | Signals |', '|---|---|---|---|---|');
    dir.forEach((x, i) => out.push(`| ${i + 1} | ${esc(x.reason)} | \`${esc(x.where)}\` | ${esc(clip(x.text, 300))} | ${esc(x.directive.hits.join('; '))} |`));
    out.push('');
  }
  const rest = result.segments.filter((x) => !x.directive.directive).sort((a, b) => b.chars - a.chars);
  if (rest.length) {
    out.push('<details><summary>Other hidden text (' + rest.length + ')</summary>', '', '| Chars | How | Where | Text |', '|---|---|---|---|');
    for (const x of rest) out.push(`| ${x.chars} | ${esc(x.reason)} | \`${esc(x.where)}\` | ${esc(clip(x.text, 160))} |`);
    out.push('', '</details>');
  }
  return out.join('\n');
}

export function renderBots(cmp) {
  const lines = [`${c.bold('cloak-diff --compare-bots')}  ${cmp.url}`, c.dim(`browser UA: HTTP ${cmp.browser.status}, ${num(cmp.browser.bytes)} bytes`), ''];
  let any = false;
  for (const b of cmp.bots) {
    const dir = b.onlyBot.filter((x) => x.directive.directive);
    lines.push(`${c.bold(b.name.padEnd(14))} HTTP ${b.status}, ${num(b.bytes)} bytes · ${b.onlyBot.length ? c.yellow(b.onlyBot.length + ' sentences only this bot gets') : c.green('no bot-only sentences')} · ${b.onlyBrowserCount} only the browser gets${dir.length ? ' · ' + c.red(c.bold(dir.length + ' read like instructions')) : ''}`);
    for (const x of b.onlyBot.slice(0, 6)) lines.push('    ' + (x.directive.directive ? c.red('⚠ ') : '  ') + clip(x.text, 140));
    if (b.onlyBot.length > 6) lines.push(c.dim(`    … ${b.onlyBot.length - 6} more (--json for all)`));
    if (b.onlyBot.length) any = true;
  }
  lines.push('', c.dim(any
    ? 'Differences can be benign (A/B tests, rotating content, bot-blocking pages). Look at the sentences, not the count.'
    : 'Same text for the browser and every crawler user agent tried (this cannot detect cloaking that checks crawler IPs).'));
  return lines.join('\n');
}

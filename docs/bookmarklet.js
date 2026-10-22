// Builds the bookmarklet source from the same scanner the CLI uses.
import { scanDom } from './lib/walker.js';
import { directiveScore } from './lib/directive.js';

function overlay(r) {
  const old = document.getElementById('__cloak_diff');
  if (old) old.remove();
  const host = document.createElement('div');
  host.id = '__cloak_diff';
  host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dir = r.segments.filter((s) => s.directive.directive);
  const rest = r.segments.filter((s) => !s.directive.directive).sort((a, b) => b.chars - a.chars);
  const item = (s, bad) => '<li class="' + (bad ? 'bad' : '') + '"><div class="how">' + esc(s.reason) + ' <span>' + esc(s.where) + '</span></div><div class="t">' + esc(s.text.length > 400 ? s.text.slice(0, 399) + '…' : s.text) + '</div></li>';
  root.innerHTML = '<style>:host{all:initial}.p{font:13px/1.45 system-ui,sans-serif;width:min(420px,calc(100vw - 24px));max-height:80vh;overflow:auto;background:#fff;color:#1f2328;border:1px solid #d0d7de;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:12px 14px}h2{font-size:14px;margin:0 0 4px}p{margin:0 0 8px;color:#57606a}ul{list-style:none;margin:0 0 10px;padding:0}li{border-top:1px solid #eaeef2;padding:6px 0}li.bad .t{color:#cf222e}.how{font-size:11px;color:#57606a}.how span{opacity:.7}.t{word-break:break-word}button{float:right;border:0;background:none;font-size:18px;cursor:pointer;color:#57606a}h3{font-size:12px;margin:8px 0 2px;text-transform:uppercase;letter-spacing:.04em;color:#57606a}</style>'
    + '<div class="p"><button title="Close">×</button><h2>cloak-diff</h2><p>' + r.hiddenChars.toLocaleString() + ' hidden chars in ' + rest.concat(dir).filter((s) => s.kind === 'hidden-text').length + ' blocks · <b style="color:' + (dir.length ? '#cf222e' : '#1a7f37') + '">' + dir.length + ' read like instructions to a model</b></p>'
    + (dir.length ? '<h3>Model-directed</h3><ul>' + dir.map((s) => item(s, true)).join('') + '</ul>' : '')
    + (rest.length ? '<h3>Other hidden text</h3><ul>' + rest.slice(0, 40).map((s) => item(s, false)).join('') + '</ul>' : '')
    + '</div>';
  root.querySelector('button').onclick = () => host.remove();
  document.documentElement.appendChild(host);
}

export function bookmarkletSource() {
  // Browsers percent-decode javascript: URLs, so the source must be URI-encoded (it contains '%').
  const code = '(()=>{const scanDom=' + scanDom.toString() + ';const score=' + directiveScore.toString() + ';const overlay=' + overlay.toString()
    + ';try{overlay(scanDom(document,score,{}))}catch(e){alert("cloak-diff: "+e.message)}})()';
  return 'javascript:' + encodeURIComponent(code);
}

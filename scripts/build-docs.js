// Copy the browser-side modules and the example page into docs/ (GitHub Pages).
// Usage: node scripts/build-docs.js
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const p = (rel) => fileURLToPath(new URL('../' + rel, import.meta.url));
mkdirSync(p('docs/lib'), { recursive: true });
copyFileSync(p('src/walker.js'), p('docs/lib/walker.js'));
copyFileSync(p('src/directive.js'), p('docs/lib/directive.js'));
copyFileSync(p('examples/hidden-instructions.html'), p('docs/example.html'));
console.log('docs/lib and docs/example.html updated');

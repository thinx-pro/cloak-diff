// Print how the directive scorer does on the phrasing sets in test/heldout.js.
// Usage: node scripts/heldout-report.js
import { directiveScore } from '../src/directive.js';
import { DEV_DIRECTED, DEV_ORDINARY, HELDOUT_DIRECTED, HELDOUT_ORDINARY } from '../test/heldout.js';

function run(name, directed, ordinary) {
  let tp = 0;
  let fp = 0;
  console.log(`== ${name}`);
  for (const t of directed) {
    const r = directiveScore(t);
    if (r.directive) tp++;
    else console.log(`  MISS ${String(r.score).padStart(2)}  ${t}`);
  }
  for (const t of ordinary) {
    const r = directiveScore(t);
    if (r.directive) { fp++; console.log(`  FP   ${String(r.score).padStart(2)}  ${t}   [${r.hits.join(' · ')}]`); }
  }
  console.log(`  flagged ${tp}/${directed.length} model-directed, ${fp}/${ordinary.length} ordinary\n`);
}
run('dev set (used to write the rules)', DEV_DIRECTED, DEV_ORDINARY);
run('held-out set', HELDOUT_DIRECTED, HELDOUT_ORDINARY);

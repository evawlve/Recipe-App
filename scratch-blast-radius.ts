/* LANE S blast radius — READ-ONLY, never committed.
 * Question (playbook §4): does the key a LOOKUP computes change, over real query forms?
 * Imports: the new leaf + cache-key-core + canonicalizeCacheKey ONLY (leaf-safe; never cache-key.ts). */
import * as fs from 'fs';
import { stripPartitiveOfResidue } from './src/lib/mapping/partitive-residue';
import { deriveCacheKeyName, collapseAdjacentDuplicateTokens } from './src/lib/mapping/cache-key-core';
import { canonicalizeCacheKey } from './src/lib/mapping/normalization-rules';

const forms = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.trim().length > 0);
function keyOf(name: string): string {
  // deriveMappingCacheKey minus the brand prefix (strip touches neither rawLine nor brand tokens):
  // step 1 deriveCacheKeyName (identity discriminators, parsed=null) -> step 3 canonicalize + collapse
  return collapseAdjacentDuplicateTokens(canonicalizeCacheKey(deriveCacheKeyName(name, null)));
}
let movers = 0, checked = 0;
const out: string[] = [];
for (const f of forms) {
  checked++;
  const s = stripPartitiveOfResidue(f);
  if (s === f) continue;
  const oldK = keyOf(f), newK = keyOf(s);
  if (oldK !== newK) { movers++; out.push(JSON.stringify({ form: f, stripped: s, oldK, newK })); }
}
console.log('FORMS_CHECKED=' + checked);
console.log('MOVERS=' + movers);
for (const line of out) console.log(line);

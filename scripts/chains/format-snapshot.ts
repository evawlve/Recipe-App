/**
 * Rewrite a snapshot written by another collector (a Chrome pass) through `formatSnapshot()`, refusing any change
 * beyond key and list order.
 *   npx ts-node --project tsconfig.scripts.json --transpile-only scripts/chains/format-snapshot.ts chains/menus/<chain>.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { ChainSnapshot } from '../../src/lib/chains/snapshot';
import { canonicalJson } from '../../src/lib/chains/snapshot';
import { formatSnapshot, sortSnapshotLists } from '../../src/lib/chains/format';

const file = process.argv[2];
if (!file) { console.error('usage: format-snapshot.ts <file>'); process.exit(2); }
const before = JSON.parse(readFileSync(file, 'utf8')) as ChainSnapshot;
const text = formatSnapshot(before);
const after = JSON.parse(text) as ChainSnapshot;
if (canonicalJson(sortSnapshotLists(before)) !== canonicalJson(after)) {
  console.error('content changed while formatting: refusing');
  process.exit(1);
}
writeFileSync(file, text);
console.log(`formatted ${file}`);

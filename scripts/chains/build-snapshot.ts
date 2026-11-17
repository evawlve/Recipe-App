/**
 * Build `chains/menus/<chain>.json` from a raw directory written by `fetch-sources.ts`.
 *   npx ts-node --project tsconfig.scripts.json --transpile-only scripts/chains/build-snapshot.ts <chain> --raw <dir> [--check]
 * Exit 0: written (or, with --check, the committed file is byte-identical: prints SAME).
 * Exit 1: the snapshot fails a gate (nothing written), or --check found a difference (prints DIFF).
 * Exit 2: usage error. The gates are the ones CI runs: `checkSnapshot()` at the snapshot's newest fetchedAt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSnapshot, newestFetchedAt, reportPasses } from '../../src/lib/chains/snapshot';
import { formatSnapshot } from '../../src/lib/chains/format';
import { adapterFor, argValue, readRaw } from './cli-io';
import { assembleSnapshot } from './lib/adapter';

function main(): void {
  const args = process.argv.slice(2);
  const adapter = adapterFor(args[0]);
  const raw = argValue(args, '--raw');
  if (!raw) { console.error('--raw <dir> is required'); process.exit(2); }
  const { manifest, bodies } = readRaw(raw);
  const snap = assembleSnapshot(adapter, manifest, bodies);
  const report = checkSnapshot(snap, adapter.chain, newestFetchedAt(snap));
  console.log(`${adapter.chain}: ${snap.items.length} items, ${snap.components.length} components, ${snap.spotChecks.length} spot checks`);
  if (!reportPasses(report)) {
    for (const [gate, problems] of Object.entries(report)) {
      if (Array.isArray(problems)) for (const p of problems) console.log(`FAIL ${gate}: ${p}`);
    }
    process.exit(1);
  }
  const text = formatSnapshot(snap);
  const file = join('chains', 'menus', `${adapter.chain}.json`);
  if (args.includes('--check')) {
    const same = existsSync(file) && readFileSync(file, 'utf8') === text;
    console.log(same ? 'SAME' : 'DIFF');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(file, text);
  console.log(`wrote ${file}`);
}

main();

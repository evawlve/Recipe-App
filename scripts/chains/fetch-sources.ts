/**
 * Collect one chain's sources into a raw directory OUTSIDE the repo (never under `data/`, which never syncs, and never
 * committed: the bodies are the chain's pages, the snapshot is what we keep).
 *   npx ts-node --project tsconfig.scripts.json --transpile-only scripts/chains/fetch-sources.ts <chain> --out <dir>
 * Refuses a non-empty --out, so a raw directory is always one collection.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapterFor, argValue } from './cli-io';
import { politeFetch } from './lib/polite-fetch';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const adapter = adapterFor(args[0]);
  const out = argValue(args, '--out');
  if (!out) { console.error('--out <dir> is required'); process.exit(2); }
  if (existsSync(out) && readdirSync(out).length > 0) { console.error(`${out} is not empty`); process.exit(2); }
  mkdirSync(out, { recursive: true });
  const manifest = await politeFetch(adapter.chain, adapter.sources, {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
    save: (file, body) => writeFileSync(join(out, file), body),
  });
  writeFileSync(join(out, 'fetch.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const r of manifest.records) console.log(`${r.id}\t${r.status}\t${r.bytes}\t${r.sha256}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

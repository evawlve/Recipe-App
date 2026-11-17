/** File-system glue shared by the chain CLIs; kept out of `lib/` so the libraries stay pure and unit-tested. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChainAdapter, FetchManifest } from './lib/adapter';
import { ADAPTERS } from './adapters';

export function adapterFor(chain: string | undefined): ChainAdapter {
  const a = chain ? ADAPTERS[chain] : undefined;
  if (!a) {
    console.error(`unknown chain "${chain ?? ''}"; adapters: ${Object.keys(ADAPTERS).sort().join(', ') || '(none)'}`);
    process.exit(2);
  }
  return a;
}

export function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export function readRaw(rawDir: string): { manifest: FetchManifest; bodies: Record<string, Buffer> } {
  const manifest = JSON.parse(readFileSync(join(rawDir, 'fetch.json'), 'utf8')) as FetchManifest;
  const bodies: Record<string, Buffer> = {};
  for (const r of manifest.records) bodies[r.id] = readFileSync(join(rawDir, r.file));
  return { manifest, bodies };
}

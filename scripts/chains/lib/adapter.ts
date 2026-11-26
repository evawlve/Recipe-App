/**
 * The adapter contract and the snapshot assembler (chain row 2, 2026-11-16).
 *
 * An adapter is one file per chain, `scripts/chains/adapters/<chain>.ts`, default-exporting a `ChainAdapter`: the
 * chain's identity, the URLs it is collected from, a pure `parse()` over the saved bodies, and the spot checks a
 * person observed on the chain's own pages. Collection and parsing are split on purpose:
 *  - `fetch-sources.ts` is the only code that touches the network (sequential, >= 2 s apart, a generic User-Agent,
 *    mobile repo `sync-docs/reports/2026-11-14_chain-menu-nutrition-handoff-for-50-to-100-chains.md` §5). It saves
 *    each body and a `fetch.json` manifest with its sha256 into a raw directory OUTSIDE the repo.
 *  - `build-snapshot.ts` reads that directory, checks every body against the manifest's sha256, runs `parse()`, and
 *    writes `chains/menus/<chain>.json` through `formatSnapshot()`. With `--check` it writes nothing and compares, so
 *    "re-run the adapter on the saved source and get the committed bytes" is one command.
 * `parse()` must be deterministic and must never invent a number: a field the source does not publish is null.
 */
import { createHash } from 'node:crypto';
import type { ChainComponent, ChainItem, ChainRoute, ChainSnapshot, ChainSource, SpotCheck } from '../../../src/lib/chains/snapshot';
import { SNAPSHOT_SCHEMA_VERSION } from '../../../src/lib/chains/snapshot';

export type SourceSpec = {
  id: string;
  kind: ChainRoute;
  url: string;
  landingUrl: string | null;
  /** File name the body is saved under in the raw directory. */
  file: string;
};

export type FetchRecord = {
  id: string;
  url: string;
  file: string;
  status: number;
  bytes: number;
  sha256: string;
  /** ISO timestamp, UTC. */
  fetchedAt: string;
};

export type FetchManifest = { chain: string; records: FetchRecord[] };

export type ParseResult = { items: ChainItem[]; components: ChainComponent[] };

export type ChainAdapter = {
  chain: string;
  chainName: string;
  country: string;
  route: ChainRoute;
  sources: SourceSpec[];
  /** The date the source prints on itself, as YYYY-MM-DD, or null. */
  sourceDate?: (sourceId: string, body: string) => string | null;
  /** The machine timestamp the source carries (Nutritionix `generatedAt`), as YYYY-MM-DD, or null. Absent -> null. */
  generatedAt?: (sourceId: string, body: string) => string | null;
  parse: (bodies: Record<string, string>) => ParseResult;
  spotChecks: SpotCheck[];
};

export function sha256(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Builds the snapshot from an adapter, its fetch manifest and the saved bodies (keyed by source id). Throws, never
 * guesses, when a source is missing, was not a 200, or its bytes do not match the manifest's sha256.
 */
export function assembleSnapshot(adapter: ChainAdapter, manifest: FetchManifest, bodies: Record<string, Buffer>): ChainSnapshot {
  if (manifest.chain !== adapter.chain) throw new Error(`manifest is for "${manifest.chain}", adapter is "${adapter.chain}"`);
  const text: Record<string, string> = {};
  const sources: ChainSource[] = adapter.sources.map((spec) => {
    const rec = manifest.records.find((r) => r.id === spec.id);
    if (!rec) throw new Error(`source ${spec.id}: not in the fetch manifest`);
    if (rec.status !== 200) throw new Error(`source ${spec.id}: fetched with HTTP ${rec.status}`);
    const body = bodies[spec.id];
    if (!body) throw new Error(`source ${spec.id}: body ${rec.file} is missing`);
    const hash = sha256(body);
    if (hash !== rec.sha256) throw new Error(`source ${spec.id}: sha256 ${hash} does not match the manifest's ${rec.sha256}`);
    text[spec.id] = body.toString('utf8');
    return {
      id: spec.id,
      kind: spec.kind,
      url: rec.url,
      landingUrl: spec.landingUrl,
      sourceDate: adapter.sourceDate ? adapter.sourceDate(spec.id, text[spec.id]) : null,
      generatedAt: adapter.generatedAt ? adapter.generatedAt(spec.id, text[spec.id]) : null,
      fetchedAt: rec.fetchedAt.slice(0, 10),
      contentHash: hash,
    };
  });
  const { items, components } = adapter.parse(text);
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    chain: adapter.chain,
    chainName: adapter.chainName,
    country: adapter.country,
    route: adapter.route,
    sources,
    components,
    items,
    spotChecks: adapter.spotChecks,
  };
}

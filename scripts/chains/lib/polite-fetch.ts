/**
 * The only network code in the chain adapters: one GET per source, in order, at least `CHAIN_FETCH_GAP_MS` apart,
 * with a User-Agent that names the app and no person (mobile CLAUDE.md privacy rule; s458 §5 politeness rules), a
 * timeout, and redirects NOT followed: an adapter lists each source's final URL, so a redirect (a moved page, or a
 * bounce to a challenge) is a refusal to look at, never a page silently saved. It stops at the first non-200 and
 * saves nothing for that source: a wall is recorded, never worked around. A refusal partway leaves the bodies already
 * saved and no `fetch.json`, so `build-snapshot.ts` cannot read that directory. The network, the clock and the sleep
 * are injected so the rules are unit-tested.
 */
import type { FetchManifest, FetchRecord, SourceSpec } from './adapter';
import { sha256 } from './adapter';

export const CHAIN_FETCH_GAP_MS = 2000;
export const CHAIN_FETCH_MAX_SOURCES = 8;
export const CHAIN_USER_AGENT = 'Mozilla/5.0 (Macintosh) KindaHealthy-menu-check/1.0';
export const CHAIN_FETCH_TIMEOUT_MS = 30_000;

export type FetchDeps = {
  fetch: (url: string, init: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal }) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  save: (file: string, body: Buffer) => void;
};

export class FetchRefused extends Error {}

export async function politeFetch(chain: string, specs: SourceSpec[], deps: FetchDeps): Promise<FetchManifest> {
  if (specs.length > CHAIN_FETCH_MAX_SOURCES) {
    throw new FetchRefused(`${chain}: ${specs.length} sources exceeds the ${CHAIN_FETCH_MAX_SOURCES}-request budget`);
  }
  const records: FetchRecord[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (i > 0) await deps.sleep(CHAIN_FETCH_GAP_MS);
    const res = await deps.fetch(spec.url, {
      headers: { 'User-Agent': CHAIN_USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(CHAIN_FETCH_TIMEOUT_MS),
    });
    const fetchedAt = deps.now().toISOString();
    if (res.status !== 200) {
      throw new FetchRefused(`${chain} source ${spec.id}: HTTP ${res.status} from ${spec.url}; record it and route the chain to the Chrome pass`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    deps.save(spec.file, body);
    records.push({ id: spec.id, url: spec.url, file: spec.file, status: res.status, bytes: body.length, sha256: sha256(body), fetchedAt });
  }
  return { chain, records };
}

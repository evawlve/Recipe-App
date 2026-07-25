/**
 * debug-retrieval-probe.ts — for each query, dump what EACH retrieval source returns.
 *
 * Answers "why did this line drop?" by separating a DATASET gap (nothing exists in
 * any lane) from a LANE/RANKING gap (records exist, retrieval or rerank lost them).
 *
 * ---------------------------------------------------------------------------
 * COST + SIDE EFFECTS (read this before running it over hundreds of drops)
 * ---------------------------------------------------------------------------
 * - NO LLM CALLS. Nothing here reaches OpenRouter/Ollama. `gatherCandidates` does
 *   keyword search (Typesense `off_foods` + Postgres FDC) and, only when
 *   SEMANTIC_SEARCH_ENABLED=true, a LOCAL ONNX query embedding — no paid tokens.
 * - IT IS NOT PURELY READ-ONLY. `searchFatSecretLane` fires
 *   `persistFatSecretHits` as a registered background task, which UPSERTS
 *   FatSecretFood / FatSecretServing rows (corpus hydration of FS API results —
 *   it never touches FoodMapping, so it cannot change a cached pick). For a
 *   strictly read-only run set FATSECRET_RETRIEVAL_ENABLED=false BEFORE this
 *   module is loaded; the lane then returns [] without calling the API.
 * - FatSecret API quota IS consumed per query (Premier tier), twice per query in
 *   fact: once by the direct lane call and once inside gatherCandidates. Pass
 *   `{ skipFatSecretLaneCall: true }` to drop the direct call and rely on the
 *   gather pass alone.
 *
 * Usage (unchanged):
 *   ts-node ... scripts/debug-retrieval-probe.ts '<query1>' '<query2>' ...
 *   ts-node ... scripts/debug-retrieval-probe.ts --file <queries.txt>
 */
import * as nodeFs from 'fs';
import { searchFatSecretLane } from '../src/lib/mapping/fatsecret-lane';
import { gatherCandidates } from '../src/lib/mapping/gather-candidates';

/** One candidate, flattened to the fields a triage reader needs. */
export interface ProbeCandidate {
    /** `off_<barcode>` | `fdc_<id>` | `fs_<fsId>` — the repoint target vocabulary. */
    id: string | null;
    source: string | null;
    name: string | null;
    brand: string | null;
    score: number | null;
}

export interface RetrievalProbe {
    query: string;
    /** Direct FatSecret lane call. `null` when skipped, `{error}` when it threw. */
    fatsecret: { count: number; top: ProbeCandidate[] } | { error: string } | null;
    /** Combined OFF + FDC + FS through gatherCandidates (branded path forces OFF on). */
    gather: { total: number; bySource: Record<string, number>; top: ProbeCandidate[] } | { error: string };
}

export interface RetrievalProbeOptions {
    /** How many candidates per source to ask for (default 8, same as the pipeline). */
    maxPerSource?: number;
    /** How many candidates to keep in the report (default 6). */
    topN?: number;
    /** Skip the direct FatSecret lane call — halves FS API quota per query. */
    skipFatSecretLaneCall?: boolean;
}

function toProbeCandidate(c: unknown): ProbeCandidate {
    const r = c as { id?: string; source?: string; foodName?: string; name?: string; brandName?: string | null; score?: number };
    return {
        id: r.id ?? null,
        source: r.source ?? null,
        name: r.foodName ?? r.name ?? null,
        brand: r.brandName ?? null,
        score: typeof r.score === 'number' ? +r.score.toFixed(3) : null,
    };
}

/**
 * Probe every retrieval lane for one query. Never throws: per-lane failures are
 * captured as `{ error }` so a batch caller keeps going.
 */
export async function probeRetrieval(query: string, opts: RetrievalProbeOptions = {}): Promise<RetrievalProbe> {
    const maxPerSource = opts.maxPerSource ?? 8;
    const topN = opts.topN ?? 6;
    const out: RetrievalProbe = { query, fatsecret: null, gather: { error: 'not run' } };

    if (!opts.skipFatSecretLaneCall) {
        try {
            const fs = await searchFatSecretLane(query, maxPerSource);
            out.fatsecret = { count: fs.length, top: fs.slice(0, topN).map(toProbeCandidate) };
        } catch (e) {
            out.fatsecret = { error: (e as Error)?.message ?? String(e) };
        }
    }

    try {
        const cands = await gatherCandidates(query, null, query, { isBrandedQuery: true, maxPerSource });
        const bySource: Record<string, number> = {};
        for (const c of cands) bySource[c.source ?? '?'] = (bySource[c.source ?? '?'] ?? 0) + 1;
        out.gather = {
            total: cands.length,
            bySource,
            top: cands.slice(0, topN).map(toProbeCandidate),
        };
    } catch (e) {
        out.gather = { error: (e as Error)?.message ?? String(e) };
    }
    return out;
}

/** Every gathered candidate that survived to the report, flattened. */
export function probeCandidates(probe: RetrievalProbe): ProbeCandidate[] {
    const out: ProbeCandidate[] = [];
    if (probe.gather && !('error' in probe.gather)) out.push(...probe.gather.top);
    if (probe.fatsecret && !('error' in probe.fatsecret)) out.push(...probe.fatsecret.top);
    return out;
}

function readQueriesFromArgv(argv: string[]): string[] {
    const fileIdx = argv.indexOf('--file');
    if (fileIdx >= 0) {
        return nodeFs
            .readFileSync(argv[fileIdx + 1], 'utf8')
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);
    }
    return argv.filter(a => !a.startsWith('--'));
}

async function main(): Promise<void> {
    const queries = readQueriesFromArgv(process.argv.slice(2));
    for (const q of queries) {
        console.log(JSON.stringify(await probeRetrieval(q)));
    }
    process.exit(0);
}

if (require.main === module) {
    main().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

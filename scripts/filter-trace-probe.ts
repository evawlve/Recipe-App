/**
 * filter-trace-probe.ts — gather candidates, then run each candidate through the
 * SAME filter functions the pipeline uses, and report which filter (if any)
 * dropped it. Pinpoints the exact rejection cause behind an `all_filtered` or a
 * "the right record existed and we lost it" drop.
 *
 * Recorded lesson (venue-brand blackout, PR #150): `FilterResult.reason` is a
 * blanket label, not the cause. Two plausible diagnoses were wrong and only
 * running gather+filter with debug logs settled it — which is what this does.
 *
 * ---------------------------------------------------------------------------
 * COST + SIDE EFFECTS
 * ---------------------------------------------------------------------------
 * - NO LLM CALLS. `filterCandidatesByTokens` / `hasCoreTokenMismatch` /
 *   `deriveMustHaveTokens` are pure deterministic token logic.
 * - Same caveat as debug-retrieval-probe for the gather step: FatSecret lane
 *   hits are background-upserted into FatSecretFood/FatSecretServing and FS API
 *   quota is consumed. Set FATSECRET_RETRIEVAL_ENABLED=false before load for a
 *   strictly read-only run.
 *
 * Usage (unchanged):
 *   ts-node ... scripts/filter-trace-probe.ts '<query1>' '<query2>' ...
 */
import { gatherCandidates, type UnifiedCandidate } from '../src/lib/mapping/gather-candidates';
import {
    filterCandidatesByTokens,
    hasCoreTokenMismatch,
    deriveMustHaveTokens,
} from '../src/lib/mapping/filter-candidates';

/** Where a candidate died (or that it survived both filters). */
export type CandidateFate = 'KEPT' | 'DROPPED@filterCandidatesByTokens' | 'DROPPED@coreTokenMismatch';

export interface TracedCandidate {
    /** `off_<barcode>` | `fdc_<id>` | `fs_<fsId>`. */
    id: string | null;
    source: string | null;
    name: string | null;
    brand: string | null;
    score: number | null;
    fate: CandidateFate;
}

export interface FilterTrace {
    query: string;
    gathered: number;
    mustHaveTokens: string[];
    keptAfterTokenFilter: number;
    removedByTokenFilter: number;
    /** FilterResult.reason — a blanket label, NOT the per-candidate cause. */
    tokenFilterReason: string | null;
    droppedByCoreToken: number;
    survivors: number;
    /** Every gathered candidate with its fate (capped by `topN`, default all). */
    candidates: TracedCandidate[];
    error?: string;
}

export interface FilterTraceOptions {
    maxPerSource?: number;
    /** Cap on candidates reported (default: all gathered). */
    topN?: number;
}

function flatten(c: UnifiedCandidate, fate: CandidateFate): TracedCandidate {
    return {
        id: c.id ?? null,
        source: c.source ?? null,
        name: c.name ?? null,
        brand: c.brandName ?? null,
        score: typeof c.score === 'number' ? +c.score.toFixed(3) : null,
        fate,
    };
}

/**
 * Trace one query through gather -> filterCandidatesByTokens -> hasCoreTokenMismatch.
 *
 * Fates are keyed on candidate `id`, not on `name|brand` as the original ad-hoc
 * probe did: two OFF SKUs routinely share a name+brand pair (near-dups across
 * barcodes), which made the name-keyed version report the survivor's fate for
 * the dropped twin.
 */
export async function traceFilters(query: string, opts: FilterTraceOptions = {}): Promise<FilterTrace> {
    const maxPerSource = opts.maxPerSource ?? 8;
    const trace: FilterTrace = {
        query,
        gathered: 0,
        mustHaveTokens: [],
        keptAfterTokenFilter: 0,
        removedByTokenFilter: 0,
        tokenFilterReason: null,
        droppedByCoreToken: 0,
        survivors: 0,
        candidates: [],
    };

    let cands: UnifiedCandidate[];
    try {
        cands = await gatherCandidates(query, null, query, { isBrandedQuery: true, maxPerSource });
    } catch (e) {
        trace.error = (e as Error)?.message ?? String(e);
        return trace;
    }

    trace.gathered = cands.length;
    try {
        trace.mustHaveTokens = deriveMustHaveTokens(query);
        const fr = filterCandidatesByTokens(cands, query, { debug: false, rawLine: query });
        trace.keptAfterTokenFilter = fr.filtered.length;
        trace.removedByTokenFilter = fr.removedCount;
        trace.tokenFilterReason = fr.reason ?? null;

        const survivedTokenFilter = new Set(fr.filtered.map(c => c.id));
        for (const c of fr.filtered) {
            if (hasCoreTokenMismatch(query, c.name, c.brandName)) trace.droppedByCoreToken++;
        }
        trace.survivors = trace.keptAfterTokenFilter - trace.droppedByCoreToken;

        const reported = opts.topN != null ? cands.slice(0, opts.topN) : cands;
        for (const c of reported) {
            let fate: CandidateFate;
            if (!survivedTokenFilter.has(c.id)) fate = 'DROPPED@filterCandidatesByTokens';
            else if (hasCoreTokenMismatch(query, c.name, c.brandName)) fate = 'DROPPED@coreTokenMismatch';
            else fate = 'KEPT';
            trace.candidates.push(flatten(c, fate));
        }
    } catch (e) {
        trace.error = (e as Error)?.message ?? String(e);
    }
    return trace;
}

/** Candidates that survived BOTH filters. */
export function survivingCandidates(trace: FilterTrace): TracedCandidate[] {
    return trace.candidates.filter(c => c.fate === 'KEPT');
}

/** The original CLI rendering, preserved. */
export function printFilterTrace(trace: FilterTrace): void {
    console.log('\n================ ' + trace.query + ' ================');
    if (trace.error) console.log('ERROR:', trace.error);
    console.log('gathered:', trace.gathered, ' mustHave=', JSON.stringify(trace.mustHaveTokens));
    console.log(`filterCandidatesByTokens: kept ${trace.keptAfterTokenFilter}/${trace.gathered} `
        + `(removed ${trace.removedByTokenFilter})`);
    console.log(`hasCoreTokenMismatch: dropped ${trace.droppedByCoreToken}, final survivors ${trace.survivors}`);
    for (const c of trace.candidates.slice(0, 8)) {
        console.log(`   [${c.source}] ${JSON.stringify(c.name)} brand=${c.brand ?? '-'} `
            + `score=${c.score ?? '?'} => ${c.fate}`);
    }
}

async function main(): Promise<void> {
    for (const q of process.argv.slice(2).filter(a => !a.startsWith('--'))) {
        printFilterTrace(await traceFilters(q));
    }
    process.exit(0);
}

if (require.main === module) {
    main().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

/**
 * warm-cold-diff.test.ts — FAIL INJECTION for the warm/cold instrument.
 * ==========================================================================
 * Playbook §11 class B, "absence encoded as a PASS". A warm/cold differ has an
 * unusually cheap way to lie, and the lie looks like the best possible result:
 *
 *     COMPARABLE (both sides)    0
 *     IDENTITY-DIVERGED          0    0.0%
 *     VERDICT: exit 0
 *
 * Four different shapes of nothing produce that. This file drives the REAL
 * `runWarmCold()` — the same function the CLI calls, with the real `probe()`, the
 * real `summarize()` and the real `warmColdExitCode()` in the path — into each of
 * them and asserts a NONZERO exit and a reason that names what went wrong:
 *
 *   1. the population is empty
 *   2. every line was skipped
 *   3. ONE SIDE IS DARK — every cold (or warm) probe errors. This is the one the
 *      instrument would otherwise report as "0 divergences", because a row that
 *      never answered on one side simply never enters the comparison.
 *   4. the warm side never hit the cache, so warm ≡ cold by construction and 0
 *      divergences is a tautology.
 *
 * Two of the blocks below run against a REAL http.createServer, not a stubbed
 * fetch, because "the instrument goes red when the box is broken" is a claim about
 * transport, and a stubbed fetch is not transport.
 *
 * EVERY BLOCK CARRIES A POSITIVE CONTROL, per fail-closed.test.ts: a guard that
 * refuses everything is a tautology, not a test. The controls here are stronger
 * than usual — they assert the instrument finds a KNOWN PLANTED divergence and
 * puts the band crossing on the correct side, so a "safe" refactor that made the
 * comparison vacuous would fail here rather than pass quietly.
 *
 * NO DATABASE. NO LIVE BOX. The only network is a loopback stub this file starts.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';

import {
    WARM_QS,
    COLD_QS,
    WC_VOID_EXIT,
    WC_PARTIAL_EXIT,
    bandVerdict,
    bodyFor,
    cachePopulation,
    classifyRow,
    decompose,
    emptyNoiseLedger,
    fetchServerStamp,
    filePopulation,
    goldenPopulation,
    inBand,
    noiseReceiptPath,
    pct,
    populationFingerprint,
    probe,
    runNoiseFloor,
    runReport,
    runWarmCold,
    selfDiff,
    serverChanged,
    summarize,
    warmColdExitCode,
    writeReceiptSummary,
    type PopLine,
    type ProbeConfig,
    type Row,
    type SideObs,
} from '../warm-cold-diff';

// ===========================================================================
// helpers
// ===========================================================================

const QUIET = () => { /* the report is asserted through RunResult.lines, not stdout */ };

function line(over: Partial<PopLine> = {}): PopLine {
    return { id: 'x1', query: '1 cup spinach', shape: 'item', category: 'test', band: null, ...over };
}

function obs(over: Partial<SideObs> = {}): SideObs {
    return {
        ok: true, error: null, httpStatus: 200,
        foodId: 'off_1', foodName: 'Spinach', source: 'openfoodfacts',
        grams: 60, kcal: 14, servingTier: 'fs_label_volume_declared', cacheHit: 'early',
        itemCount: 1, foodIds: ['off_1'], writeReceipt: null, ms: 5,
        ...over,
    };
}

function row(over: { line?: Partial<PopLine>; warm?: Partial<SideObs>; cold?: Partial<SideObs> } = {}): Row {
    return { line: line(over.line), warm: obs(over.warm), cold: obs(over.cold) };
}

const errObs = (msg: string): SideObs => ({
    ok: false, error: msg, httpStatus: 500,
    foodId: null, foodName: null, source: null, grams: null, kcal: null,
    itemCount: 0, foodIds: [], writeReceipt: null, ms: 1,
});

/**
 * A loopback /api/nlp/parse. `plan(side, body)` returns either the array of items
 * to send, or a number to send as an HTTP status with no body.
 */
async function startStub(
    plan: (side: 'warm' | 'cold', body: any) => unknown[] | number,
): Promise<{ base: string; close: () => Promise<void>; hits: Array<{ side: string; qs: string }> }> {
    const hits: Array<{ side: string; qs: string }> = [];
    const server = http.createServer((req, res) => {
        const qs = (req.url ?? '').split('?')[1] ?? '';
        const side = qs.includes('nocache=1') ? 'cold' : 'warm';
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c as Buffer));
        req.on('end', () => {
            hits.push({ side, qs });
            let body: any = {};
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* keep {} */ }
            const out = plan(side as 'warm' | 'cold', body);
            if (typeof out === 'number') { res.writeHead(out); res.end('boom'); return; }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(out));
        });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    return {
        base: `http://127.0.0.1:${port}`,
        hits,
        close: () => new Promise<void>(r => server.close(() => r())),
    };
}

function cfgFor(base: string): ProbeConfig {
    return { base, apiKey: 'test-key', timeoutMs: 4000 };
}

/** A well-formed response item. */
function item(over: Record<string, unknown> = {}) {
    return {
        foodId: 'off_1', foodName: 'Spinach', source: 'openfoodfacts',
        grams: 60, nutrition: { calories: 14 },
        servingTier: 'fs_label_volume_declared', cacheHit: 'early',
        ...over,
    };
}

// ===========================================================================
// 1. THE WIRE CONTRACT — the difference between the two sides IS the experiment
// ===========================================================================

describe('the two query strings are the whole experiment', () => {
    it('warm reads the cache and saves nothing; cold bypasses it and saves nothing', () => {
        expect(WARM_QS).toBe('nosave=1&debug=1');
        expect(COLD_QS).toBe('nocache=1&nosave=1&debug=1');
        // nosave on BOTH sides is what stops the instrument mutating what it measures.
        expect(WARM_QS).toContain('nosave=1');
        expect(COLD_QS).toContain('nosave=1');
        // debug on BOTH sides is what makes `cacheHit` observable — without it on the
        // warm side there is no way to prove the warm side was warm, which is guard 4.
        expect(WARM_QS).toContain('debug=1');
        expect(COLD_QS).toContain('debug=1');
        // and only the cold side may carry nocache.
        expect(WARM_QS).not.toContain('nocache');
    });

    it('an `item` line never posts free text, so the LLM segmenter cannot run for it', () => {
        expect(bodyFor(line({ shape: 'item' }))).toEqual({ items: [{ rawText: '1 cup spinach', mealType: 'snacks' }] });
        expect(bodyFor(line({ shape: 'text', query: 'about 2 cups of spinach' }))).toEqual({ text: 'about 2 cups of spinach' });
    });
});

// ===========================================================================
// 2. VERDICT ORDERING — a divergence must be attributed to its FIRST cause
// ===========================================================================

describe('classifyRow reports the most fundamental difference, not the last one', () => {
    it('either side unanswered is ERROR and nothing else', () => {
        expect(classifyRow({ line: line(), warm: obs(), cold: errObs('HTTP 500') })).toBe('ERROR');
        expect(classifyRow({ line: line(), warm: errObs('HTTP 500'), cold: obs() })).toBe('ERROR');
    });

    it('a different item COUNT outranks a different id — the split itself moved', () => {
        expect(classifyRow(row({
            warm: { itemCount: 1, foodIds: ['a'], foodId: 'a' },
            cold: { itemCount: 2, foodIds: ['b', 'c'], foodId: 'b' },
        }))).toBe('SEGMENTATION-DIVERGED');
    });

    it('a different id outranks different grams', () => {
        expect(classifyRow(row({ warm: { foodId: 'a', grams: 120 }, cold: { foodId: 'b', grams: 60 } })))
            .toBe('IDENTITY-DIVERGED');
    });

    it('same record, different grams is GRAMS-DIVERGED', () => {
        expect(classifyRow(row({ warm: { grams: 120 }, cold: { grams: 60 } }))).toBe('GRAMS-DIVERGED');
    });

    it('same record and grams, different rung is TIER-DIVERGED', () => {
        expect(classifyRow(row({ warm: { servingTier: 'volume_unit' }, cold: { servingTier: 'fs_label_volume_declared' } })))
            .toBe('TIER-DIVERGED');
    });

    it('an ABSENT debug echo is absence of the observable, never a tier difference', () => {
        const warm = obs(); delete (warm as any).servingTier;
        expect(classifyRow({ line: line(), warm, cold: obs({ servingTier: 'volume_unit' }) })).toBe('SAME');
    });

    it('float noise under 0.1 g is not a finding', () => {
        expect(classifyRow(row({ warm: { grams: 60 }, cold: { grams: 60.05 } }))).toBe('SAME');
        expect(classifyRow(row({ warm: { grams: 60 }, cold: { grams: 60.2 } }))).toBe('GRAMS-DIVERGED');
    });

    it('POSITIVE CONTROL — two identical sides are SAME', () => {
        expect(classifyRow(row())).toBe('SAME');
    });
});

describe('the golden band is the only thing that adjudicates WHICH side is right', () => {
    it('null grams is never inside a band', () => {
        expect(inBand(null, [40, 100])).toBe(false);
        expect(inBand(60, null)).toBeNull();
    });

    it('the band is inclusive at both ends', () => {
        expect(inBand(40, [40, 100])).toBe(true);
        expect(inBand(100, [40, 100])).toBe(true);
        expect(inBand(39.9, [40, 100])).toBe(false);
    });

    it('n-prose-08 as measured: cold inside, warm outside — the cache is the wrong side', () => {
        const bv = bandVerdict(row({
            line: { id: 'n-prose-08', band: [40, 100] },
            warm: { grams: 240, foodId: 'off_9336137000028' },
            cold: { grams: 60, foodId: 'fs_36577' },
        }));
        expect(bv).toEqual({ warmIn: false, coldIn: true, crossed: true, insideSide: 'cold' });
    });

    it('both sides outside the band is NOT a crossing — the band, or the pipeline, is wrong for both', () => {
        const bv = bandVerdict(row({ line: { band: [2, 3.5] }, warm: { grams: 5.2 }, cold: { grams: 6.0 } }));
        expect(bv.crossed).toBe(false);
        expect(bv.warmIn).toBe(false);
        expect(bv.coldIn).toBe(false);
    });

    it('POSITIVE CONTROL — a real crossing the OTHER way is attributed to warm', () => {
        const bv = bandVerdict(row({ line: { band: [20, 40] }, warm: { grams: 26 }, cold: { grams: 120 } }));
        expect(bv).toEqual({ warmIn: true, coldIn: false, crossed: true, insideSide: 'warm' });
    });

    it('a row whose cold side errored contributes NO band verdict at all', () => {
        const bv = bandVerdict({ line: line({ band: [40, 100] }), warm: obs({ grams: 60 }), cold: errObs('HTTP 500') });
        expect(bv).toEqual({ warmIn: null, coldIn: null, crossed: false, insideSide: null });
    });
});

// ===========================================================================
// 3. THE EXIT VERDICT — the four shapes of nothing
// ===========================================================================

const HEALTHY = {
    population: 100, skipped: 0, probed: 100,
    warmErrors: 0, coldErrors: 0, comparable: 100, warmCacheHits: 90,
};

describe('warmColdExitCode refuses every shape of nothing', () => {
    it('an empty population is VOID, and the reason blames the SOURCE, not the cache', () => {
        const v = warmColdExitCode({ ...HEALTHY, population: 0, probed: 0, comparable: 0, warmCacheHits: 0 });
        expect(v.code).toBe(WC_VOID_EXIT);
        expect(v.reason).toContain('ZERO lines');
        expect(v.reason).toContain('not about the cache');
    });

    it('a fully skipped population is VOID and points at the SKIPPED section', () => {
        const v = warmColdExitCode({ ...HEALTHY, skipped: 100, probed: 0, comparable: 0, warmCacheHits: 0 });
        expect(v.code).toBe(WC_VOID_EXIT);
        expect(v.reason).toContain('SKIPPED');
    });

    it('a DARK COLD SIDE is VOID even though every warm probe succeeded', () => {
        const v = warmColdExitCode({ ...HEALTHY, coldErrors: 100, comparable: 0, warmCacheHits: 0 });
        expect(v.code).toBe(WC_VOID_EXIT);
        expect(v.reason).toContain('COLD side is entirely dark');
    });

    it('a DARK WARM SIDE is VOID even though every cold probe succeeded', () => {
        const v = warmColdExitCode({ ...HEALTHY, warmErrors: 100, comparable: 0, warmCacheHits: 0 });
        expect(v.code).toBe(WC_VOID_EXIT);
        expect(v.reason).toContain('WARM side is entirely dark');
    });

    it('errors split across the two sides so that NO row is comparable is still VOID', () => {
        // 50 rows dark warm, 50 dark cold: neither side is wholly dark, yet zero
        // comparisons ran. This is the gap a naive "all warm failed?" check leaves.
        const v = warmColdExitCode({ ...HEALTHY, warmErrors: 50, coldErrors: 50, comparable: 0, warmCacheHits: 0 });
        expect(v.code).toBe(WC_VOID_EXIT);
        expect(v.reason).toContain('ZERO of 100 rows had BOTH sides answer');
    });

    it('a warm side that never hit the cache is VOID — the comparison is a tautology', () => {
        const v = warmColdExitCode({ ...HEALTHY, warmCacheHits: 0 });
        expect(v.code).toBe(WC_VOID_EXIT);
        expect(v.reason).toContain('warm cache HIT');
        expect(v.reason).toContain('tautology');
    });

    it('--allow-unwarmed downgrades that to a clean exit, and only that guard', () => {
        expect(warmColdExitCode({ ...HEALTHY, warmCacheHits: 0 }, { allowUnwarmed: true }).code).toBe(0);
        // it does NOT rescue a dark side
        expect(warmColdExitCode({ ...HEALTHY, coldErrors: 100, comparable: 0, warmCacheHits: 0 }, { allowUnwarmed: true }).code)
            .toBe(WC_VOID_EXIT);
    });

    it('a partial transport failure is exit 1 and says the rows were verified by nothing', () => {
        const v = warmColdExitCode({ ...HEALTHY, coldErrors: 7, comparable: 93 });
        expect(v.code).toBe(WC_PARTIAL_EXIT);
        expect(v.reason).toContain('verified by NOTHING');
    });

    it('POSITIVE CONTROL — a healthy run is exit 0 with no reason at all', () => {
        expect(warmColdExitCode(HEALTHY)).toEqual({ code: 0, reason: null });
    });

    it('POSITIVE CONTROL — one warm cache hit out of a hundred is enough to be a real run', () => {
        expect(warmColdExitCode({ ...HEALTHY, warmCacheHits: 1 }).code).toBe(0);
    });

    it('the VOID code is distinct from success AND from partial', () => {
        expect(WC_VOID_EXIT).not.toBe(0);
        expect(WC_VOID_EXIT).not.toBe(WC_PARTIAL_EXIT);
    });
});

// ===========================================================================
// 4. SUMMARIZE — errored rows must never be counted as agreement
// ===========================================================================

describe('summarize counts only what was actually compared', () => {
    it('an errored row is NOT a SAME row', () => {
        const rows: Row[] = [
            row(),
            { line: line({ id: 'x2' }), warm: obs(), cold: errObs('HTTP 502') },
        ];
        const c = summarize(rows, [], 2);
        expect(c.probed).toBe(2);
        expect(c.comparable).toBe(1);
        expect(c.same).toBe(1);
        expect(c.coldErrors).toBe(1);
        expect(c.identityDiverged).toBe(0);
    });

    it('skips are carried into the counts, not dropped', () => {
        const c = summarize([row()], [{ id: 'z', query: 'q', reason: 'beyond --limit 1' }], 1);
        expect(c.skipped).toBe(1);
    });

    it('warm cache hits are counted only from a real echo', () => {
        const noEcho = obs(); delete (noEcho as any).cacheHit; delete (noEcho as any).servingTier;
        const c = summarize([{ line: line(), warm: noEcho, cold: obs() }], [], 1);
        expect(c.warmCacheHits).toBe(0);
        expect(c.echoMissing).toBe(1);
    });

    it('a warm echo of cacheHit:null counts as a MISS, not a hit', () => {
        const c = summarize([{ line: line(), warm: obs({ cacheHit: null }), cold: obs() }], [], 1);
        expect(c.warmCacheHits).toBe(0);
    });

    it('a probe with NO X-Write-Receipt is counted, because nosave was not in force on it', () => {
        const s = writeReceiptSummary([
            { line: line(), warm: obs({ writeReceipt: { suppress: ['aiServing', 'segmentationCache'], refusedTotal: 0 } }), cold: obs() },
        ]);
        expect(s.probes).toBe(2);
        expect(s.withReceipt).toBe(1);
        expect(s.withoutReceipt).toBe(1);
        expect(s.suppressSets).toEqual(['aiServing+segmentationCache']);
    });

    it('refusedTotal is summed across probes, and an errored probe is not a probe', () => {
        const s = writeReceiptSummary([
            { line: line(), warm: obs({ writeReceipt: { suppress: ['aiServing'], refusedTotal: 3 } }), cold: errObs('x') },
            { line: line(), warm: obs({ writeReceipt: { suppress: ['aiServing'], refusedTotal: 4 } }), cold: obs({ writeReceipt: { suppress: [], refusedTotal: 0 } }) },
        ]);
        expect(s.probes).toBe(3);
        expect(s.refusedTotal).toBe(7);
        expect(s.suppressSets).toEqual(['(none)', 'aiServing']);
    });

    it('POSITIVE CONTROL — the 3-of-29 shape from the 2026-08-19 hand measurement', () => {
        const rows: Row[] = [
            // cold-only pass, x3 (all prose)
            row({ line: { id: 'n-prose-01', category: 'prose', band: [200, 280] }, warm: { grams: 120, foodId: 'a' }, cold: { grams: 243, foodId: 'b' } }),
            row({ line: { id: 'n-prose-03', category: 'prose', band: [100, 200] }, warm: { grams: 240, foodId: 'a' }, cold: { grams: 120, foodId: 'b' } }),
            row({ line: { id: 'n-prose-08', category: 'prose', band: [40, 100] }, warm: { grams: 240, foodId: 'a' }, cold: { grams: 60, foodId: 'b' } }),
            // both inside, different record — benign identity churn
            row({ line: { id: 'n-serv-01', category: 'serving_unit', band: [40, 100] }, warm: { grams: 50, foodId: 'a' }, cold: { grams: 70, foodId: 'b' } }),
            // neither inside — the band is wrong
            row({ line: { id: 'n-dens-07', category: 'serving_unit', band: [2, 3.5] }, warm: { grams: 5.2, foodId: 'a' }, cold: { grams: 6, foodId: 'b' } }),
        ];
        const c = summarize(rows, [], 5);
        expect(c.comparable).toBe(5);
        expect(c.identityDiverged).toBe(5);
        expect(c.banded).toBe(5);
        expect(c.bandCrossed).toBe(3);
        expect(c.coldOnlyIn).toBe(3);
        expect(c.warmOnlyIn).toBe(0);
        expect(c.bandBothIn).toBe(1);
        expect(c.bandBothOut).toBe(1);
        // and the decomposition must show prose carrying all three
        const byCat = decompose(rows, r => r.line.category);
        const prose = byCat.find(s => s.label === 'prose')!;
        expect(prose.n).toBe(3);
        expect(prose.bandCrossed).toBe(3);
        expect(prose.coldOnlyIn).toBe(3);
    });
});

// ===========================================================================
// 5. FAIL INJECTION AGAINST A REAL SERVER — transport, not a stubbed fetch
// ===========================================================================

describe('FAIL INJECTION: the instrument goes red against a broken box', () => {
    const LINES: PopLine[] = [
        line({ id: 'a', query: '1 cup spinach', band: [40, 100] }),
        line({ id: 'b', query: '1 cup cheerios', band: [20, 40] }),
        line({ id: 'c', query: '1 tsp salt', band: [4.5, 7] }),
    ];

    it('a DARK COLD SIDE exits VOID and never prints a clean divergence verdict', async () => {
        const stub = await startStub((side) => (side === 'cold' ? 503 : [item()]));
        try {
            const res = await runWarmCold({
                lines: LINES, populationDesc: 'fail-injection', skips: [],
                cfg: cfgFor(stub.base), concurrency: 2, log: QUIET,
            });
            expect(res.code).toBe(WC_VOID_EXIT);
            expect(res.counts.coldErrors).toBe(3);
            expect(res.counts.comparable).toBe(0);
            expect(res.reason).toContain('COLD side is entirely dark');
            const text = res.lines.join('\n');
            expect(text).toContain('VERDICT: exit 2');
            expect(text).not.toContain('VERDICT: exit 0');
        } finally { await stub.close(); }
    });

    it('a DARK WARM SIDE exits VOID too — a cold-only run is not a warm/cold measurement', async () => {
        const stub = await startStub((side) => (side === 'warm' ? 500 : [item()]));
        try {
            const res = await runWarmCold({
                lines: LINES, populationDesc: 'fail-injection', skips: [],
                cfg: cfgFor(stub.base), concurrency: 2, log: QUIET,
            });
            expect(res.code).toBe(WC_VOID_EXIT);
            expect(res.reason).toContain('WARM side is entirely dark');
        } finally { await stub.close(); }
    });

    it('an EMPTY ARRAY is absence of a reading, not a reading of "nothing matched"', async () => {
        const stub = await startStub(() => []);
        try {
            const res = await runWarmCold({
                lines: LINES, populationDesc: 'fail-injection', skips: [],
                cfg: cfgFor(stub.base), concurrency: 2, log: QUIET,
            });
            expect(res.code).toBe(WC_VOID_EXIT);
            expect(res.counts.warmErrors).toBe(3);
            expect(res.counts.coldErrors).toBe(3);
        } finally { await stub.close(); }
    });

    it('a warm side that answers but never HITS the cache exits VOID as a tautology', async () => {
        // Both sides answer identically and the warm echo says cacheHit:null. Zero
        // divergences — and it means nothing, because warm ran the pipeline too.
        const stub = await startStub(() => [item({ cacheHit: null })]);
        try {
            const res = await runWarmCold({
                lines: LINES, populationDesc: 'fail-injection', skips: [],
                cfg: cfgFor(stub.base), concurrency: 2, log: QUIET,
            });
            expect(res.counts.comparable).toBe(3);
            expect(res.counts.identityDiverged).toBe(0);
            expect(res.code).toBe(WC_VOID_EXIT);
            expect(res.reason).toContain('tautology');
            expect(res.lines.join('\n')).toContain('WARM SIDE WAS COLD');
        } finally { await stub.close(); }
    });

    it('an EMPTY POPULATION exits VOID rather than reporting a spotless run', async () => {
        const stub = await startStub(() => [item()]);
        try {
            const res = await runWarmCold({
                lines: [], populationDesc: 'fail-injection (empty)', skips: [],
                cfg: cfgFor(stub.base), concurrency: 2, log: QUIET,
            });
            expect(res.code).toBe(WC_VOID_EXIT);
            expect(res.reason).toContain('ZERO lines');
            expect(stub.hits).toHaveLength(0);
        } finally { await stub.close(); }
    });

    it('a FULLY SKIPPED population exits VOID and PRINTS every skip with its reason', async () => {
        const stub = await startStub(() => [item()]);
        try {
            const res = await runWarmCold({
                lines: [],
                populationDesc: 'fail-injection (all skipped)',
                skips: [
                    { id: 'a', query: '1 cup spinach', reason: 'beyond --limit 0' },
                    { id: 'b', query: '1 cup cheerios', reason: 'beyond --limit 0' },
                ],
                cfg: cfgFor(stub.base), concurrency: 2, log: QUIET,
            });
            expect(res.code).toBe(WC_VOID_EXIT);
            const text = res.lines.join('\n');
            expect(text).toContain('SKIPPED        2');
            expect(text).toContain('beyond --limit 0');
        } finally { await stub.close(); }
    });

    it('a PARTIAL failure is exit 1, and the percentages are over the comparable rows only', async () => {
        let n = 0;
        const stub = await startStub((side) => {
            // fail the cold probe of exactly one line
            if (side === 'cold' && ++n === 2) return 504;
            return [item()];
        });
        try {
            const res = await runWarmCold({
                lines: LINES, populationDesc: 'fail-injection', skips: [],
                cfg: cfgFor(stub.base), concurrency: 1, log: QUIET,
            });
            expect(res.code).toBe(WC_PARTIAL_EXIT);
            expect(res.counts.coldErrors).toBe(1);
            expect(res.counts.comparable).toBe(2);
            expect(res.lines.join('\n')).toContain('every percentage below is over THIS');
        } finally { await stub.close(); }
    });

    it('POSITIVE CONTROL — a healthy box with a PLANTED divergence exits 0 and finds it', async () => {
        const stub = await startStub((side, body) => {
            const q: string = body?.items?.[0]?.rawText ?? body?.text ?? '';
            if (q.includes('spinach')) {
                // the n-prose-08 shape: warm holds the wrong record at 240 g, cold
                // resolves the right one at 60 g. Band [40,100] ⇒ cold-only inside.
                return side === 'warm'
                    ? [item({ foodId: 'off_9336137000028', grams: 240, servingTier: 'volume_unit' })]
                    : [item({ foodId: 'fs_36577', grams: 60, cacheHit: null })];
            }
            return [item({ foodId: `id_${q.slice(0, 6)}` })];
        });
        try {
            const res = await runWarmCold({
                lines: LINES, populationDesc: 'positive control', skips: [],
                cfg: cfgFor(stub.base), concurrency: 2, log: QUIET,
            });
            expect(res.code).toBe(0);
            expect(res.counts.comparable).toBe(3);
            expect(res.counts.identityDiverged).toBe(1);
            expect(res.counts.same).toBe(2);
            expect(res.counts.banded).toBe(3);
            expect(res.counts.bandCrossed).toBe(1);
            expect(res.counts.coldOnlyIn).toBe(1);
            expect(res.counts.warmOnlyIn).toBe(0);
            expect(res.counts.warmCacheHits).toBe(3);
            const text = res.lines.join('\n');
            expect(text).toContain('VERDICT: exit 0');
            expect(text).toContain('off_9336137000028');
            expect(text).toContain('fs_36577');
        } finally { await stub.close(); }
    });

    it('POSITIVE CONTROL — the run really did send two differently-flagged requests per line', async () => {
        const stub = await startStub(() => [item()]);
        try {
            await runWarmCold({
                lines: LINES, populationDesc: 'positive control', skips: [],
                cfg: cfgFor(stub.base), concurrency: 1, log: QUIET,
            });
            // Two probe requests per line, plus the /api/ok server-stamp
            // bracket (one read before the pass, one after — qs-less GETs).
            const probes = stub.hits.filter(h => h.qs !== '');
            const stamps = stub.hits.filter(h => h.qs === '');
            expect(probes).toHaveLength(6);
            expect(stamps).toHaveLength(2);
            expect(probes.filter(h => h.side === 'warm')).toHaveLength(3);
            expect(probes.filter(h => h.side === 'cold')).toHaveLength(3);
            for (const h of probes) {
                expect(h.qs).toContain('nosave=1');
                expect(h.qs).toContain('debug=1');
            }
        } finally { await stub.close(); }
    });

    it('--dry-run sends nothing at all', async () => {
        const stub = await startStub(() => [item()]);
        try {
            const res = await runWarmCold({
                lines: LINES, populationDesc: 'dry run', skips: [],
                cfg: cfgFor(stub.base), concurrency: 2, dryRun: true, log: QUIET,
            });
            expect(stub.hits).toHaveLength(0);
            expect(res.lines.join('\n')).toContain('DRY RUN');
        } finally { await stub.close(); }
    });
});

// ===========================================================================
// 6. THE PROBE ITSELF
// ===========================================================================

describe('probe treats every non-reading as a non-reading', () => {
    it('a non-2xx is an error carrying its status', async () => {
        const stub = await startStub(() => 418);
        try {
            const o = await probe(line(), 'warm', cfgFor(stub.base));
            expect(o.ok).toBe(false);
            expect(o.error).toBe('HTTP 418');
            expect(o.httpStatus).toBe(418);
        } finally { await stub.close(); }
    });

    it('a connection refused is an error, not a silent null reading', async () => {
        // port 1 on loopback: nothing listens, and the connect fails immediately.
        const o = await probe(line(), 'cold', { base: 'http://127.0.0.1:1', apiKey: 'k', timeoutMs: 2000 });
        expect(o.ok).toBe(false);
        expect(o.foodId).toBeNull();
        expect(o.error).toMatch(/ERROR:/);
    });

    it('an ABSENT debug echo leaves servingTier UNDEFINED, a present one leaves it null-able', async () => {
        const stub = await startStub((side) => (side === 'warm'
            ? [{ foodId: 'x', foodName: 'X', grams: 10 }]
            : [item({ servingTier: null, cacheHit: null })]));
        try {
            const warm = await probe(line(), 'warm', cfgFor(stub.base));
            const cold = await probe(line(), 'cold', cfgFor(stub.base));
            expect(Object.prototype.hasOwnProperty.call(warm, 'servingTier')).toBe(false);
            expect(cold.servingTier).toBeNull();
        } finally { await stub.close(); }
    });

    it('POSITIVE CONTROL — a full item is read into every field', async () => {
        const stub = await startStub(() => [item(), item({ foodId: 'off_2' })]);
        try {
            const o = await probe(line(), 'warm', cfgFor(stub.base));
            expect(o.ok).toBe(true);
            expect(o.foodId).toBe('off_1');
            expect(o.grams).toBe(60);
            expect(o.kcal).toBe(14);
            expect(o.cacheHit).toBe('early');
            expect(o.itemCount).toBe(2);
            expect(o.foodIds).toEqual(['off_1', 'off_2']);
        } finally { await stub.close(); }
    });
});

// ===========================================================================
// 7. NOISE FLOOR — a floor measured over nothing would clear a diff it never saw
// ===========================================================================

describe('the noise floor refuses to be measured over nothing', () => {
    it('a dark side yields a VOID floor, not a floor of 0', async () => {
        const stub = await startStub(() => 500);
        try {
            const { code, receipt } = await runNoiseFloor({
                lines: [line()], populationDesc: 'nf', side: 'cold',
                cfg: cfgFor(stub.base), concurrency: 1, log: QUIET,
            });
            expect(code).toBe(WC_VOID_EXIT);
            expect(receipt.comparable).toBe(0);
            expect(receipt.idDiffs).toBe(0);
        } finally { await stub.close(); }
    });

    it('POSITIVE CONTROL — a flapping cold side is measured as a non-zero floor', async () => {
        let n = 0;
        const stub = await startStub(() => [item({ foodId: `off_${++n % 2}` })]);
        try {
            const { code, receipt } = await runNoiseFloor({
                lines: [line(), line({ id: 'y' })], populationDesc: 'nf', side: 'cold',
                cfg: cfgFor(stub.base), concurrency: 1, log: QUIET,
            });
            expect(code).toBe(0);
            expect(receipt.comparable).toBe(2);
            expect(receipt.idDiffs).toBe(2);
        } finally { await stub.close(); }
    });

    it('POSITIVE CONTROL — a stable side is a floor of 0 over a non-zero denominator', async () => {
        const stub = await startStub(() => [item()]);
        try {
            const { code, receipt } = await runNoiseFloor({
                lines: [line(), line({ id: 'y' })], populationDesc: 'nf', side: 'warm',
                cfg: cfgFor(stub.base), concurrency: 2, log: QUIET,
            });
            expect(code).toBe(0);
            expect(receipt.comparable).toBe(2);
            expect(receipt.idDiffs).toBe(0);
        } finally { await stub.close(); }
    });

    it('selfDiff on an unanswered pair is not comparable and contributes nothing', () => {
        expect(selfDiff(errObs('x'), obs()).comparable).toBe(false);
        expect(selfDiff(obs(), obs({ foodId: 'other' }))).toMatchObject({ comparable: true, id: true });
    });

    it('the fingerprint is order-independent but content-sensitive', () => {
        const a = [line({ id: '1', query: 'a' }), line({ id: '2', query: 'b' })];
        const b = [line({ id: '2', query: 'b' }), line({ id: '1', query: 'a' })];
        expect(populationFingerprint(a)).toBe(populationFingerprint(b));
        expect(populationFingerprint(a)).not.toBe(populationFingerprint([line({ query: 'c' })]));
        // shape is part of the identity: the same string as text and as item is not
        // the same probe, because only one of them can reach the segmenter.
        expect(populationFingerprint([line({ query: 'a', shape: 'item' })]))
            .not.toBe(populationFingerprint([line({ query: 'a', shape: 'text' })]));
    });
});

// ===========================================================================
// 8. POPULATIONS — a shrinking denominator must be visible
// ===========================================================================

describe('population builders account for every line they were given', () => {
    const GOLDEN = {
        nlp: [
            { id: 'n-gen-01', category: 'generic_staples', item: { rawText: '200g chicken breast' }, grams: [190, 210] },
            { id: 'n-prose-08', category: 'prose', text: 'approximately 2 cups of spinach', grams: [40, 100] },
            { id: 'n-bad-01', category: 'broken' },
            { id: 'n-ki-01', category: 'match_quality', item: { rawText: 'qdoba burrito' }, knownIssue: true },
        ],
    };

    it('a malformed case is SKIPPED WITH A REASON, never dropped', () => {
        const p = goldenPopulation(GOLDEN);
        expect(p.lines.map(l => l.id)).toEqual(['n-gen-01', 'n-prose-08', 'n-ki-01']);
        expect(p.skips).toEqual([{ id: 'n-bad-01', query: '', reason: 'golden case declares neither `item.rawText` nor `text`' }]);
    });

    it('shape follows the case: `item` bypasses the segmenter, `text` may reach it', () => {
        const p = goldenPopulation(GOLDEN);
        expect(p.lines.find(l => l.id === 'n-gen-01')!.shape).toBe('item');
        expect(p.lines.find(l => l.id === 'n-prose-08')!.shape).toBe('text');
        expect(p.lines.find(l => l.id === 'n-prose-08')!.band).toEqual([40, 100]);
    });

    it('--limit truncation is COUNTED, because silent truncation reads as full coverage', () => {
        const p = goldenPopulation(GOLDEN, { limit: 1 });
        expect(p.lines).toHaveLength(1);
        expect(p.skips.filter(s => s.reason === 'beyond --limit 1')).toHaveLength(2);
        // total accounted for = every case the file offered
        expect(p.lines.length + p.skips.length).toBe(GOLDEN.nlp.length);
    });

    it('--grep exclusions are counted too', () => {
        const p = goldenPopulation(GOLDEN, { grep: 'prose' });
        expect(p.lines).toHaveLength(1);
        expect(p.lines.length + p.skips.length).toBe(GOLDEN.nlp.length);
    });

    it('--no-known-issue excludes the pinned cases and says so', () => {
        const p = goldenPopulation(GOLDEN, { includeKnownIssue: false });
        expect(p.lines.map(l => l.id)).not.toContain('n-ki-01');
        expect(p.skips.some(s => s.reason.includes('knownIssue'))).toBe(true);
    });

    it('the REAL golden set yields the pinned 285 nlp cases with nothing unaccounted for', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const real = require('../golden-set.json');
        const p = goldenPopulation(real);
        expect(p.lines.length + p.skips.length).toBe(real.nlp.length);
        // 271 / 105 since 2026-08-24: n-syn-01..06, six bare `text` lines with a
        // kcal100 band and no grams band (D-A9 / PR #381).
        // 274 / 165 / 108 since 2026-08-24 (same day): n-dup-01..03 (A7/K4, PR #382), grams + kcal100 bands.
        // 281 / 166 / 115 since 2026-08-24 (same day, third set): n-grd-01..07 (ground-meat identity), kcal100 bands + one grams band.
        // 285 / 169 / 119 since 2026-08-24 (fourth set): n-pct-01..04 (percent modifier, PR #385), three grams bands.
        // 288 / 169 / 122 since 2026-08-25: n-k3-01..03 (the FatSecret lane/builder seam, A8 row 1).
        // Three `text` lines and NO grams band — deliberately: on this tier grams is
        // `estimateServingGrams` (kcal / 2.0), so banding it would band the estimator,
        // not the record. They assert `total.calories` instead, which is the record's
        // own published serving and the number the user is billed.
        expect(p.lines).toHaveLength(288);
        expect(p.lines.filter(l => l.band).length).toBe(169);
        expect(p.lines.filter(l => l.shape === 'text').length).toBe(122);
        expect(p.lines.filter(l => l.category === 'prose').length).toBe(16);
    });

    it('a file population ignores comments and counts them', () => {
        const p = filePopulation('# a comment\n1 cup spinach\n\n1 tsp salt\n');
        expect(p.lines.map(l => l.query)).toEqual(['1 cup spinach', '1 tsp salt']);
        expect(p.skips).toHaveLength(1);
    });

    it('a cache population posts the key as an ITEM — the key is not free text', () => {
        const p = cachePopulation([{ normalizedForm: 'breast chicken', usedCount: 12 }], 'used');
        expect(p.lines[0].shape).toBe('item');
        expect(bodyFor(p.lines[0])).toEqual({ items: [{ rawText: 'breast chicken', mealType: 'snacks' }] });
        expect(p.lines[0].band).toBeNull();
    });

    it('an empty cache key is skipped with a reason', () => {
        const p = cachePopulation([{ normalizedForm: '', usedCount: 1 }], 'used');
        expect(p.lines).toHaveLength(0);
        expect(p.skips[0].reason).toContain('empty FoodMapping.normalizedForm');
    });
});

// ===========================================================================
// 9. THE IN-RUN NOISE CONTROL — a warm MISS is a same-side-twice draw
// ===========================================================================

describe('the warm-MISS control measures the instrument against itself', () => {
    it('a warm MISS that diverges is counted as noise, not as cache disagreement', () => {
        const c = summarize([
            // warm HIT + divergence: real cache disagreement
            row({ warm: { foodId: 'a', cacheHit: 'early' }, cold: { foodId: 'b' } }),
            // warm MISS + divergence: the warm probe ran the same pipeline, so this is noise
            row({ warm: { foodId: 'a', cacheHit: null }, cold: { foodId: 'b' } }),
            // warm MISS + agreement
            row({ warm: { foodId: 'a', cacheHit: null }, cold: { foodId: 'a' } }),
        ], [], 3);
        expect(c.warmCacheHits).toBe(1);
        expect(c.warmMisses).toBe(2);
        expect(c.warmMissDiverged).toBe(1);
        // it does NOT stop the row also counting as an identity divergence: the control
        // is a denominator to judge the headline against, not a filter on it.
        expect(c.identityDiverged).toBe(2);
    });

    it('an ABSENT echo is not a miss — absence of the observable is not an observation', () => {
        const noEcho = obs(); delete (noEcho as any).cacheHit; delete (noEcho as any).servingTier;
        const c = summarize([{ line: line(), warm: noEcho, cold: obs({ foodId: 'other' }) }], [], 1);
        expect(c.warmMisses).toBe(0);
        expect(c.warmMissDiverged).toBe(0);
    });

    it('POSITIVE CONTROL — an all-hit population has no control sample and says 0 of 0', () => {
        const c = summarize([row(), row()], [], 2);
        expect(c.warmMisses).toBe(0);
        expect(c.warmCacheHits).toBe(2);
        // and the printer must not divide by zero
        expect(pct(c.warmMissDiverged, c.warmMisses)).toBe('  n/a');
    });
});

// ===========================================================================
// 10. THE RE-RENDER — a stored verdict must not survive a re-read
// ===========================================================================

describe('report re-renders a stored run without trusting anything stored in it', () => {
    const TMP = path.join(os.tmpdir(), `wc-report-${process.pid}`);
    beforeAll(() => fs.mkdirSync(TMP, { recursive: true }));
    afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

    /** A receipt whose stored exit says 0 but whose rows say the cold side was dark. */
    function writeReceiptFile(name: string, rows: any[], extra: Record<string, unknown> = {}) {
        const p = path.join(TMP, name);
        fs.writeFileSync(p, JSON.stringify({
            kind: 'warm-cold-diff/run', version: 1, ranAt: '2026-08-19T00:00:00.000Z',
            base: 'http://box:3000', population: 'stored', exit: 0, exitReason: null,
            rows, skips: [], ...extra,
        }));
        return p;
    }

    it('a receipt that CLAIMS exit 0 over a dark cold side is re-verdicted VOID', () => {
        const p = writeReceiptFile('dark.json', [
            { id: 'a', query: 'q', shape: 'item', category: 'c', band: null, warm: obs(), cold: errObs('HTTP 500') },
        ]);
        const { code, lines } = runReport(p, QUIET);
        expect(code).toBe(WC_VOID_EXIT);
        expect(lines.join('\n')).toContain('COLD side is entirely dark');
    });

    it('POSITIVE CONTROL — a healthy receipt re-renders to exit 0 with the same counts', () => {
        const p = writeReceiptFile('ok.json', [
            { id: 'a', query: 'q1', shape: 'item', category: 'c', band: [40, 100], warm: obs({ grams: 240, foodId: 'x' }), cold: obs({ grams: 60, foodId: 'y' }) },
            { id: 'b', query: 'q2', shape: 'item', category: 'c', band: null, warm: obs(), cold: obs() },
        ]);
        const { code, lines } = runReport(p, QUIET);
        expect(code).toBe(0);
        const text = lines.join('\n');
        expect(text).toContain('IDENTITY-DIVERGED            1');
        expect(text).toContain('cold inside only           1');
    });

    it('a floor receipt written later is picked up by the re-render', () => {
        const rows = [
            { id: 'a', query: 'q1', shape: 'item', category: 'c', band: null, warm: obs(), cold: obs() },
        ];
        const p = writeReceiptFile('floor.json', rows);
        // before: no ledger at all
        expect(runReport(p, QUIET).lines.join('\n')).toContain('UNMEASURED');
        // after: a matching floor receipt exists
        const fingerprint = populationFingerprint([{ id: 'a', query: 'q1', shape: 'item', category: 'c', band: null }]);
        fs.writeFileSync(noiseReceiptPath(p), JSON.stringify({
            ...emptyNoiseLedger(),
            receipts: [{
                kind: 'warm-cold-diff/noise-floor', version: 1, ranAt: '2026-08-19T01:00:00.000Z',
                side: 'cold', population: 'stored', populationFingerprint: fingerprint,
                rows: 1, comparable: 1, idDiffs: 0, gramsDiffs: 0, itemCountDiffs: 0, tierDiffs: 0,
            }],
        }));
        const after = runReport(p, QUIET).lines.join('\n');
        expect(after).not.toContain('UNMEASURED');
        expect(after).toContain('cold self-noise floor');
    });

    it('a floor receipt for a DIFFERENT population is not applied', () => {
        const p = writeReceiptFile('mismatch.json', [
            { id: 'a', query: 'q1', shape: 'item', category: 'c', band: null, warm: obs(), cold: obs() },
        ]);
        fs.writeFileSync(noiseReceiptPath(p), JSON.stringify({
            ...emptyNoiseLedger(),
            receipts: [{
                kind: 'warm-cold-diff/noise-floor', version: 1, ranAt: '2026-08-19T01:00:00.000Z',
                side: 'cold', population: 'somewhere else', populationFingerprint: 'deadbeefdeadbeef',
                rows: 999, comparable: 999, idDiffs: 0, gramsDiffs: 0, itemCountDiffs: 0, tierDiffs: 0,
            }],
        }));
        expect(runReport(p, QUIET).lines.join('\n')).toContain('UNMEASURED');
    });

    it('an edited row set is flagged against the stored fingerprint', () => {
        const p = writeReceiptFile('edited.json', [
            { id: 'a', query: 'q1', shape: 'item', category: 'c', band: null, warm: obs(), cold: obs() },
        ], { populationFingerprint: 'notthehashatall' });
        expect(runReport(p, QUIET).lines.join('\n')).toContain('DOES NOT MATCH the stored');
    });
});

// ===========================================================================
// 9. SERVER STAMP — a receipt without a build is a diff trap
// ===========================================================================

function stampFetch(body: unknown, status = 200): typeof fetch {
    return (async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        headers: { get: () => null },
    })) as unknown as typeof fetch;
}

describe('the server stamp reads /api/ok and refuses to invent identity', () => {
    const cfg = (fetchImpl: typeof fetch): ProbeConfig =>
        ({ base: 'http://box', apiKey: 'k', timeoutMs: 1000, fetchImpl });

    it('a keyed read carries buildId, pid and since', async () => {
        const s = await fetchServerStamp(cfg(stampFetch({
            ok: true, buildId: 'B1', llm: { authorized: true, pid: 42, since: '2026-08-23T00:00:00.000Z' },
        })));
        expect(s).toEqual({ buildId: 'B1', pid: 42, since: '2026-08-23T00:00:00.000Z' });
    });

    it('an unauthorized read still stamps the public buildId, with pid/since null', async () => {
        const s = await fetchServerStamp(cfg(stampFetch({
            ok: true, buildId: 'B1', llm: { authorized: false },
        })));
        expect(s).toEqual({ buildId: 'B1', pid: null, since: null });
    });

    it('a non-2xx or a network error is null (UNSTAMPED), never a fabricated stamp', async () => {
        expect(await fetchServerStamp(cfg(stampFetch({}, 500)))).toBeNull();
        const throwing = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
        expect(await fetchServerStamp(cfg(throwing))).toBeNull();
    });

    it('serverChanged: any identity field moving is a change; a missing read is null, not false', () => {
        const a = { buildId: 'B1', pid: 42, since: 's' };
        expect(serverChanged(a, { ...a })).toBe(false);
        expect(serverChanged(a, { ...a, buildId: 'B2' })).toBe(true);  // deploy
        expect(serverChanged(a, { ...a, pid: 43 })).toBe(true);        // restart
        expect(serverChanged(a, { ...a, since: 's2' })).toBe(true);    // counter reset
        expect(serverChanged(null, a)).toBeNull();
        expect(serverChanged(a, null)).toBeNull();
    });
});

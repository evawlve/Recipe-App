/**
 * serving-divergence.test.ts — pins how far the screen's serving RECONSTRUCTION is
 * from the anchor the request path actually bills.
 *
 * THE CLASS OF BUG THIS CLOSES
 * `resolveServingGrams(row)` REIMPLEMENTS the billing anchor: it walks
 * OffFood.servingGrams -> FatSecretServing.grams -> OffServing.grams ->
 * FdcFood.servingSize -> FdcServing.grams -> flat 100 g. It never calls
 * `hydrateAndSelectServing`, so count-label serving, dose-anchored serving and the
 * FatSecret weight oracle are invisible to it. D5/D6 judged that reconstruction and
 * evicted cache rows on it. The screen carried the caveat "a row D5 calls 'no
 * serving weight' MAY IN FACT BILL CORRECTLY — **this was not measured**" from the
 * day it shipped, which is the whole failure mode: a reimplementation is not a
 * measurement until something compares it to the original, and nothing did.
 *
 * `realServing(row)` reads the anchor `hydrateAndSelectServing` actually produced,
 * baked into the fixture as `row.real`. This file compares the two OFFLINE — no DB,
 * no FDC API, no model call — because the fixture already carries the real numbers.
 * `measure-serving-divergence.ts` is the same method as a one-shot script; this is
 * the same method as a gate.
 *
 * MEASURED 2026-07-27 over the 81 batch-01 rows: 78/81 = 96.3% agreement.
 * The floor below is 95%, not 96.3%, so ordinary data movement in the fixture does
 * not fail CI — but a refactor that quietly re-points D5/D6 at the reconstruction,
 * or breaks one of the five resolution branches, drops well through it.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    realServing,
    resolveServingGrams,
    screenBatch,
    tierD,
    type Policy,
    type ScreenRow,
} from '../correctness-screen';

const FIXTURE = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'correctness-screen-batch01.json'), 'utf8'),
) as { rows: Array<{ verdict: string; row: ScreenRow }> };

const BATCH01: ScreenRow[] = FIXTURE.rows.map(r => r.row);

/** Below 95% the reconstruction is not a stand-in for the anchor at all. */
const AGREEMENT_FLOOR = 0.95;
/** What it actually measured when the fixture was baked. Reported, never asserted as equality. */
const MEASURED_AGREEMENT = 78 / 81;

const ALL_POLICIES: Policy[] = ['lenient', 'balanced', 'strict'];

/** The same comparison measure-serving-divergence.ts prints, as a function. */
function compare(rows: ScreenRow[]) {
    let agree = 0, errored = 0;
    const moved: Array<{ key: string; from: number | null; to: number | null; tier: string | null }> = [];
    for (const r of rows) {
        if (r.real?.error) { errored++; continue; }
        const a = resolveServingGrams(r).grams;
        // Compare what D5/D6 actually CONSUME, i.e. after flat-100g normalisation.
        // Comparing raw grams would count the flat-100g fallback as a disagreement
        // when both sides are saying "there is no anchor here".
        const b = realServing(r).grams;
        if (a == null && b == null) { agree++; continue; }
        if (a != null && b != null && Math.abs(a - b) < 0.01) { agree++; continue; }
        moved.push({ key: r.key, from: a, to: b, tier: r.real?.tier ?? null });
    }
    return { agree, errored, moved, judged: Math.max(1, rows.length - errored) };
}

/** The D5/D6 bucket a gram weight lands in — the only thing the disagreement can cost. */
function d56(g: number | null): 'D5' | 'D6' | '-' {
    if (g == null) return 'D5';
    if (g < 5 || g > 500) return 'D6';
    return '-';
}

describe('the fixture carries the REAL anchor, so this can be measured offline', () => {
    it('every row has a baked-in row.real — otherwise the comparison is vacuous', () => {
        // Without this the whole file degenerates: realServing() falls back to
        // resolveServingGrams() when `row.real` is undefined, so the two would agree
        // 81/81 by construction and the test would pass by measuring nothing.
        expect(BATCH01).toHaveLength(81);
        expect(BATCH01.filter(r => r.real === undefined)).toHaveLength(0);
    });

    it('does not touch the network', () => {
        const spy = jest.spyOn(globalThis, 'fetch');
        compare(BATCH01);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('reconstruction vs real billing anchor — pinned floor', () => {
    it(`agrees on at least ${(AGREEMENT_FLOOR * 100).toFixed(0)}% of rows (measured ${(MEASURED_AGREEMENT * 100).toFixed(1)}%)`, () => {
        const { agree, judged, moved } = compare(BATCH01);
        const rate = agree / judged;
        if (rate < AGREEMENT_FLOOR) {
            throw new Error(
                `serving reconstruction agreement fell to ${(rate * 100).toFixed(1)}% (${agree}/${judged}); `
                + `floor is ${(AGREEMENT_FLOOR * 100).toFixed(0)}%, measured baseline ${(MEASURED_AGREEMENT * 100).toFixed(1)}%. `
                + `Rows that moved: ${JSON.stringify(moved)}. `
                + 'Re-measure with: npx ts-node --project tsconfig.scripts.json --transpile-only '
                + '-r tsconfig-paths/register scripts/eval/measure-serving-divergence.ts');
        }
        expect(rate).toBeGreaterThanOrEqual(AGREEMENT_FLOOR);
    });

    it('the divergence is REAL — a handful of rows genuinely disagree', () => {
        // The counter-assertion to the floor. If `moved` were empty the floor above
        // would be satisfied by a reconstruction that had been silently aliased to
        // the real anchor, i.e. by deleting the thing being measured.
        const { moved } = compare(BATCH01);
        expect(moved.length).toBeGreaterThan(0);
        expect(moved.length).toBeLessThanOrEqual(Math.ceil(81 * (1 - AGREEMENT_FLOOR)));
    });

    it('names the rows where the screen would have judged a number nobody is billed', () => {
        // Pinned by key so the divergence stays legible rather than being a bare
        // percentage. These three are the entire measured gap:
        //   simple truth emerge protein bar — reconstruction found 55 g on the OFF
        //     record; the real path fell through to flat_100g_default (no anchor).
        //   kirkland cashews / publix sub  — reconstruction found NOTHING; the real
        //     path recovered a weight through the FatSecret serving-macros branch,
        //     which the reconstruction cannot see at all.
        const { moved } = compare(BATCH01);
        expect(moved.map(m => m.key).sort()).toEqual([
            'bar emerge protein simple truth',
            'cashew kirkland signature',
            'publix sandwich sub',
        ]);
    });

    it('all three disagreements change the D5/D6 verdict — this gap is not cosmetic', () => {
        const flips = BATCH01.filter(r =>
            d56(resolveServingGrams(r).grams) !== d56(realServing(r).grams));
        expect(flips).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// The invariant that made shipping the real anchor SAFE
// ---------------------------------------------------------------------------

describe('a row whose real anchor did not run can NEVER produce an EVICT-severity D5/D6', () => {
    /** Every shape that makes `judged` false. */
    const unjudged: Array<[string, Partial<ScreenRow>]> = [
        ['the --with-serving pass never ran', { real: undefined }],
        ['hydrateAndSelectServing returned nothing', { real: null }],
        ['hydration threw', { real: { grams: null, tier: null, kcal: null, error: 'FDC API 503' } }],
        ['the anchor is a fresh AI guess', { real: { grams: 1.2, tier: 'ai_estimated_serving', kcal: 7 } }],
        ['the anchor is an fdc size ESTIMATE', { real: { grams: 900, tier: 'fdc_size_estimate', kcal: 1400 } }],
    ];

    /** Rows engineered so the ONLY rule that can fire is a serving rule. */
    const servingOnlyRow = (over: Partial<ScreenRow>): ScreenRow => ({
        key: 'almond great value', src: 'openfoodfacts', conf: 0.9, validatedby: 'ai',
        mapfoodname: 'Great value, almonds', mapbrand: 'Great Value',
        recname: 'Great value, almonds, smoke', recbrand: 'Great Value',
        per100g: { calories: 600, protein: 21, carbs: 20, fat: 53 },
        off_serving_grams: null, off_serving_size: '', pkg_qty: null, pkg_unit: '',
        corruptreason: '', dupof: '', fs_serving_desc: '', fs_serving_grams: null,
        fs_serving_nutrients: null, recid: '0000000000001', n_off_servings: 1,
        off_serv_min_g: null, off_serv_max_g: null,
        fdc_serving_size: null, fdc_serving_unit: '', fdc_serv_min_g: null,
        seed: 'great value almonds',
        ...over,
    });

    it.each(unjudged)('%s -> D5/D6 are INFO under every policy', (_why, over) => {
        // Both the "no anchor" shape and the "absurd anchor" shape, because D5 and D6
        // are separate rules and only one of them fires per row.
        for (const shape of [{}, { fs_serving_grams: 1.0 }]) {
            const row = servingOnlyRow({ ...shape, ...over });
            expect(realServing(row).judged).toBe(false);
            for (const p of ALL_POLICIES) {
                const hits = tierD(row, p).filter(h => h.rule === 'D5' || h.rule === 'D6');
                expect(hits.length).toBeGreaterThan(0);                       // still REPORTS
                expect(hits.map(h => h.severity)).not.toContain('EVICT');     // never GATES
                expect(hits.every(h => h.detail.includes('UNJUDGED'))).toBe(true);
            }
        }
    });

    it('the whole batch run WITHOUT the real anchor yields zero D5/D6 evictions, even under --policy strict', () => {
        // This is the `--no-serving` run. `strict` lists BOTH D5 and D6 in its evict
        // set, so before the downgrade this configuration evicted rows on an
        // unmeasured reconstruction — the exact mistake PR #174 closed for the
        // serving gate.
        const stripped = BATCH01.map(r => ({ ...r, real: undefined }));
        const evicting = stripped.flatMap(r =>
            tierD(r, 'strict').filter(h => (h.rule === 'D5' || h.rule === 'D6') && h.severity === 'EVICT'));
        expect(evicting).toEqual([]);
    });

    it('POSITIVE CONTROL — with the real anchor present, D5/D6 DO evict under strict', () => {
        // Without this, "no EVICT" is satisfiable by rules that never fire, which is
        // a tautology rather than an invariant.
        const judgedRows = BATCH01.filter(r => realServing(r).judged);
        expect(judgedRows.length).toBeGreaterThan(70);
        const evicting = judgedRows.flatMap(r =>
            tierD(r, 'strict').filter(h => (h.rule === 'D5' || h.rule === 'D6') && h.severity === 'EVICT'));
        expect(evicting.length).toBeGreaterThan(0);
    });

    it('an unjudged serving row is never EVICTed by the combined decision either', () => {
        // The severity downgrade is only half the property — what ships is decide().
        const row = servingOnlyRow({ real: { grams: null, tier: null, kcal: null, error: 'boom' } });
        for (const p of ALL_POLICIES) {
            expect(screenBatch([row], p)[0].decision).not.toBe('EVICT');
        }
    });
});

/**
 * apply-repoints.test.ts — the first tests this script has ever had.
 *
 * It went untested because it was not importable: PrismaClient, process.argv
 * and an unconditional main() all ran at module scope. main() is now behind a
 * `require.main === module` guard and the decision logic is exported, so the
 * parts that can silently corrupt the cache are checkable.
 *
 * What these pin, in order of how much damage the absence cost:
 *   1. `fs_` is a THREE-character prefix. The old code had one
 *      startsWith('off_') test and an unguarded fall-through to
 *      parseInt(target.slice(4)), so `fs_4513` was read as FdcFood 513 — a
 *      real, unrelated record — and would have been written under
 *      validatedBy 'human-triage', which the write-guard then protects from
 *      correction. Nothing was ever corrupted by it, but only because none of
 *      the mangled ids happened to exist in FdcFood.
 *   2. The three target columns are mutually exclusive.
 *   3. A genuine zero-calorie record is not a missing-nutrition record.
 *
 * Added 2026-08-12, for the FatSecret empty-panel guard defect:
 *   4. An empty `nutrientsPer100g` is not "no nutrition" on the FatSecret lane.
 *      The panel-only guard refused 3,472 of 24,123 FatSecretFood rows (14.4%,
 *      measured 2026-08-12) that production bills every day, which is what
 *      actually killed repair batch 1's `claw mango white`. fsServingKcalBasis()
 *      mirrors buildFatSecretResult()'s macro-only pick and reads the Json
 *      through servingMacros(), the lane's own reader.
 *   5. The printed line for a row that already planned must be byte-identical
 *      after the change — that is what the dry-run parity gate asserts against
 *      the live corpus, and formatNutritionBasis() pins it here.
 */

import {
    parseTargetRef,
    targetColumns,
    readKcal,
    fsServingKcalBasis,
    formatNutritionBasis,
    unparseableTargets,
    conflictingKeys,
    checkSnapshotCoversPlans,
    type FsNutritionSource,
    type Plan,
    type Repoint,
} from '../apply-repoints';

function plan(over: Partial<Plan> = {}): Plan {
    return { seed: 's', key: 'k', action: 'UPDATE', target: 'off_1', ...over };
}
function repoint(over: Partial<Repoint> = {}): Repoint {
    return { seed: 's', target: 'off_1', class: 'c', severity: 'high', wasFood: 'w', ...over };
}

describe('parseTargetRef — the prefix allowlist', () => {
    it('resolves off_ by barcode, keeping the full remainder', () => {
        expect(parseTargetRef('off_0051933720008')).toEqual({ kind: 'off', barcode: '0051933720008' });
        // Barcodes are not always pure digits in this corpus.
        expect(parseTargetRef('off_44213149860112455')).toEqual({ kind: 'off', barcode: '44213149860112455' });
        expect(parseTargetRef('off_abc.def-1_2')).toEqual({ kind: 'off', barcode: 'abc.def-1_2' });
    });

    it('resolves fdc_ to an integer id', () => {
        expect(parseTargetRef('fdc_167762')).toEqual({ kind: 'fdc', fdcId: 167762 });
    });

    it('resolves fs_ off a THREE-character prefix, as a string', () => {
        expect(parseTargetRef('fs_4513')).toEqual({ kind: 'fs', fsId: '4513' });
        expect(parseTargetRef('fs_75421144')).toEqual({ kind: 'fs', fsId: '75421144' });
    });

    it('REGRESSION: fs_4513 is FatSecret 4513, never FdcFood 513', () => {
        const ref = parseTargetRef('fs_4513');
        expect(ref).not.toBeNull();
        expect(ref!.kind).toBe('fs');
        // The exact off-by-one the old fall-through produced.
        expect('fs_4513'.slice(4)).toBe('513');
        expect((ref as { fsId: string }).fsId).toBe('4513');
    });

    it('returns null for every prefix outside the allowlist, instead of guessing', () => {
        for (const bad of ['ai_9', 'ai_estimate_1', 'x', '', 'weird', 'OFF_123', 'FS_1', 'FDC_1']) {
            expect(parseTargetRef(bad)).toBeNull();
        }
    });

    it('returns null for a recognised prefix with a malformed payload', () => {
        for (const bad of ['off_', 'fdc_', 'fs_', 'fdc_abc', 'fs_abc', 'fdc_12a', 'fs_1.2', 'off_a b']) {
            expect(parseTargetRef(bad)).toBeNull();
        }
    });

    it('never returns a kind whose payload disagrees with the prefix', () => {
        for (const t of ['off_123', 'fdc_123', 'fs_123']) {
            const ref = parseTargetRef(t)!;
            expect(t.startsWith(ref.kind + '_')).toBe(true);
        }
    });
});

describe('targetColumns — the mutual-exclusion invariant', () => {
    it('sets exactly one target column per kind, nulling the other two', () => {
        const cases: Array<[string, string]> = [
            ['off_123', 'offBarcode'],
            ['fdc_123', 'fdcId'],
            ['fs_123', 'fsId'],
        ];
        for (const [target, expectedCol] of cases) {
            const cols = targetColumns(parseTargetRef(target)!);
            const set = (['offBarcode', 'fdcId', 'fsId'] as const).filter(c => cols[c] != null);
            expect(set).toEqual([expectedCol]);
        }
    });

    it('pairs each kind with the source string the production writer uses', () => {
        expect(targetColumns(parseTargetRef('off_1')!).source).toBe('openfoodfacts');
        expect(targetColumns(parseTargetRef('fdc_1')!).source).toBe('fdc');
        expect(targetColumns(parseTargetRef('fs_1')!).source).toBe('fatsecret');
    });

    it('always returns all three keys, so an upsert cannot omit one', () => {
        // The bug this pins: the old update block wrote offBarcode and fdcId
        // and omitted fsId, so repointing a row that carried an fsId left TWO
        // columns populated — and three read sites disagree on precedence when
        // that happens.
        for (const t of ['off_1', 'fdc_1', 'fs_1']) {
            const cols = targetColumns(parseTargetRef(t)!);
            expect(Object.keys(cols).sort()).toEqual(['fdcId', 'fsId', 'offBarcode', 'source']);
        }
    });
});

describe('readKcal', () => {
    it('reads calories, falling back to kcal', () => {
        expect(readKcal({ calories: 110 })).toBe(110);
        expect(readKcal({ kcal: 110 })).toBe(110);
    });

    it('treats a genuine zero as a value, not as missing', () => {
        // fs_6409498 (Bang Energy Drink) really is 0 kcal/100g. A falsy check
        // would skip it.
        expect(readKcal({ calories: 0 })).toBe(0);
        expect(readKcal({ calories: 0 })).not.toBeNull();
    });

    it('returns null for the empty object persistFatSecretHits writes on failure', () => {
        // It writes `nutrientsPer100g: (per100 ?? {})` — an empty object, not
        // null — so a null-check on the column itself would miss this.
        expect(readKcal({})).toBeNull();
        expect(readKcal(null)).toBeNull();
        expect(readKcal(undefined)).toBeNull();
        expect(readKcal({ calories: 'x' })).toBeNull();
    });
});

describe('fsServingKcalBasis — the empty-panel fallback the guard was missing', () => {
    const food = (over: Partial<FsNutritionSource> = {}): FsNutritionSource => ({
        defaultServingId: null,
        servings: [],
        ...over,
    });

    it('reads the live shape that was being refused: fs_67788437, panel {} + "1 can" 100 kcal', () => {
        // Measured on the box 2026-08-12:
        //   SELECT f."nutrientsPer100g"::text, f."defaultServingId", s."servingId",
        //          s.description, s.grams, s.nutrients::text
        //     FROM "FatSecretFood" f JOIN "FatSecretServing" s ON s."fsId" = f."fsId"
        //    WHERE f."fsId" = '67788437';
        //   -> {} | 55576913 | 55576913 | 1 can | NULL |
        //      {"fat":0,"sugar":2,"sodium":20,"protein":0,"calories":100,"carbohydrate":2}
        const basis = fsServingKcalBasis(food({
            defaultServingId: '55576913',
            servings: [{
                servingId: '55576913',
                description: '1 can',
                nutrients: { fat: 0, sugar: 2, sodium: 20, protein: 0, calories: 100, carbohydrate: 2 },
            }],
        }));
        expect(basis).toEqual({ kcal: 100, servingId: '55576913', description: '1 can' });
    });

    it('prefers the record\'s OWN default serving, matching the lane\'s macro-only pick', () => {
        // buildFatSecretResult() looks for row.defaultServingId FIRST and only
        // then falls back to "any serving with macros". A basis that ignored
        // defaultServingId would report the wrong portion on the multi-serving
        // records where the two disagree.
        const basis = fsServingKcalBasis(food({
            defaultServingId: 'B',
            servings: [
                { servingId: 'A', description: '1 oz', nutrients: { calories: 40 } },
                { servingId: 'B', description: '1 serving', nutrients: { calories: 560 } },
            ],
        }));
        expect(basis).toEqual({ kcal: 560, servingId: 'B', description: '1 serving' });
    });

    it('falls back to the first macro-bearing serving when the default carries none', () => {
        const basis = fsServingKcalBasis(food({
            defaultServingId: 'A',
            servings: [
                { servingId: 'A', description: '1 oz', nutrients: null },
                { servingId: 'B', description: '1 serving', nutrients: { calories: 630 } },
            ],
        }));
        expect(basis).toEqual({ kcal: 630, servingId: 'B', description: '1 serving' });
    });

    it('returns null only when NO serving carries macros — the lane\'s own refusal condition', () => {
        expect(fsServingKcalBasis(food())).toBeNull();
        expect(fsServingKcalBasis(food({
            servings: [{ servingId: 'A', description: '1 cup', nutrients: null }],
        }))).toBeNull();
        expect(fsServingKcalBasis(food({
            servings: [{ servingId: 'A', description: '1 cup', nutrients: { protein: 3 } }],
        }))).toBeNull();
    });

    it('treats a genuine zero-calorie serving as billable, not as missing', () => {
        // Same trap readKcal has: a falsy check refuses a real 0 kcal drink.
        expect(fsServingKcalBasis(food({
            servings: [{ servingId: 'A', description: '1 can', nutrients: { calories: 0 } }],
        }))).toEqual({ kcal: 0, servingId: 'A', description: '1 can' });
    });

    it('reads string-typed Json the way the lane bills it, because it IS the lane\'s reader', () => {
        // A re-implementation using Number() would read '' as a genuine 0 kcal
        // billing basis. servingMacros() parseFloats and refuses it. This test
        // dies if anyone re-derives the reader here.
        expect(fsServingKcalBasis(food({
            servings: [{ servingId: 'A', description: '1 bar', nutrients: { calories: '210' } }],
        }))).toEqual({ kcal: 210, servingId: 'A', description: '1 bar' });
        expect(fsServingKcalBasis(food({
            servings: [{ servingId: 'A', description: '1 bar', nutrients: { calories: '' } }],
        }))).toBeNull();
    });

    it('does NOT apply to OffFood or FdcFood: neither production path has a serving macro source', () => {
        // Guard against a future "generalise it to all three lanes" edit. The
        // OFF and FDC reads select nutrientsPer100g (+ servingSize/servingGrams
        // for OFF) and no per-serving nutrients exist to fall back to, so the
        // panel-only test there matches production and must stay.
        expect(readKcal({})).toBeNull();
    });
});

describe('formatNutritionBasis — the printed line, and the parity property', () => {
    it('prints a panel-backed plan EXACTLY as it did before the serving fallback existed', () => {
        // This is the gate the whole change rests on: a row that planned before
        // must print byte-identically after. The literal is the pre-change
        // format string, written out rather than re-derived.
        expect(formatNutritionBasis(plan({ kcal100: 204 }))).toBe('204 kcal/100g');
        expect(formatNutritionBasis(plan({ kcal100: 39.6 }))).toBe('40 kcal/100g');
        expect(formatNutritionBasis(plan({ kcal100: 0 }))).toBe('0 kcal/100g');
        expect(formatNutritionBasis(plan({}))).toBe('kcal n/a');
    });

    it('labels a serving-basis plan per SERVING and as a CAPABILITY, never per 100 g and never as a forecast', () => {
        const s = formatNutritionBasis(plan({
            servingBasis: { kcal: 100, servingId: '55576913', description: '1 can' },
        }));
        expect(s).toBe('billable from "1 can" (100 kcal)');
        expect(s).not.toContain('/100g');
        // "billable from", never "bills": this function has no input that can
        // tell it what production will actually charge. The serving cascade
        // picks the grams (batch 2's `stevia` defeated three independent
        // predictions of the rung), and buildFatSecretResult() refuses a bare
        // query outright under BARE_LABEL_MIN_GRAMS = 3 g, which covers 127 of
        // the 3,472 empty-panel FatSecret rows. An operator reading this line as
        // a forecast is how a verification draw gets downgraded to a formality.
        expect(s).not.toMatch(/\bbills\b/);
        // Parity is unaffected: a serving-basis line can only appear on a row
        // that previously SKIPped, so no already-planned row's output moves.
    });

    it('lets the panel win when both are somehow set, so no existing line can change', () => {
        expect(formatNutritionBasis(plan({
            kcal100: 204,
            servingBasis: { kcal: 100, servingId: 'A', description: '1 can' },
        }))).toBe('204 kcal/100g');
    });
});

describe('unparseableTargets — fail closed on a mis-shaped file', () => {
    it('is empty when every target is in the vocabulary', () => {
        expect(unparseableTargets([
            repoint({ target: 'off_1' }), repoint({ target: 'fdc_2' }), repoint({ target: 'fs_3' }),
        ])).toEqual([]);
    });

    it('names every offending entry with its seed', () => {
        const bad = unparseableTargets([
            repoint({ seed: 'ok', target: 'off_1' }),
            repoint({ seed: 'nope', target: 'ai_9' }),
            repoint({ seed: 'alsonope', target: 'fs_abc' }),
        ]);
        expect(bad).toHaveLength(2);
        expect(bad[0]).toContain('nope');
        expect(bad[0]).toContain('ai_9');
        expect(bad[1]).toContain('fs_abc');
    });
});

describe('conflictingKeys', () => {
    it('flags one key aimed at two different targets', () => {
        const c = conflictingKeys([
            plan({ key: 'rice', target: 'off_1' }),
            plan({ key: 'rice', target: 'fs_2' }),
        ]);
        expect(c).toHaveLength(1);
        expect(c[0].key).toBe('rice');
    });

    it('allows one key repeated with the SAME target', () => {
        expect(conflictingKeys([
            plan({ key: 'rice', target: 'off_1' }),
            plan({ key: 'rice', target: 'off_1' }),
        ])).toEqual([]);
    });

    it('ignores SKIPs, which write nothing', () => {
        expect(conflictingKeys([
            plan({ key: 'rice', target: 'off_1' }),
            plan({ key: 'rice', target: 'fs_2', action: 'SKIP' }),
        ])).toEqual([]);
    });
});

describe('checkSnapshotCoversPlans — the restore anchor', () => {
    const snap = (keys: string[]) => JSON.stringify({
        table: 'FoodMapping',
        rows: keys.map(k => ({ normalizedForm: k, foodName: 'x' })),
    });

    it('accepts a snapshot containing every row the run would overwrite', () => {
        const r = checkSnapshotCoversPlans(snap(['rice', 'oats']), [plan({ key: 'rice' })]);
        expect(r.ok).toBe(true);
        expect(r.rowCount).toBe(2);
        expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('REFUSES when a row being overwritten is absent from the snapshot', () => {
        const r = checkSnapshotCoversPlans(snap(['oats']), [plan({ key: 'rice' })]);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('OVERWRITE');
        expect(r.missingKeys).toEqual(['rice']);
    });

    it('does not require coverage of CREATEs, which destroy nothing', () => {
        const r = checkSnapshotCoversPlans(snap([]), [plan({ key: 'new', action: 'CREATE' })]);
        expect(r.ok).toBe(true);
    });

    it('ignores SKIPs', () => {
        const r = checkSnapshotCoversPlans(snap([]), [plan({ key: 'rice', action: 'SKIP' })]);
        expect(r.ok).toBe(true);
    });

    it('refuses a snapshot of the wrong table', () => {
        const r = checkSnapshotCoversPlans(JSON.stringify({ table: 'OffFood', rows: [] }), []);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('OffFood');
    });

    it('refuses a file that is not a snapshot at all', () => {
        expect(checkSnapshotCoversPlans('not json', []).ok).toBe(false);
        expect(checkSnapshotCoversPlans(JSON.stringify({ table: 'FoodMapping' }), []).ok).toBe(false);
    });

    it('hashes the exact bytes it was given, so the outcome file pins the artifact', () => {
        const a = checkSnapshotCoversPlans(snap(['rice']), []);
        const b = checkSnapshotCoversPlans(snap(['rice']), []);
        const c = checkSnapshotCoversPlans(snap(['oats']), []);
        expect(a.sha256).toBe(b.sha256);
        expect(a.sha256).not.toBe(c.sha256);
    });
});

/**
 * LANE B1b (2026-08-17) — the large volume units bill their volume.
 *
 * THE SYMPTOM. `normalizeUnitToken()` in `src/lib/parse/unit.ts` emits `l`,
 * `pint`, `quart` and `gallon`, and every one of them fell past every volume
 * branch to a flat 100 g on all three lanes, measured live 2026-08-17:
 *
 *   `1 liter of milk`   billed 100 g   true ~1030 g   10x under
 *   `1 quart of milk`   billed 100 g   true  ~946 g    9x under
 *   `1 pint of ice cream` billed 100 g  true  ~473 ml   5x under
 *   `1 gallon of milk`  billed 100 g   true ~3785 g   38x under
 *   `500 ml of milk`    billed 500 g   correct — the control
 *
 * The owner (`src/lib/units/volume-density.ts`) had no cell for them, so
 * `pickVolumeUnits()` dropped them from both `*_VOLUME_UNIT_SPELLINGS` gates,
 * `buildFatSecretResult()`'s private table lacked them, and the FDC terminal arm
 * (`fdc_unknown_unit`) / OFF `flat_100g_default` / FS `fs_per100g_fallback` each
 * billed 100 x qty. The pin that described that state — `unit:'liter'` in
 * `fdc-fallback-tiers.test.ts` — is FLIPPED there, not deleted.
 *
 * WHAT THIS FILE PINS. One block per surface the fix touched, in the order the
 * plan named them, plus the controls that must not move:
 *   1. the owner's cells (`VOLUME_UNIT_ML`, `resolveVolumeGrams().perUnit`)
 *      carry every spelling in `LARGE_VOLUME_UNIT_SPELLINGS`, class-scaled the
 *      way `ml` is;
 *   2. the FS builder's private table was byte-identical to the owner's export
 *      before it was replaced by it (the convergence proof the plan asked for);
 *   3. FDC lane — the parser spellings (`l`/`pint`/`quart`/`gallon`), the
 *      AI-parse spelling (`liter`) and the raw partitive spelling (`litre`) all
 *      reach the volume branch, and a genuine USDA "1 quart" row now anchors it;
 *   4. OFF lane — same spellings, same numbers, `ml` still the flat pin;
 *   5. FS lane — the record's own density row scales the litre/gallon.
 *   6. held-out spellings (`kilograms`, `serving`) still terminate — B1b did
 *      not widen the gate past the family it names.
 *
 * RED on master for every headline assertion in blocks 3–5 (100 g where 1000 g
 * is asserted); the controls (`500 ml`, `1 cup`, `2 kilograms`) are green on
 * both trees.
 */

import {
    VOLUME_UNIT_ML,
    LARGE_VOLUME_UNIT_SPELLINGS,
    resolveVolumeGrams,
} from '../../units/volume-density';
import { hydrateAndSelectServing, buildOffResult } from '../map-ingredient-with-fallback';
import { buildFatSecretResult } from '../build-fatsecret-result';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { prisma } from '../../db';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        fatSecretFood: { findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

// Both FDC AI rungs are OFF so the density fallback is the resolver under test;
// a live-model rung answering would mask the gate this file is about.
jest.mock('../../usda/fdc-ai-backfill', () => {
    const actual = jest.requireActual('../../usda/fdc-ai-backfill');
    return {
        ...actual,
        getOrCreateFdcSizeServings: jest.fn().mockResolvedValue(null),
        insertFdcAiServing: jest.fn().mockResolvedValue({ success: false, reason: 'mocked-off' }),
    };
});

jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return {
        ...actual,
        getOrCreateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'mocked-off' }),
    };
});

jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return {
        ...actual,
        estimateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'mocked-off' }),
    };
});

jest.mock('../../openfoodfacts/hydrate', () => ({
    hydrateOffCandidate: jest.fn(),
}));

const mockedFdcServingFindMany = prisma.fdcServing.findMany as unknown as jest.Mock;
const mockedFsFindUnique = prisma.fatSecretFood.findUnique as unknown as jest.Mock;
const mockedHydrateOff = hydrateOffCandidate as jest.Mock;

/** The millilitres the plan names, byte-for-byte what `VOLUME_IN_ML` in parse/unit.ts carries. */
const ML = { l: 1000, pint: 473.176, quart: 946.353, gallon: 3785.41 } as const;

function parsed(p: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: undefined, name: 'milk', ...p } as ParsedIngredient;
}

function fdcCandidate(name = 'Milk, whole') {
    return {
        id: 'fdc_1077',
        source: 'fdc' as const,
        name,
        score: 1,
        foodType: 'sr_legacy',
        nutrition: { kcal: 61, protein: 3.15, carbs: 4.8, fat: 3.25, per100g: true },
        rawData: {},
    } as never;
}

function offCandidate(name = 'Whole Milk') {
    return {
        id: 'off_100',
        source: 'openfoodfacts' as const,
        name,
        score: 1,
        foodType: 'generic',
        rawData: {},
    } as never;
}

function offHydrated(foodName: string) {
    return {
        foodId: 'off_100',
        foodName,
        brandName: null,
        nutrientsPer100g: { calories: 61, protein: 3.2, carbs: 4.8, fat: 3.3 },
        servingGrams: null,
        servingDescription: null,
        servingUnitCount: 1,
        packageQuantity: null,
        packageQuantityUnit: null,
    };
}

function fsCandidate(name = 'Whole Milk') {
    return {
        id: 'fs_4499',
        source: 'fatsecret' as const,
        name,
        brandName: null,
        score: 1,
        foodType: 'Generic',
        rawData: {},
    } as never;
}

/** A FatSecret milk row whose "1 cup" serving carries volumeMl — the record's own density. */
function fsMilkRow(servings: Array<Record<string, unknown>>) {
    return {
        fsId: '4499',
        name: 'Whole Milk',
        brandName: null,
        foodType: 'Generic',
        nutrientsPer100g: { kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3 },
        defaultServingId: 'svCup',
        fetchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        servings,
    };
}
const FS_CUP_SERVING = {
    servingId: 'svCup',
    description: '1 cup',
    measurementDescription: 'cup',
    grams: 244,
    volumeMl: 240,
    numberOfUnits: 1,
    nutrients: { calories: 149, protein: 7.7, carbohydrate: 11.7, fat: 7.9 },
};

beforeEach(() => {
    jest.clearAllMocks();
    // mockReset, not mockClear: a queued `mockResolvedValueOnce` that a test
    // did not consume (on the pre-fix tree the quart request never reaches the
    // matcher) must not leak into the next test's control.
    mockedFdcServingFindMany.mockReset().mockResolvedValue([]);
    mockedFsFindUnique.mockReset().mockResolvedValue(null);
});

// ------------------------------------------------------------------
// 1. The owner
// ------------------------------------------------------------------
describe('1. the owner carries the large units, class-scaled the way ml is', () => {
    it('LARGE_VOLUME_UNIT_SPELLINGS is the eleven-spelling family the plan names, and nothing held out', () => {
        expect([...LARGE_VOLUME_UNIT_SPELLINGS].sort()).toEqual([
            'gallon', 'gallons', 'l', 'liter', 'liters', 'litre', 'litres',
            'pint', 'pints', 'quart', 'quarts',
        ]);
        for (const heldOut of ['serving', 'portion', 'mg', 'kilograms', 'milliliter', 'millilitre']) {
            expect(LARGE_VOLUME_UNIT_SPELLINGS).not.toContain(heldOut);
        }
    });

    it('VOLUME_UNIT_ML: every spelling, the plan\'s millilitres', () => {
        for (const s of ['l', 'liter', 'liters', 'litre', 'litres']) expect(VOLUME_UNIT_ML[s]).toBe(ML.l);
        for (const s of ['pint', 'pints']) expect(VOLUME_UNIT_ML[s]).toBe(ML.pint);
        for (const s of ['quart', 'quarts']) expect(VOLUME_UNIT_ML[s]).toBe(ML.quart);
        for (const s of ['gallon', 'gallons']) expect(VOLUME_UNIT_ML[s]).toBe(ML.gallon);
        // Control: the pre-existing cells did not move.
        expect(VOLUME_UNIT_ML['cup']).toBe(240);
        expect(VOLUME_UNIT_ML['ml']).toBe(1);
    });

    it('LIQUID (milk): 1 l = 1000 g, 1 gallon = 3785.41 g — the ml cell x millilitres', () => {
        const milk = resolveVolumeGrams('Milk, whole');
        expect(milk.volumeClass).toBe('liquid');
        for (const s of LARGE_VOLUME_UNIT_SPELLINGS) {
            expect(milk.perUnit[s]).toBe(VOLUME_UNIT_ML[s] * milk.perUnit['ml']);
        }
        expect(milk.perUnit['l']).toBe(1000);
        expect(milk.perUnit['litre']).toBe(1000);
        expect(milk.perUnit['pint']).toBeCloseTo(473.176, 6);
        expect(milk.perUnit['quart']).toBeCloseTo(946.353, 6);
        expect(milk.perUnit['gallon']).toBeCloseTo(3785.41, 6);
        // Controls: unchanged cells.
        expect(milk.perUnit['cup']).toBe(240);
        expect(milk.perUnit['ml']).toBe(1);
    });

    it('PASTE (peanut butter): 1 l = 1000 g — follows the ml cell (1 g/ml), not the cup cell\'s 250/240', () => {
        const pb = resolveVolumeGrams('Peanut Butter');
        expect(pb.volumeClass).toBe('paste');
        expect(pb.perUnit['l']).toBe(1000);
        expect(pb.perUnit['gallon']).toBeCloseTo(3785.41, 6);
    });

    it('SOLID (flour): 1 l = 1000 x solidDensity, exactly as 1000 ml would', () => {
        const flour = resolveVolumeGrams('All Purpose Flour');
        expect(flour.volumeClass).toBe('solid');
        expect(flour.solidDensity).toBe(0.53);
        expect(flour.perUnit['l']).toBeCloseTo(530, 6);
        expect(flour.perUnit['l']).toBeCloseTo(1000 * flour.perUnit['ml'], 6);
        expect(flour.perUnit['quart']).toBeCloseTo(946.353 * 0.53, 6);
    });
});

// ------------------------------------------------------------------
// 2. The FS builder's private table was the owner's export, byte for byte
// ------------------------------------------------------------------
describe('2. buildFatSecretResult converged onto the owner\'s VOLUME_UNIT_ML', () => {
    /** VERBATIM: the private `VOLUME_UNIT_ML` build-fatsecret-result.ts carried until 2026-08-17. */
    const PRE_B1B_FS_VOLUME_UNIT_ML: Record<string, number> = {
        'cup': 240, 'cups': 240,
        'tbsp': 15, 'tablespoon': 15, 'tablespoons': 15,
        'tsp': 5, 'teaspoon': 5, 'teaspoons': 5,
        'ml': 1, 'milliliter': 1, 'milliliters': 1,
        'floz': 30, 'fl oz': 30,
    };

    it('every key the private copy had is in the owner with the identical value', () => {
        for (const [spelling, ml] of Object.entries(PRE_B1B_FS_VOLUME_UNIT_ML)) {
            expect(`${spelling}=${VOLUME_UNIT_ML[spelling]}`).toBe(`${spelling}=${ml}`);
        }
    });

    it('and the owner adds exactly the large units on top of it', () => {
        expect(Object.keys(VOLUME_UNIT_ML).sort())
            .toEqual([...Object.keys(PRE_B1B_FS_VOLUME_UNIT_ML), ...LARGE_VOLUME_UNIT_SPELLINGS].sort());
    });
});

// ------------------------------------------------------------------
// 3. FDC lane
// ------------------------------------------------------------------
describe('3. FDC lane — buildFdcResult bills the volume, no longer the terminal arm', () => {
    it.each([
        ['l', ML.l],
        ['pint', ML.pint],
        ['quart', ML.quart],
        ['gallon', ML.gallon],
    ])('parser spelling `%s`: one of it on milk → volume_unit, %s g', async (unit, grams) => {
        const r = await hydrateAndSelectServing(
            fdcCandidate(), parsed({ qty: 1, unit, name: 'milk' }), 0.9, `1 ${unit} milk`,
        );
        expect(r?.servingTier).toBe('volume_unit');
        expect(r?.grams).toBeCloseTo(grams, 6);
    });

    it('AI-parse spelling `liter` and raw partitive `litre` resolve to the same 1000 g', async () => {
        for (const unit of ['liter', 'litre', 'liters', 'litres']) {
            const r = await hydrateAndSelectServing(
                fdcCandidate(), parsed({ qty: 1, unit, name: 'milk' }), 0.9, `1 ${unit} of milk`,
            );
            expect(`${unit}:${r?.servingTier}:${r?.grams}`).toBe(`${unit}:volume_unit:1000`);
        }
    });

    it('2 gallons of milk → 2 x 3785.41 g (qty scales)', async () => {
        const r = await hydrateAndSelectServing(
            fdcCandidate(), parsed({ qty: 2, unit: 'gallons', name: 'milk' }), 0.9, '2 gallons milk',
        );
        expect(r?.servingTier).toBe('volume_unit');
        expect(r?.grams).toBeCloseTo(2 * ML.gallon, 6);
    });

    it('a genuine USDA "1 quart" row now anchors the request ahead of the density fallback', async () => {
        // SR Legacy "Milk, whole" carries `1 quart` = 976 g. Before B1b the
        // matcher's stem table did not know `quart`, so the row was invisible.
        mockedFdcServingFindMany.mockResolvedValueOnce([
            { description: '1 cup', grams: 244, isAiEstimated: false },
            { description: '1 quart', grams: 976, isAiEstimated: false },
        ]);
        const r = await hydrateAndSelectServing(
            fdcCandidate(), parsed({ qty: 1, unit: 'quart', name: 'milk' }), 0.9, '1 quart milk',
        );
        expect(r?.servingTier).toBe('fdc_label_volume');
        expect(r?.grams).toBe(976);
    });

    it('CONTROL (green on both trees): 500 ml milk → volume_unit, 500 g; 1 cup milk → 240 g', async () => {
        const ml = await hydrateAndSelectServing(
            fdcCandidate(), parsed({ qty: 500, unit: 'ml', name: 'milk' }), 0.9, '500 ml milk',
        );
        expect(ml?.servingTier).toBe('volume_unit');
        expect(ml?.grams).toBe(500);

        const cup = await hydrateAndSelectServing(
            fdcCandidate(), parsed({ qty: 1, unit: 'cup', name: 'milk' }), 0.9, '1 cup milk',
        );
        expect(cup?.servingTier).toBe('volume_unit');
        expect(cup?.grams).toBe(240);
    });

    it('CONTROL (green on both trees): the held-out spellings still terminate at fdc_unknown_unit', async () => {
        for (const unit of ['kilograms', 'serving', 'milliliters']) {
            const r = await hydrateAndSelectServing(
                fdcCandidate('Yam, raw'), parsed({ qty: 2, unit, name: 'yam' }), 0.9, `2 ${unit} yam`,
            );
            expect(`${unit}:${r?.servingTier}:${r?.grams}`).toBe(`${unit}:fdc_unknown_unit:200`);
        }
    });
});

// ------------------------------------------------------------------
// 4. OFF lane
// ------------------------------------------------------------------
describe('4. OFF lane — buildOffResult bills the volume, no longer flat_100g_default', () => {
    beforeEach(() => {
        mockedHydrateOff.mockResolvedValue(offHydrated('Whole Milk'));
    });

    it.each([
        ['l', ML.l],
        ['pint', ML.pint],
        ['quart', ML.quart],
        ['gallon', ML.gallon],
    ])('parser spelling `%s`: one of it on milk → volume_unit, %s g', async (unit, grams) => {
        const r = await buildOffResult(
            offCandidate(), parsed({ qty: 1, unit, name: 'milk' }), 0.9, `1 ${unit} milk`,
        );
        expect(r?.servingTier).toBe('volume_unit');
        expect(r?.grams).toBeCloseTo(grams, 6);
    });

    it('`liter` (AI-parse arm) and `litre` (raw partitive) → 1000 g', async () => {
        for (const unit of ['liter', 'litre']) {
            const r = await buildOffResult(
                offCandidate(), parsed({ qty: 1, unit, name: 'milk' }), 0.9, `1 ${unit} of milk`,
            );
            expect(`${unit}:${r?.servingTier}:${r?.grams}`).toBe(`${unit}:volume_unit:1000`);
        }
    });

    it('a SOLID-classed record bills the owner\'s density-scaled litre (the documented asymmetry with the flat ml pin)', async () => {
        mockedHydrateOff.mockResolvedValue(offHydrated('All Purpose Flour'));
        const litre = await buildOffResult(
            offCandidate('All Purpose Flour'), parsed({ qty: 1, unit: 'l', name: 'flour' }), 0.9, '1 l flour',
        );
        expect(litre?.servingTier).toBe('volume_unit');
        expect(litre?.grams).toBeCloseTo(530, 6);
        // The pinned flat ml cell, unchanged by B1b — 1000 ml of the same food is 1000 g.
        const ml = await buildOffResult(
            offCandidate('All Purpose Flour'), parsed({ qty: 1000, unit: 'ml', name: 'flour' }), 0.9, '1000 ml flour',
        );
        expect(ml?.servingTier).toBe('volume_unit');
        expect(ml?.grams).toBe(1000);
    });

    it('CONTROL (green on both trees): 500 ml milk → 500 g; 1 cup milk → 240 g', async () => {
        const ml = await buildOffResult(
            offCandidate(), parsed({ qty: 500, unit: 'ml', name: 'milk' }), 0.9, '500 ml milk',
        );
        expect(ml?.servingTier).toBe('volume_unit');
        expect(ml?.grams).toBe(500);

        const cup = await buildOffResult(
            offCandidate(), parsed({ qty: 1, unit: 'cup', name: 'milk' }), 0.9, '1 cup milk',
        );
        expect(cup?.servingTier).toBe('volume_unit');
        expect(cup?.grams).toBe(240);
    });
});

// ------------------------------------------------------------------
// 5. FS lane
// ------------------------------------------------------------------
describe('5. FS lane — buildFatSecretResult scales the record\'s own density to the litre/gallon', () => {
    it('1 l milk on a record with a "1 cup" 244 g / 240 ml serving → fs_label_volume, 1000 x 244/240', async () => {
        mockedFsFindUnique.mockResolvedValue(fsMilkRow([FS_CUP_SERVING]));
        const r = await buildFatSecretResult(
            fsCandidate(), parsed({ qty: 1, unit: 'l', name: 'milk' }), 0.9, '1 l milk',
        );
        expect(r?.servingTier).toBe('fs_label_volume');
        expect(r?.grams).toBeCloseTo(1000 * 244 / 240, 6);
    });

    it('1 gallon milk on the same record → 3785.41 x 244/240', async () => {
        mockedFsFindUnique.mockResolvedValue(fsMilkRow([FS_CUP_SERVING]));
        const r = await buildFatSecretResult(
            fsCandidate(), parsed({ qty: 1, unit: 'gallon', name: 'milk' }), 0.9, '1 gallon milk',
        );
        expect(r?.servingTier).toBe('fs_label_volume');
        expect(r?.grams).toBeCloseTo(ML.gallon * 244 / 240, 6);
    });

    it('a record with no volumeMl serving falls to the owner\'s density: 1 pint milk → 473.176 g (fs_volume_density)', async () => {
        mockedFsFindUnique.mockResolvedValue(fsMilkRow([{
            ...FS_CUP_SERVING, servingId: 'svCup', description: '1 cup', volumeMl: null,
        }]));
        // The "1 cup" row has grams but no volumeMl and does not name `pint`, so
        // neither the density path nor the declared-default path can use it.
        const r = await buildFatSecretResult(
            fsCandidate(), parsed({ qty: 1, unit: 'pint', name: 'milk' }), 0.9, '1 pint milk',
        );
        expect(r?.servingTier).toBe('fs_volume_density');
        expect(r?.grams).toBeCloseTo(ML.pint, 6);
    });

    it('a declared "1 pint" default row (no volumeMl) anchors a pint request through the stem table', async () => {
        mockedFsFindUnique.mockResolvedValue({
            ...fsMilkRow([{
                servingId: 'svPint', description: '1 pint', measurementDescription: 'pint',
                grams: 488, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 298, protein: 15.4, carbohydrate: 23.4, fat: 15.8 },
            }]),
            defaultServingId: 'svPint',
        });
        const r = await buildFatSecretResult(
            fsCandidate(), parsed({ qty: 1, unit: 'pint', name: 'milk' }), 0.9, '1 pint milk',
        );
        expect(r?.servingTier).toBe('fs_label_volume_declared');
        expect(r?.grams).toBe(488);
    });

    it('CONTROL (green on both trees): 500 ml milk → fs_label_volume, 500 x 244/240', async () => {
        mockedFsFindUnique.mockResolvedValue(fsMilkRow([FS_CUP_SERVING]));
        const r = await buildFatSecretResult(
            fsCandidate(), parsed({ qty: 500, unit: 'ml', name: 'milk' }), 0.9, '500 ml milk',
        );
        expect(r?.servingTier).toBe('fs_label_volume');
        expect(r?.grams).toBeCloseTo(500 * 244 / 240, 6);
    });
});

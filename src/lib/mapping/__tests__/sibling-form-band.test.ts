/**
 * SIB-FORM (s459): a dense record must not borrow a lighter product FORM's
 * serving. `siblingFormBand()` decides when a sibling borrow re-runs over
 * same-density siblings only; both borrows (brand rung (C2) and name rung (E))
 * apply it. Fixtures are the measured sibling groups (s459 pd-sib findings).
 */
import { buildOffResult } from '../map-ingredient-with-fallback';
import {
    siblingFormBand,
    SIBLING_FORM_DENSE_SELF_KCAL,
    SIBLING_FORM_MISMATCH_RATIO,
} from '../serving/hydration-lane';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { prisma } from '../../db';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));
jest.mock('../../openfoodfacts/hydrate', () => ({ hydrateOffCandidate: jest.fn() }));
jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return { ...actual, getOrCreateAmbiguousServing: jest.fn() };
});

const mockedQueryRaw = prisma.$queryRaw as jest.Mock;

function makeCandidate(name: string) {
    return { id: 'off_100', source: 'openfoodfacts' as const, name, score: 1, foodType: 'generic', rawData: {} } as any;
}
function makeHydrated(overrides: Record<string, unknown>) {
    return {
        foodId: 'off_100', foodName: 'Food', brandName: null,
        nutrientsPer100g: { calories: 400, protein: 10, carbs: 50, fat: 15 },
        servingGrams: null, servingDescription: null, servingUnitCount: 1,
        packageQuantity: null, packageQuantityUnit: null,
        ...overrides,
    };
}
const bare = (name: string): ParsedIngredient => ({ qty: 1, multiplier: 1, unit: null, name });

type Rows = unknown[];
interface Groups { brand?: Rows; brandBanded?: Rows; name?: Rows; nameBanded?: Rows }
const issued: Array<{ kind: 'brand' | 'name' | 'other'; banded: boolean }> = [];

/**
 * Dispatch on the SQL text (which borrow) and on the band values: the unbanded
 * scan binds three NULLs for the band, the banded scan binds three numbers.
 */
function dispatch(g: Groups) {
    mockedQueryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
        const banded = sql.includes('IS NULL OR') && !values.slice(-3).includes(null);
        if (sql.includes('"packageQuantity"')) { issued.push({ kind: 'other', banded: false }); return Promise.resolve([]); }
        if (sql.includes('"brandName" ILIKE')) {
            issued.push({ kind: 'brand', banded });
            return Promise.resolve((banded ? g.brandBanded : g.brand) ?? []);
        }
        if (sql.includes('lower(name) =')) {
            issued.push({ kind: 'name', banded });
            return Promise.resolve((banded ? g.nameBanded : g.name) ?? []);
        }
        issued.push({ kind: 'other', banded: false });
        return Promise.resolve([]);
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    issued.length = 0;
    dispatch({});
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error', error: 'not mocked' });
});

describe('siblingFormBand()', () => {
    it('gates a dense record whose siblings are under a third of its density (meal replacement powder vs cartons)', () => {
        const band = siblingFormBand(474, 68.8);
        expect(band).not.toBeNull();
        expect(band!.min).toBeCloseTo(237);
        expect(band!.max).toBeCloseTo(948);
    });
    it('never gates below the dense-self threshold (Salmon Fillet 202 vs a 63 kcal brand line)', () => {
        expect(siblingFormBand(202, 63)).toBeNull();
        expect(siblingFormBand(SIBLING_FORM_DENSE_SELF_KCAL - 0.01, 1)).toBeNull();
        expect(siblingFormBand(SIBLING_FORM_DENSE_SELF_KCAL, 1)).not.toBeNull();
    });
    it('never gates at or under the ratio (Charcuterie Tasting Board 286 vs 142)', () => {
        expect(siblingFormBand(286, 142)).toBeNull();
        expect(siblingFormBand(300, 300 / SIBLING_FORM_MISMATCH_RATIO)).toBeNull();
        expect(siblingFormBand(300, 300 / SIBLING_FORM_MISMATCH_RATIO - 0.01)).not.toBeNull();
    });
    it('reads unknown densities as no gate', () => {
        expect(siblingFormBand(null, 50)).toBeNull();
        expect(siblingFormBand(undefined, 50)).toBeNull();
        expect(siblingFormBand(474, null)).toBeNull();
        expect(siblingFormBand(Number.NaN, 50)).toBeNull();
        expect(siblingFormBand(474, -1)).toBeNull();
    });
});

describe('name rung (E) — bare_name_sibling_serving*', () => {
    it('meal replacement shake powder borrows the same-form 60 g, not the 325 g carton median', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Meal replacement shake', nutrientsPer100g: { calories: 474, protein: 30, carbs: 50, fat: 15 },
        }));
        dispatch({
            name: [{ med: 325, n: 21, p25: 70, p75: 325, kmed: 68.8 }],
            nameBanded: [{ med: 60, n: 7, p25: 53.5, p75: 65, kmed: 374 }],
        });
        const r = await buildOffResult(makeCandidate('Meal replacement shake'), bare('meal replacement shake'), 0.9, 'meal replacement shake');
        expect(r?.grams).toBe(60);
        expect(r?.servingTier).toBe('bare_name_sibling_serving_tight');
        expect(r?.kcal).toBeCloseTo(284.4, 1);
        expect(issued.filter(q => q.kind === 'name').map(q => q.banded)).toEqual([false, true]);
    });

    it('keeps the unfiltered borrow under 3 same-form siblings, never refuses (Shake 750 vs 222)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Shake', nutrientsPer100g: { calories: 750, protein: 10, carbs: 50, fat: 55 },
        }));
        dispatch({
            name: [{ med: 152, n: 12, p25: 120, p75: 300, kmed: 222 }],
            nameBanded: [{ med: 24.5, n: 2, p25: 20, p75: 29, kmed: 700 }],
        });
        const r = await buildOffResult(makeCandidate('Shake'), bare('shake'), 0.9, 'shake');
        expect(r?.servingTier).toBe('bare_name_sibling_serving');
        expect(r?.grams).toBe(152);
        expect(issued.filter(q => q.kind === 'name').map(q => q.banded)).toEqual([false, true]);
    });

    it('a record as light as its group borrows exactly as before, one scan (control)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Pad thai', nutrientsPer100g: { calories: 160, protein: 6, carbs: 25, fat: 4 },
        }));
        dispatch({ name: [{ med: 300, n: 9, p25: 250, p75: 340, kmed: 150 }] });
        const r = await buildOffResult(makeCandidate('Pad thai'), bare('pad thai'), 0.9, 'pad thai');
        expect(r?.servingTier).toBe('bare_name_sibling_serving');
        expect(r?.grams).toBe(300);
        expect(issued.filter(q => q.banded)).toHaveLength(0);
    });

    it('a same-form set this rung would not admit leaves the 100 g floor, lower than the light-form raise (Pina colada: banded 55 g, p75/p25 1.67)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Pina colada', nutrientsPer100g: { calories: 428.6, protein: 1, carbs: 80, fat: 12 },
        }));
        // Measured read-only on the box 2026-11-15 (rf-sib q2.sql): unbanded n=11 med 105 p25 65 p75 243.5 kmed 122.3;
        // banded [214.3, 857.1] n=4 med 55 p25 39 p75 65.
        dispatch({
            name: [{ med: 105, n: 11, p25: 65, p75: 243.5, kmed: 122.3 }],
            nameBanded: [{ med: 55, n: 4, p25: 39, p75: 65, kmed: 354 }],
        });
        const r = await buildOffResult(makeCandidate('Pina colada'), bare('a pina colada'), 0.9, 'a pina colada');
        expect(r?.servingTier).toBe('count_unresolved_floor');
        expect(r?.grams).toBe(100);
        expect(issued.filter(q => q.kind === 'name').map(q => q.banded)).toEqual([false, true]);
    });

    it('never raises: a same-form median above the unfiltered one is ignored (salsa 30 g, not 31 g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Salsa', nutrientsPer100g: { calories: 300, protein: 5, carbs: 50, fat: 8 },
        }));
        // Measured read-only 2026-11-15 (rf-sib q4_name_sample.sql): unbanded n=171 med 30 p25 29 p75 32 kmed 36;
        // banded [150, 600] n=9 med 31 p25 30 p75 32.
        dispatch({
            name: [{ med: 30, n: 171, p25: 29, p75: 32, kmed: 36 }],
            nameBanded: [{ med: 31, n: 9, p25: 30, p75: 32, kmed: 330 }],
        });
        const r = await buildOffResult(makeCandidate('Salsa'), bare('salsa'), 0.9, 'salsa');
        expect(r?.servingTier).toBe('bare_name_sibling_serving_tight');
        expect(r?.grams).toBe(30);
    });

    it('never raises: a tight sub-floor borrow stands when the same-form set is not admitted (potato wedges 85 g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Potato wedges', nutrientsPer100g: { calories: 500, protein: 5, carbs: 50, fat: 30 },
        }));
        // Measured read-only 2026-11-15 (rf-sib q4_name_sample.sql): unbanded n=17 med 85 p25 80 p75 93 kmed 165;
        // banded [250, 1000] n=3 med 30 p25 28.5 p75 69.
        dispatch({
            name: [{ med: 85, n: 17, p25: 80, p75: 93, kmed: 165 }],
            nameBanded: [{ med: 30, n: 3, p25: 28.5, p75: 69, kmed: 520 }],
        });
        const r = await buildOffResult(makeCandidate('Potato wedges'), bare('potato wedges'), 0.9, 'potato wedges');
        expect(r?.servingTier).toBe('bare_name_sibling_serving_plural');
        expect(r?.grams).toBe(85);
    });
});

describe('serving-word rung (#270) — serving_unit_sibling_label is NOT banded', () => {
    it('`1 serving` of a dense brand record scans the brand once, unbanded (the band is a bare-borrow rule only)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Muscle Milk Vanilla Creme', brandName: 'Muscle milk',
            nutrientsPer100g: { calories: 385, protein: 45, carbs: 20, fat: 12 },
        }));
        dispatch({
            brand: [{ med: 325, n: 71, p25: 70, p75: 330, kmed: 58.5 }],
            brandBanded: [{ med: 70, n: 21, p25: 54, p75: 70, kmed: 394 }],
        });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'serving', name: 'muscle milk vanilla' };
        await buildOffResult(makeCandidate('Muscle Milk Vanilla Creme'), parsed, 0.9, '1 serving muscle milk vanilla');
        expect(issued.filter(q => q.kind === 'brand').length).toBeGreaterThan(0);
        expect(issued.filter(q => q.banded)).toHaveLength(0);
    });
});

describe('brand rung (C2) — bare_sibling_serving', () => {
    it("Muscle Milk Vanilla Creme powder borrows the brand's same-form 70 g, not the 325 g bottle median", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Muscle Milk Vanilla Creme', brandName: 'Muscle milk',
            nutrientsPer100g: { calories: 385, protein: 45, carbs: 20, fat: 12 },
        }));
        dispatch({
            brand: [{ med: 325, n: 71, p25: 70, p75: 330, kmed: 58.5 }],
            brandBanded: [{ med: 70, n: 21, p25: 66, p75: 74, kmed: 394 }],
        });
        const r = await buildOffResult(makeCandidate('Muscle Milk Vanilla Creme'), bare('muscle milk vanilla'), 0.9, 'muscle milk vanilla');
        expect(r?.servingTier).toBe('bare_sibling_serving');
        expect(r?.grams).toBe(70);
        expect(r?.kcal).toBeCloseTo(269.5, 1);
    });

    it('never raises: a same-form median above the unfiltered one is ignored (Shamrock Farms Raisins 240 g, not 354 g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Raisins', brandName: 'Shamrock farms',
            nutrientsPer100g: { calories: 276, protein: 3, carbs: 70, fat: 1 },
        }));
        // Measured read-only 2026-11-15 (rf-sib q3b_brand_sample.sql): unbanded n=62 med 240 kmed 54; banded n=7 med 354.
        dispatch({
            brand: [{ med: 240, n: 62, p25: 200, p75: 300, kmed: 54 }],
            brandBanded: [{ med: 354, n: 7, p25: 300, p75: 360, kmed: 200 }],
        });
        const r = await buildOffResult(makeCandidate('Raisins'), bare('raisins'), 0.9, 'raisins');
        expect(r?.servingTier).toBe('bare_sibling_serving');
        expect(r?.grams).toBe(240);
        expect(issued.filter(q => q.kind === 'brand').map(q => q.banded)).toEqual([false, true]);
    });

    it('a 202 kcal salmon fillet keeps its 120 g brand borrow (below the dense-self threshold)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Salmon Fillet', brandName: 'Keohane Seafoods',
            nutrientsPer100g: { calories: 202, protein: 20, carbs: 0, fat: 13 },
        }));
        dispatch({ brand: [{ med: 120, n: 3, p25: 110, p75: 130, kmed: 63 }] });
        const r = await buildOffResult(makeCandidate('Salmon Fillet'), bare('salmon fillet'), 0.9, 'salmon fillet');
        expect(r?.servingTier).toBe('bare_sibling_serving');
        expect(r?.grams).toBe(120);
        expect(issued.filter(q => q.banded)).toHaveLength(0);
    });

    it('under 3 same-form siblings (C2) keeps its borrow; it never hands the line to the rungs below (shrimp tacos 475 g label)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Shrimp tacos', brandName: 'Good food', servingGrams: 475,
            nutrientsPer100g: { calories: 600, protein: 20, carbs: 50, fat: 35 },
        }));
        dispatch({
            brand: [{ med: 318, n: 16, p25: 200, p75: 340, kmed: 195 }],
            brandBanded: [{ med: 16.5, n: 2, p25: 15, p75: 18, kmed: 560 }],
        });
        const r = await buildOffResult(makeCandidate('Shrimp tacos'), bare('shrimp tacos'), 0.9, 'shrimp tacos');
        expect(r?.servingTier).toBe('bare_sibling_serving');
        expect(r?.grams).toBe(318);
    });
});

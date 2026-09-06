/**
 * `fiber100` is NULL when the source panel does not declare fibre, and 0 only
 * when it declares 0 — on EVERY branch of resolveFoodDetails.
 *
 * WHY THIS FILE EXISTS. OffFood 0850003023175 ("Blueberry") stores
 * `"fiber": null` in its panel — the row is copied verbatim below — and
 * /api/nlp/parse billed it `fiber: 0`. That is not a cosmetic zero: the client
 * derives Net carbs as carbs minus fibre, so a fabricated 0 g inflates the one
 * field it computes. 807 of the 3,574 OFF records behind a FoodMapping row are
 * that shape, and FatSecret has its own spelling of the same fact (it OMITS the
 * key: fs_113183876 "7Up Shirley Temple" below has a full panel and no `fiber`).
 * Measured on the box 2026-09-05; re-derive:
 *   SELECT count(*) FILTER (WHERE o."nutrientsPer100g"->>'fiber' IS NULL), count(*)
 *   FROM "FoodMapping" fm JOIN "OffFood" o ON o.barcode = fm."offBarcode";
 *
 * Same harness as resolve-payload-sodium-units.test.ts, for the same reason: the
 * last cross-branch field defect survived every per-branch test, so the rule is
 * asserted as one table over every store this function reads.
 *
 * RED on the pre-fix tree: every `toBeNull()` below fails on master @ 5411f7e,
 * where each branch read `nutrients.fiber ?? 0`. The declared-0 and
 * declared-number rows are the controls and pass on both trees.
 */

const mockFdcFindUnique = jest.fn();
const mockOffFindUnique = jest.fn();
const mockFsFindUnique = jest.fn();
const mockAiFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fdcFood: { findUnique: (...a: unknown[]) => mockFdcFindUnique(...a) },
        offFood: { findUnique: (...a: unknown[]) => mockOffFindUnique(...a) },
        fatSecretFood: { findUnique: (...a: unknown[]) => mockFsFindUnique(...a) },
        aiGeneratedFood: { findUnique: (...a: unknown[]) => mockAiFindUnique(...a) },
    },
}));

import { resolveFoodDetails } from '../resolve-payload';

beforeEach(() => {
    mockFdcFindUnique.mockReset();
    mockOffFindUnique.mockReset();
    mockFsFindUnique.mockReset();
    mockAiFindUnique.mockReset();
});

/** OffFood 0850003023175 as stored on the box, 2026-09-05. `fiber` is present-and-null. */
const BLUEBERRY_PANEL = {
    fat: 1.600000023841858, carbs: 14.39999961853027, fiber: null, sodium: null,
    sugars: 7.199999809265137, protein: 0.800000011920929, calories: 72,
};

/** FatSecretFood 113183876 as stored on the box, 2026-09-05. No `fiber` key at all. */
const SHIRLEY_TEMPLE_PANEL = {
    fat: 0, carbs: 13.52, sodium: 0.012, sugars: 13.23, protein: 0, calories: 50,
};

function offRow(nutrientsPer100g: Record<string, unknown>) {
    return {
        barcode: '0850003023175', name: 'Blueberry', brandName: null,
        servingGrams: null, servingSize: null, nutrientsPer100g, servings: [],
    };
}

function fdcRow(nutrientsPer100g: Record<string, unknown>) {
    return { fdcId: 171711, description: 'Blueberries, raw', brandName: null, nutrientsPer100g, servings: [] };
}

function fsRow(nutrientsPer100g: Record<string, unknown>) {
    return {
        fsId: '113183876', name: '7Up Shirley Temple', brandName: null, defaultServingId: null,
        fetchedAt: new Date(), nutrientsPer100g,
        // A weighed serving, so the macro-only recovery does NOT fire here.
        servings: [{ servingId: 's', description: '1 can', measurementDescription: null, grams: 355, volumeMl: null, numberOfUnits: 1, nutrients: {} }],
    };
}

function aiRow(fiberPer100g: number | null) {
    return {
        id: 'ckfiber', displayName: 'Blueberry Compote',
        caloriesPer100g: 72, proteinPer100g: 0.8, carbsPer100g: 14.4, fatPer100g: 1.6,
        fiberPer100g, sugarPer100g: 7.2, sodiumMgPer100g: 0,
        servings: [],
    };
}

/**
 * fs_68444899 "Whopper Jr." in its stored shape (empty panel, one gram-less
 * serving), which routes through recoverMacroOnlyServing(). `nutrients` is
 * parameterised so one fixture can be silent about fibre or declare it.
 */
function fsMacroOnlyRow(servingNutrients: Record<string, number>) {
    return {
        fsId: '68444899', name: 'Whopper Jr.', brandName: 'Burger King',
        nutrientsPer100g: {}, defaultServingId: '56035832', fetchedAt: new Date(),
        servings: [{
            servingId: '56035832', description: '1 serving', measurementDescription: null,
            grams: null, volumeMl: null, numberOfUnits: 1, nutrients: servingNutrients,
        }],
    };
}

describe('off_: an undeclared fibre is null, a declared one is its number', () => {
    it('the measured row — "fiber": null in the stored panel — resolves fiber100: null', async () => {
        mockOffFindUnique.mockResolvedValue(offRow(BLUEBERRY_PANEL));
        const d = await resolveFoodDetails('off_0850003023175');
        expect(d.source).toBe('openfoodfacts');
        expect(d.nutritionPer100g.fiber100).toBeNull();
        // The rest of the panel is untouched by the rule.
        expect(d.nutritionPer100g.kcal100).toBe(72);
        expect(d.nutritionPer100g.carbs100).toBeCloseTo(14.4, 5);
    });

    it('a DECLARED 0 stays 0 — the rule distinguishes two facts, it does not null zeros', async () => {
        mockOffFindUnique.mockResolvedValue(offRow({ ...BLUEBERRY_PANEL, fiber: 0 }));
        const d = await resolveFoodDetails('off_0850003023175');
        expect(d.nutritionPer100g.fiber100).toBe(0);
    });

    it('a declared value passes through unchanged', async () => {
        mockOffFindUnique.mockResolvedValue(offRow({ ...BLUEBERRY_PANEL, fiber: 2.4 }));
        const d = await resolveFoodDetails('off_0850003023175');
        expect(d.nutritionPer100g.fiber100).toBe(2.4);
    });
});

describe('fs_: FatSecret omits the key instead of nulling it — same rule', () => {
    it('a full panel with no `fiber` key resolves fiber100: null (the measured row)', async () => {
        mockFsFindUnique.mockResolvedValue(fsRow(SHIRLEY_TEMPLE_PANEL));
        const d = await resolveFoodDetails('fs_113183876');
        expect(d.source).toBe('fatsecret');
        expect(d.nutritionPer100g.fiber100).toBeNull();
        expect(d.nutritionPer100g.kcal100).toBe(50);
    });

    it('a declared 0 stays 0', async () => {
        mockFsFindUnique.mockResolvedValue(fsRow({ ...SHIRLEY_TEMPLE_PANEL, fiber: 0 }));
        const d = await resolveFoodDetails('fs_113183876');
        expect(d.nutritionPer100g.fiber100).toBe(0);
    });

    it('a declared value passes through unchanged', async () => {
        mockFsFindUnique.mockResolvedValue(fsRow({ ...SHIRLEY_TEMPLE_PANEL, fiber: 0.8 }));
        const d = await resolveFoodDetails('fs_113183876');
        expect(d.nutritionPer100g.fiber100).toBe(0.8);
    });
});

describe('fs_ macro-only recovery: the serving row is the panel', () => {
    it('a serving row silent about fibre recovers the macros and leaves fiber100 null', async () => {
        mockFsFindUnique.mockResolvedValue(fsMacroOnlyRow({
            calories: 340, protein: 15, carbohydrate: 30, fat: 18, sugar: 7, sodium: 560,
        }));
        const d = await resolveFoodDetails('fs_68444899');
        // The recovery ran (kcal100 is the invented-weight self-consistency term)…
        expect(d.nutritionPer100g.kcal100).toBe(200);
        expect(d.portionEstimated).toBe(true);
        // …and did not manufacture a fibre figure the row never carried.
        expect(d.nutritionPer100g.fiber100).toBeNull();
        // Sugar and sodium keep the 0 fallback: same shape, deliberately not this change.
        expect(d.nutritionPer100g.sugar100).toBeCloseTo(4.12, 5);
    });

    it('a serving row declaring fibre still recovers the number (1.18, as resolve-payload-fs pins)', async () => {
        mockFsFindUnique.mockResolvedValue(fsMacroOnlyRow({
            calories: 340, protein: 15, carbohydrate: 30, fat: 18, fiber: 2, sugar: 7, sodium: 560,
        }));
        const d = await resolveFoodDetails('fs_68444899');
        expect(d.nutritionPer100g.fiber100).toBeCloseTo(1.18, 5);
    });
});

describe('fdc_: every stored row carries a number, so the rule is inert here — pinned so it holds if that changes', () => {
    // 0 of 4,133 FdcFood rows have a null or absent `fiber` (measured 2026-09-05;
    // re-derive: SELECT count(*) FILTER (WHERE "nutrientsPer100g"->>'fiber' IS NULL),
    // count(*) FROM "FdcFood";). The number branches are the live population.
    it('a declared value passes through unchanged', async () => {
        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 57, protein: 0.7, carbs: 14.5, fat: 0.3, fiber: 2.4 }));
        const d = await resolveFoodDetails('fdc_171711');
        expect(d.source).toBe('fdc');
        expect(d.nutritionPer100g.fiber100).toBe(2.4);
    });

    it('a declared 0 stays 0 (2,780 of 4,133 FdcFood rows declare exactly 0)', async () => {
        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 }));
        const d = await resolveFoodDetails('fdc_171413');
        expect(d.nutritionPer100g.fiber100).toBe(0);
    });

    it('a null, should the ingest ever write one, is null — not a special case for this store', async () => {
        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 57, protein: 0.7, carbs: 14.5, fat: 0.3, fiber: null }));
        const d = await resolveFoodDetails('fdc_171711');
        expect(d.nutritionPer100g.fiber100).toBeNull();
    });
});

describe('AiGeneratedFood: the nullable column reaches the wire as itself', () => {
    it('fiberPer100g: null resolves fiber100: null', async () => {
        mockAiFindUnique.mockResolvedValue(aiRow(null));
        const d = await resolveFoodDetails('ckfiber');
        expect(d.source).toBe('ai_estimated');
        expect(d.nutritionPer100g.fiber100).toBeNull();
    });

    it('fiberPer100g: 0 — the column default — stays 0', async () => {
        mockAiFindUnique.mockResolvedValue(aiRow(0));
        const d = await resolveFoodDetails('ckfiber');
        expect(d.nutritionPer100g.fiber100).toBe(0);
    });

    it('a declared value passes through unchanged', async () => {
        mockAiFindUnique.mockResolvedValue(aiRow(4));
        const d = await resolveFoodDetails('ckfiber');
        expect(d.nutritionPer100g.fiber100).toBe(4);
    });
});

describe('an unresolvable id declares nothing', () => {
    it('ships fiber100: null beside the all-zero macros, on every prefix', async () => {
        // Every store answers "no such row": a stale fdc_, a purged off_, an fs_ never
        // persisted, and an AiGeneratedFood id that is not one. The parse route's
        // degenerate-panel repair then re-derives the four MACROS from the billed
        // line and nothing else, so this initializer is the fibre value that ships.
        for (const id of ['fdc_0', 'off_0000000000000', 'fs_0', 'water_default']) {
            const d = await resolveFoodDetails(id);
            expect([id, d.nutritionPer100g.fiber100]).toEqual([id, null]);
            expect([id, d.nutritionPer100g.kcal100]).toEqual([id, 0]);
            expect([id, d.source]).toEqual([id, 'ai_estimated']);
        }
    });
});

describe('cross-branch: a declared 0 is 0 and an undeclared fibre is null on every store', () => {
    it('one table, every branch', async () => {
        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 100, fiber: 0 }));
        mockOffFindUnique.mockResolvedValue(offRow({ calories: 100, fiber: 0 }));
        mockFsFindUnique.mockResolvedValue(fsRow({ calories: 100, fiber: 0 }));
        mockAiFindUnique.mockResolvedValue(aiRow(0));
        for (const id of ['fdc_1', 'off_1', 'fs_1', 'ckfiber']) {
            const d = await resolveFoodDetails(id);
            expect([id, d.nutritionPer100g.fiber100]).toEqual([id, 0]);
        }

        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 100, fiber: null }));
        mockOffFindUnique.mockResolvedValue(offRow({ calories: 100, fiber: null }));
        mockFsFindUnique.mockResolvedValue(fsRow({ calories: 100 }));
        mockAiFindUnique.mockResolvedValue(aiRow(null));
        for (const id of ['fdc_1', 'off_1', 'fs_1', 'ckfiber']) {
            const d = await resolveFoodDetails(id);
            expect([id, d.nutritionPer100g.fiber100]).toEqual([id, null]);
        }
    });
});

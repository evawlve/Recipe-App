/**
 * `sugar100` and `sodium100` are NULL when the source panel does not declare
 * them, and 0 only when it declares 0 — on EVERY branch of resolveFoodDetails.
 *
 * WHY THIS FILE EXISTS. It is the sibling of resolve-payload-fiber-null.test.ts
 * and it exists for the same reason one PR later (#134 after #424): `null` and
 * `0` are two different facts about a food, and until this change every store's
 * silence about sugar or sodium reached the wire as a fabricated `0 g`. The
 * mobile client (#119, `700b8d1`) already reads a null at every seat, so from
 * this deploy a food with no declared sugar stops writing a zero to the diary.
 *
 * TEN SEATS, and they are asserted as ONE TABLE per field rather than one test
 * per branch, for the reason resolve-payload-fiber-null.test.ts states: the last
 * cross-branch field defect in this module (the mg/g sodium leak) survived every
 * per-branch test because each branch had its own. The fifth sodium seat — the
 * FatSecret panel branch — was in fact missed on the first pass of #134 and
 * caught by a grep of the finished file, not by a test; it is pinned here.
 *
 * THE ONE BRANCH THAT IS NOT A ONE-TOKEN CHANGE is `AiGeneratedFood`'s sodium:
 * the column is milligrams, so the value is divided by 1000. `(x ?? null) / 1000`
 * is the SAME expression as `(x ?? 0) / 1000` — arithmetic coerces null to 0 —
 * so that branch must decide the null BEFORE converting. Pinned below.
 *
 * RED on the pre-fix tree: every `toBeNull()` here fails on master @ 4a1ca59,
 * where each seat read `?? 0`. The declared-0 and declared-number rows are the
 * controls and pass on both trees — a null-only pin would also pass on a `|| null`
 * implementation, which destroys every declared zero.
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

/**
 * OffFood 0850003023175 "Blueberry" as stored on the box: `sodium` is
 * present-and-null. Its `sugars` IS declared (7.2), which is why the undeclared
 * sugar case below nulls it explicitly rather than reusing this row verbatim —
 * a fixture that already agrees with the expectation proves nothing.
 */
const BLUEBERRY_PANEL = {
    fat: 1.600000023841858, carbs: 14.39999961853027, fiber: null, sodium: null,
    sugars: 7.199999809265137, protein: 0.800000011920929, calories: 72,
};

/** FatSecretFood 113183876 "7Up Shirley Temple": a full panel, no `fiber` key. */
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

function aiRow(sugarPer100g: number | null, sodiumMgPer100g: number | null) {
    return {
        id: 'cksusd', displayName: 'Blueberry Compote',
        caloriesPer100g: 72, proteinPer100g: 0.8, carbsPer100g: 14.4, fatPer100g: 1.6,
        fiberPer100g: 0, sugarPer100g, sodiumMgPer100g,
        servings: [],
    };
}

/** fs_68444899 "Whopper Jr." — empty panel, one gram-less serving: the macro-only lane. */
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

describe('off_: the store spells an undeclared value as present-and-null', () => {
    it('the measured row — "sodium": null — resolves sodium100: null', async () => {
        mockOffFindUnique.mockResolvedValue(offRow(BLUEBERRY_PANEL));
        const d = await resolveFoodDetails('off_0850003023175');
        expect(d.source).toBe('openfoodfacts');
        expect(d.nutritionPer100g.sodium100).toBeNull();
        // Its sugar IS declared on this row, so it must NOT be nulled.
        expect(d.nutritionPer100g.sugar100).toBeCloseTo(7.2, 5);
        expect(d.nutritionPer100g.kcal100).toBe(72);
    });

    it('an undeclared sugar resolves sugar100: null', async () => {
        mockOffFindUnique.mockResolvedValue(offRow({ ...BLUEBERRY_PANEL, sugars: null }));
        const d = await resolveFoodDetails('off_0850003023175');
        expect(d.nutritionPer100g.sugar100).toBeNull();
    });

    it('the `sugar` spelling is read as well as `sugars` — both keys occur in this store', async () => {
        const { sugars, ...noSugars } = BLUEBERRY_PANEL;
        void sugars;
        mockOffFindUnique.mockResolvedValue(offRow({ ...noSugars, sugar: 3.3 }));
        const d = await resolveFoodDetails('off_0850003023175');
        expect(d.nutritionPer100g.sugar100).toBe(3.3);
    });

    it('DECLARED zeros stay 0 — the rule distinguishes two facts, it does not null zeros', async () => {
        mockOffFindUnique.mockResolvedValue(offRow({ ...BLUEBERRY_PANEL, sugars: 0, sodium: 0 }));
        const d = await resolveFoodDetails('off_0850003023175');
        expect(d.nutritionPer100g.sugar100).toBe(0);
        expect(d.nutritionPer100g.sodium100).toBe(0);
    });

    it('declared values pass through unchanged', async () => {
        mockOffFindUnique.mockResolvedValue(offRow({ ...BLUEBERRY_PANEL, sugars: 12.1, sodium: 0.44 }));
        const d = await resolveFoodDetails('off_0850003023175');
        expect(d.nutritionPer100g.sugar100).toBe(12.1);
        expect(d.nutritionPer100g.sodium100).toBe(0.44);
    });
});

describe('fs_: FatSecret OMITS the key instead of nulling it — same rule', () => {
    it('a full panel with no `sugars` key resolves sugar100: null', async () => {
        const { sugars, ...noSugar } = SHIRLEY_TEMPLE_PANEL;
        void sugars;
        mockFsFindUnique.mockResolvedValue(fsRow(noSugar));
        const d = await resolveFoodDetails('fs_113183876');
        expect(d.source).toBe('fatsecret');
        expect(d.nutritionPer100g.sugar100).toBeNull();
        expect(d.nutritionPer100g.kcal100).toBe(50);
    });

    /**
     * THE SEAT #134 MISSED ON ITS FIRST PASS. Its comment in resolve-payload.ts
     * is about the UNIT ("already grams per 100 g in this store"), which reads as
     * though the null question had already been considered there. It had not.
     */
    it('a full panel with no `sodium` key resolves sodium100: null', async () => {
        const { sodium, ...noSodium } = SHIRLEY_TEMPLE_PANEL;
        void sodium;
        mockFsFindUnique.mockResolvedValue(fsRow(noSodium));
        const d = await resolveFoodDetails('fs_113183876');
        expect(d.nutritionPer100g.sodium100).toBeNull();
    });

    it('declared zeros stay 0', async () => {
        mockFsFindUnique.mockResolvedValue(fsRow({ ...SHIRLEY_TEMPLE_PANEL, sugars: 0, sodium: 0 }));
        const d = await resolveFoodDetails('fs_113183876');
        expect(d.nutritionPer100g.sugar100).toBe(0);
        expect(d.nutritionPer100g.sodium100).toBe(0);
    });

    it('the measured row passes its declared values through unchanged', async () => {
        mockFsFindUnique.mockResolvedValue(fsRow(SHIRLEY_TEMPLE_PANEL));
        const d = await resolveFoodDetails('fs_113183876');
        expect(d.nutritionPer100g.sugar100).toBe(13.23);
        expect(d.nutritionPer100g.sodium100).toBe(0.012);
    });
});

describe('fs_ macro-only recovery: the serving row is the panel', () => {
    it('a serving row silent about sugar and sodium leaves both null', async () => {
        mockFsFindUnique.mockResolvedValue(fsMacroOnlyRow({
            calories: 340, protein: 15, carbohydrate: 30, fat: 18,
        }));
        const d = await resolveFoodDetails('fs_68444899');
        // The recovery ran (kcal100 is the invented-weight self-consistency term)…
        expect(d.nutritionPer100g.kcal100).toBe(200);
        expect(d.portionEstimated).toBe(true);
        // …and did not manufacture figures the row never carried.
        expect(d.nutritionPer100g.sugar100).toBeNull();
        expect(d.nutritionPer100g.sodium100).toBeNull();
    });

    it('a serving row declaring them still recovers the numbers', async () => {
        mockFsFindUnique.mockResolvedValue(fsMacroOnlyRow({
            calories: 340, protein: 15, carbohydrate: 30, fat: 18, sugar: 7, sodium: 560,
        }));
        const d = await resolveFoodDetails('fs_68444899');
        expect(d.nutritionPer100g.sugar100).toBeCloseTo(4.12, 5);
        // mg -> g happens inside the recovery, matching the panel branches.
        expect(d.nutritionPer100g.sodium100).toBeGreaterThan(0);
    });
});

describe('fdc_: pinned so the rule holds if the ingest ever writes a null', () => {
    it('declared values pass through unchanged', async () => {
        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 57, protein: 0.7, carbs: 14.5, fat: 0.3, sugar: 10, sodium: 0.001 }));
        const d = await resolveFoodDetails('fdc_171711');
        expect(d.source).toBe('fdc');
        expect(d.nutritionPer100g.sugar100).toBe(10);
        expect(d.nutritionPer100g.sodium100).toBe(0.001);
    });

    it('declared zeros stay 0', async () => {
        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 884, protein: 0, carbs: 0, fat: 100, sugar: 0, sodium: 0 }));
        const d = await resolveFoodDetails('fdc_171413');
        expect(d.nutritionPer100g.sugar100).toBe(0);
        expect(d.nutritionPer100g.sodium100).toBe(0);
    });

    it('an absent key is null — not a special case for this store', async () => {
        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 57, protein: 0.7, carbs: 14.5, fat: 0.3 }));
        const d = await resolveFoodDetails('fdc_171711');
        expect(d.nutritionPer100g.sugar100).toBeNull();
        expect(d.nutritionPer100g.sodium100).toBeNull();
    });
});

describe('AiGeneratedFood: the null is decided BEFORE the mg -> g conversion', () => {
    it('a null sodiumMgPer100g resolves null, never 0 and never NaN', async () => {
        mockAiFindUnique.mockResolvedValue(aiRow(4.2, null));
        const d = await resolveFoodDetails('cksusd');
        expect(d.source).toBe('ai_estimated');
        expect(d.nutritionPer100g.sodium100).toBeNull();
        expect(Number.isNaN(d.nutritionPer100g.sodium100 as unknown as number)).toBe(false);
        expect(d.nutritionPer100g.sugar100).toBe(4.2);
    });

    it('a null sugarPer100g resolves null', async () => {
        mockAiFindUnique.mockResolvedValue(aiRow(null, 500));
        const d = await resolveFoodDetails('cksusd');
        expect(d.nutritionPer100g.sugar100).toBeNull();
    });

    /**
     * The control that makes the branch's shape load-bearing. `(0 ?? null)/1000`
     * and `0 == null ? null : 0/1000` agree here, but a careless `x || null`
     * would return null and silently delete a real measurement.
     */
    it('a stored 0 mg converts to 0 g and stays a number', async () => {
        mockAiFindUnique.mockResolvedValue(aiRow(0, 0));
        const d = await resolveFoodDetails('cksusd');
        expect(d.nutritionPer100g.sodium100).toBe(0);
        expect(d.nutritionPer100g.sugar100).toBe(0);
    });

    it('a declared value still converts mg -> g exactly as before', async () => {
        mockAiFindUnique.mockResolvedValue(aiRow(1.5, 1200));
        const d = await resolveFoodDetails('cksusd');
        expect(d.nutritionPer100g.sodium100).toBeCloseTo(1.2, 9);
    });
});

describe('an unresolvable id declares nothing', () => {
    it('ships sugar100 and sodium100 null beside the all-zero macros, on every prefix', async () => {
        for (const id of ['fdc_0', 'off_0000000000000', 'fs_0', 'water_default']) {
            const d = await resolveFoodDetails(id);
            expect([id, d.nutritionPer100g.sugar100]).toEqual([id, null]);
            expect([id, d.nutritionPer100g.sodium100]).toEqual([id, null]);
            // The macros keep their 0: `isDegenerateNutrition()` reads them as
            // this module's spelling of "unknown" and the parse route's repair
            // re-derives exactly those four from the billed line.
            expect([id, d.nutritionPer100g.kcal100]).toEqual([id, 0]);
            expect([id, d.source]).toEqual([id, 'ai_estimated']);
        }
    });
});

describe('cross-branch: one table over every store', () => {
    it('a declared 0 is 0 and an undeclared value is null, on all four', async () => {
        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 100, sugar: 0, sodium: 0 }));
        mockOffFindUnique.mockResolvedValue(offRow({ calories: 100, sugars: 0, sodium: 0 }));
        mockFsFindUnique.mockResolvedValue(fsRow({ calories: 100, sugars: 0, sodium: 0 }));
        mockAiFindUnique.mockResolvedValue(aiRow(0, 0));
        for (const id of ['fdc_1', 'off_1', 'fs_1', 'cksusd']) {
            const d = await resolveFoodDetails(id);
            expect([id, d.nutritionPer100g.sugar100]).toEqual([id, 0]);
            expect([id, d.nutritionPer100g.sodium100]).toEqual([id, 0]);
        }

        mockFdcFindUnique.mockResolvedValue(fdcRow({ calories: 100 }));
        mockOffFindUnique.mockResolvedValue(offRow({ calories: 100, sugars: null, sodium: null }));
        mockFsFindUnique.mockResolvedValue(fsRow({ calories: 100 }));
        mockAiFindUnique.mockResolvedValue(aiRow(null, null));
        for (const id of ['fdc_1', 'off_1', 'fs_1', 'cksusd']) {
            const d = await resolveFoodDetails(id);
            expect([id, d.nutritionPer100g.sugar100]).toEqual([id, null]);
            expect([id, d.nutritionPer100g.sodium100]).toEqual([id, null]);
        }
    });
});

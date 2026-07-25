/**
 * Conditional sub-threshold admission (funnel fix 4).
 *
 * Every query/record pair below is a REAL row from the 1,158-seed cold warm of
 * 2026-07-24 (sync-docs/funnel_first_read_2026-07-24.md), at the confidence the
 * cascade actually produced. The blocked cases are as load-bearing as the
 * admitted ones: the whole point is that lowering the flat 0.85 would let the
 * cross-brand substitutions in alongside the good picks.
 */

// simple-rerank reaches the prisma client through its import chain; the
// admission decision itself touches no database.
jest.mock('../../db', () => ({ prisma: {} }));

import {
    assessSubThresholdAdmission,
    SUB_THRESHOLD_SAVE_FLOOR,
    SAVE_CONFIDENCE_THRESHOLD,
} from '../sub-threshold-admission';

const plausible = { kcal: 150, protein: 8, carbs: 20, fat: 4 };

function assess(over: {
    rawLine: string;
    confidence: number;
    matchedBrand?: string | null;
    isBranded?: boolean;
    foodName: string;
    brandName?: string | null;
    nutrientsPer100g?: { kcal: number; protein: number; carbs: number; fat: number };
}) {
    return assessSubThresholdAdmission({
        rawLine: over.rawLine,
        confidence: over.confidence,
        brandDetection: {
            isBranded: over.isBranded ?? true,
            matchedBrand: over.matchedBrand ?? null,
        },
        foodName: over.foodName,
        brandName: over.brandName,
        nutrientsPer100g: over.nutrientsPer100g ?? plausible,
    });
}

describe('admits the good picks the gate was discarding', () => {
    it('dymatize casein -> Elite Casein [Dymatize] at 0.83', () => {
        const r = assess({
            rawLine: 'dymatize casein protein',
            confidence: 0.83,
            matchedBrand: 'dymatize',
            foodName: 'Elite Casein',
            brandName: 'Dymatize',
            nutrientsPer100g: { kcal: 360, protein: 72, carbs: 8, fat: 4 },
        });
        expect(r.admit).toBe(true);
    });

    it('accepts the brand carried in the NAME rather than the brand field', () => {
        const r = assess({
            rawLine: 'ghost protein powder',
            confidence: 0.8,
            matchedBrand: 'ghost',
            foodName: 'Ghost Whey Protein Cereal Milk',
            brandName: undefined,
        });
        expect(r.admit).toBe(true);
    });
});

describe('class 1, cross-brand substitution — the reason not to lower the flat number', () => {
    // Multi-word brands are decisive on their own, so these reach the
    // brand-agreement check and are rejected by it specifically.
    it.each<[string, string, string, string]>([
        ['buffalo wild wings traditional wings', 'buffalo wild wings', 'Traditional Wings', 'Zaxby\'s'],
        ['papa johns pepperoni pizza', 'papa johns', 'Pepperoni Pizza', 'Pizza Hut'],
        ['olive garden breadsticks', 'olive garden', 'Breadsticks', 'Little Caesars'],
    ])('blocks %s -> a different company\'s record', (rawLine, matchedBrand, foodName, brandName) => {
        const r = assess({ rawLine, confidence: 0.82, matchedBrand, foodName, brandName });
        expect(r.admit).toBe(false);
        expect(r.reason).toBe('record_lacks_query_brand');
    });

    it('admits the same query shape when the record IS the right chain', () => {
        const r = assess({
            rawLine: 'buffalo wild wings traditional wings',
            confidence: 0.82,
            matchedBrand: 'buffalo wild wings',
            foodName: 'Traditional Wings',
            brandName: 'Buffalo Wild Wings',
        });
        expect(r.admit).toBe(true);
    });
});

describe('unbranded near-misses — the population this actually converts', () => {
    // Measured: warming 369 real seeds through a brand-REQUIRING draft of this
    // fix admitted ZERO rows, because the under-gate population is
    // overwhelmingly unbranded. These are the real sub-0.85 picks that batch
    // produced, at the confidence it produced them — including two the funnel
    // read had already confirmed good and discarded.
    it.each<[string, string, number]>([
        ['ground beef 90/10', 'Ground Beef 85% Lean 15% Fat', 0.78],
        ['ground turkey', '85% lean ground turkey', 0.83],
        ['canned tuna in water', 'Fish, tuna, white, canned in water, drained solids', 0.84],
        ['honey bunches of oats', 'Honey Bunches of Oats', 0.82],
        ['shrimp and grits', 'Shrimp and Grits', 0.75],
        ['baked salmon', 'Baked or Broiled Salmon', 0.83],
    ])('admits "%s" -> %s at %s', (rawLine, foodName, confidence) => {
        const r = assess({ rawLine, confidence, isBranded: false, foodName });
        expect(r.admit).toBe(true);
    });

    it('admits an unbranded whole food whose name collides with a grocery chain', () => {
        // detectBrandInQuery reports "sprouts" (Sprouts Farmers Market) here.
        // hasDecisiveBrandContext declines it, so the query asserts no brand and
        // the record has nothing to contradict.
        const r = assess({
            rawLine: 'brussels sprouts',
            confidence: 0.82,
            matchedBrand: 'sprouts',
            foodName: 'Brussels Sprouts',
        });
        expect(r.admit).toBe(true);
    });
});

describe('the insert-only guarantee is what makes unbranded admission safe', () => {
    // The admission decision knows nothing about incumbents; the guarantee is
    // enforced by `insertOnly` in saveValidatedMapping (covered in
    // validated-mapping-save-gates.test.ts). What matters here is that an
    // admission is a plain `{admit: true}` carrying no exemption of its own —
    // the mapper passes `insertOnly: subThreshold.admit` on both the primary
    // save and its aliases, so every admitted pick may SEED a key and none may
    // overwrite one.
    it('admits with no additional exemption attached', () => {
        const r = assess({
            rawLine: 'ground turkey',
            confidence: 0.83,
            isBranded: false,
            foodName: '85% lean ground turkey',
        });
        expect(r).toEqual({ admit: true });
    });
});

describe('KNOWN COVERAGE LIMIT: single-word chain brands are not adjudicated', () => {
    // hasDecisiveBrandContext qualifies a single-token brand only next to a
    // token in BRAND_PRODUCT_CONTEXT_TOKENS, which is a SUPPLEMENT vocabulary
    // (protein/whey/casein/bar/creatine/...). So "chipotle burrito" reads as
    // UNBRANDED here and is admitted on the insert-only guarantee rather than
    // being checked for cross-brand substitution.
    //
    // That is a weaker check than these queries deserve, but it is bounded: such
    // a pick can only seed a key that had no row. Tightening it means widening a
    // predicate that the brand_mismatch gate and deriveMappingCacheKey both
    // depend on — its own change, with its own blast radius.
    it('admits "chipotle burrito bowl" because the brand never registers as asserted', () => {
        const r = assess({
            rawLine: 'chipotle burrito bowl',
            confidence: 0.82,
            matchedBrand: 'chipotle',
            foodName: 'Burrito Bowl',
            brandName: 'Pollen + Grace',
        });
        expect(r.admit).toBe(true);
    });

    it('DOES adjudicate a single-word brand next to a supplement product word', () => {
        const r = assess({
            rawLine: 'ryse protein powder',
            confidence: 0.8,
            matchedBrand: 'ryse',
            foodName: 'Optimum Nutrition Whey',
            brandName: 'Optimum Nutrition',
        });
        expect(r.admit).toBe(false);
        expect(r.reason).toBe('record_lacks_query_brand');
    });
});

describe('floor and ceiling', () => {
    it('does not claim picks at or above the existing gate', () => {
        const r = assess({
            rawLine: 'dymatize casein protein',
            confidence: SAVE_CONFIDENCE_THRESHOLD,
            matchedBrand: 'dymatize',
            foodName: 'Elite Casein',
            brandName: 'Dymatize',
        });
        expect(r.admit).toBe(false);
        expect(r.reason).toBe('above_threshold');
    });

    it('rejects below the floor, where the population stops being clustered', () => {
        const r = assess({
            rawLine: 'dymatize casein protein',
            confidence: SUB_THRESHOLD_SAVE_FLOOR - 0.01,
            matchedBrand: 'dymatize',
            foodName: 'Elite Casein',
            brandName: 'Dymatize',
        });
        expect(r.admit).toBe(false);
        expect(r.reason).toBe('below_floor');
    });

    it('admits exactly at the floor', () => {
        const r = assess({
            rawLine: 'dymatize casein protein',
            confidence: SUB_THRESHOLD_SAVE_FLOOR,
            matchedBrand: 'dymatize',
            foodName: 'Elite Casein',
            brandName: 'Dymatize',
        });
        expect(r.admit).toBe(true);
    });
});

describe('does not reopen the degenerate-nutrition class that fix 1 closed', () => {
    it('blocks an all-zero panel', () => {
        const r = assess({
            rawLine: 'dymatize casein protein',
            confidence: 0.82,
            matchedBrand: 'dymatize',
            foodName: 'Elite Casein',
            brandName: 'Dymatize',
            nutrientsPer100g: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
        });
        expect(r.admit).toBe(false);
        expect(r.reason).toBe('degenerate_macros');
    });

    it('blocks when the pick carries no macros at all (grams <= 0)', () => {
        const r = assessSubThresholdAdmission({
            rawLine: 'dymatize casein protein',
            confidence: 0.82,
            brandDetection: { isBranded: true, matchedBrand: 'dymatize' },
            foodName: 'Elite Casein',
            brandName: 'Dymatize',
            nutrientsPer100g: undefined,
        });
        expect(r.admit).toBe(false);
        expect(r.reason).toBe('no_macros');
    });
});

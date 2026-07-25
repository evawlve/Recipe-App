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

describe('KNOWN COVERAGE LIMIT: single-word chain brands are not reached', () => {
    // hasDecisiveBrandContext qualifies a single-token brand only when it sits
    // next to a token in BRAND_PRODUCT_CONTEXT_TOKENS, which is a
    // SUPPLEMENT vocabulary (protein/whey/casein/bar/creatine/...). So
    // "chipotle burrito" and "dunkin munchkins" fall out here rather than at
    // the brand-agreement check, and this fix does not convert them.
    //
    // This is deliberate, not an oversight. The same predicate gates the
    // brand prefix in deriveMappingCacheKey, and that shared use is what
    // guarantees an admitted pick cannot address a bare generic cache key.
    // Loosening it for admission alone would forfeit the guarantee and
    // reintroduce the failure that closed PR #143. Widening restaurant
    // coverage means widening the KEY predicate, which is its own change with
    // its own blast radius.
    it.each(['chipotle burrito bowl', 'chilis chips and salsa', 'wendys frosty'])(
        'declines "%s" for want of decisive brand context', (rawLine) => {
            const brand = rawLine.split(' ')[0];
            const r = assess({
                rawLine, confidence: 0.82, matchedBrand: brand,
                foodName: 'Some Food', brandName: 'Some Brand',
            });
            expect(r.admit).toBe(false);
            expect(r.reason).toBe('no_decisive_brand');
        });

    it('also misses a brand whose lexicon form does not tokenize onto the record', () => {
        // "a and w root beer" -> Root Beer [A&W] at 0.81 was a confirmed-good
        // discard in the funnel read, and it still is. The brand is decisive
        // (multi-word), but candidateMatchesTargetBrand tests the FIRST brand
        // token — "a" — against ["root","beer","a&w"]. Punctuation-collapsed
        // brand forms would need a normalization change in a helper the
        // brand_mismatch gate and the reranker also depend on.
        const r = assess({
            rawLine: 'a and w root beer',
            confidence: 0.81,
            matchedBrand: 'a and w',
            foodName: 'Root Beer',
            brandName: 'A&W',
            nutrientsPer100g: { kcal: 46, protein: 0, carbs: 12.4, fat: 0 },
        });
        expect(r.admit).toBe(false);
        expect(r.reason).toBe('record_lacks_query_brand');
    });

    it('DOES reach a single-word brand next to a supplement product word', () => {
        const r = assess({
            rawLine: 'ryse protein powder',
            confidence: 0.8,
            matchedBrand: 'ryse',
            foodName: 'Loaded Protein',
            brandName: 'RYSE',
        });
        expect(r.admit).toBe(true);
    });
});

describe('classes 2 and 3 are excluded wholesale by requiring a brand', () => {
    // Composite-dish undercount and product-form slip are overwhelmingly
    // unbranded queries, so the brand requirement removes them as a population
    // rather than trying to detect each one.
    it.each<[string, string]>([
        ['spaghetti and meatballs', 'Meatballs'],
        ['meyer lemon', 'Lemon Syrup'],
        ['injera', 'Injera Crisps'],
        ['mac and cheese', 'Macaroni, Dry'],
        ['restaurant bbq ribs', 'Brioche Bun'],
    ])('blocks the unbranded query "%s"', (rawLine, foodName) => {
        const r = assess({ rawLine, confidence: 0.82, isBranded: false, foodName });
        expect(r.admit).toBe(false);
        expect(r.reason).toBe('no_decisive_brand');
    });

    it('blocks an unbranded whole food even when a lexicon brand shares its name', () => {
        // detectBrandInQuery reports "sprouts" (Sprouts Farmers Market) here.
        // A bare matchedBrand check would admit it — and an admitted pick can
        // address a bare generic cache key, which is exactly the blast radius
        // that sank PR #143.
        const r = assess({
            rawLine: 'brussels sprouts',
            confidence: 0.82,
            matchedBrand: 'sprouts',
            foodName: 'Brussels Sprouts',
        });
        expect(r.admit).toBe(false);
        expect(r.reason).toBe('no_decisive_brand');
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

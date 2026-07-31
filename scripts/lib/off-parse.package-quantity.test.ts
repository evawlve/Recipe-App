/**
 * Package-quantity extraction (OffFood.packageQuantity / packageQuantityUnit).
 *
 * These columns feed the whole-package-count serving tier. The 2026-07-30
 * refresh left them at 0 of 1,085,525 rows because NOTHING in the ingest wrote
 * them — the column existed only as a side effect of an out-of-band backfill.
 * The end-to-end cases at the bottom exist specifically to fail if that wiring
 * is ever removed again; the unit cases pin the qualification rules that the
 * ingest and the backfill now share.
 *
 * Label strings are verbatim rows from the 2026-07-31 Parquet extract.
 */

import { parsePackageQuantity, inferPackageUnit, parseOffProduct } from './off-parse';

describe('inferPackageUnit', () => {
    it.each([
        ['591 ml', 'ml'],
        ['1.75 L', 'ml'],
        ['33 cl', 'ml'],
        ['8 fl oz', 'ml'],
        ['12 fl. oz.', 'ml'],
        ['350 g', 'g'],
        ['2,5 kg', 'g'],
        ['1 lb', 'g'],
        ['16 oz', 'g'],
    ])('reads %s as %s', (label, expected) => {
        expect(inferPackageUnit(label)).toBe(expected);
    });

    it('returns null rather than guessing when the label carries no unit', () => {
        // A wrong unit is worse than no unit: 'ml' and 'g' route to different
        // package bands downstream.
        expect(inferPackageUnit('1 piece')).toBeNull();
        expect(inferPackageUnit('')).toBeNull();
    });
});

describe('parsePackageQuantity', () => {
    it('accepts a plain single-package row', () => {
        expect(parsePackageQuantity(350, '350 g')).toEqual({ quantity: 350, unit: 'g' });
    });

    it('accepts a numeric string (CSV columns arrive as text)', () => {
        expect(parsePackageQuantity('2500.0', '2,5 kg')).toEqual({ quantity: 2500, unit: 'g' });
    });

    it('keeps the quantity when the unit is unreadable', () => {
        // Quantity is still useful on its own; the unit is separately nullable.
        expect(parsePackageQuantity(120, 'family size')).toEqual({ quantity: 120, unit: null });
    });

    describe('rejects', () => {
        it('multipacks — product_quantity is the pack TOTAL', () => {
            // Serving these as one package overbills "1 bottle" by the pack count.
            expect(parsePackageQuantity(250, '2 x 125 g')).toBeNull();
            expect(parsePackageQuantity(1474.17, '10 x 5.2 OZ (150 g)')).toBeNull();
            expect(parsePackageQuantity(2130, '6 × 355 ml')).toBeNull();
        });

        it('a parenthesised pack count even when the total is correct', () => {
            // "26.6 g (14 x 1.9 g)" — 26.6 IS the true net weight, so this is a
            // deliberate false negative. Losing a row is cheap; overbilling 14x
            // is not. Pinned so the conservatism is a decision, not an accident.
            expect(parsePackageQuantity(26.6, '26.6 g (14 x 1.9 g)')).toBeNull();
        });

        it('zero and negative quantities', () => {
            expect(parsePackageQuantity(0, '0 g')).toBeNull();
            expect(parsePackageQuantity(-5, '5 g')).toBeNull();
        });

        it('quantities above the 100kg sanity bound', () => {
            expect(parsePackageQuantity(100001, '100001 g')).toBeNull();
            expect(parsePackageQuantity(100000, '100000 g')).not.toBeNull(); // bound is inclusive
        });

        it('missing and unparseable values', () => {
            expect(parsePackageQuantity(undefined, '')).toBeNull();
            expect(parsePackageQuantity(null, '')).toBeNull();
            expect(parsePackageQuantity('', '')).toBeNull();
            expect(parsePackageQuantity('n/a', '')).toBeNull();
            expect(parsePackageQuantity(NaN, '')).toBeNull();
        });
    });
});

describe('parseOffProduct wiring (the 2026-07-30 regression)', () => {
    // Minimal product that clears the country, category, macro and Atwater
    // gates, so these cases isolate the package-quantity fields.
    const base = {
        code: '0012345678905',
        product_name: 'Test Crackers',
        brands: 'Testco',
        countries_tags: ['en:united-states'],
        nutriments: {
            'energy-kcal_100g': 400,
            proteins_100g: 8,
            carbohydrates_100g: 70,
            fat_100g: 10,
            fiber_100g: 3,
        },
    };

    function parsed(extra: Record<string, unknown>) {
        const r = parseOffProduct({ ...base, ...extra });
        if (r.skip) throw new Error(`fixture was skipped: ${r.reason}`);
        return r.data;
    }

    it('carries product_quantity/quantity through to the parsed row', () => {
        const d = parsed({ product_quantity: 453.592, quantity: '1 lb' });
        expect(d.packageQuantity).toBeCloseTo(453.592);
        expect(d.packageQuantityUnit).toBe('g');
    });

    it('leaves both null when OFF has no package fields', () => {
        const d = parsed({});
        expect(d.packageQuantity).toBeNull();
        expect(d.packageQuantityUnit).toBeNull();
    });

    it('leaves both null for a multipack', () => {
        const d = parsed({ product_quantity: 2130, quantity: '6 x 355 ml' });
        expect(d.packageQuantity).toBeNull();
        expect(d.packageQuantityUnit).toBeNull();
    });

    it('does not confuse serving weight with package weight', () => {
        // servingGrams and packageQuantity are independent tiers; a row can
        // have both, and swapping them bills a serving as a whole package.
        const d = parsed({
            serving_size: '30 g', serving_quantity: 30,
            product_quantity: 453.592, quantity: '1 lb',
        });
        expect(d.servingGrams).toBe(30);
        expect(d.packageQuantity).toBeCloseTo(453.592);
    });
});

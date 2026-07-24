import { legacyHitReflectsBrand } from '../map-ingredient-with-fallback';

// The brandless legacy cache key (deriveCacheKeyName) drops the detected brand,
// so it can match a GENERIC record. legacyHitReflectsBrand blocks a fallback hit
// that shows no trace of the detected brand (name or brandName), which is what
// caused "one bar birthday cake" → generic "Birthday Cake".
describe('legacyHitReflectsBrand', () => {
    it('rejects a generic record for a branded query (the n-brand-02 bug)', () => {
        expect(
            legacyHitReflectsBrand({ foodName: 'Birthday Cake', brandName: null }, 'one bar'),
        ).toBe(false);
    });

    it('accepts a record whose NAME carries the brand token', () => {
        expect(
            legacyHitReflectsBrand(
                { foodName: 'One birthday cake protein bars', brandName: null },
                'one bar',
            ),
        ).toBe(true);
    });

    it('accepts a record whose brandName carries the brand', () => {
        expect(
            legacyHitReflectsBrand({ foodName: 'Ketchup', brandName: 'Heinz' }, 'heinz'),
        ).toBe(true);
    });

    it('rejects a different-brand generic record', () => {
        expect(
            legacyHitReflectsBrand({ foodName: 'Tomato Ketchup', brandName: 'Hunts' }, 'heinz'),
        ).toBe(false);
    });

    it('does not block when the brand has no significant (≥3-char) token', () => {
        // Nothing specific to match on — never block (conservative).
        expect(legacyHitReflectsBrand({ foodName: 'Anything', brandName: null }, 'a')).toBe(true);
    });
});

import {
    dedupeCandidates,
    macroSignature,
    normalizeNameKey,
} from '../dedupe-candidates';
import type { UnifiedCandidate } from '../../mapping/gather-candidates';

function candidate(overrides: Partial<UnifiedCandidate> & { name: string }): UnifiedCandidate {
    return {
        id: overrides.id ?? `off_${Math.random().toString(36).slice(2)}`,
        source: 'openfoodfacts',
        score: 0.8,
        brandName: null,
        rawData: {},
        nutrition: { kcal: 69, protein: 0.7, carbs: 18, fat: 0.2, per100g: true },
        ...overrides,
    };
}

describe('normalizeNameKey', () => {
    it('is case-, punctuation-, and word-order-insensitive', () => {
        expect(normalizeNameKey('Grapes, red')).toBe(normalizeNameKey('Red Grapes'));
        expect(normalizeNameKey('grapes')).toBe(normalizeNameKey('Grapes!'));
    });

    it('singularizes tokens', () => {
        expect(normalizeNameKey('grapes')).toBe(normalizeNameKey('grape'));
        expect(normalizeNameKey('tomatoes')).toBe(normalizeNameKey('tomato'));
        expect(normalizeNameKey('berries')).toBe(normalizeNameKey('berry'));
    });

    it('does not mangle short or ss-ending words', () => {
        expect(normalizeNameKey('swiss cheese')).toContain('swiss');
        expect(normalizeNameKey('peas')).toBe('pea');
    });

    it('strips diacritics', () => {
        expect(normalizeNameKey('açaí')).toBe(normalizeNameKey('acai'));
    });
});

describe('macroSignature', () => {
    it('buckets nearby macro values together', () => {
        expect(macroSignature({ kcal: 68, protein: 0.6, carbs: 17.8, fat: 0.2, per100g: true }))
            .toBe(macroSignature({ kcal: 71, protein: 0.9, carbs: 18.2, fat: 0.4, per100g: true }));
    });

    it('separates genuinely different foods', () => {
        const grapes = macroSignature({ kcal: 69, protein: 0.7, carbs: 18, fat: 0.2, per100g: true });
        const raisins = macroSignature({ kcal: 299, protein: 3.1, carbs: 79, fat: 0.5, per100g: true });
        expect(grapes).not.toBe(raisins);
    });

    it('marks all-zero/missing macros as empty', () => {
        expect(macroSignature(undefined)).toBe('empty');
        expect(macroSignature({ kcal: 0, protein: 0, carbs: 0, fat: 0, per100g: true })).toBe('empty');
    });
});

describe('dedupeCandidates', () => {
    it('collapses near-identical entries to one representative', () => {
        const input = [
            candidate({ id: 'off_1', name: 'Grapes' }),
            candidate({ id: 'off_2', name: 'grapes' }),
            candidate({ id: 'off_3', name: 'Grapes.' }),
            candidate({ id: 'off_4', name: 'Grape' }),
        ];
        expect(dedupeCandidates(input)).toHaveLength(1);
    });

    it('prefers FDC over OFF as the surviving representative', () => {
        const input = [
            candidate({ id: 'off_1', name: 'Grapes' }),
            candidate({ id: 'fdc_1', name: 'grapes raw', source: 'fdc' }),
        ];
        // Different names → both survive; same name → FDC wins
        const sameName = [
            candidate({ id: 'off_1', name: 'Grapes' }),
            candidate({ id: 'fdc_1', name: 'Grapes', source: 'fdc' }),
        ];
        const result = dedupeCandidates(sameName);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('fdc_1');
        expect(dedupeCandidates(input)).toHaveLength(2);
    });

    it('prefers a real brand, then completeness, among same-source duplicates', () => {
        const branded = dedupeCandidates([
            candidate({ id: 'off_1', name: 'Grapes' }),
            candidate({ id: 'off_2', name: 'Grapes', brandName: 'Dole' }),
        ]);
        expect(branded[0].id).toBe('off_2');

        const complete = dedupeCandidates([
            candidate({ id: 'off_3', name: 'Grapes', nutrition: { kcal: 69, protein: 0.7, carbs: 18, fat: 0, per100g: true } }),
            candidate({ id: 'off_4', name: 'Grapes', nutrition: { kcal: 69, protein: 0.7, carbs: 18, fat: 0.4, per100g: true } }),
        ]);
        // fat 0 vs 0.4 both round to 0 → same group; the one with fat data is more complete
        expect(complete).toHaveLength(1);
        expect(complete[0].id).toBe('off_4');
    });

    it('keeps entries whose macros genuinely differ', () => {
        const input = [
            candidate({ id: 'off_1', name: 'Grapes', nutrition: { kcal: 69, protein: 0.7, carbs: 18, fat: 0.2, per100g: true } }),
            candidate({ id: 'off_2', name: 'Grapes', nutrition: { kcal: 299, protein: 3, carbs: 79, fat: 0.5, per100g: true } }),
        ];
        expect(dedupeCandidates(input)).toHaveLength(2);
    });

    it('drops zero-macro entries when a same-named entry has macros', () => {
        const input = [
            candidate({ id: 'off_empty', name: 'Grapes', nutrition: { kcal: 0, protein: 0, carbs: 0, fat: 0, per100g: true } }),
            candidate({ id: 'off_full', name: 'Grapes' }),
        ];
        const result = dedupeCandidates(input);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('off_full');
    });

    it('keeps a zero-macro entry when it is the only one with that name', () => {
        const input = [
            candidate({ id: 'off_empty', name: 'Mystery Snack', nutrition: { kcal: 0, protein: 0, carbs: 0, fat: 0, per100g: true } }),
            candidate({ id: 'off_full', name: 'Grapes' }),
        ];
        expect(dedupeCandidates(input)).toHaveLength(2);
    });

    it('preserves input order (first occurrence wins position)', () => {
        const input = [
            candidate({ id: 'fdc_1', name: 'Grapes raw', source: 'fdc' }),
            candidate({ id: 'off_1', name: 'Green Grapes', nutrition: { kcal: 69, protein: 0.7, carbs: 18, fat: 0.2, per100g: true } }),
            candidate({ id: 'off_2', name: 'Banana', nutrition: { kcal: 89, protein: 1.1, carbs: 23, fat: 0.3, per100g: true } }),
        ];
        const result = dedupeCandidates(input);
        expect(result.map(c => c.id)).toEqual(['fdc_1', 'off_1', 'off_2']);
    });

    it('handles empty input', () => {
        expect(dedupeCandidates([])).toEqual([]);
    });
});

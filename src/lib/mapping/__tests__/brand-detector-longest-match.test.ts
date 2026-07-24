/**
 * FIX 1: the brand detector must prefer the LONGEST matching brand phrase so
 * multi-word supplement/energy brands are read as whole phrases. Before this,
 * "alani nu ..." matched the bare 1-gram "alani" (already in the lexicon) and
 * lost the decisive multi-word context; the whole-phrase match restores it.
 */
import { detectBrandInQuery } from '../brand-detector';
import { hasDecisiveBrandContext } from '../simple-rerank';

describe('brand detector longest-first matching (FIX 1)', () => {
    it('matches the whole "alani nu" phrase, not the bare "alani" sub-token', () => {
        const det = detectBrandInQuery('alani nu pre workout arctic white');
        expect(det.isBranded).toBe(true);
        expect(det.matchedBrand?.toLowerCase()).toBe('alani nu');
    });

    it('a whole-phrase multi-word brand is decisive on its own', () => {
        const det = detectBrandInQuery('alani nu pre workout arctic white');
        expect(hasDecisiveBrandContext('alani nu pre workout arctic white', det.matchedBrand!)).toBe(true);
    });

    it('newly-added supplement/energy/DTC brands are detected', () => {
        for (const q of [
            'bucked up rocket pop pre workout',
            'gorilla mode pre workout',
            'ghost energy sour patch',
            'celsius sparkling orange',
            'total war pre workout',
            'core power protein shake',
            'gomacro protein bar',
            'slim jim original',
            'redcon1 total war pre workout',
            'kaged muscle creatine',
        ]) {
            expect(detectBrandInQuery(q).isBranded).toBe(true);
        }
    });

    it('preserves existing single-token produce behavior ("bell pepper" -> "bell")', () => {
        const det = detectBrandInQuery('bell pepper');
        expect(det.matchedBrand?.toLowerCase()).toBe('bell');
    });

    it('preserves multi-word "dr pepper" detection', () => {
        expect(detectBrandInQuery('dr pepper').matchedBrand?.toLowerCase()).toBe('dr pepper');
    });
});

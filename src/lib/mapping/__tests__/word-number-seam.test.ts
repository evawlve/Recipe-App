/**
 * TRIPWIRE for the word-number seam guard.
 *
 * The guard exists because `one slice of Swiss cheese` wrote the orphaned cache
 * key `cheese one swiss`. The DANGER is not that the guard stops working — it is
 * that someone "generalises" it into a blanket word-number strip and silently
 * moves the twelve LEGITIMATE word-number keys, two of which are the highest
 * traffic rows in the class (`birthday cake one` usedCount 242, `milk one` 203).
 *
 * So the pinned half of this file is the load-bearing half. Both refuted fixes
 * are pinned here as regressions, not described in prose:
 *   (a) a blanket leading-word-number strip, and
 *   (b) re-running the segmenter name through parseIngredientLine().
 * Owner: `sync-docs/reports/2026-08-25_the-word-number-key-and-why-both-obvious-fixes-break-it.md`
 * (mobile repo). Populations re-measured on the box 2026-08-31.
 */
import { stripSpentWordNumber } from '../map-ingredient-with-fallback';
import { parseIngredientLine } from '../../parse/ingredient-line';

const strip = (rawLine: string, segmenterName: string) =>
    stripSpentWordNumber(rawLine, segmenterName, parseIngredientLine(rawLine));

describe('stripSpentWordNumber — fires only on the parser/segmenter disagreement', () => {
    it('strips the number the parser already spent as a quantity', () => {
        // The defect of record: key was `cheese one swiss`, must become `cheese swiss`.
        expect(strip('one slice of Swiss cheese', 'one Swiss cheese')).toBe('Swiss cheese');
    });

    it('strips it when the unit is a size word the segmenter dropped', () => {
        // Produced the second orphan, `banana one`.
        expect(strip('one medium banana', 'one banana')).toBe('banana');
    });

    it.each([
        // The number is the PRODUCT NAME. The raw line yields no unit, so the
        // parser never spent the word-number and there is no disagreement.
        ['four cheese pizza', 'four cheese pizza'],
        ['freschetta four cheese pizza', 'freschetta four cheese pizza'],
        ['ten vegetable soup', 'ten vegetable soup'],
        ['panera ten vegetable soup', 'panera ten vegetable soup'],
        ['five cheese ziti al forno', 'five cheese ziti al forno'],
        ['red baron four cheese pizza', 'red baron four cheese pizza'],
        ['digiorno rising crust four cheese pizza', 'digiorno rising crust four cheese pizza'],
        // The number is the BRAND (the ONE bar family) — the 242-serve key.
        ['one bar birthday cake', 'one bar birthday cake'],
        ['almond bliss one bar', 'almond bliss one bar'],
        ['one rolled oat chocolate fiber bar', 'one rolled oat chocolate fiber bar'],
        ['milk one', 'milk one'],
        // The segmenter KEPT the unit, so the two sides agree.
        ['one slice whole wheat bread', 'one slice whole wheat bread'],
        ['one egg', 'one egg'],
        // The raw line does not lead with the word-number at all.
        ['3 one bars', 'one bars'],
        ['2 one protein bars', 'one protein bars'],
    ])('leaves %s alone', (rawLine, segmenterName) => {
        expect(strip(rawLine, segmenterName)).toBeNull();
    });

    it('never strips a name down to nothing', () => {
        expect(strip('one slice of cheese', 'one')).toBeNull();
    });

    it('requires the SAME word-number on both sides', () => {
        expect(strip('one slice of Swiss cheese', 'two Swiss cheese')).toBeNull();
    });
});

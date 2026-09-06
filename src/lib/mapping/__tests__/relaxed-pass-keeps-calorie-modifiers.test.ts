/**
 * The relaxed admission pass keeps the CALORIE-class modifier check (2026-09-05).
 *
 * Defect, measured on master 5411f7e with winner-diff `replay --verbose --debug`:
 * `2 tbsp ghugh's sugar free honey mustard` derives the must-have tokens
 * `['ghugh','honey']`, `ghugh` is unsatisfiable (the corpus spells the brand `G hughes`),
 * the strict pass empties (21 -> 0), and the relaxed pass — which skips
 * hasCriticalModifierMismatch() wholesale — re-admits the full-sugar brandless
 * `Honey mustard` rows the strict pass had just rejected for critical_modifier_mismatch.
 * One of them wins. A `sugar free` line billed as full-sugar honey mustard.
 *
 * What these tests pin:
 *   1. hasCalorieModifierViolation() is the strict function's calorie block, byte-for-
 *      byte in behaviour (parity on pairs where no fat class fires), and its class
 *      boundary is the module's own CALORIE_MODIFIERS — NOT a wider list.
 *   2. Under `relaxed`, a pool with a calorie-violating candidate and a compliant one is
 *      narrowed to the compliant one.
 *   3. THE STRONGER PROPERTY: a relaxed pool where EVERY candidate violates the calorie
 *      class is returned UNCHANGED — today's pool — so no line that resolves today loses
 *      its pool; only the choice among today's relaxed candidates can change.
 *   4. The fat classes keep the relaxed pass's leniency (a full-fat record still survives
 *      a `reduced fat` line's relaxed pass, exactly as on master).
 *   5. The strict pass is unchanged (still rejects the full-sugar row on its own).
 *
 * Fixture note: the fake brand `ghugh` is deliberately a token no candidate carries, so the
 * strict must-have check empties the pool and the relaxed pass is the one under test.
 * Candidates carry no nutrition block: the macro filters are null-tolerant (the existing
 * restaurant-brand-filter-relax fixtures rely on the same), so nothing but the token and
 * modifier checks decides these pools.
 */
import {
    filterCandidatesByTokens,
    hasCalorieModifierViolation,
    hasCriticalModifierMismatch,
    deriveMustHaveTokens,
} from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';

let _id = 0;
function cand(partial: Partial<UnifiedCandidate>): UnifiedCandidate {
    return {
        id: `c${_id++}`,
        source: 'openfoodfacts',
        name: 'x',
        brandName: null,
        score: 1,
        rawData: null,
        ...(partial as any),
    } as UnifiedCandidate;
}

const RAW = "2 tbsp ghugh's sugar free honey mustard";
const NORM = "ghugh's sugar free honey mustard";

const fullSugar = () => cand({ name: 'Honey mustard', brandName: null });
const fullSugar2 = () => cand({ name: 'Honey Mustard', brandName: null });
const sugarFree = () => cand({ name: 'Sugar free honey mustard dipping sauce', brandName: 'G hughes' });

describe('hasCalorieModifierViolation — the calorie class, and only the calorie class', () => {
    it('fires when the query is sugar free and the candidate carries no low-cal marker', () => {
        expect(hasCalorieModifierViolation(RAW, 'Honey mustard')).toBe(true);
        expect(hasCalorieModifierViolation('diet cola', 'Cola')).toBe(true);
        expect(hasCalorieModifierViolation('low calorie mayo', 'Mayonnaise')).toBe(true);
    });

    it('is satisfied by every candidate-side equivalent the strict pass already accepts', () => {
        expect(hasCalorieModifierViolation(RAW, 'Sugar free honey mustard dipping sauce')).toBe(false);
        expect(hasCalorieModifierViolation(RAW, 'Fat Free Honey Mustard Dressing')).toBe(false);
        expect(hasCalorieModifierViolation('low calorie mayo', 'Light Mayonnaise')).toBe(false);
        expect(hasCalorieModifierViolation('sugar free ice cream', 'No Sugar Added Vanilla')).toBe(false);
        expect(hasCalorieModifierViolation('diet cola', 'Diet Cola')).toBe(false);
    });

    it('never fires on a fat-class query — that class keeps the relaxed pass leniency', () => {
        expect(hasCalorieModifierViolation('reduced fat cheddar', 'Cheddar Cheese')).toBe(false);
        expect(hasCalorieModifierViolation('2 tbsp fat free ranch', 'Ranch Dressing')).toBe(false);
        expect(hasCalorieModifierViolation('low fat milk', 'Whole Milk')).toBe(false);
        expect(hasCalorieModifierViolation('light ranch', 'Ranch')).toBe(false);
    });

    it("pins the class boundary at the module's own CALORIE_MODIFIERS: zero sugar / unsweetened are NOT in it today", () => {
        // Widening the class is a deliberate edit to CALORIE_MODIFIERS in filter-candidates.ts.
        // This test exists so that edit is made on purpose, with its own gate, never by accident.
        expect(hasCalorieModifierViolation('zero sugar cola', 'Cola')).toBe(false);
        expect(hasCalorieModifierViolation('unsweetened almond milk', 'Almond Milk')).toBe(false);
    });

    it('agrees with hasCriticalModifierMismatch() wherever no fat class is in play (parity pin)', () => {
        const pairs: Array<[string, string]> = [
            ['diet cola', 'Cola'], ['diet cola', 'Diet Cola'], ['diet cola', 'Cola Zero'],
            ['sugar free syrup', 'Maple Syrup'], ['sugar free syrup', 'Lite Syrup'],
            [RAW, 'Honey mustard'], [RAW, 'Sugar free honey mustard dipping sauce'],
            ['low calorie ranch', 'Ranch'], ['low calorie ranch', 'Calorie Free Ranch'],
            ['honey mustard', 'Honey mustard'], ['honey mustard', 'Sugar free honey mustard'],
        ];
        for (const [q, c] of pairs) {
            expect(hasCriticalModifierMismatch(q, c, 'openfoodfacts')).toBe(hasCalorieModifierViolation(q, c));
        }
    });
});

describe('filterCandidatesByTokens — the relaxed pass keeps the calorie class', () => {
    it('fixture sanity: the fake brand IS a must-have token, so the strict pass empties', () => {
        expect(deriveMustHaveTokens(NORM)).toEqual(['ghugh', 'honey']);
        const strict = filterCandidatesByTokens([fullSugar(), sugarFree()], NORM, { rawLine: RAW });
        expect(strict.filtered).toHaveLength(0);
    });

    it('narrows a relaxed pool to the candidates that honour the calorie modifier', () => {
        const pool = [fullSugar(), sugarFree(), fullSugar2()];
        const relaxed = filterCandidatesByTokens(pool, NORM, { rawLine: RAW, relaxed: true });
        expect(relaxed.filtered.map(c => c.name)).toEqual(['Sugar free honey mustard dipping sauce']);
    });

    it('keeps the candidate-side equivalents (fat free / light) in the narrowed relaxed pool', () => {
        const pool = [fullSugar(), cand({ name: 'Fat Free Honey Mustard Dressing', brandName: 'Gourmet Table' }), sugarFree()];
        const relaxed = filterCandidatesByTokens(pool, NORM, { rawLine: RAW, relaxed: true });
        expect(relaxed.filtered.map(c => c.name).sort()).toEqual([
            'Fat Free Honey Mustard Dressing',
            'Sugar free honey mustard dipping sauce',
        ]);
    });

    it('THE STRONGER PROPERTY: a relaxed pool where every candidate violates is returned unchanged', () => {
        // Today's relaxed result for this pool is both full-sugar rows. Applying the calorie
        // check would empty it, so the pool falls back to today's — the line keeps resolving
        // (to the same wrong-ish answer it gets on master) rather than to nothing.
        const pool = [fullSugar(), fullSugar2()];
        const relaxed = filterCandidatesByTokens(pool, NORM, { rawLine: RAW, relaxed: true });
        expect(relaxed.filtered.map(c => c.name)).toEqual(['Honey mustard', 'Honey Mustard']);
        expect(relaxed.removedCount).toBe(0);
    });

    it("a relaxed pool with NO calorie modifier on the query is byte-identical to today's", () => {
        // `xyzbrand` empties the strict pass; relaxed admits every cheddar. No calorie class on
        // the query, so the narrowing step is inert and the pool is master's.
        const pool = [
            cand({ name: 'Cheddar Cheese', source: 'fatsecret' }),
            cand({ name: 'Sharp Cheddar', source: 'fatsecret' }),
        ];
        const relaxed = filterCandidatesByTokens(pool, 'xyzbrand cheddar', { rawLine: 'xyzbrand cheddar', relaxed: true });
        expect(relaxed.filtered).toHaveLength(2);
    });

    it('the FAT classes keep the relaxed leniency: a full-fat record survives a reduced-fat line', () => {
        // On master the relaxed pass skips hasCriticalModifierMismatch() entirely, so the full-fat
        // FatSecret cheddar (which the STRICT pass rejects for a `reduced fat` query) is admitted.
        // That is the leniency the narrowing must not touch — and does not.
        const raw = 'xyzbrand reduced fat cheddar';
        const pool = [cand({ name: 'Cheddar Cheese', source: 'fatsecret' })];
        expect(hasCriticalModifierMismatch(raw, 'Cheddar Cheese', 'fatsecret')).toBe(true);
        const relaxed = filterCandidatesByTokens(pool, raw, { rawLine: raw, relaxed: true });
        expect(relaxed.filtered.map(c => c.name)).toEqual(['Cheddar Cheese']);
    });

    it('the STRICT pass is unchanged: it still rejects the full-sugar row on the calorie class alone', () => {
        // The TRAILING spelling is the production control (p3 replay, master 5411f7e: strict
        // ADMITTED=2, both sugar-free dipping sauces): the must-have derivation is positional, so
        // `ghugh` is core token #3 and never required, and the modifier check alone decides.
        // (A line that does not name the brand at all trips meal_product_mismatch on the
        // "dipping sauce" record instead — a different filter, not the one under test.)
        const raw = 'Sugar free honey mustard ghugh';
        const norm = 'sugar free honey mustard ghugh';
        expect(deriveMustHaveTokens(norm)).toEqual(['honey', 'mustard']);
        const strict = filterCandidatesByTokens([fullSugar(), sugarFree()], norm, { rawLine: raw });
        expect(strict.filtered.map(c => c.name)).toEqual(['Sugar free honey mustard dipping sauce']);
    });
});

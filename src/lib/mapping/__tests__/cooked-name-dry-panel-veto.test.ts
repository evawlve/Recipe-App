import { simpleRerank, type RerankCandidate } from '../simple-rerank';

/**
 * A record whose NAME says cooked but whose PANEL is dry (>= 280 kcal/100 g) is not a cooked record
 * for the grain preference (C6970 s410, 2026-10-30). The defect (s407, measured 2026-10-31): OFF
 * `off_20720155` "Basmati rice (cooked)" is labelled per 100 g RAW (369 kcal) and won
 * `a cup of cooked basmati rice` over six cooked basmati records at 121-153 kcal in the same pool.
 *
 * The seven records below are the live admitted pool of that line, copied from the s400 winner-gate
 * snapshot (entry `a cup of cooked basmati rice`, ids = the run's admittedIds).
 */
const BASMATI_POOL: RerankCandidate[] = [
    { id: 'off_8901047011054', name: 'Cooked Basmati Rice', brandName: 'Trophy', foodType: null, score: 8.85, source: 'openfoodfacts' as const, nutrition: { kcal: 138.623, protein: 2.8, carbs: 32, fat: 0.4, per100g: true } },
    { id: 'off_5051379048181', name: 'Cooked Basmati Rice', brandName: 'Fresh & Easy', foodType: null, score: 8.85, source: 'openfoodfacts' as const, nutrition: { kcal: 143, protein: 2.86, carbs: 31.43, fat: 0, per100g: true } },
    { id: 'off_29398102', name: 'cooked basmati rice', brandName: 'Marks & Spencers', foodType: null, score: 8.85, source: 'openfoodfacts' as const, nutrition: { kcal: 150, protein: 3.6, carbs: 29.3, fat: 1.7, per100g: true } },
    { id: 'off_20720155', name: 'Basmati rice (cooked)', brandName: 'Lidl', foodType: null, score: 5.85, source: 'openfoodfacts' as const, nutrition: { kcal: 369, protein: 8.1, carbs: 83.7, fat: 0.5, per100g: true } },
    { id: 'off_29496693', name: 'Cooked Brown Basmati Rice', brandName: 'Marks & Spencers', foodType: null, score: 5.8, source: 'openfoodfacts' as const, nutrition: { kcal: 140.8, protein: 3.2, carbs: 27.04, fat: 1.84, per100g: true } },
    { id: 'off_0020601412156', name: 'Organic Cooked Brown Basmati Rice', brandName: "Heinen's", foodType: null, score: 5.75, source: 'openfoodfacts' as const, nutrition: { kcal: 153.333, protein: 3.333, carbs: 34.667, fat: 1.667, per100g: true } },
    { id: 'off_9415077105724', name: 'Basmati Long Grain Rice (cooked)', brandName: 'Pams', foodType: null, score: 5.75, source: 'openfoodfacts' as const, nutrition: { kcal: 121, protein: 3, carbs: 26, fat: 0.3, per100g: true } },
];

const COOKED_IDS = [
    'off_8901047011054', 'off_5051379048181', 'off_29398102', 'off_29496693', 'off_0020601412156', 'off_9415077105724',
];

function cand(partial: Partial<RerankCandidate> & { id: string; name: string }): RerankCandidate {
    return { score: 0.5, source: 'openfoodfacts', ...partial };
}

describe('cooked-named record with a dry panel does not count as cooked', () => {
    it('(i) explicit line: a cooked basmati record wins, the 369 kcal record no longer does', () => {
        const r = simpleRerank('basmati rice', BASMATI_POOL, undefined, 'a cup of cooked basmati rice', false, undefined, false);
        expect(r.winner?.id).not.toBe('off_20720155');
        expect(COOKED_IDS).toContain(r.winner?.id);
        expect(r.winner!.nutrition!.kcal).toBeLessThanOrEqual(170);
        expect(r.reason).toBe('cooked_grain_preference');
        // The vetoed record is partitioned below every cooked record.
        const order = r.sortedCandidates.map(c => c.id);
        const dryIdx = order.indexOf('off_20720155');
        for (const id of COOKED_IDS) expect(order.indexOf(id)).toBeLessThan(dryIdx);
    });

    it('(iii) soft line `a cup of basmati rice`: the veto applies on the soft preference too', () => {
        const r = simpleRerank('basmati rice', BASMATI_POOL, undefined, 'a cup of basmati rice', false, undefined, false);
        expect(r.winner?.id).not.toBe('off_20720155');
        expect(COOKED_IDS).toContain(r.winner?.id);
        expect(r.winner!.nutrition!.kcal).toBeLessThanOrEqual(170);
    });

    it('(ii) pin: Steel Cut Oats (Cooked) at 73 kcal still counts as cooked', () => {
        const oats = cand({
            id: 'fs_oats', name: 'Steel Cut Oats (Cooked)', source: 'fatsecret', score: 0.6,
            nutrition: { kcal: 73, protein: 3, carbs: 12.5, fat: 1.4, per100g: true },
        });
        const dry = cand({
            id: 'off_dry_oats', name: 'Rolled Oats', score: 0.9,
            nutrition: { kcal: 379, protein: 13, carbs: 68, fat: 6.5, per100g: true },
        });
        const r = simpleRerank('oats', [dry, oats], undefined, '1 cup cooked oats', false, undefined, false);
        expect(r.winner?.id).toBe('fs_oats');
        expect(r.reason).toBe('cooked_grain_preference');
    });

    it.each([
        ['no nutrition at all', undefined],
        ['per100g false', { kcal: 400, protein: 8, carbs: 80, fat: 1, per100g: false }],
    ])('(iv) a cooked name with %s still counts as cooked (null / non-per-100g is not a dry panel)', (_label, nutrition) => {
        const unknown = cand({ id: 'x_cooked', name: 'Cooked Basmati Rice', score: 0.5, nutrition });
        const dry = cand({
            id: 'x_dry', name: 'Basmati Rice', score: 0.9,
            nutrition: { kcal: 356, protein: 8, carbs: 78, fat: 0.6, per100g: true },
        });
        const r = simpleRerank('basmati rice', [dry, unknown], undefined, 'a cup of cooked basmati rice', false, undefined, false);
        expect(r.winner?.id).toBe('x_cooked');
    });
});

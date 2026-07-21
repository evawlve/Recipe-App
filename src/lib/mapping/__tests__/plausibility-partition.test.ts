import { simpleRerank, type RerankCandidate } from '../simple-rerank';

/**
 * Rank-time plausibility partition (PR D pt3, Lever B3).
 *
 * Floor-hit candidates — per-100g macros that trip a deterministic floor for
 * the query (produce kcal>150, lean-cut protein<18, ...) or a barcode on the
 * triage-confirmed corrupt denylist — sort strictly BELOW plausible ones, but
 * are never dropped. The partition sits strictly below the decisive-brand and
 * cooked-grain partitions. Kill-switch: RANK_PLAUSIBILITY_PARTITION="0".
 *
 * Golden anchors: n-mq-24 (tuna 5.66g protein), n-mq-27 (lemon 383 kJ-as-kcal).
 */

function cand(partial: Partial<RerankCandidate> & { id: string; name: string }): RerankCandidate {
    return { score: 0.5, source: 'openfoodfacts', ...partial };
}

// Real denylisted barcode (corrupt-off-denylist.json: nutella, per-serving
// panel stored as per-100g).
const DENYLISTED_ID = 'off_0062020001849';

const ORIGINAL_ENV = process.env.RANK_PLAUSIBILITY_PARTITION;

afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
        delete process.env.RANK_PLAUSIBILITY_PARTITION;
    } else {
        process.env.RANK_PLAUSIBILITY_PARTITION = ORIGINAL_ENV;
    }
});

// The lemon-383 class: kJ-stored-as-kcal produce record with a perfect name
// match vs a plausible generic with a weaker name/score.
const lemonCorrupt = cand({
    id: 'off_corrupt_lemon', name: 'Lemon', score: 0.95,
    nutrition: { kcal: 383, protein: 1.1, carbs: 93, fat: 0.3, per100g: true },
});
const lemonPlausible = cand({
    id: 'fdc_lemon_raw', name: 'Lemon Raw', score: 0.8, source: 'fdc',
    nutrition: { kcal: 29, protein: 1.1, carbs: 9.3, fat: 0.3, per100g: true },
});

describe('plausibility partition', () => {
    it('demotes a floor-hit exact-name candidate below a plausible generic (lemon-383 class)', () => {
        const result = simpleRerank('lemon', [lemonCorrupt, lemonPlausible]);
        expect(result.winner?.id).toBe('fdc_lemon_raw');
    });

    it('demotes a lean-cut protein-floor candidate (tuna 5.66g class)', () => {
        const sauced = cand({
            id: 'off_sauced_tuna', name: 'Tuna', score: 0.95,
            nutrition: { kcal: 180, protein: 5.66, carbs: 10, fat: 12, per100g: true },
        });
        const real = cand({
            id: 'fdc_tuna', name: 'Tuna', score: 0.8, source: 'fdc',
            nutrition: { kcal: 116, protein: 25.5, carbs: 0, fat: 0.8, per100g: true },
        });
        const result = simpleRerank('tuna', [sauced, real]);
        expect(result.winner?.id).toBe('fdc_tuna');
    });

    it('all-floor pool is a comparative no-op — best score still wins', () => {
        const worse = cand({
            id: 'off_corrupt_b', name: 'Lemon Fresh', score: 0.7,
            nutrition: { kcal: 412, protein: 1, carbs: 98, fat: 0.4, per100g: true },
        });
        const result = simpleRerank('lemon', [lemonCorrupt, worse]);
        expect(result.winner?.id).toBe('off_corrupt_lemon');
    });

    it('candidates without nutrition are neutral — never flagged, never promoted', () => {
        const noNutrition = cand({ id: 'off_no_nutrition', name: 'Lemon', score: 0.95 });
        const result = simpleRerank('lemon', [noNutrition, lemonPlausible]);
        // No floor fires for the nutrition-less candidate, so plain score
        // order holds and the stronger name match wins.
        expect(result.winner?.id).toBe('off_no_nutrition');
    });

    it('demotes a denylisted OFF record even when the query trips no macro floor', () => {
        const denylisted = cand({
            id: DENYLISTED_ID, name: 'Hazelnut Spread', score: 0.95,
            nutrition: { kcal: 108, protein: 1.2, carbs: 11.4, fat: 6.4, per100g: true },
        });
        const clean = cand({
            id: 'off_clean_spread', name: 'Hazelnut Spread', score: 0.8,
            nutrition: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, per100g: true },
        });
        const result = simpleRerank('hazelnut spread', [denylisted, clean]);
        expect(result.winner?.id).toBe('off_clean_spread');
    });

    it('partition order: decisive-brand beats plausibility (floor-hit brand pick still wins)', () => {
        // The named brand's own record is denylisted (floor-hit), but the
        // decisive-brand partition sits ABOVE plausibility — the user named
        // the brand, so it must still beat the cross-brand hijacker.
        const hijacker = cand({
            id: 'off_on', name: 'Cinnamon Roll Protein', brandName: 'Optimum Nutrition', score: 0.9,
            nutrition: { kcal: 380, protein: 75, carbs: 10, fat: 5, per100g: true },
        });
        const ghostDenylisted = cand({
            id: DENYLISTED_ID, name: 'Cinnamon Roll Protein Powder', brandName: 'GHOST', score: 0.7,
            nutrition: { kcal: 380, protein: 70, carbs: 12, fat: 5, per100g: true },
        });
        const result = simpleRerank(
            'ghost protein cinnamon roll', [hijacker, ghostDenylisted], undefined,
            '2 scoops ghost protein cinnamon roll', true, 'ghost',
        );
        expect(result.winner?.id).toBe(DENYLISTED_ID);
    });

    it('partition order: cooked-grain beats plausibility (floor-hit cooked record still wins)', () => {
        // Under softCooked context (volume-unit bare grain) a denylisted cooked
        // record still partitions above a plausible dry one — cooked-grain sits
        // ABOVE plausibility.
        const cookedDenylisted = cand({
            id: DENYLISTED_ID, name: 'White Rice Cooked', score: 0.7,
            nutrition: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, per100g: true },
        });
        const dry = cand({
            id: 'off_dry_rice', name: 'White Rice', score: 0.9,
            nutrition: { kcal: 360, protein: 7, carbs: 80, fat: 0.6, per100g: true },
        });
        const result = simpleRerank('white rice', [cookedDenylisted, dry], undefined, '1 cup white rice');
        expect(result.winner?.id).toBe(DENYLISTED_ID);
    });

    it('kill-switch RANK_PLAUSIBILITY_PARTITION=0 restores prior ordering', () => {
        process.env.RANK_PLAUSIBILITY_PARTITION = '0';
        const result = simpleRerank('lemon', [lemonCorrupt, lemonPlausible]);
        expect(result.winner?.id).toBe('off_corrupt_lemon');
    });
});

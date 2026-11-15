import { simpleRerank, type RerankCandidate } from '../simple-rerank';
import { nonAlcoholicDrinkReason } from '../macro-plausibility';

/**
 * s459 AL-a — a non-alcoholic record must not win a plain alcoholic-drink query.
 * Panels are the real per-100g rows from the s459 pd-al pools (OffFood / FatSecretFood mirror, read 2026-11-15).
 */
function cand(partial: Partial<RerankCandidate> & { id: string; name: string }): RerankCandidate {
    return { score: 0.5, source: 'openfoodfacts', ...partial };
}
const nonny = cand({ id: 'off_0628942740244', name: 'IPA', brandName: 'Nonny', score: 0.95,
    nutrition: { kcal: 11.83, protein: 0.28, carbs: 2.54, fat: 0, per100g: true } });
const athletic = cand({ id: 'off_0855352008040', name: 'IPA', brandName: 'ATHLETIC BREWING CO', score: 0.95,
    nutrition: { kcal: 18.31, protein: 0.28, carbs: 3.94, fat: 0, per100g: true } });
const gooseIsland = cand({ id: 'fs_500175', name: 'IPA Beer', brandName: 'Goose Island', score: 0.95, source: 'fatsecret',
    nutrition: { kcal: 61, protein: 0, carbs: 6.32, fat: 0, per100g: true } });
const guinnessZero = cand({ id: 'off_6034000106701', name: 'Guinness Zero', brandName: 'Guinness', score: 0.95,
    nutrition: { kcal: 17, protein: 0.3, carbs: 3.8, fat: 0, per100g: true } });
const originalStout = cand({ id: 'fs_89552', name: 'Original Stout', brandName: 'Guinness', score: 0.95, source: 'fatsecret',
    nutrition: { kcal: 38, protein: 0.3, carbs: 3.2, fat: 0, per100g: true } });

describe('nonAlcoholicDrinkReason', () => {
    it('flags a marker-less NA panel for an alcoholic query (Nonny "IPA", alcohol share 0.6 kcal)', () => {
        expect(nonAlcoholicDrinkReason('ipa', 'IPA', 'Nonny', nonny.nutrition, 'a pint of ipa')).toMatch(/^rank:non_alcoholic_for_alcohol_query_panel/);
    });
    it('leaves an alcoholic panel alone (Goose Island IPA, alcohol share 35.7 kcal; FS Light Beer 21.5)', () => {
        expect(nonAlcoholicDrinkReason('ipa', 'IPA Beer', 'Goose Island', gooseIsland.nutrition, 'a pint of ipa')).toBeNull();
        expect(nonAlcoholicDrinkReason('beer', 'Light Beer', '', { kcal: 29, protein: 0.24, carbs: 1.64, fat: 0 }, 'a beer')).toBeNull();
    });
    it('flags a name marker even without a panel', () => {
        expect(nonAlcoholicDrinkReason('beer', 'Non-Alcoholic Beer', 'Strange Fellows', null, 'a beer')).toMatch(/_name$/);
        expect(nonAlcoholicDrinkReason('negroni', 'Negroni (0%)', '', null, 'a negroni')).toMatch(/_name$/);
    });
    it('reads wine varietals and cocktails ALCOHOL_PATTERN lacks (s399 members)', () => {
        expect(nonAlcoholicDrinkReason('pinot grigio', 'Pinot Grigio 0%', 'Cambala', { kcal: 16, protein: 0, carbs: 3.9, fat: 0 }, 'a glass of pinot grigio')).toMatch(/_name$/);
        expect(nonAlcoholicDrinkReason('sauvignon blanc', 'Sauvignon Blanc', 'Fre', { kcal: 25, protein: 0, carbs: 6, fat: 0 }, 'a glass of sauvignon blanc')).not.toBeNull();
        expect(nonAlcoholicDrinkReason('mint julep', 'Mint Julep', 'Kosmic Kombucha', { kcal: 24, protein: 0, carbs: 6, fat: 0 }, 'a mint julep')).not.toBeNull();
        expect(nonAlcoholicDrinkReason('rose wine', 'Rose Wine', '', { kcal: 71, protein: 0.1, carbs: 3.8, fat: 0 }, 'a glass of rose wine')).toBeNull();
        expect(nonAlcoholicDrinkReason('rose water', 'Rose Water', '', { kcal: 0, protein: 0, carbs: 0, fat: 0 }, 'rose water')).toBeNull();
    });
    it('is silent when the user asked for non-alcoholic', () => {
        for (const [q, raw] of [['non alcoholic beer', 'a non alcoholic beer'], ['heineken 0 0', 'a heineken 0.0'], ['virgin margarita', 'a virgin margarita'], ['na beer', 'an na beer'], ['rum and diet coke', 'a rum and diet coke'], ['skinny margarita', 'skinny margarita']]) {
            expect(nonAlcoholicDrinkReason(q, 'Non Alcoholic Beer', '', { kcal: 20, protein: 0.5, carbs: 4.5, fat: 0 }, raw)).toBeNull();
        }
    });
    it('is silent for soft drinks named like beer, and for a query with no alcohol word', () => {
        expect(nonAlcoholicDrinkReason('diet root beer', 'Diet Root Beer', 'A&W', { kcal: 0, protein: 0, carbs: 0, fat: 0 }, 'a diet root beer')).toBeNull();
        expect(nonAlcoholicDrinkReason('ginger ale', 'Diet Ginger Ale', '', { kcal: 0, protein: 0, carbs: 0, fat: 0 }, 'ginger ale')).toBeNull();
        expect(nonAlcoholicDrinkReason('kombucha', 'Kombucha', '', { kcal: 15, protein: 0, carbs: 3.8, fat: 0 }, 'kombucha')).toBeNull();
    });
    it('keeps a marker-less NA record whose brand the user named (athletic brewing ipa)', () => {
        expect(nonAlcoholicDrinkReason('athletic brewing ipa', 'IPA', 'ATHLETIC BREWING CO', athletic.nutrition, 'an athletic brewing ipa')).toBeNull();
    });
    it('does NOT extend the brand exemption to a marked NA variant (guinness stout -> Guinness Zero)', () => {
        expect(nonAlcoholicDrinkReason('guinness stout', 'Guinness Zero', 'Guinness', guinnessZero.nutrition, 'guinness stout')).not.toBeNull();
    });
    it('is silent when the drink word modifies a food (s459 rf-al replay regressions)', () => {
        const low = { kcal: 18, protein: 0.7, carbs: 4.4, fat: 0.1 };
        for (const q of ['light cranberry juice cocktail', 'tomato juice cocktail', 'cocktail tomatoes', 'campari tomatoes', 'bloody mary mix', 'fruit cocktail', 'champagne vinegar', 'red vinegar wine', 'light red wine vinaigrette']) {
            expect(nonAlcoholicDrinkReason(q, 'X', '', low, q)).toBeNull();
        }
    });
    it('reads the soft-drink exemption as tokens, so a token-sorted warmer line is exempt (100g ale ginger)', () => {
        expect(nonAlcoholicDrinkReason('ale ginger', 'Ginger Ale', '', { kcal: 34, protein: 0, carbs: 8.8, fat: 0 }, '100g ale ginger')).toBeNull();
        expect(nonAlcoholicDrinkReason('beer root', 'Root Beer', '', { kcal: 0, protein: 0, carbs: 0, fat: 0 }, '100g beer root')).toBeNull();
    });
    it('does not read a drink word in the BRAND as the user naming the brand (Romeo\'s Gin, Moody Ale)', () => {
        expect(nonAlcoholicDrinkReason('gin sour', 'Amaretto & Tangerine Gin Sour', "Romeo's Gin", { kcal: 22.5, protein: 0, carbs: 5.9, fat: 0 }, 'a gin sour')).not.toBeNull();
        expect(nonAlcoholicDrinkReason('ale', 'Salted Lime Lager', 'Moody Ale', { kcal: 21.1, protein: 0, carbs: 4.8, fat: 0 }, 'an ale')).not.toBeNull();
        expect(nonAlcoholicDrinkReason('margarita cocktail', 'Desert Margarita', 'Parch Agave Cocktail', { kcal: 20, protein: 0, carbs: 5.2, fat: 0 }, 'a margarita cocktail')).not.toBeNull();
    });
    it('reads rosé (accented) as a wine head and leaves rose water alone', () => {
        expect(nonAlcoholicDrinkReason('rosé', 'Rosé', 'Fre', { kcal: 20, protein: 0, carbs: 5, fat: 0 }, 'a glass of rosé')).not.toBeNull();
        expect(nonAlcoholicDrinkReason('rose', 'Rose Water', '', { kcal: 0, protein: 0, carbs: 0, fat: 0 }, 'rose water')).toBeNull();
    });
    it('ignores a spirit with a junk carb panel (Casamigos 226 kcal, carbs 56.4) — above the NA kcal ceiling', () => {
        expect(nonAlcoholicDrinkReason('tequila', 'Blanco Tequila', 'Casamigos', { kcal: 226, protein: 0, carbs: 56.4, fat: 0 }, 'a shot of tequila')).toBeNull();
    });
});

describe('simpleRerank with the NA partition', () => {
    // Confidence is NOT asserted: this synthetic pool's top reads 0.697 vs MIN_RERANK_CONFIDENCE 0.70 (the live
    // s459 pool read 0.417 -> 0.7085). Whether the demoted pool clears the floor is the replay's question, not this test's.
    it('a pint of ipa: two NA exact-name "IPA" records sort below an alcoholic IPA', () => {
        const r = simpleRerank('ipa', [nonny, athletic, gooseIsland], undefined, 'a pint of ipa');
        expect(r.sortedCandidates[0].id).toBe('fs_500175');
        expect(r.rerankPool.filter((p) => p.plausibilityFloorHit).map((p) => p.foodId).sort()).toEqual(['off_0628942740244', 'off_0855352008040']);
    });
    it('guinness stout: Guinness Zero sorts below Original Stout', () => {
        const r = simpleRerank('guinness stout', [guinnessZero, originalStout], undefined, 'guinness stout');
        expect(r.winner?.id).toBe('fs_89552');
    });
    it('control: a non alcoholic beer keeps its NA winner', () => {
        const na = cand({ id: 'off_na', name: 'Non Alcoholic Beer', score: 0.95, nutrition: { kcal: 31, protein: 0.56, carbs: 6.76, fat: 0, per100g: true } });
        const r = simpleRerank('non alcoholic beer', [na, gooseIsland], undefined, 'a non alcoholic beer');
        expect(r.winner?.id).toBe('off_na');
    });
    it('all-NA pool is a no-op (floor-hits are sorted, never dropped)', () => {
        const r = simpleRerank('ipa', [nonny, athletic], undefined, 'an ipa');
        expect(r.winner).not.toBeNull();
    });
});


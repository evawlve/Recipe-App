/**
 * hasCriticalModifierMismatch() — the calorie / sugar-free branch and the all-drop restore.
 *
 * This predicate had ZERO test references before 2026-09-02, which is how it carried a
 * private eight-spelling vocabulary that disagreed with the retrieval side for weeks:
 * `sugar free coke` deleted fs_43580 "Coke Zero" (the name carries only a trailing `Zero`),
 * emptied the strict pool, and the relaxed retry — which skips this check — returned
 * fs_644459 "Caffeine Free Coke" at 100 kcal. The reverse spelling `zero sugar coke` fired no
 * constraint at all. Measured live 2026-09-01 (pm19 ROW 1, owner: KindaHealthyMobile
 * sync-docs/reports/2026-09-01_pm19-pm20-ultracode-lane-briefs.md).
 *
 * Every candidate name below is a REAL corpus name, never an invented fixture (an invented
 * tier string is how the servingTier classification gap survived). Provenance per name:
 *   fs_43580 "Coke Zero" [Coca-Cola], fs_644459 "Caffeine Free Coke"  — keyed nosave probe, 2026-09-01
 *   fs_90946 "Diet Coke" [Coca-Cola], off_9300675012089 "Coke Zero"    — warm run 22/23 eval.json
 *   off_0067000011382 "Coca cola"; "Coca-Cola" [Coca-Cola]              — warm run 23 / FoodMapping snapshot
 *   fs_63076 "Mexican Coke" [Coca-Cola]                                    — a26i census 2026-08-28 (FS catalogue)
 *   "ZERO SUGAR" [Coca-Cola] (the cached `coke zero` row, usedCount 81) — FoodMapping snapshot 2026-08-28
 *   fs_700695 "Sprite Zero" [Sprite]; "Zero Sugar Baja Blast" [Mountain Dew]; "Gatorade Zero"
 *   "Unsweetened Almond Milk" [Woolworths] (cached `almond milk unsweetened`, usedCount 375);
 *   "Almond milk unsweetened" [Silk]; off_0005200120060 "Almond Milk" [Simply Almond];
 *   off_0041000000089 "Almond milk" [Almond breeze]
 *   fs 18383339 "Ketchup No Sugar Added" [Heinz]; fs_6037912 "100% Juice Cranberry No Sugar Added";
 *   "Applesauce Cups" [Lunch Buddies]; "Fruit Pouch" [Gogo Squeez]
 *   off_0063598580305 "Zero Proof Mango Passion Fruit" [White Claw]; "White Claw Zero Lime Yuzu";
 *   "Monster Energy Zero Ultra" [Monster Energy]; "Lactose free milk"; "Zero Calorie Sweetener"
 *   off_9000111321859 "Light mayonnaise"; off_69759355 "Hellmann's Light Mayonnaise";
 *   off_9348905001434 "Mayonnaise"
 *   "Whole milk" [Maple View Milk Company]; "2% Milk"; "Skim milk";
 *   fs_2322419 "Nonfat Plain Greek Yogurt" [Chobani]; "Whole Milk Greek Yogurt" [Aldi]
 * All read from sync-docs artifacts in the mobile repo (warm-plan runs, cache-snapshots,
 * a26i census) on 2026-09-02 — the box was unreachable that day, so none is a fresh SELECT.
 *
 * The four fixtures added 2026-09-03 for the on-topic-pool fix ARE fresh SELECTs, taken from the
 * box the same day (`docker exec mealspire-db psql -U postgres -d mealspire`):
 *   fs_48634 "Diet Pepsi" [Pepsi]
 *   fs_299830 "Cranberry Juice" (no brand)
 *   off_0031200019042 "Diet Cranberry Cocktail" [Ocean Spray]
 *   fs_700695 "Sprite Zero" [Sprite] — re-confirmed
 */

import { hasCriticalModifierMismatch, filterCandidatesByTokens } from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';
import { logger } from '../../logger';

type Source = UnifiedCandidate['source'];

let _id = 0;
function cand(name: string, brandName: string | null, source: Source = 'fatsecret', id?: string): UnifiedCandidate {
    return {
        id: id ?? `c${_id++}`,
        source,
        name,
        brandName,
        score: 1,
        rawData: null,
    } as unknown as UnifiedCandidate;
}

const cokeZero = cand('Coke Zero', 'Coca-Cola', 'fatsecret', 'fs_43580');
const caffeineFreeCoke = cand('Caffeine Free Coke', null, 'fatsecret', 'fs_644459');
const dietCoke = cand('Diet Coke', 'Coca-Cola', 'fatsecret', 'fs_90946');
const cocaCola = cand('Coca cola', null, 'openfoodfacts', 'off_0067000011382');
const mexicanCoke = cand('Mexican Coke', 'Coca-Cola', 'fatsecret', 'fs_63076');
// fs_700695 'Sprite Zero' [Sprite] and fs_48634 'Diet Pepsi' [Pepsi] — both pass the modifier
// check (trailing zero / `diet`) and both fail the must-have token `coke`. They are the OFF-TOPIC
// satisfier-carrying candidates `buildQueryVariants()` reliably pulls into a sugar-free gather,
// and the pair the restore's quantifier must not read.
const spriteZero = cand('Sprite Zero', 'Sprite', 'fatsecret', 'fs_700695');
const dietPepsi = cand('Diet Pepsi', 'Pepsi', 'fatsecret', 'fs_48634');

// The strong-vs-weak discriminator, in a family where the corpus actually has one: a candidate
// that passes the modifier check AND the must-have token, and is deleted by a LATER check (the
// disqualifier word `cocktail`). See the test that uses them.
const cranberryJuice = cand('Cranberry Juice', null, 'fatsecret', 'fs_299830');
const dietCranberryCocktail = cand('Diet Cranberry Cocktail', 'Ocean Spray', 'openfoodfacts', 'off_0031200019042');

describe('hasCriticalModifierMismatch — the sugar-free / low-calorie branch', () => {
    it('sugar free coke: "Coke Zero" is admitted (trailing zero), "Caffeine Free Coke" rejected, "Diet Coke" admitted', () => {
        expect(hasCriticalModifierMismatch('sugar free coke', 'Coke Zero', 'fatsecret')).toBe(false);
        expect(hasCriticalModifierMismatch('sugar free coke', 'Caffeine Free Coke', 'fatsecret')).toBe(true);
        expect(hasCriticalModifierMismatch('sugar free coke', 'Diet Coke', 'fatsecret')).toBe(false);
        expect(hasCriticalModifierMismatch('sugar free coke', 'ZERO SUGAR', 'openfoodfacts')).toBe(false);
        expect(hasCriticalModifierMismatch('sugar free coke', 'Coca cola', 'openfoodfacts')).toBe(true);
    });

    it('zero sugar coke now FIRES: a plain "Coca-Cola" is rejected, "Coke Zero" admitted', () => {
        expect(hasCriticalModifierMismatch('zero sugar coke', 'Coca-Cola', 'openfoodfacts')).toBe(true);
        expect(hasCriticalModifierMismatch('zero sugar coke', 'Coke Zero', 'fatsecret')).toBe(false);
        expect(hasCriticalModifierMismatch('zero sugar coke', 'ZERO SUGAR', 'openfoodfacts')).toBe(false);
        // Same class, same answer for the cache-read consumers, which pass source 'cache'.
        expect(hasCriticalModifierMismatch('zero sugar coke', 'ZERO SUGAR', 'cache')).toBe(false);
    });

    it('zero sugar sprite / trailing-zero and zero+word shapes', () => {
        expect(hasCriticalModifierMismatch('zero sugar sprite', 'Sprite Zero', 'fatsecret')).toBe(false);
        expect(hasCriticalModifierMismatch('sugar free mountain dew', 'Zero Sugar Baja Blast', 'fatsecret')).toBe(false);
        expect(hasCriticalModifierMismatch('zero sugar gatorade', 'Gatorade Zero', 'openfoodfacts')).toBe(false);
        expect(hasCriticalModifierMismatch('zero calorie sweetener', 'Zero Calorie Sweetener', 'openfoodfacts')).toBe(false);
    });

    it('no sugar added: fires, and "no sugar added" / "No Sugar Added" names satisfy it', () => {
        expect(hasCriticalModifierMismatch('no sugar added applesauce', 'Applesauce Cups', 'openfoodfacts')).toBe(true);
        expect(hasCriticalModifierMismatch('no sugar added ketchup', 'Ketchup No Sugar Added', 'fatsecret')).toBe(false);
        expect(hasCriticalModifierMismatch('no sugar added cranberry juice', '100% Juice Cranberry No Sugar Added', 'fatsecret')).toBe(false);
    });

    it('unsweetened almond milk: an "Unsweetened …" name is admitted, a plain "Almond Milk" rejected', () => {
        expect(hasCriticalModifierMismatch('unsweetened almond milk', 'Unsweetened Almond Milk', 'openfoodfacts')).toBe(false);
        expect(hasCriticalModifierMismatch('unsweetened almond milk', 'Almond milk unsweetened', 'openfoodfacts')).toBe(false);
        expect(hasCriticalModifierMismatch('unsweetened almond milk', 'Almond Milk', 'openfoodfacts')).toBe(true);
        expect(hasCriticalModifierMismatch('unsweetened almond milk', 'Almond milk', 'openfoodfacts')).toBe(true);
    });

    it('non-sugar zero claims stay REJECTED for a sugar-free query', () => {
        expect(hasCriticalModifierMismatch('sugar free seltzer', 'Zero Proof Mango Passion Fruit', 'openfoodfacts')).toBe(true);
        expect(hasCriticalModifierMismatch('sugar free seltzer', 'White Claw Zero Lime Yuzu', 'openfoodfacts')).toBe(true);
        expect(hasCriticalModifierMismatch('sugar free milk', 'Lactose free milk', 'openfoodfacts')).toBe(true);
        // A mid-name bare zero is NOT rescued either — the rule is trailing zero or zero+sugar-word
        // only, so "Zero Ultra" reads as a flavour, not a claim. Known limit, stated not hidden.
        expect(hasCriticalModifierMismatch('sugar free monster', 'Monster Energy Zero Ultra', 'openfoodfacts')).toBe(true);
    });

    it('light mayo does NOT fire the low-cal trigger (it is the LENIENT_LOW_FAT branch, unchanged)', () => {
        // Same answers as before the vocabulary change: the lenient branch admits a light-named
        // candidate and only rejects an unmodified name on fatsecret/cache/fdc sources.
        expect(hasCriticalModifierMismatch('light mayo', 'Light mayonnaise', 'openfoodfacts')).toBe(false);
        expect(hasCriticalModifierMismatch('light mayo', "Hellmann's Light Mayonnaise", 'openfoodfacts')).toBe(false);
        expect(hasCriticalModifierMismatch('light mayo', 'Mayonnaise', 'openfoodfacts')).toBe(false);
        expect(hasCriticalModifierMismatch('light mayo', 'Mayonnaise', 'fatsecret')).toBe(true);
    });

    it('a bare `no sugar` query fires at the predicate (not only via `no sugar added`)', () => {
        expect(hasCriticalModifierMismatch('no sugar coke', 'Coca-Cola', 'openfoodfacts')).toBe(true);
        expect(hasCriticalModifierMismatch('no sugar coke', 'Coke Zero', 'fatsecret')).toBe(false);
    });

    it('a "Light mayonnaise" candidate satisfies a "low calorie mayonnaise" query — the worked example in filter-candidates.ts', () => {
        // Dropping light/lite from the candidate satisfiers newly hard-drops 11,242 corpus records
        // (10,898 OFF + 344 FS, measured 2026-09-01, pm19 ROW 1); this is the behavioural pin.
        expect(hasCriticalModifierMismatch('low calorie mayonnaise', 'Light mayonnaise', 'openfoodfacts')).toBe(false);
        expect(hasCriticalModifierMismatch('low calorie mayonnaise', 'Mayonnaise', 'openfoodfacts')).toBe(true);
    });

    it('fat-percentage and nonfat branches are unchanged', () => {
        expect(hasCriticalModifierMismatch('2% milk', 'Whole milk', 'openfoodfacts')).toBe(true);
        expect(hasCriticalModifierMismatch('2% milk', '2% Milk', 'openfoodfacts')).toBe(false);
        expect(hasCriticalModifierMismatch('nonfat greek yogurt', 'Whole Milk Greek Yogurt', 'openfoodfacts', { fat: 5, per100g: true })).toBe(true);
        expect(hasCriticalModifierMismatch('nonfat greek yogurt', 'Whole Milk Greek Yogurt', 'openfoodfacts', { fat: 0.4, per100g: true })).toBe(false);
        expect(hasCriticalModifierMismatch('nonfat greek yogurt', 'Nonfat Plain Greek Yogurt', 'fatsecret')).toBe(false);
        expect(hasCriticalModifierMismatch('nonfat milk', 'Skim milk', 'openfoodfacts')).toBe(false);
    });
});

describe('filterCandidatesByTokens — the all-drop restore is pool-relative', () => {
    let warnSpy: jest.SpyInstance;
    beforeEach(() => { warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined); });
    afterEach(() => { warnSpy.mockRestore(); });

    const ids = (r: { filtered: UnifiedCandidate[] }) => r.filtered.map(c => c.id).sort();

    it('when the modifier check ALONE would reject every candidate, the pool is returned unfiltered by it', () => {
        const pool = [caffeineFreeCoke, mexicanCoke];
        const r = filterCandidatesByTokens(pool, 'sugar free coke', { rawLine: 'sugar free coke' });
        expect(ids(r)).toEqual(['fs_63076', 'fs_644459']);
        expect(warnSpy).toHaveBeenCalledWith('filter.candidates.modifier_check_rejects_all',
            expect.objectContaining({ rawLine: 'sugar free coke', poolSize: 2 }));
    });

    it('when at least one candidate passes, the others are dropped (no restore)', () => {
        const pool = [cokeZero, caffeineFreeCoke, dietCoke, mexicanCoke];
        const r = filterCandidatesByTokens(pool, 'sugar free coke', { rawLine: 'sugar free coke' });
        expect(ids(r)).toEqual(['fs_43580', 'fs_90946']);
        expect(warnSpy).not.toHaveBeenCalledWith('filter.candidates.modifier_check_rejects_all', expect.anything());
    });

    it('zero sugar coke now fires inside the pool: the plain record is dropped, Coke Zero and Diet Coke kept', () => {
        const pool = [mexicanCoke, cokeZero, dietCoke];
        const r = filterCandidatesByTokens(pool, 'zero sugar coke', { rawLine: 'zero sugar coke' });
        expect(ids(r)).toEqual(['fs_43580', 'fs_90946']);
    });

    it('the relaxed pass keeps skipping the modifier check exactly as before', () => {
        const pool = [cokeZero, caffeineFreeCoke, dietCoke, mexicanCoke];
        const r = filterCandidatesByTokens(pool, 'sugar free coke', { rawLine: 'sugar free coke', relaxed: true });
        expect(ids(r)).toEqual(['fs_43580', 'fs_63076', 'fs_644459', 'fs_90946']);
        expect(warnSpy).not.toHaveBeenCalledWith('filter.candidates.modifier_check_rejects_all', expect.anything());
    });

    it('the restore lifts ONLY the modifier check — the must-have token check still applies', () => {
        // Both fail the modifier check, so it is lifted; "Coca cola" then still fails the
        // must-have token `coke` and is dropped by THAT check, not restored with the pool.
        const r = filterCandidatesByTokens([caffeineFreeCoke, cocaCola], 'sugar free coke', { rawLine: 'sugar free coke' });
        expect(ids(r)).toEqual(['fs_644459']);
        expect(warnSpy).toHaveBeenCalledWith('filter.candidates.modifier_check_rejects_all', expect.objectContaining({ poolSize: 2 }));
    });

    it('ONE off-topic candidate carrying a satisfier does NOT suppress the restore — the quantifier is scoped to the on-topic pool', () => {
        // THE PIN FOR THE 2026-09-03 FIX. Diet Pepsi satisfies the modifier check and fails the
        // must-have `coke`; before the fix its mere presence made `candidates.every(...)` false,
        // the restore stayed off, both cokes were hard-deleted by the modifier check, Diet Pepsi
        // was dropped by the must-have check, and the strict pool came back EMPTY — the outcome
        // the restore exists to prevent, on a pool shape buildQueryVariants() produces routinely
        // (it searches the diet/lite/light/zero-sugar variants of every sugar-free line).
        const r = filterCandidatesByTokens([caffeineFreeCoke, mexicanCoke, dietPepsi], 'sugar free coke', { rawLine: 'sugar free coke' });
        expect(ids(r)).toEqual(['fs_63076', 'fs_644459']);   // both cokes; Diet Pepsi still excluded
        expect(warnSpy).toHaveBeenCalledWith('filter.candidates.modifier_check_rejects_all',
            expect.objectContaining({ poolSize: 3, onTopicPoolSize: 2 }));
    });

    it('the same shape with a single on-topic candidate: Sprite Zero does not suppress the restore either', () => {
        // The Sprite Zero pool is the Diet Pepsi pool with one coke removed — structurally the
        // same defect, so it now restores too. THIS EXPECTATION CHANGED on 2026-09-03: it used to
        // assert EMPTY, and was cited as what separates the strong restore from the weak (#395)
        // one. It cannot carry that job, because "a pool emptied jointly by the modifier check and
        // the must-have check" IS the defect the fix repairs, not a property worth preserving. The
        // strong-vs-weak discriminator is the cranberry test below, which uses a pool emptied by a
        // check the restore must NOT lift.
        const r = filterCandidatesByTokens([caffeineFreeCoke, spriteZero], 'sugar free coke', { rawLine: 'sugar free coke' });
        expect(ids(r)).toEqual(['fs_644459']);
        expect(warnSpy).toHaveBeenCalledWith('filter.candidates.modifier_check_rejects_all',
            expect.objectContaining({ poolSize: 2, onTopicPoolSize: 1 }));
    });

    it('a pool emptied by a check OTHER than the modifier check is NOT restored — the STRONG property', () => {
        // fs_299830 "Cranberry Juice" fails ONLY the modifier check. off_0031200019042 "Diet
        // Cranberry Cocktail" [Ocean Spray] PASSES the modifier check and PASSES the must-have
        // token `cranberry` — it is on-topic — and is then deleted by the disqualifier-word check
        // on `cocktail`. So the modifier check does not empty the on-topic pool, nothing is
        // restored, and the pool is empty. The WEAK property (#395: "restore whenever the strict
        // pool came back empty, for any reason") would re-admit Cranberry Juice here, re-admitting
        // what a DIFFERENT check removed. Verified against the shipped function, ts-node,
        // 2026-09-03; both rows read from the box the same day.
        const r = filterCandidatesByTokens([cranberryJuice, dietCranberryCocktail], 'sugar free cranberry', { rawLine: 'sugar free cranberry' });
        expect(ids(r)).toEqual([]);
        expect(warnSpy).not.toHaveBeenCalledWith('filter.candidates.modifier_check_rejects_all', expect.anything());
    });

    it('a pool with NO on-topic candidate at all is not restored and logs nothing (`[].every()` is true)', () => {
        // Neither candidate carries the must-have `coke`, so the on-topic pool is empty and the
        // quantifier must not read `true` off it. Guarded by `strictlyAdmissible.length > 0`.
        const r = filterCandidatesByTokens([spriteZero, dietPepsi], 'sugar free coke', { rawLine: 'sugar free coke' });
        expect(ids(r)).toEqual([]);
        expect(warnSpy).not.toHaveBeenCalledWith('filter.candidates.modifier_check_rejects_all', expect.anything());
    });

    it('the relaxed pass never computes or logs the restore, even on an all-rejecting pool', () => {
        const r = filterCandidatesByTokens([caffeineFreeCoke, mexicanCoke], 'sugar free coke', { rawLine: 'sugar free coke', relaxed: true });
        expect(ids(r)).toEqual(['fs_63076', 'fs_644459']);
        expect(warnSpy).not.toHaveBeenCalledWith('filter.candidates.modifier_check_rejects_all', expect.anything());
    });

    it('unsweetened almond milk: the plain record is dropped when an unsweetened one is in the pool', () => {
        const unsweetened = cand('Unsweetened Almond Milk', 'Woolworths', 'openfoodfacts');
        const plain = cand('Almond Milk', 'Simply Almond', 'openfoodfacts', 'off_0005200120060');
        const r = filterCandidatesByTokens([plain, unsweetened], 'unsweetened almond milk', { rawLine: 'unsweetened almond milk' });
        expect(ids(r)).toEqual([unsweetened.id]);
    });
});

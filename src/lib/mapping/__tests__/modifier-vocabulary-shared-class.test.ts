/**
 * The modifier vocabulary is ONE class, read by both retrieval and admission.
 *
 * `modifier-vocabulary.ts` carries a COPY of gather-candidates' MODIFIER_SYNONYM_GROUPS
 * (the leaf must import nothing — see its header for the require cycle), and this file
 * is what stops the copy drifting: the retrieval side (`buildQueryVariants()`) and the
 * admission side (`hasCriticalModifierMismatch()`) used to carry different lists, so the
 * gather searched for `zero sugar` and the filter deleted it on arrival. Owner:
 * KindaHealthyMobile sync-docs/reports/2026-09-01_pm19-pm20-ultracode-lane-briefs.md
 * (pm19 ROW 1).
 */

import { MODIFIER_SYNONYM_GROUPS as RETRIEVAL_GROUPS } from '../gather-candidates';
import {
    MODIFIER_SYNONYM_GROUPS as LEAF_GROUPS,
    SUGAR_FREE_SYNONYM_GROUP,
    LOW_CAL_QUERY_TRIGGERS,
    LOW_CAL_CANDIDATE_SATISFIERS,
    BARE_ZERO_CLAIM_RE,
    queryCarriesLowCalClaim,
    candidateCarriesLowCalClaim,
} from '../modifier-vocabulary';

describe('modifier-vocabulary is the same class gather-candidates reads', () => {
    it('the leaf copy is deep-equal to gather-candidates MODIFIER_SYNONYM_GROUPS', () => {
        expect(LEAF_GROUPS).toEqual(RETRIEVAL_GROUPS);
    });

    it('the sugar-free class is the group buildQueryVariants() expands "sugar free" into', () => {
        expect(SUGAR_FREE_SYNONYM_GROUP).toBe(LEAF_GROUPS.find(g => g.includes('sugar free')));
        for (const spelling of ['zero sugar', 'no sugar', 'unsweetened', 'sugar free', 'sugar-free', 'diet', 'low calorie']) {
            expect(SUGAR_FREE_SYNONYM_GROUP).toContain(spelling);
        }
    });

    // ADMIT-ONLY (Diego, 2026-09-03). The query side is master's exact eight and
    // does not move. An earlier revision derived it from the retrieval group (12
    // entries, adding `unsweetened`, `no sugar`, `no sugar added`, `zero sugar`),
    // which is a HARD-GATE widening -- the bottom of the preference order -- and
    // its arms turned `pure leaf unsweetened black tea` into an HTTP 500. This pin
    // is literal on purpose: it is the thing that must not drift back.
    it('the query trigger set is exactly master\'s eight CALORIE_MODIFIERS', () => {
        expect([...LOW_CAL_QUERY_TRIGGERS].sort()).toEqual([
            'calorie free', 'calorie-free', 'diet', 'low calorie',
            'low-calorie', 'sugar free', 'sugar-free', 'zero calorie',
        ]);
    });

    // The disagreement this branch was opened to fix is REAL and is NOT fixed on
    // the query side. buildQueryVariants() still searches for these; the admission
    // check still does not read them as claims on the query side. Only the
    // CANDIDATE direction is widened (the next test). Closing the query side needs
    // the step-3b design that also fixes hasCoreTokenMismatch (punch #65).
    it('the four retrieval spellings the query side still does NOT read stay out', () => {
        for (const spelling of ['unsweetened', 'no sugar', 'no sugar added', 'zero sugar']) {
            expect(SUGAR_FREE_SYNONYM_GROUP).toContain(spelling);
            expect(LOW_CAL_QUERY_TRIGGERS).not.toContain(spelling);
            // ...but each one DOES satisfy the candidate side. That asymmetry is
            // the whole of the admit-only half.
            expect(candidateCarriesLowCalClaim(spelling)).toBe(true);
        }
    });

    it('every retrieval spelling of the class satisfies the candidate side (light/lite kept)', () => {
        for (const spelling of SUGAR_FREE_SYNONYM_GROUP) {
            expect(LOW_CAL_CANDIDATE_SATISFIERS).toContain(spelling);
            expect(candidateCarriesLowCalClaim(spelling)).toBe(true);
        }
        expect(LOW_CAL_CANDIDATE_SATISFIERS).toEqual(expect.arrayContaining(['light', 'lite', 'no added sugar', 'fat free', 'fat-free']));
    });

    it('light/lite never trigger the low-cal admission check (they are the LENIENT_LOW_FAT branch)', () => {
        expect(queryCarriesLowCalClaim('light mayo')).toBe(false);
        expect(queryCarriesLowCalClaim('light corn syrup')).toBe(false); // golden sentinel n-syn-04
        expect(queryCarriesLowCalClaim('lite yogurt')).toBe(false);
    });

    it('the bare-zero regex accepts a trailing zero and zero+sugar-word, and nothing else', () => {
        // Real corpus names (FatSecretFood / OffFood / cached FoodMapping.foodName).
        for (const name of ['coke zero', 'sprite zero', 'gatorade zero', 'coke zero (can)', 'zero sugar', 'zero sugar baja blast', 'isopure zero carb', 'zero calorie sweetener', 'zero-sugar original beef jerky']) {
            expect(BARE_ZERO_CLAIM_RE.test(name)).toBe(true);
        }
        for (const name of ['zero proof mango passion fruit', 'white claw zero lime yuzu', 'monster energy zero ultra', 'lactose free milk', 'zero fat greek yogurt']) {
            expect(BARE_ZERO_CLAIM_RE.test(name)).toBe(false);
        }
    });
});

import { candidateMatchesTargetBrand, simpleRerank, type RerankCandidate } from '../simple-rerank';

/**
 * Possessive brands defeat the whole-token brand matcher (found by warm batch 01,
 * Jul 2026).
 *
 * `candidateMatchesTargetBrand` tokenizes on `[\s,()[\]{}]+`, which does not
 * include the apostrophe, so a record branded "Member's Mark" yields the token
 * `member's` while the lexicon's detected form yields `members`. They never
 * matched. Because the function is consulted by the rerank decisive-brand boost,
 * same-brand variant precision, sub-threshold admission and the save gate, a
 * possessive-first brand lost its *ranking* boost as well as its save — the
 * larger of the two effects.
 *
 * Measured exposure at the time of the fix: 27 multi-word lexicon brands against
 * 6,122 corpus records — Nature's Promise (2587), Member's Mark (1202),
 * President's Choice (1104), Boar's Head (397).
 *
 * Same root cause as the PR #149 cache-key fix, on a different path: #149 was
 * apostrophes in the key, this is apostrophes in the brand comparison.
 */

function cand(partial: Partial<RerankCandidate> & { id: string; name: string }): RerankCandidate {
    return { score: 0.5, source: 'openfoodfacts', ...partial };
}

describe('candidateMatchesTargetBrand — apostrophe folding', () => {
    it('matches an apostrophe-free lexicon brand against a possessive record brand', () => {
        // The batch-01 defect verbatim: `members mark trail mix` was rejected
        // against a record whose brand is literally "Member's Mark".
        expect(candidateMatchesTargetBrand('Member\'s Mark', 'Trail Mix', 'members mark')).toBe(true);
        expect(candidateMatchesTargetBrand('Boar\'s Head', 'Ovengold Turkey Breast', 'boars head')).toBe(true);
        expect(candidateMatchesTargetBrand('Nature\'s Promise', 'Organic Baby Spinach', 'natures promise')).toBe(true);
    });

    it('matches in the reverse direction: possessive lexicon form, bare record brand', () => {
        expect(candidateMatchesTargetBrand('Members Mark', 'Trail Mix', 'member\'s mark')).toBe(true);
        expect(candidateMatchesTargetBrand('Boars Head', 'Ovengold Turkey Breast', 'boar\'s head')).toBe(true);
    });

    it('folds the typographic apostrophe too — OFF carries both forms', () => {
        expect(candidateMatchesTargetBrand('Member’s Mark', 'Trail Mix', 'members mark')).toBe(true);
        expect(candidateMatchesTargetBrand('Members Mark', 'Trail Mix', 'member’s mark')).toBe(true);
    });

    it('still finds the brand when it is embedded in the name and the brand field is empty', () => {
        // The reason the matcher reads name + brand in the first place.
        expect(candidateMatchesTargetBrand(undefined, 'Boar\'s Head Ovengold Turkey', 'boars head')).toBe(true);
    });

    it('does not admit an unrelated brand — folding must not become substring matching', () => {
        expect(candidateMatchesTargetBrand('Udi\'s', 'Granola Bars', 'great value')).toBe(false);
        expect(candidateMatchesTargetBrand('Bear Naked', 'Pumpkin Spice Granola', 'trader joes')).toBe(false);
        // "one" must not match "Toblerone" — the substring hazard the whole-token
        // rule exists to prevent, unchanged by folding.
        expect(candidateMatchesTargetBrand('Toblerone', 'Milk Chocolate', 'one')).toBe(false);
    });

    it('rejects a degenerate all-apostrophe target instead of matching everything', () => {
        expect(candidateMatchesTargetBrand('Member\'s Mark', 'Trail Mix', '\'')).toBe(false);
    });
});

describe('possessive brand — end-to-end rerank', () => {
    it('gives the possessive-brand record the decisive boost over a cross-brand competitor', () => {
        const hijacker = cand({
            id: 'off_other', name: 'Trail Mix', brandName: 'Second Nature', score: 0.9,
        });
        const membersMark = cand({
            id: 'off_mm', name: 'Sweet & Salty Trail Mix', brandName: 'Member\'s Mark', score: 0.6,
        });
        const result = simpleRerank(
            'members mark trail mix', [hijacker, membersMark], undefined,
            'members mark trail mix', true, 'members mark',
        );
        expect(result.winner?.id).toBe('off_mm');
    });
});

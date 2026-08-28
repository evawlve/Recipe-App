import { filterCandidatesByTokens, deriveMustHaveTokens } from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';

/**
 * A22 — the head is EMPIRICAL when the pool cannot satisfy the positional one.
 *
 * K2 spends the second must-have slot on the LAST non-brand core token, which is
 * positional in 93.4% of the lines it governs. When the pool carries no record spelling
 * that word ALONGSIDE the brand, `every()` deletes the whole pool before
 * buildRerankPool() is reached, and the caller falls to the relax pass — which on a
 * brand-detected line relaxes to the BRAND ALONE. `dominos garlic knots` emptied its
 * 25-candidate pool on `knots` (Domino's calls them Garlic Bread Twists) and
 * `martin's potato hot dog buns` emptied 29 on `buns` (the record is a Potato Hot Dog
 * Roll); both then admitted anything of that brand.
 *
 * A22 steps the head back to the last EARLIER non-brand core token some candidate
 * carries together with the brand slot. Three properties are pinned below, and the
 * fourth — that the test is the CONJUNCTION, not the token — is the correction
 * measurement forced on A21's design: the per-token form fired ZERO times on 258
 * measured lines, because a candidate spelling the head need not be the candidate
 * carrying the brand.
 *
 * Owner: KindaHealthyMobile sync-docs/reports/2026-08-27_a22-the-empirical-head-and-the-faces-that-were-never-admission.md
 */

function cand(name: string, brandName?: string, id = name): UnifiedCandidate {
    return { id, source: 'openfoodfacts', name, brandName, score: 0.5, rawData: {} };
}
const names = (r: { filtered: UnifiedCandidate[] }) => r.filtered.map(c => c.name).sort();

describe('the head moves only when the pool cannot satisfy it', () => {
    it('MOVES to the earlier token when brand+head is unsatisfiable', () => {
        const pool = [
            cand('Garlic Bread Twists - 2 Pieces', "Domino's Pizza"),
            cand('Garlic Dipping Cup', "Domino's Pizza"),
            cand('Pepperoni Pizza', "Domino's Pizza"),
        ];
        // Positional: ['dominos','knots'] — nothing here spells `knots`, so the pool empties.
        expect(deriveMustHaveTokens('dominos garlic knots')).toEqual(['dominos', 'knots']);
        // Empirical: `garlic` is carried by two records that also carry the brand.
        expect(deriveMustHaveTokens('dominos garlic knots', pool)).toEqual(['dominos', 'garlic']);
        expect(names(filterCandidatesByTokens(pool, 'dominos garlic knots')))
            .toEqual(['Garlic Bread Twists - 2 Pieces', 'Garlic Dipping Cup']);
    });

    it('is a NO-OP when the positional head is satisfiable — the common case', () => {
        // `gatorade cool blue`: the head is a flavour word and it is RIGHT, because the
        // pool spells it. Evidence, not a lexicon, is what separates this from `knots`.
        const pool = [cand('Gatorade Zero Cool Blue', 'Gatorade'), cand('Fierce Blue Cherry', 'Gatorade')];
        expect(deriveMustHaveTokens('gatorade cool blue', pool)).toEqual(['gatorade', 'blue']);
    });

    it('NEVER DROPS the requirement: unsatisfiable everywhere means unchanged', () => {
        // No earlier token is carried with the brand either, so the head stays positional
        // and the pool still empties — the relax pass, not this rule, decides what happens
        // next. This is the guard that keeps the rule from widening admission.
        const pool = [cand('Five Guys, Bun', 'Five Guys'), cand('Five Guys, Pickles', 'Five Guys')];
        expect(deriveMustHaveTokens('five guys milkshake', pool)).toEqual(['five', 'milkshake']);
        expect(filterCandidatesByTokens(pool, 'five guys milkshake').filtered).toHaveLength(0);
    });

    it('reads the CONJUNCTION, not the token: a head spelled by a brandless record is not evidence', () => {
        // The per-token form of this rule ("some candidate spells the head") reads this pool
        // as satisfying `knots` and does nothing. filterCandidatesByTokens requires every()
        // token of the SAME candidate, so only a record carrying BOTH counts.
        const pool = [
            cand('Garlic Bread Twists', "Domino's Pizza"),
            cand('Pretzel Knots', 'Some Bakery'),
        ];
        expect(deriveMustHaveTokens('dominos garlic knots', pool)).toEqual(['dominos', 'garlic']);
    });

    it('keeps K2 tolerance in scope: a head the menu spells differently does not move', () => {
        // `Chicken Fingerz` satisfies `fingers` only through the tolerant head rung. Testing
        // the head strictly here would step it back to `chicken` and re-open the pre-K2
        // defect the tolerance exists to close, so the chooser reads the same predicate the
        // filter loop enforces.
        const pool = [cand('Chicken Fingerz - 4 Pieces', "Zaxby's")];
        expect(deriveMustHaveTokens('zaxbys chicken fingers', pool)).toEqual(['zaxbys', 'fingers']);
        expect(filterCandidatesByTokens(pool, 'zaxbys chicken fingers').filtered).toHaveLength(1);
    });

    it('is unchanged with no pool — the arity-1 contract is the positional rule', () => {
        // Every existing caller and pin that asks deriveMustHaveTokens() a question about a
        // STRING alone still gets the positional answer.
        expect(deriveMustHaveTokens('trader joes scandinavian swimmers')).toEqual(['trader', 'swimmers']);
        expect(deriveMustHaveTokens('dominos garlic knots', [])).toEqual(['dominos', 'knots']);
    });
});

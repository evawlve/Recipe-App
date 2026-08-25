/**
 * D-A9 rider (2026-08-24): `hamburger -> ground beef` must not fire before `bun|buns`.
 *
 * Measured live on 3JD249AyleJUI2qu0ZERF: bare `hamburger bun` normalized to
 * `ground beef bun`, matched no bun, and resolved to a gpt-4o-mini stub
 * "85% Lean 15% Fat Beef Bun" at 150 g / 270 kcal (owner: the D-A9 report §1).
 *
 * Both halves are pinned: the on-disk data/fatsecret/normalization-rules.json
 * (what the box reads, delivered by scp — data/ never syncs) AND the in-code
 * DEFAULT_RULES fallback, reached here by making the file unreadable.
 */
import fs from 'fs';
import { normalizeIngredientName, clearRulesCache } from '../normalization-rules';

// [line, cleaned]. The three `bun` lines are the fix; every other line is asserted at
// master's own output (measured 2026-08-24 with ts-node against 32cd7fc) so the guard is
// proven inert outside its scope. `whole wheat` is a PROTECTED_PRODUCT_PHRASE, and the
// later rules `ground beef -> 85% lean 15% fat beef` / `lean ground beef -> 90% lean 10%
// fat beef` are what the unguarded lines land on.
const cases: Array<[string, string]> = [
    ['hamburger bun', 'hamburger bun'], // master: 85% lean 15% fat beef bun
    ['hamburger buns', 'hamburger buns'], // master: 85% lean 15% fat beef buns
    ['Hamburger Bun', 'Hamburger Bun'], // master: 85% lean 15% fat beef Bun
    ['whole wheat hamburger bun', 'whole wheat hamburger bun'], // master: whole wheat 85% lean 15% fat beef bun
    ['hamburger patty', '85% lean 15% fat beef patty'],
    ['hamburger', '85% lean 15% fat beef'],
    ['lean hamburger', '90% lean 10% fat beef'],
    ['hamburger meat', '85% lean 15% fat beef meat'],
];

describe('hamburger rule scope — on-disk rules JSON', () => {
    beforeAll(() => clearRulesCache());
    afterAll(() => clearRulesCache());

    it.each(cases)('%s -> %s', (line, expected) => {
        expect(normalizeIngredientName(line).cleaned).toBe(expected);
    });
});

describe('hamburger rule scope — DEFAULT_RULES fallback', () => {
    let spy: jest.SpyInstance;
    beforeAll(() => {
        clearRulesCache();
        spy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw new Error('rules file unreadable (test)');
        });
    });
    afterAll(() => {
        spy.mockRestore();
        clearRulesCache();
    });

    it.each(cases)('%s -> %s', (line, expected) => {
        expect(normalizeIngredientName(line).cleaned).toBe(expected);
    });
});

describe('unlessFollowedBy guard shape', () => {
    beforeAll(() => clearRulesCache());
    afterAll(() => clearRulesCache());

    it('vetoes only an immediately following whole word', () => {
        // `bun` further along does not veto — the guard is a lookahead on the next word.
        expect(normalizeIngredientName('hamburger with bun').cleaned).toBe('85% lean 15% fat beef with bun');
        // `bunless` is not `bun`: the guard word is whole-word bounded.
        expect(normalizeIngredientName('hamburger bunless').cleaned).toBe('85% lean 15% fat beef bunless');
    });
});

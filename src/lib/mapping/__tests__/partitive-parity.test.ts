/**
 * LANE S parity pin. stripPartitiveOfResidue (src/lib/mapping/partitive-residue.ts)
 * re-expresses the parser's partitive-`of` rule for the STRING input the key
 * site sees. The rule's owner, consumePartitiveOf(), is private to
 * src/lib/parse/ingredient-line.ts — a frozen input (winner-gate exit 3), so it
 * can never be exported for reuse here. This suite therefore drives the
 * EXPORTED parseIngredientLine() end-to-end and asserts both implementations
 * land on the same canonical key: if either side drifts, this file reds.
 *
 * Every import of a frozen file below is READ-ONLY — only EDITS trip the gate.
 */
import { parseIngredientLine } from '../../parse/ingredient-line';
import { canonicalizeCacheKey } from '../normalization-rules';
import { stripPartitiveOfResidue } from '../partitive-residue';

// Producing lines: `<qty> <unit/hint> of <food>` shapes where the post-#350
// parser consumes the partitive, while the free-text/LLM normalizedForm path
// (which never runs the parser) can still hand the key site the residue form
// 'of <food>'. Data-driven: adding a corpus line is one row of
// [line, foodForm].
const PRODUCING_LINES: Array<[line: string, foodForm: string]> = [
    ['3 slices of bacon', 'bacon'],
    ['3 cups of spinach', 'spinach'],
    ['2 cloves of garlic', 'garlic'],
    ['1 slice of pizza', 'pizza'],
    ['1 cup of milk', 'milk'],
];

describe('partitive parity: strip(residue form) lands on the parser\'s canonical key', () => {
    it.each(PRODUCING_LINES)('%j: strip("of <food>") keys like the parsed name', (line, foodForm) => {
        const parsed = parseIngredientLine(line);
        expect(parsed).not.toBeNull();
        expect(canonicalizeCacheKey(stripPartitiveOfResidue(`of ${foodForm}`)))
            .toBe(canonicalizeCacheKey(parsed!.name));
    });
});

describe('refusal parity: what the parser keeps, the strip keeps', () => {
    it('"1 cup of cream of wheat" — parser consumes the partitive, keeps the food\'s own `of`; the strip leaves that name alone', () => {
        const name = parseIngredientLine('1 cup of cream of wheat')!.name;
        expect(name).toBe('cream of wheat'); // at-most-once on the parser side too
        expect(stripPartitiveOfResidue(name)).toBe(name); // mid-`of` out of scope
    });

    it('"2 slices of" — the parser\'s follower guard refuses the skip; the strip refuses single-token input', () => {
        const name = parseIngredientLine('2 slices of')!.name;
        expect(name.split(/\s+/)).toHaveLength(1); // the bare dangling token itself
        expect(name).toBe('of');
        expect(stripPartitiveOfResidue(name)).toBe(name);
    });
});

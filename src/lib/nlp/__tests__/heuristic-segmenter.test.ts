/**
 * Tests for the heuristic-first food-log segmenter that lets /api/nlp/parse
 * skip the LLM segmentation call for clearly-delimited multi-item logs.
 *
 * Includes assertions for the golden-set segmentation inputs
 * (scripts/eval/golden-set.json, ids n-seg-01..04): the heuristic must either
 * split them correctly or refuse (ambiguous → LLM fallback) — never produce a
 * confident wrong split.
 */

import {
    forceSegmentText,
    segmentTextHeuristically,
    splitAndClean,
} from '../heuristic-segmenter';

function expectOk(text: string) {
    const result = segmentTextHeuristically(text);
    if (result.status !== 'ok') {
        throw new Error(`Expected ok for "${text}", got ambiguous: ${result.reason}`);
    }
    return result.items;
}

function expectAmbiguous(text: string) {
    const result = segmentTextHeuristically(text);
    expect(result.status).toBe('ambiguous');
}

describe('segmentTextHeuristically', () => {
    describe('clear delimiter splits (skip LLM)', () => {
        it('splits "2 eggs and 1 slice of toast" into 2 items', () => {
            const items = expectOk('2 eggs and 1 slice of toast');
            expect(items.map((i) => i.rawText)).toEqual(['2 eggs', '1 slice of toast']);
        });

        it('splits comma lists: "chicken breast, rice, broccoli" into 3 items', () => {
            const items = expectOk('chicken breast, rice, broccoli');
            expect(items.map((i) => i.rawText)).toEqual(['chicken breast', 'rice', 'broccoli']);
        });

        it('handles mixed comma + and: "2 eggs, toast with butter and a glass of orange juice"', () => {
            const items = expectOk('2 eggs, toast with butter and a glass of orange juice');
            expect(items.map((i) => i.rawText)).toEqual([
                '2 eggs',
                'toast with butter',
                'a glass of orange juice',
            ]);
        });

        it('splits newline-separated logs', () => {
            const items = expectOk('2 eggs\n1 bagel with cream cheese\nblack coffee');
            expect(items.map((i) => i.rawText)).toEqual([
                '2 eggs',
                '1 bagel with cream cheese',
                'black coffee',
            ]);
        });

        it('splits bulleted newline logs and strips bullets', () => {
            const items = expectOk('- 2 eggs\n- greek yogurt\n- black coffee');
            expect(items.map((i) => i.rawText)).toEqual(['2 eggs', 'greek yogurt', 'black coffee']);
        });

        it('splits on "plus" and "&"', () => {
            const items = expectOk('protein shake plus a banana & peanut butter');
            expect(items.map((i) => i.rawText)).toEqual([
                'protein shake',
                'a banana',
                'peanut butter',
            ]);
        });

        it('drops empty fragments from trailing/doubled delimiters', () => {
            const items = expectOk('2 eggs, , toast,');
            expect(items.map((i) => i.rawText)).toEqual(['2 eggs', 'toast']);
        });
    });

    describe('single items', () => {
        it('keeps "toast with butter" as ONE item (with = modifier)', () => {
            const items = expectOk('toast with butter');
            expect(items).toHaveLength(1);
            expect(items[0].rawText).toBe('toast with butter');
        });

        it('handles "1 protein shake" as one item', () => {
            const items = expectOk('1 protein shake');
            expect(items).toHaveLength(1);
            expect(items[0].rawText).toBe('1 protein shake');
        });

        it('keeps compound names with internal "and" whole: "mac and cheese"', () => {
            const items = expectOk('mac and cheese');
            expect(items).toHaveLength(1);
            expect(items[0].rawText).toBe('mac and cheese');
        });

        it('keeps "eggs with salt and pepper" as one item', () => {
            const items = expectOk('eggs with salt and pepper');
            expect(items).toHaveLength(1);
            expect(items[0].rawText).toBe('eggs with salt and pepper');
        });

        it('attaches multi-condiment tails: "coffee with cream and sugar"', () => {
            const items = expectOk('coffee with cream and sugar');
            expect(items).toHaveLength(1);
            expect(items[0].rawText).toBe('coffee with cream and sugar');
        });
    });

    describe('meal type extraction', () => {
        it('applies a trailing meal marker to all items', () => {
            const items = expectOk('turkey sandwich and an apple for lunch');
            expect(items.map((i) => i.rawText)).toEqual(['turkey sandwich', 'an apple']);
            expect(items.every((i) => i.mealType === 'lunch')).toBe(true);
        });

        it('defaults to snacks when no meal is mentioned', () => {
            const items = expectOk('chicken breast, rice');
            expect(items.every((i) => i.mealType === 'snacks')).toBe(true);
        });

        it('applies a leading "breakfast:" prefix to all items', () => {
            const items = expectOk('breakfast: 2 eggs, oatmeal');
            expect(items.map((i) => i.rawText)).toEqual(['2 eggs', 'oatmeal']);
            expect(items.every((i) => i.mealType === 'breakfast')).toBe(true);
        });
    });

    describe('golden-set segmentation inputs (scripts/eval/golden-set.json)', () => {
        it('n-seg-01: "2 scrambled eggs and a slice of whole wheat toast for breakfast" → 2 breakfast items', () => {
            const items = expectOk('2 scrambled eggs and a slice of whole wheat toast for breakfast');
            expect(items.map((i) => i.rawText)).toEqual([
                '2 scrambled eggs',
                'a slice of whole wheat toast',
            ]);
            expect(items.every((i) => i.mealType === 'breakfast')).toBe(true);
        });

        it('n-seg-02: quantified "with" starts a new item → 2 lunch items', () => {
            const items = expectOk('grilled chicken salad with a tablespoon of olive oil for lunch');
            expect(items.map((i) => i.rawText)).toEqual([
                'grilled chicken salad',
                'a tablespoon of olive oil',
            ]);
            expect(items.every((i) => i.mealType === 'lunch')).toBe(true);
        });

        it('n-seg-03: "grilled chicken with brown rice and steamed broccoli" defers to LLM (with-tail is a real food, expected 3 items)', () => {
            // "brown rice" is a standalone side, not a condiment — a naive "and"
            // split would confidently produce 2 items where the golden set
            // expects 3. The heuristic must refuse instead.
            expectAmbiguous('grilled chicken with brown rice and steamed broccoli');
        });

        it('n-seg-04: "a bowl of oatmeal with blueberries and honey" defers to LLM (expected 2+ items)', () => {
            expectAmbiguous('a bowl of oatmeal with blueberries and honey');
        });
    });

    describe('LLM fallback (ambiguous input)', () => {
        it('falls back for messy run-on sentences with hedging', () => {
            expectAmbiguous(
                'so yesterday i think i ate some eggs maybe toast not really sure how much honestly'
            );
        });

        it('falls back for "or" alternatives', () => {
            expectAmbiguous('chicken or beef burrito');
        });

        it('falls back when one undelimited fragment has multiple quantities', () => {
            expectAmbiguous('2 eggs 1 slice of toast');
        });

        it('falls back for a long undelimited sentence', () => {
            expectAmbiguous('a big plate of leftover pasta from the fridge last night');
        });

        it('falls back for a non-condiment "with" tail: "greek yogurt with granola"', () => {
            expectAmbiguous('greek yogurt with granola');
        });

        it('falls back for empty text', () => {
            expectAmbiguous('   ');
        });
    });
});

describe('forceSegmentText (lenient fallback when the LLM errors/times out)', () => {
    it('best-effort splits a clear list', () => {
        const items = forceSegmentText('2 eggs and toast');
        expect(items.map((i) => i.rawText)).toEqual(['2 eggs', 'toast']);
    });

    it('never returns empty for non-empty text (run-on degrades to one item)', () => {
        const items = forceSegmentText(
            'so yesterday i think i ate some eggs maybe toast not really sure how much honestly'
        );
        expect(items.length).toBeGreaterThanOrEqual(1);
        expect(items.every((i) => i.rawText.length > 0)).toBe(true);
    });

    it('splits ambiguous "with" texts on the remaining delimiters', () => {
        const items = forceSegmentText('a bowl of oatmeal with blueberries and honey');
        expect(items.map((i) => i.rawText)).toEqual([
            'a bowl of oatmeal with blueberries',
            'honey',
        ]);
    });

    it('returns [] only for empty text', () => {
        expect(forceSegmentText('')).toEqual([]);
    });
});

/**
 * Punch #94 (ASC AB9m7h). Diego typed `12.7 ounces real good chicken`; the meal
 * staged as `7 x 1 oz (198 g)`. The LLM segmenter failed or deadlined for that
 * request (the box has ONE MappingEventLog request of 8 rows with rawLine
 * `7 ounces real good chicken` and NO SegmentationCache row, and the route caches
 * only a successful LLM split), so forceSegmentText() ran and BULLET_RE read the
 * `12.` of `12.7` as list-item numbering.
 *
 * The whole class is silent: a decimal quantity loses its integer part and the
 * line still parses, so nothing errors and no gate goes red. `1.5 cups rice` is
 * the same defect in the over-billing direction.
 */
describe('forceSegmentText: a leading decimal is a quantity, not a bullet (punch #94)', () => {
    it('keeps the decimal on the verbatim reported meal shape', () => {
        const items = forceSegmentText(
            '12.7 ounces real good chicken\n2 eggs\n1 slice of toast'
        );
        expect(items.map((i) => i.rawText)).toEqual([
            '12.7 ounces real good chicken',
            '2 eggs',
            '1 slice of toast',
        ]);
    });

    it('keeps the decimal with and without the "of"', () => {
        expect(forceSegmentText('12.7 ounces of real good chicken')[0].rawText).toBe(
            '12.7 ounces of real good chicken'
        );
        expect(forceSegmentText('12.7 ounces real good chicken')[0].rawText).toBe(
            '12.7 ounces real good chicken'
        );
    });

    it('keeps a decimal that would otherwise OVER-bill', () => {
        // `1.5 cups rice` used to become `5 cups rice` — 3.3x the food.
        expect(forceSegmentText('1.5 cups rice')[0].rawText).toBe('1.5 cups rice');
        expect(forceSegmentText('3.5 oz salmon')[0].rawText).toBe('3.5 oz salmon');
    });

    it('keeps a LEADING-ZERO and a TWO-DIGIT decimal', () => {
        // Both shapes were unpinned in the first draft of this block, and a
        // refuter found two wrong regexes that passed all 34 tests without
        // them: `\d+\.(?=\d\d)` re-added to the alternation turns
        // `0.75 cup olive oil` into `75 cup olive oil`, and a `0\.` arm turns
        // `0.5 cups rice` into `5 cups rice`. Every decimal above happens to
        // have exactly ONE digit after the point and no leading zero, which is
        // what let the mutants through. `0.5` and `.25`/`.75` are the most
        // common decimals a person types into a food log.
        expect(forceSegmentText('0.5 cups rice')[0].rawText).toBe('0.5 cups rice');
        expect(forceSegmentText('0.75 cup olive oil')[0].rawText).toBe('0.75 cup olive oil');
        expect(forceSegmentText('1.25 cups rice')[0].rawText).toBe('1.25 cups rice');
        expect(forceSegmentText('10.25 oz salmon')[0].rawText).toBe('10.25 oz salmon');
    });

    it('CONTROL: real list bullets still strip', () => {
        expect(forceSegmentText('1. eggs')[0].rawText).toBe('eggs');
        expect(forceSegmentText('2) toast')[0].rawText).toBe('toast');
        expect(forceSegmentText('10. rice')[0].rawText).toBe('rice');
        expect(forceSegmentText('- milk')[0].rawText).toBe('milk');
        expect(forceSegmentText('\u2022 milk')[0].rawText).toBe('milk');
        // no space after the separator, and a digit after `)`, both still bullets
        expect(forceSegmentText('1.eggs')[0].rawText).toBe('eggs');
        expect(forceSegmentText('2)2 eggs')[0].rawText).toBe('2 eggs');
    });

    it('CONTROL: a numbered list of several items still strips every bullet', () => {
        expect(forceSegmentText('1) toast and 2. jam').map((i) => i.rawText)).toEqual([
            'toast',
            'jam',
        ]);
    });
});

/**
 * Punch #105. DELIMITER_SPLIT_RE split on EVERY comma, so a decimal comma or a
 * thousands comma inside a quantity was read as an item boundary. Measured on
 * the shipped function 2026-09-05, before the fix:
 *   forceSegmentText('1,5 kg rice')          -> ['5 kg rice']        (3.3x the food)
 *   forceSegmentText('1,000 g rice')         -> ['000 g rice']
 *   forceSegmentText('1,5 kg rice, 2 eggs')  -> ['5 kg rice', '2 eggs']
 *   segmentTextHeuristically('1,5 kg rice')  -> ambiguous, 'no food word in: "1"'
 * The rule: a comma between two digits is never a delimiter. It needs a digit
 * on BOTH sides, so `rice,5 eggs` and `oats 40,milk 200` are still two items.
 *
 * Same silent class as punch #94 above: nothing errors, and the mangled line
 * still parses and bills a plausible number. This fix only lets the intact
 * line REACH the parser: parseIngredientLine('1,5 kg rice') reads qty 1 with
 * name "5 kg rice" today (a second seat in src/lib/parse, handed off in the PR).
 */
describe('a decimal/thousands comma is not a delimiter (punch #105)', () => {
    const texts = (fragments: { rawText: string }[]) => fragments.map((f) => f.rawText);

    describe('splitAndClean (the helper both entry points call)', () => {
        it('keeps a decimal comma and a thousands comma inside ONE fragment', () => {
            for (const line of [
                '1,5 kg rice',
                '1,000 g rice',
                '1,000,000 g rice',
                '12,7 ounces real good chicken',
            ]) {
                const { fragments, rawFragmentCount } = splitAndClean(line);
                // rawFragmentCount pins that the comma was never a split point,
                // not merely that an empty fragment was filtered afterwards.
                expect(rawFragmentCount).toBe(1);
                expect(texts(fragments)).toEqual([line]);
            }
        });

        it('keeps the first item intact when a real list comma follows it', () => {
            expect(texts(splitAndClean('1,5 kg rice, 2 eggs').fragments)).toEqual([
                '1,5 kg rice',
                '2 eggs',
            ]);
            expect(texts(splitAndClean('1,5 kg rice,2 eggs').fragments)).toEqual([
                '1,5 kg rice',
                '2 eggs',
            ]);
        });

        it('CONTROL: the rule needs a digit on BOTH sides', () => {
            // letter-comma-digit, digit-comma-letter, and a comma followed by a
            // space between two numbers: all three are still list commas.
            expect(texts(splitAndClean('rice,5 eggs').fragments)).toEqual(['rice', '5 eggs']);
            expect(texts(splitAndClean('oats 40,milk 200').fragments)).toEqual([
                'oats 40',
                'milk 200',
            ]);
            expect(texts(splitAndClean('2 eggs, 3 toast').fragments)).toEqual([
                '2 eggs',
                '3 toast',
            ]);
        });

        it('CONTROL: ordinary list commas, with and without a space, are unchanged', () => {
            expect(texts(splitAndClean('eggs, toast').fragments)).toEqual(['eggs', 'toast']);
            // `2 eggs,toast` split into two on the shipped code (measured
            // 2026-09-05) and must keep doing so.
            expect(texts(splitAndClean('2 eggs,toast').fragments)).toEqual(['2 eggs', 'toast']);
        });
    });

    describe('forceSegmentText (the production caller)', () => {
        it('keeps the decimal / thousands comma', () => {
            expect(texts(forceSegmentText('1,5 kg rice'))).toEqual(['1,5 kg rice']);
            expect(texts(forceSegmentText('1,000 g rice'))).toEqual(['1,000 g rice']);
            expect(texts(forceSegmentText('1,5 kg rice, 2 eggs'))).toEqual([
                '1,5 kg rice',
                '2 eggs',
            ]);
        });

        it('CONTROL: list commas still split', () => {
            expect(texts(forceSegmentText('eggs, toast'))).toEqual(['eggs', 'toast']);
            expect(texts(forceSegmentText('2 eggs,toast'))).toEqual(['2 eggs', 'toast']);
            expect(texts(forceSegmentText('rice,5 eggs'))).toEqual(['rice', '5 eggs']);
        });
    });

    describe('segmentTextHeuristically', () => {
        it('returns the intact line as ONE item instead of refusing on a bare "1"', () => {
            expect(texts(expectOk('1,5 kg rice'))).toEqual(['1,5 kg rice']);
            expect(texts(expectOk('1,000 g rice'))).toEqual(['1,000 g rice']);
            expect(texts(expectOk('1,5 kg rice, 2 eggs'))).toEqual(['1,5 kg rice', '2 eggs']);
        });

        it('CONTROL: list commas still split', () => {
            expect(texts(expectOk('eggs, toast'))).toEqual(['eggs', 'toast']);
            expect(texts(expectOk('2 eggs,toast'))).toEqual(['2 eggs', 'toast']);
            expect(texts(expectOk('rice,5 eggs'))).toEqual(['rice', '5 eggs']);
        });
    });
});

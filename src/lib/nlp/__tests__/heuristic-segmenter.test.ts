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

/**
 * CONTENT PIN for SEGMENT_SYSTEM_PROMPT (punch #171, Lane A S51, 2026-09-15).
 *
 * A prompt is a string the compiler cannot see and no other suite reads, so a
 * later edit could drop an example or move a dish name to the wrong list and
 * every gate would stay green. This suite captures the prompt exactly as
 * `segmentTextWithAi()` sends it (through a mocked `callStructuredLlm()`, so
 * nothing is exported for the test's sake) and pins its SHAPE:
 *
 *   - the English "with" rule, including its two exceptions, is BYTE-IDENTICAL to
 *     seg-v2's (the 2026-08-12 trap: a new exception clause ate its own worked
 *     example, collapsing `toast with butter` 3/3 — so #171 adds examples, never a
 *     clause, and never rewrites the with rule);
 *   - the Spanish SPLIT examples sit in the "and" rule's SEPARATE list, and the
 *     Spanish dish names sit in its ONE-product list — and neither list carries
 *     the other's (the dish-name trap the 2026-09-12 Spanish baseline measured:
 *     `arroz con pollo` and `huevos rancheros` must stay one item);
 *   - the prompt never asks the segmenter to translate (`normalizedForm`
 *     translation is #170's translate-at-gate row, not this one);
 *   - SEG_PARSER_VERSION moved with the prompt, as the module header mandates.
 *
 * What it cannot see: whether the model OBEYS. That is gated by
 * `scripts/eval/_seg_ab_driver.ts` over the English labels and the Spanish corpus
 * (owner: mobile sync-docs/reports/2026-09-15_lane-a-s51-rxbar-fix-forward-and-the-spanish-segmenter.md).
 */

jest.mock('@/lib/ai/structured-client', () => ({
    callStructuredLlm: jest.fn(),
}));

import { segmentTextWithAi, SEG_PARSER_VERSION } from '@/lib/nlp/ai-segmenter';

const SEG_V2_WITH_RULE =
    '"with" SPLITS: when "with" joins a base food to another real food that has its own calories, output them as SEPARATE items ("toast with butter" -> 2, "toast with peanut butter" -> 2, "coffee with milk" -> 2, "granola with yogurt" -> 2, "chicken with rice and broccoli" -> 3). Only two exceptions: do not split inside a single branded product or restaurant menu item name ("mcdonalds sausage mcmuffin with egg" -> 1, "nature valley biscuits with almond butter" -> 1), and never split off zero-calorie seasonings, spices or herbs.';

const SEG_V2_EXAMPLE_LINE =
    'Example: "2 eggs and wheat toast for breakfast" -> {"items":[{"rawText":"2 eggs","mealType":"breakfast","brand":"","normalizedForm":"eggs"},{"rawText":"wheat toast","mealType":"breakfast","brand":"","normalizedForm":"wheat toast"}]}';

const SPANISH_SPLITS = [
    'arroz con frijoles',
    'pan con mantequilla',
    'huevos con jamon',
    'pollo y arroz',
    'una manzana y un platano',
];
const SPANISH_ONE_ITEM = ['arroz con pollo', 'huevos rancheros', 'leche con chocolate', 'cafe con leche'];

async function capturedPrompt(): Promise<string> {
    const { callStructuredLlm } = require('@/lib/ai/structured-client');
    (callStructuredLlm as jest.Mock).mockReset();
    (callStructuredLlm as jest.Mock).mockResolvedValue({
        status: 'success',
        content: { items: [{ rawText: 'arroz', mealType: 'snacks', brand: '', normalizedForm: 'arroz' }] },
    });
    await segmentTextWithAi('arroz');
    expect(callStructuredLlm).toHaveBeenCalledTimes(1);
    return (callStructuredLlm as jest.Mock).mock.calls[0][0].systemPrompt as string;
}

function separateList(prompt: string): string {
    const m = prompt.match(/Two distinct whole foods joined by "and" are SEPARATE items \((.*?)\)\. Keep "and" together/);
    if (!m) throw new Error('the "and" rule SEPARATE list was not found');
    return m[1];
}

function oneProductList(prompt: string): string {
    const m = prompt.match(/Keep "and" together ONLY when the whole phrase names ONE product or a single flavor \((.*?) = 1 item\)/);
    if (!m) throw new Error('the "and" rule ONE-product list was not found');
    return m[1];
}

describe('SEGMENT_SYSTEM_PROMPT content (punch #171)', () => {
    it('keeps the English "with" rule and its two exceptions byte-identical to seg-v2', async () => {
        const lines = (await capturedPrompt()).split('\n');
        expect(lines).toContain(SEG_V2_WITH_RULE);
        expect(lines.filter(l => l.startsWith('"with" SPLITS'))).toHaveLength(1);
    });

    it('keeps the single worked Example line unchanged', async () => {
        const lines = (await capturedPrompt()).split('\n');
        expect(lines).toContain(SEG_V2_EXAMPLE_LINE);
        expect(lines.filter(l => l.startsWith('Example:'))).toHaveLength(1);
    });

    it('keeps every English "and" example it had', async () => {
        const prompt = await capturedPrompt();
        const sep = separateList(prompt);
        for (const s of ['"chicken and rice" -> 2', '"eggs and bacon" -> 2', '"rice and beans" -> 2']) {
            expect(sep).toContain(s);
        }
        const one = oneProductList(prompt);
        for (const s of ['"cookies and cream"', '"peaches and cream"', '"mac and cheese"', '"peanut butter and jelly"']) {
            expect(one).toContain(s);
        }
    });

    it('teaches each Spanish con/y SPLIT in the SEPARATE list, and nowhere in the one-product list', async () => {
        const prompt = await capturedPrompt();
        const sep = separateList(prompt);
        const one = oneProductList(prompt);
        for (const line of SPANISH_SPLITS) {
            expect(sep).toContain(`"${line}" -> 2`);
            expect(one).not.toContain(`"${line}"`);
        }
    });

    it('keeps each Spanish dish name in the one-product list, and nowhere in the SEPARATE list', async () => {
        const prompt = await capturedPrompt();
        const sep = separateList(prompt);
        const one = oneProductList(prompt);
        for (const line of SPANISH_ONE_ITEM) {
            expect(one).toContain(`"${line}"`);
            expect(sep).not.toContain(`"${line}"`);
        }
    });

    it('never asks the segmenter to translate', async () => {
        expect((await capturedPrompt()).toLowerCase()).not.toMatch(/translat|in english/);
    });

    it('moved SEG_PARSER_VERSION with the prompt', () => {
        expect(SEG_PARSER_VERSION).toBe('seg-v3');
    });
});

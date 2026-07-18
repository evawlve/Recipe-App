/**
 * Heuristic-first food-log segmenter.
 *
 * Deterministically splits free-text food logs ("2 eggs, toast with butter and
 * a glass of orange juice") into individual items on strong delimiters
 * (newlines, commas, semicolons, " and ", " plus ", "&", "+") so the
 * multi-second LLM segmentation call in /api/nlp/parse can be skipped for the
 * common, clearly-delimited case.
 *
 * "with" is NOT a split point by default — it usually attaches a modifier
 * ("toast with butter" is one item). Two exceptions:
 *   1. "with <qty> <measure> ..." ("with a tablespoon of olive oil") starts a
 *      new, separately-quantified item, so it splits.
 *   2. A "with" tail that is a known condiment/topping ("with butter",
 *      "with cream cheese") stays attached.
 * Any other "with" tail ("with brown rice", "with blueberries") is genuinely
 * ambiguous — the segmenter refuses and the caller falls back to the LLM.
 *
 * @module heuristic-segmenter
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snacks';

export interface HeuristicSegmentItem {
    rawText: string;
    mealType: MealType;
    brand: string;
    normalizedForm: string;
}

export type HeuristicSegmentResult =
    | { status: 'ok'; items: HeuristicSegmentItem[] }
    | { status: 'ambiguous'; reason: string };

// ============================================================
// Lexicons
// ============================================================

/**
 * Compound food phrases whose internal " and " must never be treated as an
 * item delimiter. Masked before splitting, restored after.
 */
const ATOMIC_AND_PHRASES = [
    'salt and pepper',
    'mac and cheese',
    'macaroni and cheese',
    'peanut butter and jelly',
    'fish and chips',
    'ham and cheese',
    'half and half',
    'sweet and sour',
    'biscuits and gravy',
    'chicken and waffles',
    'bangers and mash',
    'surf and turf',
    'cream and sugar',
    'milk and sugar',
    'bread and butter',
    'cheese and crackers',
    'chips and salsa',
    'chips and guacamole',
    'chips and guac',
    'pork and beans',
];

/**
 * Last-word lexicon for "with <tail>" attachments. If the tail of a "with"
 * phrase ends in one of these, it is a condiment/topping that belongs to the
 * preceding food ("toast with butter", "bagel with cream cheese",
 * "pancakes with maple syrup", "coffee with milk and sugar").
 */
const CONDIMENT_TAIL_WORDS = new Set([
    'butter', 'jam', 'jelly', 'honey', 'syrup', 'cheese', 'mayo', 'mayonnaise',
    'aioli', 'ketchup', 'catsup', 'mustard', 'ranch', 'dressing', 'vinaigrette',
    'sauce', 'gravy', 'salsa', 'guac', 'guacamole', 'hummus', 'cream', 'creamer',
    'milk', 'sugar', 'sweetener', 'stevia', 'salt', 'pepper', 'cinnamon',
    'nutmeg', 'sprinkles', 'frosting', 'icing', 'nutella', 'seasoning',
    'spices', 'herbs', 'oil', 'lemon', 'lime', 'ice',
]);

const MEASURE_WORDS = new Set([
    'cup', 'cups', 'tbsp', 'tbsps', 'tablespoon', 'tablespoons', 'tsp', 'tsps',
    'teaspoon', 'teaspoons', 'slice', 'slices', 'glass', 'glasses', 'scoop',
    'scoops', 'bowl', 'bowls', 'can', 'cans', 'bottle', 'bottles', 'shot',
    'shots', 'side', 'sides', 'order', 'orders', 'piece', 'pieces', 'serving',
    'servings', 'spoonful', 'spoonfuls', 'handful', 'handfuls', 'splash',
    'splashes', 'drizzle', 'drizzles', 'dollop', 'dollops', 'pat', 'pats',
    'oz', 'ounce', 'ounces', 'gram', 'grams', 'g', 'kg', 'ml', 'l', 'lb', 'lbs',
    'pound', 'pounds', 'bar', 'bars', 'stick', 'sticks', 'pinch', 'dash',
]);

const NUMBER_WORDS = new Set([
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'half', 'quarter', 'dozen', 'couple', 'few',
]);

const STOPWORDS = new Set([
    'a', 'an', 'the', 'of', 'some', 'my', 'more', 'and', 'with', 'plus', 'or',
    'for', 'at', 'as', 'on', 'in', 'to', 'i', 'had', 'ate', 'then', 'also',
    'this', 'that', 'about', 'around', 'like',
]);

// ============================================================
// Regexes
// ============================================================

const MEAL_SUFFIX_RE = /\s*(?:for|at|as)\s+(?:a\s+)?(breakfast|lunch|dinner|snacks?)\s*\.?\s*$/i;
const MEAL_PREFIX_RE = /^\s*(breakfast|lunch|dinner|snacks?)\s*[:\-]\s*/i;

/**
 * "with <qty> <measure>" starts a separately-quantified item. Consumes only
 * "with " (lookahead keeps the quantity phrase in the next fragment).
 */
const WITH_QTY_SPLIT_RE = new RegExp(
    String.raw`\bwith\s+(?=(?:an?|one|two|three|four|five|six|\d+(?:[./]\d+)?)\s+(?:${[...MEASURE_WORDS].join('|')})\b)`,
    'gi'
);

/** Strong item delimiters: newline, comma, semicolon, &, +, " and ", " plus ". */
const DELIMITER_SPLIT_RE = /\s*(?:[\r\n;,\u0002]|[&+]|\band\b|\bplus\b)\s*/gi;

/** Signals the text is hedged/uncertain — only an LLM can untangle it. */
const VAGUE_RE = /\b(?:or|maybe|probably|possibly|dunno|idk|whatever|something|stuff)\b|not\s+(?:really\s+)?sure|i\s+think|kind\s+of|sort\s+of|some\s+kind/i;

/** Leading list bullets / numbering ("- ", "* ", "1.", "2)"). */
const BULLET_RE = /^(?:[-*•]+|\d+[.)])\s*/;

/** Leading connector filler ("and eggs", "i had eggs", "then coffee"). */
const LEADING_FILLER_RE = /^(?:and|also|then|plus|i\s+had|i\s+ate|had|ate)\s+/i;

const QTY_TOKEN_RE = /(?:^|[\s(])(?:\d+(?:[./]\d+)?|½|⅓|⅔|¼|¾|half|quarter|dozen)(?=[\s)]|$)/gi;

const AND_MASK = '\u0000';

// ============================================================
// Helpers
// ============================================================

function maskAtomicPhrases(text: string): string {
    let out = text;
    for (const phrase of ATOMIC_AND_PHRASES) {
        const re = new RegExp(phrase.replace(/ and /g, '\\s+and\\s+').replace(/ /g, '\\s+'), 'gi');
        out = out.replace(re, (m) => m.replace(/\s+and\s+/gi, AND_MASK));
    }
    return out;
}

function unmask(text: string): string {
    return text.replace(new RegExp(AND_MASK, 'g'), ' and ');
}

function normalizeMeal(word: string): MealType {
    const meal = word.toLowerCase();
    return meal === 'snack' ? 'snacks' : (meal as MealType);
}

interface CleanedFragment {
    rawText: string;
    mealType: MealType | null;
}

/** Trim bullets/filler/punctuation and extract a per-fragment meal suffix. */
function cleanFragment(fragment: string): CleanedFragment {
    let text = unmask(fragment).trim();
    text = text.replace(BULLET_RE, '');
    for (let i = 0; i < 3 && LEADING_FILLER_RE.test(text); i++) {
        text = text.replace(LEADING_FILLER_RE, '');
    }

    let mealType: MealType | null = null;
    const mealMatch = text.match(MEAL_SUFFIX_RE);
    if (mealMatch) {
        mealType = normalizeMeal(mealMatch[1]);
        text = text.slice(0, mealMatch.index).trim();
    }

    text = text.replace(/[.,;:!]+$/, '').trim();
    return { rawText: text, mealType };
}

function countQuantityTokens(text: string): number {
    return (text.match(QTY_TOKEN_RE) ?? []).length;
}

function hasContentWord(text: string): boolean {
    const tokens = text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
    return tokens.some(
        (t) => !STOPWORDS.has(t) && !MEASURE_WORDS.has(t) && !NUMBER_WORDS.has(t)
    );
}

/**
 * Inspect a lingering "with <tail>" inside a fragment.
 * Returns 'attach' when the tail is a known condiment/topping (fragment stays
 * one item), or 'ambiguous' when the tail could be a standalone food
 * ("with brown rice") and the LLM should decide.
 */
function classifyWithTail(fragment: string): 'attach' | 'ambiguous' | 'none' {
    const match = fragment.match(/\bwith\s+(.+)$/i);
    if (!match) return 'none';
    const tail = match[1].trim().toLowerCase().replace(/[.,;:!]+$/, '');
    const tailWords = tail.match(/[a-z][a-z'-]*/g) ?? [];
    if (tailWords.length === 0) return 'ambiguous';
    // Every "and"-joined part of the tail must end in a condiment word
    // ("with butter", "with milk and sugar" — masked phrases already restored).
    const parts = tail.split(/\s+and\s+/i);
    const allCondiments = parts.every((part) => {
        const words = part.match(/[a-z][a-z'-]*/g) ?? [];
        const last = words[words.length - 1];
        return last !== undefined && CONDIMENT_TAIL_WORDS.has(last);
    });
    return allCondiments ? 'attach' : 'ambiguous';
}

/** Shared splitting pass: mask, meal-prefix/suffix strip, delimiter split, clean. */
function splitAndClean(text: string): {
    fragments: CleanedFragment[];
    rawFragmentCount: number;
    defaultMeal: MealType;
} {
    let working = text.trim();
    let defaultMeal: MealType = 'snacks';

    const prefixMatch = working.match(MEAL_PREFIX_RE);
    if (prefixMatch) {
        defaultMeal = normalizeMeal(prefixMatch[1]);
        working = working.slice(prefixMatch[0].length);
    }
    const suffixMatch = working.match(MEAL_SUFFIX_RE);
    if (suffixMatch) {
        defaultMeal = normalizeMeal(suffixMatch[1]);
        working = working.slice(0, suffixMatch.index).trim();
    }

    working = maskAtomicPhrases(working);
    working = working.replace(WITH_QTY_SPLIT_RE, '\u0002');

    const rawFragments = working.split(DELIMITER_SPLIT_RE);
    const fragments = rawFragments
        .map(cleanFragment)
        .filter((f) => f.rawText.length > 0);

    return { fragments, rawFragmentCount: rawFragments.length, defaultMeal };
}

function toItem(fragment: CleanedFragment, defaultMeal: MealType): HeuristicSegmentItem {
    return {
        rawText: fragment.rawText,
        mealType: fragment.mealType ?? defaultMeal,
        brand: '',
        normalizedForm: '',
    };
}

// ============================================================
// Public API
// ============================================================

const MAX_FRAGMENT_WORDS = 8;
const MAX_FRAGMENT_CHARS = 60;
const MAX_SINGLE_ITEM_WORDS = 6;
const MAX_ITEMS = 12;

/**
 * Strict heuristic segmentation. Returns items only when every fragment is a
 * clean, unambiguous food line; otherwise returns 'ambiguous' so the caller
 * can fall back to LLM segmentation.
 */
export function segmentTextHeuristically(text: string): HeuristicSegmentResult {
    const trimmed = (text ?? '').trim();
    if (trimmed.length === 0) {
        return { status: 'ambiguous', reason: 'empty text' };
    }
    if (VAGUE_RE.test(trimmed)) {
        return { status: 'ambiguous', reason: 'hedged/uncertain wording' };
    }

    const { fragments, rawFragmentCount, defaultMeal } = splitAndClean(trimmed);

    if (fragments.length === 0) {
        return { status: 'ambiguous', reason: 'no usable fragments' };
    }
    if (fragments.length > MAX_ITEMS) {
        return { status: 'ambiguous', reason: 'too many fragments' };
    }

    for (const fragment of fragments) {
        const words = fragment.rawText.split(/\s+/);
        if (fragment.rawText.length > MAX_FRAGMENT_CHARS || words.length > MAX_FRAGMENT_WORDS) {
            return { status: 'ambiguous', reason: `fragment too long: "${fragment.rawText}"` };
        }
        if (!hasContentWord(fragment.rawText)) {
            return { status: 'ambiguous', reason: `no food word in: "${fragment.rawText}"` };
        }
        if (countQuantityTokens(fragment.rawText) > 1) {
            return { status: 'ambiguous', reason: `multiple quantities in: "${fragment.rawText}"` };
        }
        if (classifyWithTail(fragment.rawText) === 'ambiguous') {
            return { status: 'ambiguous', reason: `unclear "with" attachment in: "${fragment.rawText}"` };
        }
    }

    // A lone fragment is only trusted when the text had no delimiters at all
    // and reads like one short food line (mirrors the single-item bypass, but
    // additionally admits condiment attachments like "toast with butter").
    if (fragments.length === 1 && rawFragmentCount === 1) {
        const words = fragments[0].rawText.split(/\s+/);
        if (words.length > MAX_SINGLE_ITEM_WORDS) {
            return { status: 'ambiguous', reason: 'single undelimited fragment too long' };
        }
    }

    return { status: 'ok', items: fragments.map((f) => toItem(f, defaultMeal)) };
}

/**
 * Lenient, never-fails segmentation for when the LLM fallback itself errors
 * or times out: best-effort delimiter split, keeping any fragment with a
 * content word; degrades to the whole text as a single item.
 */
export function forceSegmentText(text: string): HeuristicSegmentItem[] {
    const trimmed = (text ?? '').trim();
    if (trimmed.length === 0) return [];

    const { fragments, defaultMeal } = splitAndClean(trimmed);
    const usable = fragments.filter((f) => hasContentWord(f.rawText)).slice(0, MAX_ITEMS);

    if (usable.length === 0) {
        return [{ rawText: trimmed, mealType: defaultMeal, brand: '', normalizedForm: '' }];
    }
    return usable.map((f) => toItem(f, defaultMeal));
}

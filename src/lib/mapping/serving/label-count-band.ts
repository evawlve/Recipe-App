/**
 * LABEL COUNT BAND (C70 row 10, 2026-10-20) — admits a multi-piece OFF label
 * (`N <noun>(s) (G g)`, N >= 2) as a PER-PIECE weight when G / N sits inside
 * that noun's corpus band.
 *
 * WHY A BAND AND NOT A SET. `label_count_derived` in buildOffResult() admits a
 * multi-piece label only for the eleven `LABEL_COUNT_PIECE_NOUNS`. The set-free
 * arm was REFUTED: `4 oreo cookies` on a `9 cookies (29 g)` label would bill
 * 3.2 g per cookie (a 3.5x under-bill; the label's count of 9 is wrong for a
 * 29 g serving) and the generic [0.2, 500] band does not catch it.
 * `LABEL_COUNT_PIECE_NOUNS` also feeds RETRIEVAL, so it is never widened. This
 * module admits by a measured per-noun BAND instead, and cookies are out by
 * construction: the label noun `cookies` singularizes to `cooky`
 * (singularizeUnit(), a known count-label.ts limit), which has no entry here.
 *
 * MEASUREMENT (2026-10-20, SQL in s341/row10/design.md, band-floor-ceil.txt):
 * OffFood real-GTIN labels `N <noun>(s) (G g)`, N >= 2, per-piece = G / N,
 * [p10, p90] per noun with >= 20 labels, p10 FLOORED and p90 CEILED to 0.1 g so
 * a label sitting exactly on a percentile is admitted. p10 is inclusive and
 * load-bearing: Pop-Tarts 48.0, Eggo 35.0 and breadsticks 3.0 sit on it.
 *
 * The generic noun `piece` is in the table for completeness but is NEVER
 * consulted: a generic label may count pieces OF the item (`2 california rolls`
 * on `6 pieces (156 g)` would bill 52 g, a 6x under-bill), and the bands were
 * measured on labels whose word IS the noun.
 */
import { singularizeUnit, GENERIC_PIECE_WORDS } from '../count-label';

/** [p10, p90] per-piece grams, singular keys. NO `cookie` — see the header. */
export const LABEL_COUNT_BAND: Readonly<Record<string, readonly [number, number]>> = {
    piece: [1.9, 25.6],
    slice: [5.6, 37.8],
    cracker: [1.1, 5.6],
    chip: [1.2, 3.2],
    bar: [10, 55.5],
    biscuit: [2.3, 21.4],
    pretzel: [1.3, 6.6],
    waffle: [35, 38],
    meatball: [14.1, 35],
    stick: [3.4, 32.3],
    egg: [7.4, 59],
    link: [11.3, 32.5],
    tortilla: [15.7, 28.5],
    ball: [10, 22.4],
    roll: [10, 43.6],
    muffin: [23.4, 41],
    nugget: [14, 23.5],
    pancake: [10, 49.4],
    gummy: [2.5, 7.1],
    dumpling: [17.7, 31],
    wing: [21, 56],
    tender: [28, 57.3],
    truffle: [8.3, 19],
    taco: [20.2, 173.5],
    breadstick: [3, 31],
    wrap: [11.1, 102],
    pastry: [48, 55],
};

/** The French label noun (`2 gaufres (70 g)`); singularizeUnit('pastries') is already 'pastry'. */
const LABEL_NOUN_ALIASES: Record<string, string> = { gaufre: 'waffle' };

/**
 * A label noun that is a synonym of the product's own head word. An EXPLICIT
 * pair table, never a substring test (`a pizza` on "Pizza Rolls" must be null).
 */
const LABEL_NOUN_COUNTS_ITEM_HEAD: Record<string, readonly string[]> = {
    pastry: ['tart'],
    ball: ['truffle'],
};

function has(table: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(table, key);
}

export function labelCountPerPiece(args: {
    servingGrams: number | null | undefined;
    labelUnitCount: number;
    labelUnitWord: string | null;
    itemName: string;
}): { perPiece: number; n: number; noun: string } | null {
    const { servingGrams, labelUnitCount, labelUnitWord, itemName } = args;
    if (!(labelUnitCount >= 2) || servingGrams == null || !(servingGrams > 0)) return null;
    if (!labelUnitWord) return null;

    const singular = singularizeUnit(labelUnitWord);
    const labelNoun = has(LABEL_NOUN_ALIASES, singular) ? LABEL_NOUN_ALIASES[singular] : singular;
    if (!labelNoun) return null;

    const tokens = (itemName || '').toLowerCase().split(/[^a-z&]+/).filter(Boolean);
    const last = tokens.length > 0 ? tokens[tokens.length - 1] : '';
    const itemHead = singularizeUnit(last);
    if (!itemHead) return null;

    if (GENERIC_PIECE_WORDS.has(labelNoun)) return null;

    let bandNoun: string | null = null;
    if (labelNoun === itemHead) {
        bandNoun = labelNoun;
    } else if (has(LABEL_NOUN_COUNTS_ITEM_HEAD, labelNoun)
        && LABEL_NOUN_COUNTS_ITEM_HEAD[labelNoun].includes(itemHead)) {
        bandNoun = labelNoun;
    }
    if (bandNoun == null || !has(LABEL_COUNT_BAND, bandNoun)) return null;

    const [lo, hi] = LABEL_COUNT_BAND[bandNoun];
    const perPiece = servingGrams / labelUnitCount;
    if (perPiece < lo || perPiece > hi) return null;
    return { perPiece, n: labelUnitCount, noun: bandNoun };
}

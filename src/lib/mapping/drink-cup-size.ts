/**
 * A CAFE CUP WORD NAMES A SIZE CLASS on a prepared-drink line (s459 LATTE-c).
 *
 * Mechanism: FatSecret's chain records carry the cup in the NAME (`Matcha Latte (Tall)` /
 * `(Grande)` / `(Venti)` / `(Short)`), one record per size, and the four siblings score within
 * 0.001 in simpleRerank() because nothing reads the size word: the variant adjustment there is
 * gated on a branded line, and its size table had no tall / grande / venti / short. So
 * `a venti matcha latte` took the Tall record (cold, deploy 40, pd-lattb `ma-run.json`: Tall
 * 0.647 / Short 0.64667 / Venti 0.64667 / Grande 0.64633). And when `small` / `medium` /
 * `large` parse as a unit on a size-named record, buildFatSecretResult()'s (c2) step asked the
 * AI for a cup weight (`a large matcha latte` on the Tall record: 250 g live) although the
 * record IS one cup of a size.
 *
 * Scope: a PREPARED-DRINK line only (preparedDrinkHeadWord(), the head-noun rule shared with the
 * prepared-drink panel and cup rules). `short` and `grande` are ordinary words elsewhere
 * (`short ribs`, `burrito grande`, `short-grain rice`), so the cup words never apply to a line
 * whose head is not a cafe drink.
 *
 * Pairing (the hot cup, Starbucks; the same pairing as DRINK_CUP_SIZE_GRAMS / CUP_SIZE_ROW in
 * bare-query-guard.ts): short = 8 oz (its own class), tall = small (12 oz), grande = medium
 * (16 oz), venti = large (20 oz), trenta = extra large (30 oz, iced only).
 */
import { preparedDrinkHeadWord } from './macro-plausibility';

export type CupSizeClass = 'short' | 'small' | 'medium' | 'large' | 'xlarge';

/** The cafe cup words and the size class each names. Read only on a prepared-drink line. */
export const CAFE_CUP_SIZE_WORDS: Readonly<Record<string, CupSizeClass>> = {
    short: 'short', tall: 'small', grande: 'medium', venti: 'large', trenta: 'xlarge',
};

/** True when the line (or the rerank query) has a prepared-drink head noun: latte, cappuccino, mocha, flat white, ... */
export function isPreparedDrinkLine(query: string, rawLine?: string): boolean {
    return preparedDrinkHeadWord(query || '') != null || (!!rawLine && preparedDrinkHeadWord(rawLine) != null);
}

const PLAIN_SIZE_WORDS: Readonly<Record<string, CupSizeClass>> = { small: 'small', medium: 'medium', large: 'large' };

/**
 * The cup size a RECORD NAME states (`Matcha Latte (Venti)` -> large, `Iced Latte - Small` -> small),
 * or null when it names none or names two. Plain small / medium / large plus the cafe cup words.
 */
export function recordCupSizeClass(foodName: string): CupSizeClass | null {
    const found = new Set<CupSizeClass>();
    for (const w of (foodName || '').toLowerCase().split(/[^a-z]+/)) {
        const c = CAFE_CUP_SIZE_WORDS[w] ?? PLAIN_SIZE_WORDS[w];
        if (c) found.add(c);
    }
    return found.size === 1 ? [...found][0] : null;
}

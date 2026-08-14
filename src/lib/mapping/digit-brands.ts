/**
 * Digit-leading brand lexicon.
 *
 * A handful of US food brands BEGIN with a digit ("7UP", "5-hour Energy",
 * "3 Musketeers"). The deterministic quantity extractor treats any leading
 * numeric token as a count, so "7up" parsed as qty 7 x (355 ml can) and
 * billed ~2.5 kg of soda. Tokens/phrases listed here are part of the food
 * NAME: the leading digit is never consumed as a quantity ("7up" -> qty 1),
 * while an explicit count before the brand still works ("2 7up" -> qty 2).
 *
 * Keep this list SMALL, explicit, and US-food-focused. Every entry disables
 * generic digit parsing for its exact token/phrase, so each addition must be
 * a real digit-leading HUMAN-food brand, unambiguous against a genuine count
 * ("7 almonds" must keep qty 7 — that is why bare "5 hour" without "energy"
 * is deliberately NOT listed). Pet-food brands ("9Lives") are excluded.
 * The general brand lexicon lives in brand-detector.ts / brand-lexicon.json;
 * this file covers only the digit-leading subset the parser must know about.
 */

/**
 * Single tokens that are a digit-leading brand on their own. These must also
 * survive the parser's number+unit token splitter ("7up" must NOT become
 * ["7", "up"] the way "200g" becomes ["200", "g"]).
 */
const DIGIT_BRAND_SINGLE_TOKENS = new Set<string>([
    '7up',          // 7UP soda ("7up")
    '7-up',         // 7UP soda, hyphenated ("7-up")
    '5-hour',       // 5-hour Energy shot ("5-hour energy") — hyphen makes it unambiguous
    '3musketeers',  // 3 Musketeers bar, no-space form
]);

/**
 * Multi-token phrases whose leading digit token belongs to the brand name.
 * Matched against consecutive lowercased tokens. Keep phrases specific enough
 * that they can never shadow a genuine count of a food ("3 musketeers" is a
 * candy bar; nobody logs 3 units of a food called "musketeers").
 */
const DIGIT_BRAND_PHRASES: ReadonlyArray<ReadonlyArray<string>> = [
    ['7', 'up'],                // "7 up" (space form of 7UP)
    ['3', 'musketeers'],        // "3 musketeers bar"
    ['5', 'hour', 'energy'],    // "5 hour energy" — trigram on purpose: bare
    //                             "5 hour" without "energy" stays a normal
    //                             quantity parse (too ambiguous to claim).

    // Private-label brands whose first token is PURELY NUMERIC (added 2026-08-14).
    // That is the exact vulnerable shape: parseIngredientLine()'s leading-quantity
    // strip is /^\s*[\d./]+(?:\s+|$)/, which consumes a whole standalone numeric
    // token only. So `1st phorm`, `4c` and `1up` were never at risk and are
    // deliberately NOT here, while `365 everyday value` was billing qty=365 against
    // a name of "everyday value peanut butter" and matching nothing.
    //
    // Measured live 2026-08-14: `365 everyday value peanut butter and a banana`
    // billed 0 g / 0 kcal with NO client marker — the item vanished from the meal
    // total — while `a scoop of 365 everyday value peanut butter` found the record
    // at 32 g / 209.9 kcal. Identical normalizedForm; the literal prefix merely
    // shielded the digits.
    ['365', 'everyday', 'value'],  // 822 OFF rows
    ['365', 'whole', 'foods'],     // 749 rows as "365 whole foods market" + 69 bare;
    //                                the 3-gram covers both, so MAX_PHRASE_LEN stays 3
    ['7', 'select'],               // 172 rows (7-Eleven private label)
    ['7', 'eleven'],               // 99 rows as "7 eleven" (+ hyphen/slash forms the
    //                                strip never touches, so they need no entry)
];

/**
 * DELIBERATELY DECLINED, with the corpus count that was checked (2026-08-14).
 * Recorded because the brand lexicon's documented failure mode is hand-authored
 * entries that no corpus supports (179 zero-corpus entries, all from the curated
 * half — owner: reports/2026-08-03_the-brand-lexicon-is-saturated.md), and the
 * opposite failure is re-deriving a decline someone already made.
 *
 *   bare "365"      239 rows — a bare leading number is exactly what the quantity
 *                   parser exists to read. Claiming it would break "365" as a count.
 *   "7 days"        35 rows  — a real croissant brand, but unresolvably ambiguous
 *                   against a genuine count/duration. Same reasoning as bare "5 hour".
 *   "99 ranch" 31 / "95 nutrition" 32 / "180 snacks" 30 / "88 acres" 26 — all below
 *                   the row floor used for the entries above, and "ranch" is a food
 *                   word. Revisit only with traffic evidence, not corpus presence.
 */

/** Longest phrase length, so callers know how far ahead matching may look. */
const MAX_PHRASE_LEN = DIGIT_BRAND_PHRASES.reduce((m, p) => Math.max(m, p.length), 1);

/** Lowercase a token and strip trailing punctuation ("7up." -> "7up"). */
function normalizeToken(token: string): string {
    return token.toLowerCase().replace(/[.,;:!?]+$/, '');
}

/**
 * True when a single token IS a digit-leading brand ("7up", "7-up").
 * Used by the tokenizer to keep the token intact instead of splitting the
 * digits off as a separate (quantity-looking) token.
 */
export function isDigitBrandToken(token: string): boolean {
    return DIGIT_BRAND_SINGLE_TOKENS.has(normalizeToken(token));
}

/**
 * Returns how many tokens starting at `startIdx` form a digit-leading brand
 * (0 when none do). Single tokens win over phrases; phrases are matched
 * longest-first so "5 hour energy" beats any shorter overlap.
 */
export function matchDigitBrandTokens(tokens: string[], startIdx = 0): number {
    if (startIdx >= tokens.length) return 0;
    if (isDigitBrandToken(tokens[startIdx])) return 1;

    for (let len = Math.min(MAX_PHRASE_LEN, tokens.length - startIdx); len >= 2; len--) {
        for (const phrase of DIGIT_BRAND_PHRASES) {
            if (phrase.length !== len) continue;
            let matches = true;
            for (let k = 0; k < len; k++) {
                if (normalizeToken(tokens[startIdx + k]) !== phrase[k]) {
                    matches = false;
                    break;
                }
            }
            if (matches) return len;
        }
    }
    return 0;
}

/**
 * When `line` STARTS with a digit-leading brand, returns the matched prefix
 * exactly as the user typed it (e.g. "7 Up", "5 hour energy"); else null.
 * Used by brand detection, whose leading-quantity strip would otherwise
 * destroy the digit half of the brand before the lexicon lookup.
 */
export function matchDigitBrandPrefix(line: string): string | null {
    const tokens = line.trim().split(/\s+/);
    const consumed = matchDigitBrandTokens(tokens, 0);
    return consumed > 0 ? tokens.slice(0, consumed).join(' ') : null;
}

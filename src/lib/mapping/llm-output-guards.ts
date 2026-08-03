/**
 * Deterministic guards over the AI normalizer's OUTPUT.
 *
 * `aiNormalizeIngredient()` is trusted unconditionally at its call site in
 * `mapIngredientWithFallback()` — six plain assignments, no validation. The
 * brand-preservation guard in that same function does not cover it: that guard
 * is gated on a CALLER-SUPPLIED `options.normalizedForm` and runs before the
 * LLM result overwrites `normalizedName`. This module is the missing check.
 *
 * Read the token list below before extending this: the defect that motivated it
 * turned out to originate in a data file, not in the model, and the guard is
 * deliberately scoped to the residue that fix cannot reach.
 *
 * Kept free of imports on purpose. `simple-rerank.ts` — the natural home for a
 * predicate like this — transitively pulls `db.ts`, which makes it unloadable
 * outside a configured runtime and therefore untestable in isolation. Same
 * reason `serving-options.ts` exists separately in the mobile app.
 */

/**
 * Tokens that name a DISTINCT FOOD rather than a property of one.
 *
 * When something introduces one the user never typed, it does not refine the
 * query — it replaces the food. MEASURED 2026-08-03 against the live box, cold
 * and deterministic over repeated probes:
 *
 *     vanilla yogurt        -> "Vanilla Extract"  fs_33911      288 kcal/100g, 4.2 g
 *     vanilla protein shake -> "Vanilla extract"  off_15283979  286 kcal/100g, 150 g = 429 kcal
 *
 * THE ROOT CAUSE WAS NOT THE MODEL, and this guard is not the primary fix.
 * `data/fatsecret/normalization-rules.json` carried an unguarded
 * `synonym_rewrites` entry, `vanilla -> vanilla extract`, which fired before
 * any LLM ran and rewrote `vanilla yogurt` to `vanilla extract yogurt`. The
 * in-code `DEFAULT_RULES` never had it and the code path that implements the
 * same recipe default is properly context-gated — but `readRulesFile()` prefers
 * the on-disk file, so the naive entry won. Deleting it is the fix; bare
 * `vanilla` still becomes `vanilla extract` from the code rule, as intended.
 *
 * What remains, and why this module still exists: `AiNormalizeCache` holds 45
 * rows / 283 reads whose stored output carries an `extract` the raw line never
 * had (`orgain organic protein powder vanilla` at 232 reads is the single
 * highest-traffic rewrite in that table). Those rows were written while the
 * alias was live and are REPLAYED from cache after it is gone, so the data fix
 * alone does not clear them. This guard covers that replay and any future echo.
 *
 * The failure is bounded, which is why the list is narrow: a query with a brand
 * (`orgain ... vanilla`) or a strong food noun (`vanilla ice cream`) still
 * retrieves correctly, because the rest of the string carries enough signal to
 * recover the pick. It is the thin queries — a flavour word plus a weak noun —
 * that are destroyed.
 *
 * DELIBERATELY AN ALLOWLIST OF MEASURED OFFENDERS, not a general
 * "token absent from the input" rule. The normalizer legitimately introduces
 * qualifiers — `rolled` for oatmeal (18 rows), `skinless` for chicken breast
 * (16 rows) — and those refine the SAME food. The distinction that matters is
 * head-noun versus qualifier, and only the head-noun class belongs here. A
 * blanket rule would revert both of those and is not what this is.
 */
const FOOD_REPLACING_TOKENS: readonly string[] = ['extract'];

const WORD_SPLIT = /[^a-z0-9]+/;

/** Whole-token, case- and punctuation-insensitive membership. */
function hasToken(text: string, token: string): boolean {
    return text
        .toLowerCase()
        .split(WORD_SPLIT)
        .some((t) => t === token);
}

export interface IntroducedTokenRepair {
    /** The repaired string. Never empty — see `stripIntroducedFoodTokens`. */
    cleaned: string;
    /** Tokens removed, lowercased. Empty when nothing fired. */
    removed: string[];
}

/**
 * Remove food-replacing tokens the normalizer introduced that are absent from
 * the user's own text.
 *
 * REPAIRS, never rejects. Rejecting the whole normalized string would also
 * discard the typo repair, form-word retention and cooking-state preservation
 * that live in the same value — and on the cache-fallback rerank path the
 * fallback is the post-AI string anyway, so a reject there is inert. Stripping
 * the offending token restores the user's own words: the rewrite is an APPEND
 * in 12 of the 14 highest-traffic cases (`X vanilla` -> `X vanilla extract`),
 * so removal is exactly the identity the user typed.
 *
 * If stripping would empty the string, the original is returned unchanged. A
 * guard must never hand an empty query downstream — several builders here are
 * terminal, and an empty retrieval lands on a worse tier than a wrong one.
 */
export function stripIntroducedFoodTokens(
    rawInput: string,
    normalized: string | null | undefined,
): IntroducedTokenRepair {
    if (!normalized) return { cleaned: normalized ?? '', removed: [] };

    const removed: string[] = [];
    let out = normalized;

    for (const token of FOOD_REPLACING_TOKENS) {
        // Only intervene when the model added it and the user did not.
        if (!hasToken(normalized, token) || hasToken(rawInput, token)) continue;

        // Targeted removal, NOT split/rejoin: rebuilding the string from
        // `WORD_SPLIT` pieces would rewrite `ben and jerry's` to
        // `ben and jerry s`. Apostrophe handling has forked the cache key on
        // this project more than once; leave every other character alone.
        const stripped = out
            .replace(new RegExp(`\\b${token}\\b`, 'gi'), ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!stripped) continue; // never empty the query
        out = stripped;
        removed.push(token);
    }

    return { cleaned: out, removed };
}

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

/**
 * Decide the branded-query flag from the static detector and the model, when
 * they disagree.
 *
 * `mapIngredientWithFallback()` seeds `isBrandedQuery` from
 * `detectBrandInQuery(rawLine)` and then overwrites it with the model's
 * `is_branded` — a plain assignment, so a model answering `false` DOWNGRADES a
 * static `true`. The comment above those assignments has always described the
 * intent as upgrade-only ("may upgrade isBrandedQuery to true ... even when the
 * static detector missed it"); the code never implemented it. A downgrade is not
 * cosmetic: it suppresses the brand-targeted supplementary OFF query in
 * `gatherCandidates()` (the one retrieval path that re-injects the brand token,
 * and no ranking fix can recover a candidate that was never retrieved), it
 * disables the `brand_guard` cache rejection so a cached row from a DIFFERENT
 * brand is served, and it lets `canReuseQuickGather` replay a gather that ran
 * without `targetBrand`.
 *
 * BUT PLAIN UPGRADE-ONLY IS REFUTED BY MEASUREMENT, and that is why this takes
 * a decisiveness argument.
 *
 * MEASURED 2026-08-03 over `AiNormalizeCache` on the live box (3,131 rows, of
 * which 250 are `SIMPLIFY:`-namespaced and 2,881 are user-namespace). Headline
 * figures are the **2,881**: the normalize-gate-skipped path calls
 * `getAiNormalizeCache(baseName)` with no namespace and therefore cannot read a
 * SIMPLIFY row at all, and those rows are warm-campaign synthetic lines rather
 * than traffic.
 *
 *     downgrades (static true, model false)   56 rows / 310 reads
 *       decisive     — this guard keeps true  14 rows /  18 reads
 *       non-decisive — downgrade allowed      42 rows / 292 reads
 *     upgrades   (static false, model true)  372 rows
 *
 * NOTE FOR ANYONE RE-DERIVING: over ALL 3,131 rows the downgrade count is 79,
 * and that 79 splits 23/56 by decisiveness while ALSO splitting 23/56 by
 * SIMPLIFY-vs-user. Two different partitions with the same shape — do not quote
 * a bare "56" without saying which.
 *
 * On 42 of the 56 the static detector is simply WRONG: the lexicon matches
 * common food words — `granola` in `greek yogurt with granola` (148 reads, the
 * single highest-traffic downgrade), `mirin` (44), `one` in `one milk` (9),
 * `sprouts` in `roasted brussels sprouts`, `poblano`, `sriracha`, `star` in
 * `star anise`, `gallo` in `pico de gallo`, `bell` in `bell pepper`. There the
 * downgrade is the model CORRECTING the detector. **94% of the reads in this
 * population (292 of 310) are on lines where the downgrade is right**, so a
 * blanket upgrade-only rule is a net loss weighted by traffic.
 *
 * So the static detector only outranks the model where its evidence spans two
 * words. `hasDecisiveBrandContext()` is that test and is already load-bearing
 * for the brand-preservation repair; it clears the real ones
 * (`just bare chicken breast strips`, `once again cashew butter`,
 * `ryse protein ...`, `diet dr pepper`) and refuses every false positive above.
 *
 * WHAT A FALSE POSITIVE WOULD COST, if you are tempted to widen this. `true`
 * makes `getTokenBloatPenalty()` return 0 up to +3 excess tokens — a swing of
 * up to 0.45, larger than `WEIGHTS.EXACT_MATCH` — which is the guard that keeps
 * `Bell Pepper & Onion Stir Fry Kit` off `bell pepper`. It adds +4 in
 * `computeOffScore()` (`src/lib/openfoodfacts/search.ts`) to any OFF row whose
 * brand is a substring of the query, and because `searchOffSimple()` sorts and
 * slices on that raw score it changes which rows are ADMITTED, not merely how
 * they rank; a lone survivor can then take the `single_candidate` path at 0.95
 * and clear the 0.85 save gate. And it turns on the `brand_guard` escape
 * against the normalized cache, which is recorded in `readEscapes` and forfeits
 * that row's cross-source displacement margin — a state change, not a read miss.
 *
 * Known under-reach, deliberate: single-word brands with no adjacent
 * product-form token stay downgraded — `fairlife chocolate milk`, `bragg
 * nutritional yeast`. Widening the context-token set is a change to the brand
 * lexicon's precision, measured separately; under-reaching costs a retrieval
 * lane, over-reaching evicts live cache rows for non-brands.
 */
export function resolveIsBrandedQuery(
    staticIsBranded: boolean,
    modelIsBranded: boolean | undefined,
    brandContextIsDecisive: boolean,
): boolean {
    // The model may always UPGRADE — that direction is the documented intent and
    // it is the common case (372 of these rows), so it stays unconditional.
    if (modelIsBranded === true) return true;
    // It may only DOWNGRADE where the static evidence is not decisive.
    return staticIsBranded && brandContextIsDecisive;
}

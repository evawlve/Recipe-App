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

// ============================================================
// Nutrition-modifier restoration
// ============================================================

/**
 * Nutrition modifiers the normalizer drops from its output while the user's own
 * text still carries them.
 *
 * MEASURED 2026-08-15 on box `BU4urjF_aMOJ1oBawuCLD`. The segmenter emits a
 * per-item `normalizedForm` that becomes the mapper's primary search term, and
 * it strips these words while retaining them in the sibling `rawText`. Of 23
 * cached segments whose `rawText` carries one of these phrases, 16 lose it from
 * `normalizedForm` (re-derive: the `SegmentationCache` census in
 * `sync-docs/reports/2026-08-15_the-nutrition-modifier-is-dropped.md`). The
 * discriminator is the FOOD, not the phrase and not the carrier: the same
 * `fat free` survives on `milk` and dies on `greek yogurt` under an identical
 * carrier, in the same cache.
 *
 * Every member clears four independent tests, and membership is gated on them
 * rather than on intuition — the brand lexicon shipped 179 hand-authored
 * zero-corpus entries and that is the failure being avoided:
 *
 *   1. it carries a non-zero `conflictPenalty` in `MODIFIER_CONFLICTS`, so the
 *      pipeline already treats it as identity-bearing;
 *   2. it is already in `MODIFIER_SYNONYM_GROUPS`, so retrieval knows its class;
 *   3. it is already in `deriveMustHaveTokens()`'s `MODIFIER_TOKENS` — which is
 *      the load-bearing safety fact: restoring these adds NO must-have token, so
 *      the `every()`-gated admission filter is not tightened. This change shifts
 *      the pool, it does not narrow admission;
 *   4. `ai-normalize.ts`'s own prompt already lists it as never-strip, so this
 *      enforces a rule the system claims to follow and does not.
 *
 * DELIBERATELY EXCLUDED, each for a measured or structural reason:
 *   - `light`/`lite` — collides with live `synonym_rewrites` that CREATE the
 *     word (`corn syrup` -> `light corn syrup`, `single cream` -> `light cream`).
 *     Restoring it would fight a data file.
 *   - `organic`/`natural`/`vegan`/`keto`/`gluten free` — `MODIFIER_CONFLICTS`
 *     gives `organic` `conflictPenalty: 0`, "user preference, not nutrition".
 *     Three golden cases carry it; narrowing there buys no nutrition accuracy.
 *   - `whole` — owned by `IDENTITY_QUALIFIERS` and `isIdentityWholePhrase()`.
 *     Restoring it here would double-restore and reopen the count-unit collision
 *     closed on 2026-08-04.
 *   - `sweetened` — widens toward the sugary product; no consequence argument.
 *     Also a substring hazard against `unsweetened`, which is why matching is
 *     whole-phrase and longest-first.
 *   - `low sodium`/`less sodium` — REAL, but dropped by a different writer:
 *     `normalizeIngredientName()` strips them via `prep_phrases`, deterministically,
 *     on BOTH paths. Restoring them here without that fix would have this guard
 *     re-adding what the static rules strip again one line later. They ship with
 *     the `RULES_VERSION` bump, not here.
 *
 * Longest-first so `no sugar added` matches before any `sugar` sub-phrase.
 */
export const NUTRITION_MODIFIER_PHRASES: readonly string[] = Object.freeze([
    'no sugar added',
    'no added sugar',
    'zero sugar',
    'sugar free',
    'sugarfree',
    'unsweetened',
    'reduced fat',
    'fat free',
    'nonfat',
    'lowfat',
    'low fat',
    'skim',
    'diet',
] as const);

/**
 * `diet` is the one member that is not self-evidently a nutrition claim: it is
 * also an ordinary noun (`my diet`, `keto diet snack`). It is kept because it is
 * the brand word in `Diet Coke` — 0 kcal against Coke's ~42 kcal/100 g, the
 * largest single-token bill difference in the set — and refused positionally
 * rather than by special-casing the phrase, the same shape as #312's fix for
 * leading-digit brands (`matchDigitBrandTokens`'s `startIdx`).
 *
 * Requires a following token, which alone refuses the noun sense in the observed
 * shapes (`i changed my diet`, `a snack on my diet` — `diet` is terminal in
 * both), plus a preceding-possessive refusal. Articles are deliberately NOT
 * refused: `a diet coke` is the canonical attributive case and an early version
 * of this guard blocked it, which the target list caught.
 */
const DIET_NOUN_PRECEDERS = new Set(['my', 'his', 'her', 'their', 'your', 'our']);

function dietIsAttributive(evidenceTokens: readonly string[], at: number): boolean {
    if (at === evidenceTokens.length - 1) return false;
    if (at > 0 && DIET_NOUN_PRECEDERS.has(evidenceTokens[at - 1])) return false;
    return true;
}

export interface NutritionModifierRepair {
    /** The repaired string. Never empty, never shorter than the input. */
    restored: string;
    /** Phrases prepended, lowercased and in evidence order. Empty when nothing fired. */
    added: string[];
}

/** Hyphen- and case-folded token list, for whole-phrase matching. */
function foldTokens(text: string): string[] {
    return text.toLowerCase().split(WORD_SPLIT).filter(Boolean);
}

/** True when `phrase` appears as a whole-token run inside `tokens`. */
function phraseAt(tokens: readonly string[], phrase: readonly string[]): number {
    outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
        for (let j = 0; j < phrase.length; j++) {
            if (tokens[i + j] !== phrase[j]) continue outer;
        }
        return i;
    }
    return -1;
}

/**
 * Restore nutrition modifiers the user typed that the normalizer dropped.
 *
 * ADDS ONLY — it never removes a token, so the sibling repairs in this file and
 * the normalizer's own typo/form fixes all survive it. That is also why it is
 * safe to run after `stripIntroducedFoodTokens()`: the two move in opposite
 * directions and cannot fight.
 *
 * A phrase is restored only when it is present in `evidence` (the user's own
 * words) AND absent from `candidate`. Nothing is invented: this cannot add a
 * claim the user did not make, which is the property that makes it safe to run
 * unconditionally on both the solo and composite paths.
 *
 * Why this is not `IDENTITY_QUALIFIERS`: that set feeds `deriveCacheKeyName()`'s
 * discriminator append and its own header says "keep this list tiny — every
 * entry splits the cache keyspace". Membership there is also necessary but not
 * sufficient, since a token must first survive `extractQualifiers()`, and none
 * of these multi-word phrases do.
 */
export function restoreNutritionModifiers(
    evidence: string,
    candidate: string | null | undefined,
): NutritionModifierRepair {
    const base = (candidate ?? '').trim();
    if (!base || !evidence) return { restored: base, added: [] };

    const evidenceTokens = foldTokens(evidence);
    const candidateTokens = foldTokens(base);
    if (evidenceTokens.length === 0) return { restored: base, added: [] };

    const added: string[] = [];
    // Track the evidence position of each hit so the restored prefix reads in the
    // order the user typed, not the order of the phrase table.
    const hits: { phrase: string; at: number }[] = [];

    for (const phrase of NUTRITION_MODIFIER_PHRASES) {
        const parts = phrase.split(' ');
        const at = phraseAt(evidenceTokens, parts);
        if (at < 0) continue;
        // Already present downstream — nothing to restore.
        if (phraseAt(candidateTokens, parts) >= 0) continue;
        // A shorter phrase already covered by a longer one that fired.
        if (hits.some((h) => h.phrase.includes(phrase) || phrase.includes(h.phrase))) continue;
        if (phrase === 'diet' && !dietIsAttributive(evidenceTokens, at)) continue;
        hits.push({ phrase, at });
    }

    if (hits.length === 0) return { restored: base, added: [] };

    hits.sort((a, b) => a.at - b.at);
    for (const h of hits) added.push(h.phrase);

    return { restored: `${added.join(' ')} ${base}`.trim(), added };
}

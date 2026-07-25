/**
 * failure-classes.ts — F2, the mapping failure-class registry.
 *
 * F1 (PR #139) made every ingredient line land in exactly one FunnelStage with
 * a namespaced dropReason. That answered "where do lines die"; it did NOT answer
 * "what is broken and who should fix it". This file is the second half: a typed,
 * committed, testable taxonomy that turns a funnel histogram into a work queue.
 *
 * FOUR MEASURED FACTS SHAPE EVERYTHING BELOW. They were established against the
 * live box on 2026-07-25 (13,452 MappingEventLog rows carrying funnelStage) and
 * must not be re-derived from the raw counts, because the raw counts lie:
 *
 * (1) THE RAW HISTOGRAM IS MISLEADING. `save_rejected:cross_source_margin` is
 *     404 of the 571 save_rejected events — 71% — and it is INCUMBENT
 *     PROTECTION, i.e. correct behaviour. The gate is nested inside
 *     `if (newTargetKey && existingTargetKey && newTargetKey !== existingTargetKey)`
 *     (validated-mapping-helpers.ts:724), so on a cold key `existing` is null and
 *     the whole block is skipped: it CANNOT fire without an incumbent, and only
 *     ever on off: <-> fs: swaps. Ranking classes by raw count would send the
 *     first and largest fix-agent at working code. Hence `FixKind.healthy`, and
 *     hence classify-drops.ts reports counts split by `hadIncumbent`.
 *
 * (2) YOU CANNOT JOIN EVENT ROWS TO CACHE ROWS ON `normalizedForm`.
 *     MappingEventLog.normalizedForm is the PRE-canonicalization AI-normalized
 *     name; FoodMapping.normalizedForm is the canonicalized, singularized,
 *     token-SORTED cache key. "chicken breast" in the log is "breast chicken" in
 *     the cache; "eggs" is "egg"; "pretzels" is "pretzel". A naive join reports
 *     every one of those as uncached and inverts the conclusion. So FunnelRow
 *     carries BOTH: `normalizedForm` (as logged) and `cacheKey`
 *     (canonicalizeCacheKey applied — the real exported function, never a
 *     re-implementation).
 *
 * (3) under_gate's dropReason IS NOT DIAGNOSTIC. F1 tags under_gate with the
 *     confidence gate's `selectionReason` — which path SELECTED the pick, not
 *     why confidence was low (map-ingredient-with-fallback.ts:2749). The
 *     2026-07-24 funnel read found simple_rerank / close_match / clear_winner
 *     each split ~50/50 good-vs-bad. Classes under under_gate are therefore
 *     distinguished by ROW heuristics (brand agreement, token coverage,
 *     degenerate macros, composite-dish magnitude), never by the reason string.
 *
 * (4) THE FUNNEL MEASURES CONVERSION, NOT CORRECTNESS. 38 rows whose macros were
 *     all zero counted as `saved` — successes. A stage cannot express "converted,
 *     but poisoned". So FunnelRow carries a QUALITY block (degenerate macros,
 *     flat-100g serving, ai_estimated source, brand disagreement, uncovered query
 *     tokens) and the registry's first classes fire on SUCCESSFUL stages.
 *
 * PRECEDENCE. FAILURE_CLASSES is ordered, and classifyRow returns the FIRST
 * match. Order is by severity of the underlying defect, not by stage:
 *   degenerate macros > corrupt panel > identity (cooked/prep/composite/brand/
 *   token) > serving shape > residual buckets > healthy/by-design.
 *
 * RESIDUAL BUCKETS. Classes flagged `residual: true` exist so that live data has
 * an unclassified rate near zero while NEW shapes still surface: classify-drops
 * reports residual hits as the frontier, with their raw dropReasons, rather than
 * hiding them inside a named class. Promote a residual's recurring sub-shape to
 * its own class rather than growing the residual's description.
 */

import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';
import { normalizeClassId, type FunnelStage } from '../../src/lib/mapping/funnel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Who can fix this class — the routing decision, and the reason a raw histogram
 * is not a work queue.
 */
export type FixKind =
    /** A gate/filter/rerank/normalizer change fixes the whole class at once. */
    | 'pipeline'
    /** A repoint/evict/corrupt-mark on specific rows. Row-by-row, not code. */
    | 'data'
    /** No record exists; only new data fixes it. Route to an ingest queue, NEVER a fix-agent. */
    | 'ingest'
    /** The drop is correct behaviour. Counted so it stops looking like a defect. */
    | 'healthy';

/** Quality dimension (finding 4): a line can convert AND still be wrong. */
export interface FunnelQuality {
    /**
     * Every macro we can see reads zero. From warm JSONL this is the per-100g
     * panel; from MappingEventLog (which stores no per-100g macros) it is
     * totalKcal === 0 with grams > 0. 38 such rows were cached as 'saved'.
     */
    degenerateMacros: boolean;
    /** kcal is zero (weaker than degenerateMacros — a real 0-kcal food can hit this). */
    zeroKcal: boolean;
    /** grams landed on exactly 100 with no resolved serving tier: the flat-100g fallthrough. */
    flat100gServing: boolean;
    /** No corpus record answered: an AI 100g estimate did. Ingest signal, not a ranking signal. */
    aiEstimated: boolean;
    /** The record carries a brand that shares NO token with the query, and drops query tokens. */
    brandDisagreement: boolean;
    /** Distinguishing query tokens absent from the record's name+brand. Identity signal. */
    uncoveredQueryTokens: string[];
}

/** One drop (or one poisoned conversion), from warm JSONL or MappingEventLog. */
export interface FunnelRow {
    /** The line as the user/warm-seed wrote it. */
    rawLine: string;
    /** PRE-canonicalization AI-normalized name, exactly as MappingEventLog stores it. */
    normalizedForm: string | null;
    /** canonicalizeCacheKey(normalizedForm ?? rawLine) — the ONLY key that joins to FoodMapping. */
    cacheKey: string;
    funnelStage: FunnelStage | null;
    /** Namespaced '<stage>:<class>[:<detail>]', as F1 wrote it. */
    dropReason: string | null;
    /** dropReason with the stage prefix stripped and re-normalized. '' when absent. */
    dropClass: string;
    confidence: number | null;
    grams: number | null;
    totalKcal: number | null;
    kcalPer100g: number | null;
    proteinPer100g: number | null;
    carbsPer100g: number | null;
    fatPer100g: number | null;
    source: string | null;
    foodId: string | null;
    foodName: string | null;
    brandName: string | null;
    servingTier: string | null;
    /** Was a FoodMapping row present for cacheKey? null = not looked up. */
    hadIncumbent: boolean | null;
    quality: FunnelQuality;
}

/** Loose input shape; makeFunnelRow derives cacheKey, dropClass and quality. */
export interface FunnelRowInput {
    rawLine: string;
    normalizedForm?: string | null;
    funnelStage?: FunnelStage | string | null;
    dropReason?: string | null;
    confidence?: number | null;
    grams?: number | null;
    totalKcal?: number | null;
    kcalPer100g?: number | null;
    proteinPer100g?: number | null;
    carbsPer100g?: number | null;
    fatPer100g?: number | null;
    source?: string | null;
    foodId?: string | null;
    foodName?: string | null;
    brandName?: string | null;
    servingTier?: string | null;
    hadIncumbent?: boolean | null;
}

export interface FailureClass {
    id: string;
    /** Primary stage. Declarative: the doc groups by it and a meta-test keeps it honest. */
    stage: FunnelStage;
    /** Additional stages the detector legitimately fires on (quality classes span stages). */
    alsoStages?: FunnelStage[];
    title: string;
    description: string;
    fixKind: FixKind;
    /** Self-contained: it re-checks the stage itself, so calling it alone is safe. */
    detector: (row: FunnelRow) => boolean;
    /** Real queries, from measured ground truth unless the class is a tripwire. */
    exemplars: string[];
    /** Rows this detector MUST match. rawLine of each must appear in `exemplars`. */
    exemplarRows: FunnelRowInput[];
    /** Rows this detector must NOT match. Guards against silent over-matching. */
    counterRows: FunnelRowInput[];
    /** Regression pins in scripts/eval/golden-set.json. */
    goldenCaseIds: string[];
    fixPRs: number[];
    status: 'open' | 'fixing' | 'closed' | 'by-design';
    /** Absolute ISO date the class was first characterized. */
    discoveredAt: string;
    /** Live dropReason class-parts this class owns, for the coverage audit. '*' suffix = prefix match. */
    dropClasses?: string[];
    /** Catch-all bucket: hits are reported as frontier, not as a diagnosed class. */
    residual?: boolean;
}

// ---------------------------------------------------------------------------
// Row construction (the single source of truth shared by CLI and tests)
// ---------------------------------------------------------------------------

/**
 * Tokens that carry no identity. The prep/portion group mirrors what
 * normalizeIngredientName already strips via `prep_phrases` before the cache key
 * is built — so a real MappingEventLog.normalizedForm would not contain them, and
 * treating them as identity-bearing when reading a warm file (which carries the
 * raw seed) manufactured false positives: "pineapple chunks" -> Pineapple and
 * "stalks celery" -> Celery both looked like dropped-token identity defects.
 * Nutrition-affecting modifiers are DELIBERATELY absent: cooked, dry, raw, whole,
 * skim and canned all stay identity-bearing. 'frozen' IS listed — for whole foods
 * frozen and fresh are nutritionally the same, and it was the single biggest source
 * of false brand-substitution flags ("frozen broccoli" -> McCain Broccoli).
 */
const STOPWORDS = new Set([
    'and', 'with', 'the', 'of', 'in', 'on', 'a', 'an', 'for', 'from', 'plus', 'style',
    'flavor', 'flavour', 'my', 'some', 'kinda',
    // measure words
    'cup', 'cups', 'ounce', 'ounces', 'gram', 'grams', 'scoop', 'scoops', 'slice', 'slices',
    'tbsp', 'tsp', 'tablespoon', 'teaspoon', 'can', 'cans', 'bottle', 'bottles',
    'piece', 'pieces', 'serving', 'servings', 'pack', 'packs', 'container',
    // portion/shape words
    'stalk', 'stalks', 'chunk', 'chunks', 'cube', 'cubes', 'wedge', 'wedges', 'half', 'halves',
    // preparation that does not change nutrition
    'sliced', 'diced', 'chopped', 'minced', 'grated', 'shredded', 'crushed', 'cubed', 'halved',
    'peeled', 'trimmed', 'beaten', 'mashed', 'thawed', 'drained', 'rinsed', 'fresh', 'ripe', 'frozen',
]);

/**
 * Base ingredients that turn a preceding dish noun into a MODIFIER: "sandwich bread"
 * and "pizza rolls" are groceries, not assembled meals, and both false-fired the
 * composite-drift detector on the 2026-07-25 warm run.
 */
const DISH_MODIFIER_BASES = new Set([
    'bread', 'buns', 'bun', 'roll', 'rolls', 'dough', 'crust', 'shell', 'shells', 'mix',
    'sauce', 'seasoning', 'dressing', 'spread', 'tortilla', 'tortillas', 'kit', 'base',
]);

/**
 * Dish nouns that mark a query as an ASSEMBLED item rather than an ingredient.
 *
 * 'burger' and 'cheeseburger' are DELIBERATELY EXCLUDED. Measured against the
 * 2026-07-25 warm run they produced only false positives — "boca veggie burger"
 * (71g/80 kcal) and "beyond meat burger patty" (71g/160 kcal) are correct picks of
 * a single patty, which is what a bare burger query usually means in this corpus.
 * A burger MEAL still qualifies through the conjunction path
 * ("restaurant burger and fries").
 */
const DISH_NOUNS = new Set([
    'burrito', 'bowl', 'sandwich', 'wrap', 'plate', 'platter', 'casserole', 'parfait',
    'salad', 'taco', 'pizza', 'soup', 'stew', 'curry',
    'combo', 'meal', 'sub', 'quesadilla', 'nachos', 'scramble', 'omelette', 'omelet',
    'lasagna', 'enchilada', 'sushi', 'poke', 'gyro', 'panini', 'melt', 'skillet',
    'pasta', 'noodles', 'stirfry',
]);

/** A dish portion below this many grams is suspiciously small for an assembled item. */
const COMPOSITE_PORTION_FLOOR_G = 200;

/** Preparation words whose disagreement between query and record is an identity defect. */
const PREP_WORDS = ['baked', 'fried', 'grilled', 'roasted', 'steamed', 'boiled', 'breaded', 'raw', 'smoked', 'poached'];

/** Explicitly-cooked markers: the query asked for the cooked form. */
const COOKED_RE = /\b(cooked|boiled|steamed|prepared|braised|simmered)\b/i;

/** Record-name markers for the DRY/uncooked form of a grain or legume. */
const DRY_RECORD_RE = /\b(dry|dried|uncooked|raw|rolled|instant|quick|steel[- ]?cut)\b/i;

/** Serving tiers that mean "no serving shape was resolved". */
const UNRESOLVED_SERVING_TIERS = new Set(['flat_100g_default', 'fs_per100g_fallback', 'count_unresolved_floor']);

/** kcal/100g above which the panel is physically impossible (pure fat is ~900). */
export const IMPOSSIBLE_KCAL_100G = 905;

/** Stages where the pick was SERVED to the user (and possibly cached) — quality matters. */
export const SERVED_STAGES: FunnelStage[] = ['saved', 'cache_hit', 'under_gate'];

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/['‘’ʼ`´]/g, '')
        .split(/[^a-z0-9%]+/)
        .filter(Boolean);
}

/** Identity-bearing tokens: no stopwords, no bare numbers, length >= 3. */
export function contentTokens(text: string): string[] {
    return tokenize(text).filter(t => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Query tokens the record fails to account for. Deliberately generous about
 * what counts as covered (substring either way, shared 4-char prefix) so that
 * "guac" is covered by "Guacamole" and "oat" by "Oats" — an uncovered token is
 * then strong evidence the record is a different thing, not a spelling variant.
 */
export function uncoveredTokens(rawLine: string, foodName?: string | null, brandName?: string | null): string[] {
    const haystack = `${foodName ?? ''} ${brandName ?? ''}`.toLowerCase().replace(/['‘’ʼ`´]/g, '');
    if (!haystack.trim()) return [];
    const hayTokens = tokenize(haystack);
    return contentTokens(rawLine).filter(t => {
        if (haystack.includes(t)) return false;
        return !hayTokens.some(h =>
            h.includes(t) || t.includes(h) ||
            (t.length >= 4 && h.length >= 4 && h.slice(0, 4) === t.slice(0, 4)));
    });
}

/**
 * Assembled-dish query: names a dish noun, or one of the multi-word dish idioms.
 *
 * A "joined by with/and" rule was tried and REMOVED: measured against the
 * 2026-07-25 warm run it classified flavour pairs as assemblies — "quest cookies
 * and cream protein bar" (60g/190 kcal, the exactly-right record) and
 * "quest bar cookies and cream" both false-fired, and no token-count floor
 * separated them from real two-part dishes. Composite drift is a claim about the
 * DISH the query names, so only dish vocabulary may make it.
 */
export function isCompositeQuery(rawLine: string): boolean {
    const toks = tokenize(rawLine);
    const dishIdx = toks.map((t, i) => (DISH_NOUNS.has(t) ? i : -1)).filter(i => i >= 0);
    // A dish noun immediately followed by a base ingredient is a modifier, not the dish.
    if (dishIdx.length > 0 && dishIdx.some(i => !DISH_MODIFIER_BASES.has(toks[i + 1] ?? ''))) return true;
    return /\bstir\s*fry\b|\bmac\s+(and|&|n)\s+cheese\b|\bbeans?\s+and\s+rice\b/i.test(rawLine);
}

function prepWordIn(text?: string | null): string | null {
    if (!text) return null;
    const toks = tokenize(text);
    return PREP_WORDS.find(p => toks.includes(p)) ?? null;
}

function atwaterKcal(row: FunnelRow): number | null {
    const { proteinPer100g: p, carbsPer100g: c, fatPer100g: f } = row;
    if (p == null || c == null || f == null) return null;
    return 4 * p + 4 * c + 9 * f;
}

/** Strip the stage prefix from a namespaced dropReason and re-normalize it. */
export function dropClassOf(stage: string | null | undefined, dropReason: string | null | undefined): string {
    if (!dropReason) return '';
    let rest = dropReason;
    if (stage && rest.startsWith(`${stage}:`)) rest = rest.slice(stage.length + 1);
    const normalized = normalizeClassId(rest);
    return normalized === 'unknown' && !rest ? '' : normalized;
}

/** Does the row's dropClass match any of the given patterns ('foo' exact, 'foo:*' prefix)? */
export function hasDropClass(row: FunnelRow, ...patterns: string[]): boolean {
    if (!row.dropClass) return false;
    return patterns.some(p => p.endsWith('*')
        ? row.dropClass.startsWith(p.slice(0, -1))
        : row.dropClass === p);
}

export function atStage(row: FunnelRow, stages: readonly FunnelStage[]): boolean {
    return row.funnelStage != null && stages.includes(row.funnelStage);
}

/**
 * Any quality dimension raised (finding 4). The healthy stage classes require the
 * ABSENCE of this, so "cache_hit / saved with no quality flag" is a claim the
 * detector actually verifies rather than one precedence quietly makes true. Every
 * flag below is owned by a class earlier in the registry, so tightening the healthy
 * classes cannot manufacture unclassified rows:
 *   degenerateMacros -> degenerate-macros-served
 *   brandDisagreement -> identity-brand-substituted
 *   uncoveredQueryTokens -> identity-query-token-dropped
 *   aiEstimated -> ai-estimated-backfill-served
 *   flat100gServing -> serving-flat-100g-fallthrough
 */
export function hasQualityFlag(row: FunnelRow): boolean {
    const q = row.quality;
    return q.degenerateMacros
        || q.flat100gServing
        || q.aiEstimated
        || q.brandDisagreement
        || q.uncoveredQueryTokens.length > 0;
}

/** Is this fast_path line actually just water/ice, or a food that merely mentions it? */
function isPureWaterQuery(rawLine: string): boolean {
    const WATER_WORDS = ['water', 'ice', 'iced', 'sparkling', 'tap', 'still'];
    return contentTokens(rawLine).every(t => WATER_WORDS.includes(t));
}

/**
 * Build a FunnelRow, deriving the cache key (finding 2) and the quality block
 * (finding 4). Both the CLI and the tests go through here, so a detector can
 * never be green in tests against a shape the CLI would never produce.
 */
export function makeFunnelRow(input: FunnelRowInput): FunnelRow {
    const stage = (input.funnelStage ?? null) as FunnelStage | null;
    const normalizedForm = input.normalizedForm ?? null;
    const cacheKey = canonicalizeCacheKey(normalizedForm ?? input.rawLine);

    const grams = input.grams ?? null;
    const kcal100 = input.kcalPer100g ?? null;
    const protein100 = input.proteinPer100g ?? null;
    const carbs100 = input.carbsPer100g ?? null;
    const fat100 = input.fatPer100g ?? null;
    const totalKcal = input.totalKcal ?? (kcal100 != null && grams != null ? (kcal100 * grams) / 100 : null);

    const macroPanelSeen = kcal100 != null;
    const panelAllZero = macroPanelSeen
        && kcal100 === 0 && (protein100 ?? 0) === 0 && (carbs100 ?? 0) === 0 && (fat100 ?? 0) === 0;
    // MappingEventLog carries no per-100g panel, so fall back to the billed total.
    const totalAllZero = !macroPanelSeen && totalKcal === 0 && (grams ?? 0) > 0;

    const source = input.source ?? null;
    const foodId = input.foodId ?? null;
    const servingTier = input.servingTier ?? null;

    const uncovered = uncoveredTokens(input.rawLine, input.foodName, input.brandName);
    const brand = (input.brandName ?? '').trim();
    const brandTokens = brand ? tokenize(brand) : [];
    const queryTokens = new Set(tokenize(input.rawLine));
    const brandShares = brandTokens.some(t => queryTokens.has(t));

    const quality: FunnelQuality = {
        degenerateMacros: panelAllZero || totalAllZero,
        zeroKcal: kcal100 === 0 || totalKcal === 0,
        flat100gServing: grams === 100
            && (servingTier == null || UNRESOLVED_SERVING_TIERS.has(servingTier)),
        aiEstimated: source === 'ai_estimated' || source === 'ai_generated' || !!foodId?.startsWith('ai_'),
        brandDisagreement: brand.length > 0 && !brandShares && uncovered.length > 0,
        uncoveredQueryTokens: uncovered,
    };

    return {
        rawLine: input.rawLine,
        normalizedForm,
        cacheKey,
        funnelStage: stage,
        dropReason: input.dropReason ?? null,
        dropClass: dropClassOf(stage, input.dropReason),
        confidence: input.confidence ?? null,
        grams,
        totalKcal,
        kcalPer100g: kcal100,
        proteinPer100g: protein100,
        carbsPer100g: carbs100,
        fatPer100g: fat100,
        source,
        foodId,
        foodName: input.foodName ?? null,
        brandName: input.brandName ?? null,
        servingTier,
        hadIncumbent: input.hadIncumbent ?? null,
        quality,
    };
}

// ---------------------------------------------------------------------------
// The registry — ORDERED. classifyRow returns the first match.
// ---------------------------------------------------------------------------

export const FAILURE_CLASSES: FailureClass[] = [
    // ===================== poisoned conversions (finding 4) =====================
    {
        id: 'degenerate-macros-served',
        stage: 'saved',
        alsoStages: ['cache_hit', 'under_gate'],
        title: 'All-zero macros served, and cached as a success',
        description:
            'Every macro reads zero, yet the line counted as a conversion. The funnel cannot express '
            + '"converted but poisoned" (finding 4): 38 such rows were logged as `saved` in the 2026-07-24 read, '
            + 'and 3,504 FatSecret records (18.8% of the lane) served 0 kcal. The zero-macros save gate exists '
            + '(validated-mapping-helpers.ts:585) but is SKIPPED entirely when grams is 0, because '
            + 'nutrientsPer100g is only passed when result.grams > 0 (map-ingredient-with-fallback.ts:2611). '
            + 'Root cause of the FatSecret 0-kcal family was a PERSIST RACE, not corruption — fixed on the box '
            + '(master 662d609) — so the pipeline half is done and this stays as (a) a regression tripwire and '
            + '(b) a data queue: rows already cached at 0 kcal must still be evicted or repointed.',
        fixKind: 'data',
        detector: row => atStage(row, SERVED_STAGES) && row.quality.degenerateMacros,
        exemplars: ['brazil nuts', 'buckwheat', 'cassava', 'chicken salad sandwich', 'cheesecake factory pasta', 'barbecue sauce'],
        exemplarRows: [
            { rawLine: 'brazil nuts', funnelStage: 'saved', source: 'fatsecret', foodName: 'Brazil Nuts', grams: 100, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 0.98 },
            { rawLine: 'chicken salad sandwich', funnelStage: 'saved', source: 'fatsecret', foodName: 'Chicken Salad Sandwich', brandName: 'Whole Foods Market', grams: 187, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 0.95 },
            { rawLine: 'cheesecake factory pasta', funnelStage: 'under_gate', dropReason: 'under_gate:close_match', source: 'fatsecret', foodName: 'Pasta Carbonara with Chicken', brandName: 'Cheesecake Factory', grams: 1110, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 0.74 },
            // The MappingEventLog shape: no per-100g panel, only a billed total.
            { rawLine: 'barbecue sauce', funnelStage: 'saved', source: 'fatsecret', foodName: 'Barbecue Sauce', grams: 15.6, totalKcal: 0, confidence: 0.95 },
        ],
        counterRows: [
            // A real zero-calorie food that short-circuits at the fast path: not this class.
            { rawLine: 'water', funnelStage: 'fast_path', dropReason: 'fast_path:zero_calorie', source: 'fatsecret', foodName: 'Water', grams: 237, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
            // A gate BLOCKED this write, so nothing was poisoned.
            { rawLine: 'boiled potatoes', funnelStage: 'save_rejected', dropReason: 'save_rejected:zero_macros', source: 'fatsecret', foodName: 'Potatoes (Flesh, with Salt, Boiled)', grams: 78, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
            { rawLine: 'clif bar', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'CLIF BAR', brandName: 'CLIF', grams: 68, kcalPer100g: 367.6, proteinPer100g: 14, carbsPer100g: 66, fatPer100g: 7 },
        ],
        goldenCaseIds: [],
        fixPRs: [139],
        status: 'fixing',
        discoveredAt: '2026-07-24',
    },
    {
        id: 'corrupt-panel-served',
        stage: 'cache_hit',
        alsoStages: ['saved', 'under_gate'],
        title: 'Per-serving panel (or kJ) served as per-100g',
        description:
            'The record hydrates to a physically impossible or scale-slipped panel and the user was billed from it: '
            + 'kcal/100g above ' + IMPOSSIBLE_KCAL_100G + ' (pure fat is ~900), or kcal more than 3x the Atwater '
            + 'estimate from its own macros — the kJ-value-in-the-kcal-field family (n-mq-27 lemon: 383 "kcal"/100g '
            + 'vs ~40 real). detect-corrupt-nutrition.ts + mark-corrupt-off.ts already marked 30,788 rows across 8 '
            + 'per-field classes (PRs #116, #119) and the Typesense index dropped 974,044 -> 950,128 accordingly, '
            + 'so a live hit here means either an unmarked row or a corrupt-exclusion escape. Data fix: mark and purge.',
        fixKind: 'data',
        detector: row => {
            if (!atStage(row, SERVED_STAGES)) return false;
            const kcal = row.kcalPer100g;
            if (kcal == null || kcal <= 0) return false;
            if (kcal > IMPOSSIBLE_KCAL_100G) return true;
            const atwater = atwaterKcal(row);
            return atwater != null && kcal >= 100 && kcal > 3 * atwater;
        },
        exemplars: ['lemon', 'carrot'],
        exemplarRows: [
            { rawLine: 'lemon', funnelStage: 'cache_hit', source: 'openfoodfacts', foodId: 'off_0840609112113', foodName: 'Lemon', grams: 58, kcalPer100g: 383, proteinPer100g: 0.4, carbsPer100g: 9.3, fatPer100g: 0.3, confidence: 0.95 },
            { rawLine: 'carrot', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'Carrots', grams: 61, kcalPer100g: 1720, proteinPer100g: 0.9, carbsPer100g: 9.6, fatPer100g: 0.2, confidence: 0.96 },
        ],
        counterRows: [
            // Pure fat: 900 kcal/100g is real, and exactly its own Atwater value.
            { rawLine: 'olive oil', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Olive oil', grams: 14, kcalPer100g: 900, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 },
            // Alcohol is invisible to Atwater but is not corrupt — and it is rejected by its own gate.
            { rawLine: 'martini', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:atwater:kcal_exceeds_computed', source: 'fatsecret', foodName: 'Martini', grams: 71, kcalPer100g: 226, proteinPer100g: 0, carbsPer100g: 0.1, fatPer100g: 0 },
        ],
        goldenCaseIds: ['n-mq-27'],
        fixPRs: [116, 119],
        status: 'closed',
        discoveredAt: '2026-07-21',
        dropClasses: [],
    },
    {
        id: 'identity-cooked-vs-dry',
        stage: 'cache_hit',
        alsoStages: ['saved', 'under_gate'],
        title: 'Explicitly-cooked query answered with the dry record',
        description:
            'The query says cooked/boiled/prepared and the record is the dry form, so the line bills ~3x the real '
            + 'calories at cache-worthy confidence. PR #104 shipped a softCooked volume preference that fixed the '
            + 'rice family ("white rice" -> 158g cooked), but n-cook-06 ("1 cup cooked oats") is CORPUS-BLOCKED: '
            + 'retrieval returns dry Rolled Oats at 361 kcal/100g because no cooked-oatmeal record exists in any '
            + 'lane. So the residual is an ingest problem, not a ranking one — do not send a fix-agent at the '
            + 'reranker for oats/quinoa.',
        fixKind: 'ingest',
        detector: row => {
            if (!atStage(row, SERVED_STAGES)) return false;
            if (!COOKED_RE.test(row.rawLine)) return false;
            if (row.foodName && DRY_RECORD_RE.test(row.foodName)) return true;
            return (row.kcalPer100g ?? 0) > 250;
        },
        exemplars: ['cooked oats', 'cooked white rice'],
        exemplarRows: [
            { rawLine: 'cooked oats', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Rolled Oats', grams: 40, kcalPer100g: 361, proteinPer100g: 13, carbsPer100g: 60, fatPer100g: 7, confidence: 0.9 },
            { rawLine: 'cooked white rice', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'White Rice', grams: 45, kcalPer100g: 365, proteinPer100g: 7, carbsPer100g: 80, fatPer100g: 1, confidence: 0.93 },
        ],
        counterRows: [
            // Boiled potato at a plausible cooked density: correct, and not a dry record.
            { rawLine: 'boiled potatoes', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Potatoes, Boiled', grams: 173, kcalPer100g: 87, proteinPer100g: 2, carbsPer100g: 20, fatPer100g: 0.1 },
            // No cooked marker in the query: the dry record is what was asked for.
            { rawLine: 'dry rolled oats', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Rolled Oats', grams: 40, kcalPer100g: 361, proteinPer100g: 13, carbsPer100g: 60, fatPer100g: 7 },
        ],
        goldenCaseIds: ['n-cook-06', 'n-cook-05'],
        fixPRs: [104],
        status: 'open',
        discoveredAt: '2026-07-19',
    },
    {
        id: 'identity-preparation-mismatch',
        stage: 'cache_hit',
        alsoStages: ['saved', 'under_gate'],
        title: 'Preparation contradicted by the record (baked query -> Fried record)',
        description:
            'Query and record both name a preparation and they disagree. Fat and calories move 30-80% between '
            + 'baked and fried, so this is a nutrition defect wearing a plausible name — and unlike the '
            + 'cooked-vs-dry class the tokens are all present, so no gate objects. Fires only when BOTH sides name '
            + 'a preparation, which keeps unmarked records (the common case) out.',
        fixKind: 'pipeline',
        detector: row => {
            if (!atStage(row, SERVED_STAGES)) return false;
            const q = prepWordIn(row.rawLine);
            const r = prepWordIn(row.foodName);
            return q != null && r != null && q !== r;
        },
        exemplars: ['baked chicken tenders'],
        exemplarRows: [
            { rawLine: 'baked chicken tenders', funnelStage: 'under_gate', dropReason: 'under_gate:close_match', source: 'openfoodfacts', foodName: 'Fried Chicken Tenders', grams: 112, kcalPer100g: 290, proteinPer100g: 18, carbsPer100g: 18, fatPer100g: 16, confidence: 0.76 },
        ],
        counterRows: [
            { rawLine: 'grilled chicken breast', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Grilled Chicken Breast', grams: 112, kcalPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 },
            { rawLine: 'chicken tenders', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Fried Chicken Tenders', grams: 112, kcalPer100g: 290, proteinPer100g: 18, carbsPer100g: 18, fatPer100g: 16 },
        ],
        goldenCaseIds: ['n-mq-21'],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-21',
    },
    {
        id: 'composite-component-drift',
        stage: 'under_gate',
        alsoStages: ['saved', 'cache_hit'],
        title: 'Composite dish answered with one of its components (5-10x undercount)',
        description:
            'The largest-magnitude defect class measured so far. An assembled-dish query resolves to a single '
            + 'component and bills a fraction of the meal while looking authoritative: "chipotle chicken burrito" '
            + 'measured live at 118g / 166 kcal for a ~1,100 kcal burrito, and "panera green goddess cobb salad" '
            + 'resolves to the DRESSING. The "half corpus gap" theory was WRONG (corrected 2026-07-25): 3 of the 4 '
            + 'assembled records are already in Postgres — the root cause is `filtered.slice(0, 10)` truncating the '
            + 'FatSecret lane before rerank. Fix RETRIEVAL, not a gate: a gate falls through to the AI backfill at '
            + '100g, which is the same undercount with worse provenance. n-mq-42 ("chipotle chicken burrito bowl", '
            + 'which resolves correctly at 350g/606 kcal) is the mandatory over-rejection tripwire — adding the '
            + 'single token "bowl" is the whole difference between 606 and 166 kcal. '
            + 'DETECTOR CALIBRATION (measured against the 2026-07-25 warm run): dish vocabulary in the query, '
            + 'PLUS grams < 200, PLUS total < 250 kcal. All three are needed. A "joined by with/and" marker '
            + 'flagged "quest cookies and cream protein bar" (60g/190 kcal, the exactly-right record) and no '
            + 'token-count floor separated flavour pairs from real dishes, so it was removed; "burger" as a dish '
            + 'noun flagged single patties ("boca veggie burger" 71g/80 kcal), so it was removed too. Even so this '
            + 'is a SUSPICION class: confirm each hit against the real dish before repointing anything.',
        fixKind: 'pipeline',
        detector: row => {
            if (!atStage(row, SERVED_STAGES)) return false;
            if (!isCompositeQuery(row.rawLine)) return false;
            // A bare dish word is a category query, not an assembly ("pasta" -> Pasta).
            if (contentTokens(row.rawLine).length < 2) return false;
            // Two independent magnitude tests, because either alone has a big false-positive
            // family: portion (a dish billed under 200 g) AND total energy (under 250 kcal).
            if (row.grams == null || row.grams >= COMPOSITE_PORTION_FLOOR_G) return false;
            const kcal = row.totalKcal;
            return kcal != null && kcal > 0 && kcal < 250;
        },
        exemplars: ['chipotle chicken burrito', 'qdoba chicken bowl', 'panera green goddess cobb salad', 'mac and cheese', "stouffer's mac and cheese"],
        exemplarRows: [
            { rawLine: 'chipotle chicken burrito', funnelStage: 'saved', source: 'fatsecret', foodName: 'Chicken Burrito Filling', brandName: 'Chipotle', grams: 118, totalKcal: 166, kcalPer100g: 141, proteinPer100g: 12, carbsPer100g: 8, fatPer100g: 7, confidence: 0.95 },
            { rawLine: "stouffer's mac and cheese", funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'MAC & CHEESE', brandName: "Stouffer's", grams: 28, kcalPer100g: 141.2, proteinPer100g: 5, carbsPer100g: 17, fatPer100g: 6, confidence: 0.95 },
            { rawLine: 'qdoba chicken bowl', funnelStage: 'under_gate', dropReason: 'under_gate:simple_rerank', source: 'openfoodfacts', foodName: 'Qdoba, Chicken Fajita Nachos', brandName: 'Qdoba', grams: 57, kcalPer100g: 25.7, proteinPer100g: 2, carbsPer100g: 3, fatPer100g: 1, confidence: 0.72 },
            { rawLine: 'panera green goddess cobb salad', funnelStage: 'under_gate', dropReason: 'under_gate:fallback_after_serving_failure', source: 'openfoodfacts', foodName: 'Panera Bread, Green Goddess Dressing, For Half Salads', brandName: 'Panera Bread', grams: 100, kcalPer100g: 57, proteinPer100g: 1, carbsPer100g: 3, fatPer100g: 5, confidence: 0.7 },
            { rawLine: 'mac and cheese', funnelStage: 'under_gate', dropReason: 'under_gate:single_candidate', source: 'fdc', foodName: 'vegetable enriched dry macaroni', grams: 28, kcalPer100g: 367, proteinPer100g: 13, carbsPer100g: 74, fatPer100g: 2, confidence: 0.66 },
        ],
        counterRows: [
            // n-mq-42: the assembled record wins and the magnitude is right. MUST NOT fire.
            { rawLine: 'chipotle chicken burrito bowl', funnelStage: 'saved', source: 'fatsecret', foodName: 'Chipotle Chicken Burrito Bowl', brandName: 'Chipotle', grams: 350, totalKcal: 606, kcalPer100g: 173, proteinPer100g: 10, carbsPer100g: 17, fatPer100g: 6, confidence: 0.96 },
            // A genuinely small two-token item: no dish noun, no conjunction.
            { rawLine: 'egg roll', funnelStage: 'saved', source: 'fatsecret', foodName: 'Egg Roll', grams: 64, totalKcal: 150, kcalPer100g: 234, proteinPer100g: 7, carbsPer100g: 24, fatPer100g: 6 },
            // An ingredient query, not a dish.
            { rawLine: 'spinach', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Spinach', grams: 100, kcalPer100g: 16.3, proteinPer100g: 2.9, carbsPer100g: 1.4, fatPer100g: 0.4 },
            // Measured false positive of the earlier, looser detector: one product whose name
            // merely contains "and", answered by the exactly-right record.
            { rawLine: 'quest cookies and cream protein bar', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'Quest Protein Bar Cookies and Cream', brandName: 'Quest', grams: 60, totalKcal: 190, kcalPer100g: 316.7, proteinPer100g: 33, carbsPer100g: 40, fatPer100g: 12 },
            // Measured false positive of 'burger' as a dish noun: a single patty, billed right.
            { rawLine: 'boca veggie burger', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'Original veggie burgers', brandName: 'Boca', grams: 71, totalKcal: 80, kcalPer100g: 112.7, proteinPer100g: 18, carbsPer100g: 8, fatPer100g: 1.4 },
            // Measured false positive: the dish noun is a MODIFIER on a grocery item.
            { rawLine: 'sandwich bread', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Sandwich Bread', brandName: 'My Essentials', grams: 30, totalKcal: 80, kcalPer100g: 267, proteinPer100g: 9, carbsPer100g: 49, fatPer100g: 3 },
            // Measured false positive: a bare category query, not an assembly.
            { rawLine: 'pasta', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Pasta', grams: 100, totalKcal: 46, kcalPer100g: 46, proteinPer100g: 2, carbsPer100g: 9, fatPer100g: 0.3 },
        ],
        goldenCaseIds: ['n-mq-38', 'n-mq-39', 'n-mq-40', 'n-mq-41', 'n-mq-42'],
        fixPRs: [147],
        status: 'open',
        discoveredAt: '2026-07-25',
    },
    {
        id: 'identity-brand-substituted',
        stage: 'under_gate',
        alsoStages: ['saved', 'cache_hit'],
        title: "Another brand's product answered a brand query",
        description:
            'The record carries a brand that shares no token with the query AND drops query tokens: "moes guac" '
            + '-> Morrisons Guacamole, "just bare chicken breast strips" -> Buckley Farms, '
            + '"noodles and company japanese pan noodles" -> Origami Catering. The save-time brand-mismatch gate '
            + '(validated-mapping-helpers.ts:497) stops these from being CACHED when the query names a brand '
            + 'decisively, but retrieval still SERVES them, which is exactly what n-mq-23 pins. Related shipped '
            + 'lesson: PR #150 — UNRELATED_INDICATORS read name+brandName, so every chain branded '
            + 'Grill/Kitchen/Cafe/Diner/Bistro/Restaurant had its entire catalogue rejected pre-rerank '
            + '(476 FatSecret records, 66-77 brands). Two plausible diagnoses were wrong before that one; only '
            + 'running gather+filter with debug:true settled it.',
        fixKind: 'pipeline',
        detector: row => atStage(row, SERVED_STAGES) && row.quality.brandDisagreement,
        exemplars: ["moe's guac", 'just bare chicken breast strips', 'noodles and company japanese pan noodles'],
        exemplarRows: [
            { rawLine: "moe's guac", funnelStage: 'under_gate', dropReason: 'under_gate:close_match', source: 'openfoodfacts', foodName: 'Guacamole', brandName: 'Morrisons', grams: 50, kcalPer100g: 118, proteinPer100g: 2, carbsPer100g: 3, fatPer100g: 11, confidence: 0.62 },
            { rawLine: 'just bare chicken breast strips', funnelStage: 'under_gate', dropReason: 'under_gate:simple_rerank', source: 'openfoodfacts', foodName: 'Boneless Skinless Chicken Breast Strips', brandName: 'Buckley Farms', grams: 84, kcalPer100g: 145, proteinPer100g: 23, carbsPer100g: 0, fatPer100g: 5, confidence: 0.72 },
            { rawLine: 'noodles and company japanese pan noodles', funnelStage: 'under_gate', dropReason: 'under_gate:close_match', source: 'openfoodfacts', foodName: 'Sweet Potato Noodles And Mushrooms', brandName: 'Origami Catering', grams: 284, kcalPer100g: 113, proteinPer100g: 3, carbsPer100g: 20, fatPer100g: 2, confidence: 0.72 },
        ],
        counterRows: [
            // Post really does make Honey Bunches of Oats: brand shares no token, but nothing is uncovered.
            { rawLine: 'honey bunches of oats', funnelStage: 'under_gate', dropReason: 'under_gate:close_match', source: 'openfoodfacts', foodName: 'Honey Bunches of Oats', brandName: 'Post', grams: 53, kcalPer100g: 433.9, proteinPer100g: 7, carbsPer100g: 85, fatPer100g: 5, confidence: 0.82 },
            { rawLine: 'clif bar', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'CLIF BAR', brandName: 'CLIF', grams: 68, kcalPer100g: 367.6, proteinPer100g: 14, carbsPer100g: 66, fatPer100g: 7 },
        ],
        goldenCaseIds: ['n-mq-23'],
        fixPRs: [110, 150],
        status: 'open',
        discoveredAt: '2026-07-20',
    },
    {
        id: 'identity-query-token-dropped',
        stage: 'under_gate',
        alsoStages: ['saved', 'cache_hit'],
        title: 'Record is missing a distinguishing query token',
        description:
            'A content token of the query appears nowhere in the record name or brand, generously scored '
            + '(substring either way, shared 4-char prefix), so an uncovered token means a different thing was '
            + 'served: "michelangelos chicken parmesan" -> a generic Chicken Parmesan, "sweetgreen spicy sabzi" -> '
            + 'Aloo Sabzi, "moes queso" -> Queso Asadero. This is the heuristic that replaces '
            + "under_gate's non-diagnostic dropReason (finding 3): simple_rerank / close_match / clear_winner each "
            + 'split ~50/50 good-vs-bad, and token coverage is what separates the halves. Candidate contributing '
            + 'cause on the retrieval side: three CRUDER local singularize() copies shadow the exported one '
            + '(filter-candidates.ts:113, gather-candidates.ts:847, map-ingredient-with-fallback.ts:435) and strip '
            + 'two chars from ANY -es, generating "oliv", "nood", "sauc", "juic" as query variants. '
            + 'MEASURED COMPOSITION (391-row warm sample, 2026-07-25): 35 distinct keys splitting into two '
            + 'sub-shapes that want DIFFERENT fixes. (a) SYNONYM GAPS — "courgette" -> Zucchini, "oatmeal" -> '
            + 'Rolled Oats, "coke zero" -> Coca-Cola ZERO SUGAR, "all-purpose flour" -> Plain flour: these belong '
            + 'to the alias/synonym layer, not to the reranker. (b) DROPPED NUTRITION-AFFECTING MODIFIERS — '
            + '"whole wheat bread" -> Wheat Bread, "whole milk" -> Milk, "ground beef" -> Beef, '
            + '"ghost vegan protein cinnamon roll" -> Vegan Protein: the record is a less specific product whose '
            + 'macros genuinely differ. Split the queue before assigning it.',
        fixKind: 'pipeline',
        detector: row => atStage(row, SERVED_STAGES) && row.quality.uncoveredQueryTokens.length > 0,
        exemplars: ["michelangelo's chicken parmesan", 'sweetgreen spicy sabzi', "moe's queso"],
        exemplarRows: [
            { rawLine: "michelangelo's chicken parmesan", funnelStage: 'under_gate', dropReason: 'under_gate:simple_rerank', source: 'fatsecret', foodName: 'Chicken Parmesan', grams: 159, kcalPer100g: 160, proteinPer100g: 14, carbsPer100g: 9, fatPer100g: 8, confidence: 0.73 },
            { rawLine: 'sweetgreen spicy sabzi', funnelStage: 'under_gate', dropReason: 'under_gate:close_match', source: 'fatsecret', foodName: 'Aloo Sabzi', grams: 250, kcalPer100g: 96, proteinPer100g: 2, carbsPer100g: 12, fatPer100g: 4, confidence: 0.71 },
            { rawLine: "moe's queso", funnelStage: 'under_gate', dropReason: 'under_gate:close_match', source: 'fatsecret', foodName: 'Queso Asadero', grams: 28.35, kcalPer100g: 356, proteinPer100g: 23, carbsPer100g: 3, fatPer100g: 28, confidence: 0.74 },
        ],
        counterRows: [
            { rawLine: 'ground beef 90/10', funnelStage: 'under_gate', dropReason: 'under_gate:simple_rerank', source: 'openfoodfacts', foodName: 'Ground Beef 85% Lean 15% Fat', brandName: "Rastelli's", grams: 112, kcalPer100g: 232, proteinPer100g: 19, carbsPer100g: 0, fatPer100g: 17, confidence: 0.78 },
            { rawLine: 'yellow bell pepper', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Yellow Bell Pepper', grams: 164, kcalPer100g: 27, proteinPer100g: 1, carbsPer100g: 6, fatPer100g: 0.2 },
        ],
        goldenCaseIds: ['n-mq-22'],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-24',
    },
    {
        id: 'ai-estimated-backfill-served',
        stage: 'under_gate',
        alsoStages: ['saved', 'cache_hit'],
        title: 'No corpus record answered — a fabricated AI estimate was served',
        description:
            'The line was billed from an AI-generated nutrition estimate rather than from any record in OFF, FDC '
            + 'or FatSecret, almost always at exactly 100 g. This is an INGEST signal, not a ranking signal: '
            + 'sending a rerank fix-agent at it changes nothing because there is nothing to rerank. It is also the '
            + 'reason a GATE is the wrong tool for composite-component drift — a gate that rejects the component '
            + 'pick falls through to exactly this path, i.e. the same undercount with worse provenance. Watch for '
            + 'the fabrication signature: "diet dr pepper" -> "Diet Dr. Black Pepper", "hamburger bun" -> '
            + '"85% Lean Beef Bun". Confidence sits in the 0.48-0.72 band, so these lines pre-date F1 with a null '
            + 'funnelStage in older warm files and land in under_gate once staged.',
        fixKind: 'ingest',
        detector: row => atStage(row, SERVED_STAGES) && row.quality.aiEstimated,
        exemplars: ['escarole', 'cherimoya', 'diet dr pepper'],
        exemplarRows: [
            { rawLine: 'escarole', funnelStage: 'under_gate', dropReason: 'under_gate:simple_rerank', source: 'ai_estimated', foodName: 'Escarole', grams: 100, kcalPer100g: 20, proteinPer100g: 1.6, carbsPer100g: 3.1, fatPer100g: 0.3, confidence: 0.61 },
            { rawLine: 'cherimoya', funnelStage: 'under_gate', dropReason: 'under_gate:simple_rerank', source: 'ai_estimated', foodName: 'Cherimoya', grams: 200, kcalPer100g: 90, proteinPer100g: 1.6, carbsPer100g: 22, fatPer100g: 0.7, confidence: 0.61 },
            { rawLine: 'diet dr pepper', funnelStage: 'under_gate', dropReason: 'under_gate:clear_winner', source: 'ai_estimated', foodName: 'Diet Dr. Black Pepper', grams: 100, kcalPer100g: 1, proteinPer100g: 0, carbsPer100g: 0.2, fatPer100g: 0, confidence: 0.64 },
        ],
        counterRows: [
            // A real record at 100 g is the serving class, not an ingest gap.
            { rawLine: 'spinach', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Spinach', grams: 100, kcalPer100g: 16.3, proteinPer100g: 2.9, carbsPer100g: 1.4, fatPer100g: 0.4 },
            // An abstention is no_match, a stage this class does not claim.
            { rawLine: 'chipotle chicken burrito', funnelStage: 'no_match', dropReason: 'no_match:confidence_too_low', source: 'ai_estimated', foodName: 'chipotle chicken burrito', grams: 0, totalKcal: 0, confidence: 0 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-25',
    },
    {
        id: 'serving-flat-100g-fallthrough',
        stage: 'cache_hit',
        alsoStages: ['saved', 'under_gate'],
        title: 'Serving resolution fell through to a flat 100 g',
        description:
            'grams landed on exactly 100 with no resolved serving tier — the record was found, its identity is '
            + 'fine, and then the portion was invented. Chain items are the worst affected because a restaurant '
            + 'item has no natural 100g portion. PR #145 removed the need for a volume anchor on the FatSecret '
            + "lane: FatSecret's synthetic `100 g` panel is an invertible WEIGHT ORACLE "
            + '(100 x serving_nutrient / panel_nutrient, median across nutrients, 98.1% within 5% on 24,579 '
            + 'known-weight rows). NOTE ON PRECISION: from warm JSONL, servingTier is not recorded, so this fires '
            + 'on grams === 100 alone and will include records whose label really is 100 g. Run classify-drops '
            + 'with --from-db to get the exact read from MappingEventLog.servingTier.',
        fixKind: 'pipeline',
        detector: row => atStage(row, SERVED_STAGES) && row.quality.flat100gServing,
        exemplars: ['spinach', 'dry pasta', 'ribeye', 'green beans'],
        exemplarRows: [
            { rawLine: 'spinach', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Spinach', grams: 100, kcalPer100g: 16.3, proteinPer100g: 2.9, carbsPer100g: 1.4, fatPer100g: 0.4 },
            { rawLine: 'dry pasta', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Dry Pasta', brandName: 'Rocco', grams: 100, kcalPer100g: 360, proteinPer100g: 12, carbsPer100g: 73, fatPer100g: 1.5 },
            { rawLine: 'ribeye', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Ribeye', grams: 100, kcalPer100g: 250, proteinPer100g: 24, carbsPer100g: 0, fatPer100g: 17 },
            { rawLine: 'green beans', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Green beans', grams: 100, kcalPer100g: 20, proteinPer100g: 1.8, carbsPer100g: 3, fatPer100g: 0.1 },
        ],
        counterRows: [
            // The user literally asked for 100 g: the weight tier resolved it.
            { rawLine: '100g chicken breast', funnelStage: 'cache_hit', servingTier: 'weight_unit', source: 'openfoodfacts', foodName: 'Chicken Breast', grams: 100, kcalPer100g: 116, proteinPer100g: 23, carbsPer100g: 0, fatPer100g: 2 },
            { rawLine: 'salmon fillet', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Salmon Fillet', brandName: 'Keohane Seafoods', grams: 120, kcalPer100g: 202, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13 },
        ],
        goldenCaseIds: ['n-serv-35'],
        fixPRs: [145, 112],
        status: 'fixing',
        discoveredAt: '2026-07-21',
    },

    // ===================== save_rejected: healthy / by-design =====================
    {
        id: 'gate-cross-source-margin',
        stage: 'save_rejected',
        title: 'Cross-source displacement margin held the incumbent (BY DESIGN)',
        description:
            'THE CLASS THAT MAKES THE RAW HISTOGRAM LIE (finding 1). 404 of 571 save_rejected events, 71% — and '
            + 'every one is correct behaviour. When an overwrite would move a key across source families '
            + '(off: <-> fs:), the incumbent already passed every save gate at ITS save time, so the challenger '
            + 'must be meaningfully more confident, not this run\'s rerank winner by a hair. The gate is nested '
            + 'inside `if (newTargetKey && existingTargetKey && newTargetKey !== existingTargetKey)` '
            + '(validated-mapping-helpers.ts:724): on a cold key `existing` is null and the block never runs, so '
            + 'it CANNOT fire without an incumbent. Verify with the hadIncumbent split — a hit with '
            + 'hadIncumbent=false would mean the gate or the join is broken, not that a defect was found. '
            + 'CAVEAT: newTargetKey/existingTargetKey read only offBarcode then fsId, never fdcId '
            + '(validated-mapping-helpers.ts:720-723), so fdc <-> off and fdc <-> fs displacements bypass this '
            + 'margin AND the serving-downgrade guard entirely. That latent gap is a pipeline defect, not part of '
            + 'this healthy class.',
        fixKind: 'healthy',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'cross_source_margin'),
        exemplars: ['brussels sprouts', 'red bell pepper', 'pretzels', 'frozen brussels sprouts'],
        exemplarRows: [
            { rawLine: 'brussels sprouts', normalizedForm: 'brussels sprouts', funnelStage: 'save_rejected', dropReason: 'save_rejected:cross_source_margin', source: 'fatsecret', foodName: 'Brussels Sprouts', grams: 19, kcalPer100g: 43, proteinPer100g: 3, carbsPer100g: 9, fatPer100g: 0.3, confidence: 0.98, hadIncumbent: true },
            { rawLine: 'pretzels', normalizedForm: 'pretzels', funnelStage: 'save_rejected', dropReason: 'save_rejected:cross_source_margin', source: 'fatsecret', foodName: 'Pretzels', grams: 3, kcalPer100g: 380, proteinPer100g: 10, carbsPer100g: 80, fatPer100g: 3, confidence: 0.98, hadIncumbent: true },
        ],
        counterRows: [
            { rawLine: 'dymatize casein', funnelStage: 'save_rejected', dropReason: 'save_rejected:sub_threshold_no_displace', source: 'openfoodfacts', foodName: 'Elite Casein', brandName: 'Dymatize nutrition', grams: 36, kcalPer100g: 361 },
            { rawLine: 'brussels sprouts', funnelStage: 'saved', source: 'fatsecret', foodName: 'Brussels Sprouts', grams: 19, kcalPer100g: 43, proteinPer100g: 3, carbsPer100g: 9, fatPer100g: 0.3 },
        ],
        goldenCaseIds: [],
        fixPRs: [132],
        status: 'by-design',
        discoveredAt: '2026-07-23',
        dropClasses: ['cross_source_margin'],
    },
    {
        id: 'gate-sub-threshold-no-displace',
        stage: 'save_rejected',
        title: 'Sub-threshold pick refused to overwrite an existing row (BY DESIGN)',
        description:
            'A pick admitted BELOW the 0.85 confidence gate may seed a NEW key but must never overwrite one: '
            + 'something the cascade was 78% sure of has no business evicting a row a more confident pick earned '
            + '(validated-mapping-helpers.ts:650, funnel fix 4). This is the entire blast-radius bound on '
            + 'conditional admission, and the guarantee the abandoned PR #143 lacked when it repointed the eight '
            + 'most-used generic keys in the cache. Like cross_source_margin it cannot fire on a cold key.',
        fixKind: 'healthy',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'sub_threshold_no_displace'),
        exemplars: ['dymatize casein'],
        exemplarRows: [
            { rawLine: 'dymatize casein', normalizedForm: 'dymatize casein', funnelStage: 'save_rejected', dropReason: 'save_rejected:sub_threshold_no_displace', source: 'openfoodfacts', foodName: 'Elite Casein', brandName: 'Dymatize nutrition', grams: 36, kcalPer100g: 361, proteinPer100g: 78, carbsPer100g: 6, fatPer100g: 2, confidence: 0.83, hadIncumbent: true },
        ],
        counterRows: [
            { rawLine: 'pretzels', funnelStage: 'save_rejected', dropReason: 'save_rejected:cross_source_margin', source: 'fatsecret', foodName: 'Pretzels', grams: 3, kcalPer100g: 380 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'by-design',
        discoveredAt: '2026-07-24',
        dropClasses: ['sub_threshold_no_displace'],
    },
    {
        id: 'gate-serving-downgrade',
        stage: 'save_rejected',
        title: 'Serving-downgrade guard kept the record that has serving shape (BY DESIGN)',
        description:
            'A record swap that would replace a row carrying real serving data (Red Bull with its 250ml can label) '
            + 'with one carrying none is refused, because every later serving-billed request would then fall to '
            + 'flat_100g_default (validated-mapping-helpers.ts:778, PR #110). A corrupt-marked incumbent forfeits '
            + 'the guard — otherwise the row zombies: every hit escapes, re-resolves, and lands back here. '
            + 'SAME CAVEAT AS cross_source_margin: fdc records are invisible to newTargetKey/existingTargetKey, so '
            + 'fdc displacements bypass this guard.',
        fixKind: 'healthy',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'serving_downgrade'),
        exemplars: ['pret a manger chicken caesar wrap'],
        exemplarRows: [
            { rawLine: 'pret a manger chicken caesar wrap', normalizedForm: 'pret a manger chicken caesar wrap', funnelStage: 'save_rejected', dropReason: 'save_rejected:serving_downgrade', source: 'fatsecret', foodName: 'Chicken Caesar Wrap', brandName: 'Market Sandwich', grams: 330, kcalPer100g: 200, proteinPer100g: 12, carbsPer100g: 20, fatPer100g: 8, confidence: 0.98, hadIncumbent: true },
        ],
        counterRows: [
            { rawLine: 'red bull', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'Red Bull', brandName: 'Red Bull', grams: 250, kcalPer100g: 45 },
        ],
        goldenCaseIds: [],
        fixPRs: [110],
        status: 'by-design',
        discoveredAt: '2026-07-20',
        dropClasses: ['serving_downgrade'],
    },
    {
        id: 'gate-bare-category-takeover',
        stage: 'save_rejected',
        title: 'Bare-category takeover blocked (BY DESIGN)',
        description:
            'A specific branded/multi-token query must not collapse into a bare generic category with no brand — '
            + '"met rx big 100" saving under the key "protein bar", "special k red berries" -> "Cereal", '
            + '"restaurant burger and fries" -> "Burger". Two such rows were caught and reverted post-apply in the '
            + '2026-07-21 big warm batch, which is why the gate exists (validated-mapping-helpers.ts:530). The gate '
            + 'is correct; the UPSTREAM issue it hints at — telemetry keys that are bare category terms — was '
            + 'closed separately as a key-granularity question, not a save bug.',
        fixKind: 'healthy',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'bare_category_takeover'),
        exemplars: ['restaurant burger and fries'],
        exemplarRows: [
            { rawLine: 'restaurant burger and fries', normalizedForm: 'burger and fries', funnelStage: 'save_rejected', dropReason: 'save_rejected:bare_category_takeover', source: 'openfoodfacts', foodName: 'Burger', grams: 100, kcalPer100g: 212, proteinPer100g: 14, carbsPer100g: 18, fatPer100g: 10, confidence: 0.98 },
        ],
        counterRows: [
            { rawLine: 'mcdonalds big mac', funnelStage: 'saved', source: 'fatsecret', foodName: 'Big Mac', brandName: "McDonald's", grams: 219, kcalPer100g: 257 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'by-design',
        discoveredAt: '2026-07-21',
        dropClasses: ['bare_category_takeover'],
    },
    {
        id: 'gate-zero-macros',
        stage: 'save_rejected',
        title: 'Degenerate-nutrition gate refused to cache an all-zero pick (BY DESIGN)',
        description:
            'An all-zero panel passes every bounds check (nothing negative, macro sum 0, Atwater compares 0 to 0), '
            + 'so before this gate such picks sailed through at confidence 0.95-1.00 and pinned a key to a record '
            + 'that hydrates to 0 kcal forever (validated-mapping-helpers.ts:585). Declining to CACHE costs only a '
            + 'repeat lookup — the request is served either way. CAVEAT (latent gap): the gate is skipped entirely '
            + 'when grams is 0, because nutrientsPer100g is only passed when result.grams > 0 '
            + '(map-ingredient-with-fallback.ts:2611-2616). Zero live events were observed in the 2026-07-25 read; '
            + 'the 38 poisoned rows that DID get cached are class `degenerate-macros-served`.',
        fixKind: 'healthy',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'zero_macros'),
        exemplars: ['boiled potatoes', 'ben and jerrys cherry garcia'],
        exemplarRows: [
            { rawLine: 'boiled potatoes', normalizedForm: 'boiled potatoes', funnelStage: 'save_rejected', dropReason: 'save_rejected:zero_macros', source: 'fatsecret', foodName: 'Potatoes (Flesh, with Salt, Boiled)', grams: 78, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 0.95 },
            { rawLine: 'ben and jerrys cherry garcia', normalizedForm: 'ben and jerrys cherry garcia', funnelStage: 'save_rejected', dropReason: 'save_rejected:zero_macros', source: 'fatsecret', foodName: 'Cherry Garcia Ice Cream - Mini Cups', brandName: "Ben & Jerry's", grams: 130, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 0.98 },
        ],
        counterRows: [
            { rawLine: 'brazil nuts', funnelStage: 'saved', source: 'fatsecret', foodName: 'Brazil Nuts', grams: 100, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'by-design',
        discoveredAt: '2026-07-24',
        dropClasses: ['zero_macros'],
    },

    // ===================== save_rejected: real defects behind a correct gate =====================
    {
        id: 'gate-human-row-conflated',
        stage: 'save_rejected',
        title: "save_rejected:human_row CONFLATES a successful usage-bump with a rejection",
        description:
            'INSTRUMENTATION DEFECT, not a mapping defect. markSaveRejected is called OUTSIDE the if/else at '
            + 'validated-mapping-helpers.ts:684-704, so when a fresh resolution lands on the SAME record as a '
            + 'human-triage row, the usedCount/lastUsedAt bump succeeds and the line is STILL reported as a '
            + 'rejection. Only the different-record branch is a real skip. Any conversion-rate computed from this '
            + 'class is wrong in the pessimistic direction, and the two populations need separate class IDs before '
            + 'the number means anything. There are 197+ pinned human-triage rows (mayonnaise -> off_9348905001434, '
            + 'the m&ms and saltine-sleeve pins from the 2026-07-24 revert), so the bump path is well travelled.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'human_row'),
        exemplars: ['mayonnaise', 'saltine crackers'],
        exemplarRows: [
            { rawLine: 'mayonnaise', normalizedForm: 'mayonnaise', funnelStage: 'save_rejected', dropReason: 'save_rejected:human_row', source: 'openfoodfacts', foodId: 'off_9348905001434', foodName: 'Mayonnaise', grams: 15, kcalPer100g: 680, proteinPer100g: 1, carbsPer100g: 2, fatPer100g: 75, confidence: 0.95, hadIncumbent: true },
            { rawLine: 'saltine crackers', normalizedForm: 'saltine crackers', funnelStage: 'save_rejected', dropReason: 'save_rejected:human_row', source: 'openfoodfacts', foodName: 'Saltine Crackers', grams: 16, kcalPer100g: 421, proteinPer100g: 9, carbsPer100g: 72, fatPer100g: 10, confidence: 0.9, hadIncumbent: true },
        ],
        counterRows: [
            { rawLine: 'mayonnaise', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Mayonnaise', grams: 15, kcalPer100g: 680, proteinPer100g: 1, carbsPer100g: 2, fatPer100g: 75 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-25',
        dropClasses: ['human_row'],
    },
    {
        id: 'gate-brand-mismatch-pick',
        stage: 'save_rejected',
        title: 'Brand-mismatch gate fired — a wrong-brand record still SERVED the user',
        description:
            'The gate is doing its job (the pick is not cached), but a save_rejected:brand_mismatch event is '
            + 'positive evidence of a RETRIEVAL defect: the query named a brand decisively and the winning record '
            + 'carries it in neither its brand field nor its name, and that record was still served for this '
            + 'request. "cream of wheat" -> First Street "Wheat", "just bare chicken nuggets" -> an unbranded '
            + 'Chicken Nuggets. Fix belongs in retrieval/rerank; the historical marker is "protein ryse" -> '
            + '"Protein Rice" (ryse fuzzy-matching rice), whose SAVE path was closed by PR #110 while the '
            + 'RETRIEVAL gap stayed open as n-mq-23.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'brand_mismatch'),
        exemplars: ['cream of wheat', 'shredded wheat', 'just bare chicken nuggets', 'real good foods chicken breast strips'],
        exemplarRows: [
            { rawLine: 'cream of wheat', normalizedForm: 'cream of wheat', funnelStage: 'save_rejected', dropReason: 'save_rejected:brand_mismatch', source: 'openfoodfacts', foodName: 'Wheat', brandName: 'First Street', grams: 30, kcalPer100g: 250, proteinPer100g: 8, carbsPer100g: 50, fatPer100g: 1, confidence: 0.98 },
            { rawLine: 'just bare chicken nuggets', normalizedForm: 'just bare chicken nuggets', funnelStage: 'save_rejected', dropReason: 'save_rejected:brand_mismatch', source: 'fatsecret', foodName: 'Chicken Nuggets', grams: 16, kcalPer100g: 297, proteinPer100g: 15, carbsPer100g: 17, fatPer100g: 18, confidence: 0.98 },
        ],
        counterRows: [
            { rawLine: 'nutzo seven nut butter', funnelStage: 'save_rejected', dropReason: 'save_rejected:core_token_mismatch', source: 'fatsecret', foodName: 'Seven and Seven', grams: 32, kcalPer100g: 89 },
        ],
        goldenCaseIds: ['n-mq-23'],
        fixPRs: [110],
        status: 'open',
        discoveredAt: '2026-07-20',
        dropClasses: ['brand_mismatch'],
    },
    {
        id: 'gate-core-token-mismatch-pick',
        stage: 'save_rejected',
        title: 'Core-token gate fired — the winning record is a different food',
        description:
            'The gate refuses to cache a pick whose foodName is missing core tokens of the cache key '
            + '(validated-mapping-helpers.ts:553), with a brand rescue for flavour-spelling cases '
            + '("cinnamon" vs "Cinnabon"). When it fires unrescued the rerank genuinely picked a different food '
            + 'and served it: "nutzo seven nut butter" -> "Seven and Seven" (a cocktail), '
            + '"restaurant orange chicken" -> "BJ\'s Orange Juice", "scrambled eggs with cheese" -> '
            + '"homemade made with egg cooked pasta". Every one of those left the gate at confidence 0.87-1.00, so '
            + 'the confidence signal is not the problem — retrieval and rerank are.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'core_token_mismatch'),
        exemplars: ['nutzo seven nut butter', 'restaurant orange chicken', 'scrambled eggs with cheese'],
        exemplarRows: [
            { rawLine: 'nutzo seven nut butter', normalizedForm: 'nutzo seven nut butter', funnelStage: 'save_rejected', dropReason: 'save_rejected:core_token_mismatch', source: 'fatsecret', foodName: 'Seven and Seven', grams: 32, kcalPer100g: 89, proteinPer100g: 0, carbsPer100g: 8, fatPer100g: 0, confidence: 0.87 },
            { rawLine: 'restaurant orange chicken', normalizedForm: 'orange chicken', funnelStage: 'save_rejected', dropReason: 'save_rejected:core_token_mismatch', source: 'openfoodfacts', foodName: "BJ's Restaurant & Brewhouse, Orange Juice", brandName: "BJ's Restaurant & Brewhouse", grams: 100, kcalPer100g: 124, proteinPer100g: 1, carbsPer100g: 30, fatPer100g: 0, confidence: 1 },
            { rawLine: 'scrambled eggs with cheese', normalizedForm: 'scrambled eggs with cheese', funnelStage: 'save_rejected', dropReason: 'save_rejected:core_token_mismatch', source: 'fdc', foodName: 'homemade made with egg cooked pasta', grams: 28, kcalPer100g: 130, proteinPer100g: 6, carbsPer100g: 20, fatPer100g: 2, confidence: 1 },
        ],
        counterRows: [
            { rawLine: 'cream of wheat', funnelStage: 'save_rejected', dropReason: 'save_rejected:brand_mismatch', source: 'openfoodfacts', foodName: 'Wheat', brandName: 'First Street', grams: 30, kcalPer100g: 250 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-24',
        dropClasses: ['core_token_mismatch'],
    },
    {
        id: 'gate-produce-classifier-hijack',
        stage: 'save_rejected',
        title: 'Plausibility classifier called a manufactured food "fresh produce"',
        description:
            'The single largest macro-plausibility class (17 events / 15 distinct keys) and it is a CLASSIFIER bug, '
            + 'not a bad pick. A produce word anywhere in the query routes the whole item into the fresh-produce '
            + 'band, so correct branded records get rejected for having branded-food calories: '
            + '"quaker instant oatmeal APPLE cinnamon" (372 kcal/100g), "grape NUTS" (345), '
            + '"qdoba cilantro LIME rice" (155). The floor direction has the same bug: '
            + '"la croix pamplemousse" -> Spindrift Grapefruit Sparkling Water at 4.8 kcal/100g tripped '
            + 'floor:produce_kcal_below. Both directions belong to one fix: classify on the RECORD\'s identity, '
            + 'not on the presence of a produce token in the query.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'save_rejected'
            && hasDropClass(row, 'implausible_macros:category:fresh_produce_kcal_over', 'implausible_macros:floor:produce_kcal_below'),
        exemplars: ['quaker instant oatmeal apple cinnamon', 'grape nuts', 'qdoba cilantro lime rice', 'la croix pamplemousse'],
        exemplarRows: [
            { rawLine: 'quaker instant oatmeal apple cinnamon', normalizedForm: 'quaker instant oatmeal apple cinnamon', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:category:fresh_produce_kcal_over', source: 'openfoodfacts', foodName: 'Quaker instant oatmeal apples and cinnamon', brandName: 'Quaker', grams: 2.5, kcalPer100g: 372, proteinPer100g: 9, carbsPer100g: 68, fatPer100g: 7, confidence: 0.95 },
            { rawLine: 'grape nuts', normalizedForm: 'grape nuts', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:category:fresh_produce_kcal_over', source: 'openfoodfacts', foodName: 'Grape nuts', brandName: 'Post', grams: 58, kcalPer100g: 344.8, proteinPer100g: 10, carbsPer100g: 76, fatPer100g: 2, confidence: 0.93 },
            { rawLine: 'la croix pamplemousse', normalizedForm: 'la croix pamplemousse', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:floor:produce_kcal_below', source: 'openfoodfacts', foodName: 'Grapefruit Sparkling Water', brandName: 'Spindrift', grams: 355, kcalPer100g: 4.8, proteinPer100g: 0, carbsPer100g: 1, fatPer100g: 0, confidence: 0.81 },
        ],
        counterRows: [
            { rawLine: 'shrimp scampi', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:category:lean_cut_protein_below_floor', source: 'openfoodfacts', foodName: 'Shrimp scampi', grams: 85, kcalPer100g: 222.2 },
            { rawLine: 'banana', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'Banana', grams: 118, kcalPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3 },
        ],
        goldenCaseIds: [],
        fixPRs: [109],
        status: 'open',
        discoveredAt: '2026-07-25',
        dropClasses: ['implausible_macros:category:fresh_produce_kcal_over', 'implausible_macros:floor:produce_kcal_below'],
    },
    {
        id: 'gate-lean-protein-floor-on-composite',
        stage: 'save_rejected',
        title: 'Lean-cut protein floor applied to a diluted composite dish',
        description:
            'Sibling of the produce hijack: naming a lean cut puts the item in the lean-protein band, but the '
            + 'record is a DISH built from that cut and diluted with pasta, butter or cream, so its protein '
            + 'legitimately sits below the floor. "shrimp scampi" (both the generic and the Red Lobster record), '
            + '"shrimp stir fry" and "tuna casserole" are all rejected this way. Fix: the category classifier must '
            + 'see composite markers (scampi, casserole, stir fry, alfredo) and decline the lean-cut band.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'save_rejected'
            && hasDropClass(row, 'implausible_macros:category:lean_cut_protein_below_floor'),
        exemplars: ['shrimp scampi', 'red lobster shrimp scampi', 'shrimp stir fry', 'tuna casserole'],
        exemplarRows: [
            { rawLine: 'shrimp scampi', normalizedForm: 'shrimp scampi', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:category:lean_cut_protein_below_floor', source: 'openfoodfacts', foodName: 'Shrimp scampi', grams: 85, kcalPer100g: 222.2, proteinPer100g: 11, carbsPer100g: 12, fatPer100g: 14, confidence: 0.98 },
            { rawLine: 'tuna casserole', normalizedForm: 'tuna casserole', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:category:lean_cut_protein_below_floor', source: 'fatsecret', foodName: 'Tuna Casserole', brandName: 'NutriSystem', grams: 227, kcalPer100g: 79, proteinPer100g: 6, carbsPer100g: 10, fatPer100g: 2, confidence: 0.98 },
        ],
        counterRows: [
            { rawLine: 'grape nuts', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:category:fresh_produce_kcal_over', source: 'openfoodfacts', foodName: 'Grape nuts', brandName: 'Post', grams: 58, kcalPer100g: 344.8 },
        ],
        goldenCaseIds: [],
        fixPRs: [109],
        status: 'open',
        discoveredAt: '2026-07-25',
        dropClasses: ['implausible_macros:category:lean_cut_protein_below_floor'],
    },
    {
        id: 'gate-atwater-no-ethanol',
        stage: 'save_rejected',
        title: 'Atwater check has no ethanol term, so cocktails look impossible',
        description:
            'Atwater computes 4P + 4C + 9F. Ethanol is 7 kcal/g and appears in none of those, so a spirit-based '
            + 'record computes to ~0-2 kcal from its macros while its label says 226 kcal/100g, and '
            + 'atwater:kcal_exceeds_computed rejects a perfectly good pick ("martini"). '
            + 'detect-corrupt-nutrition.ts already carries an ALCOHOL_PATTERN exemption for exactly this reason; '
            + 'the save-time gate does not. Small, contained pipeline fix.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'save_rejected'
            && hasDropClass(row, 'implausible_macros:atwater:kcal_exceeds_computed', 'implausible_macros:atwater:*'),
        exemplars: ['martini'],
        exemplarRows: [
            { rawLine: 'martini', normalizedForm: 'martini', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:atwater:kcal_exceeds_computed', source: 'fatsecret', foodName: 'Martini', grams: 71, kcalPer100g: 226, proteinPer100g: 0, carbsPer100g: 0.1, fatPer100g: 0, confidence: 0.98 },
        ],
        counterRows: [
            { rawLine: 'beef stew', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:estimate:kcal_vs_expected', source: 'openfoodfacts', foodName: 'Beef stew', brandName: 'The food Life', grams: 350, kcalPer100g: 20 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-25',
        dropClasses: ['implausible_macros:atwater:*'],
    },
    {
        id: 'gate-ai-estimate-disagreement',
        stage: 'save_rejected',
        title: "AI expectation disagreed with the record's panel",
        description:
            'The save gate compares the record against an AI expected-nutrition estimate and refuses the write '
            + 'when they diverge. In every observed case the RECORD was the wrong one: "beef stew" at 20 kcal/100g '
            + 'and "oxtail" (Knorr Oxtail Soup) at 26 kcal/100g are per-serving-diluted or mis-scaled panels, and '
            + '"mofongo" at 500 kcal/100g with protein over expectation is a corrupt row. So route these to the '
            + 'corrupt-mark / repoint queue rather than to the gate. Watch the inverse though: an over-tight '
            + 'expectation would land here too, and simple queries deliberately have NO AI estimate (PR #109 '
            + 'deterministic floors), so a hit means the estimate really was produced.',
        fixKind: 'data',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'implausible_macros:estimate:*'),
        exemplars: ['beef stew', 'oxtail', 'mofongo'],
        exemplarRows: [
            { rawLine: 'beef stew', normalizedForm: 'beef stew', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:estimate:kcal_vs_expected', source: 'openfoodfacts', foodName: 'Beef stew', brandName: 'The food Life', grams: 350, kcalPer100g: 20, proteinPer100g: 2, carbsPer100g: 2, fatPer100g: 0.5, confidence: 1 },
            { rawLine: 'mofongo', normalizedForm: 'mofongo', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:estimate:protein_over_expected', source: 'openfoodfacts', foodName: 'Mofongo', grams: 100, kcalPer100g: 500, proteinPer100g: 30, carbsPer100g: 40, fatPer100g: 25, confidence: 0.98 },
        ],
        counterRows: [
            { rawLine: 'martini', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:atwater:kcal_exceeds_computed', source: 'fatsecret', foodName: 'Martini', grams: 71, kcalPer100g: 226 },
        ],
        goldenCaseIds: [],
        fixPRs: [109],
        status: 'open',
        discoveredAt: '2026-07-25',
        dropClasses: ['implausible_macros:estimate:*'],
    },
    {
        id: 'gate-macro-plausibility-residual',
        stage: 'save_rejected',
        title: 'RESIDUAL: an unnamed macro-plausibility sub-class fired',
        description:
            'Catch-all for save_rejected:implausible_macros:* sub-classes that do not yet have their own entry — '
            + 'the gate has bound, floor, category and atwater families and interpolates live measurements into '
            + 'its reason IDs, so new sub-classes appear whenever a band is added. Hits here are FRONTIER: read '
            + 'the raw dropReason from the classify-drops report and promote any recurring shape to its own class. '
            + 'Named historical members of this family: "granulated sugar" cached at 16 kcal/100g and "blueberry" '
            + 'at 8.7 g protein, both from the 2026-07-20 parity sweep, which is why the gate was built (PR #109).',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'save_rejected' && hasDropClass(row, 'implausible_macros:*'),
        exemplars: ['granulated sugar', 'blueberry'],
        exemplarRows: [
            { rawLine: 'granulated sugar', normalizedForm: 'granulated sugar', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:bound:kcal_below_floor', source: 'openfoodfacts', foodName: 'Granulated Sugar', grams: 4, kcalPer100g: 16, proteinPer100g: 0, carbsPer100g: 4, fatPer100g: 0, confidence: 0.95 },
            { rawLine: 'blueberry', normalizedForm: 'blueberry', funnelStage: 'save_rejected', dropReason: 'save_rejected:implausible_macros:bound:protein_over_ceiling', source: 'openfoodfacts', foodName: 'Blueberry', grams: 148, kcalPer100g: 57, proteinPer100g: 8.7, carbsPer100g: 14, fatPer100g: 0.3, confidence: 0.95 },
        ],
        counterRows: [
            { rawLine: 'grape nuts', funnelStage: 'save_rejected', dropReason: 'save_rejected:brand_mismatch', source: 'openfoodfacts', foodName: 'Grape nuts', brandName: 'Post', grams: 58, kcalPer100g: 344.8 },
        ],
        goldenCaseIds: [],
        fixPRs: [109],
        status: 'open',
        discoveredAt: '2026-07-25',
        dropClasses: ['implausible_macros:*'],
        residual: true,
    },
    {
        id: 'save-rejected-residual',
        stage: 'save_rejected',
        title: 'RESIDUAL: an unrecognised save gate fired',
        description:
            'Any save_rejected event whose gate has no class above. Ten markSaveRejected call sites exist today '
            + '(validated-mapping-helpers.ts:497-806) and all ten are covered, so a hit here means a NEW gate '
            + 'shipped without a registry entry. Treat it as frontier and add the class in the same PR as the gate.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'save_rejected',
        exemplars: ['<any query whose save gate has no class yet>'],
        exemplarRows: [
            { rawLine: '<any query whose save gate has no class yet>', funnelStage: 'save_rejected', dropReason: 'save_rejected:some_new_gate', source: 'fatsecret', foodName: 'Something', grams: 50, kcalPer100g: 200, proteinPer100g: 5, carbsPer100g: 20, fatPer100g: 5 },
        ],
        counterRows: [
            { rawLine: 'ground turkey', funnelStage: 'under_gate', dropReason: 'under_gate:clear_winner', source: 'openfoodfacts', foodName: '85% lean ground turkey', grams: 112, kcalPer100g: 214 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-25',
        residual: true,
    },

    // ===================== under_gate residual (finding 3) =====================
    {
        id: 'under-gate-ranking-residual',
        stage: 'under_gate',
        title: 'RESIDUAL: pick served at 0.3-0.85 confidence, never offered to the cache',
        description:
            "THE SILENT CLASS, and the population cache-warming exists to convert. Its dropReason is NOT "
            + 'DIAGNOSTIC (finding 3): F1 tags under_gate with the confidence gate\'s selectionReason — which path '
            + 'SELECTED the pick, not why confidence was low (map-ingredient-with-fallback.ts:2749) — and the '
            + '2026-07-24 read found simple_rerank / close_match / clear_winner each split ~50/50 good-vs-bad. '
            + 'Rows that reach this residual have already failed every dossier heuristic above (degenerate macros, '
            + 'corrupt panel, cooked/prep/composite/brand/token identity, flat-100g), so what is left is the '
            + 'genuine near-miss population: plausible picks that the cascade merely was not confident about '
            + '("ground beef 90/10" -> an 85/15 record, "honey bunches of oats" at 0.82, '
            + '"panera bacon turkey bravo sandwich" at 0.71 with the right record and 435g). Convert these by '
            + 'raising retrieval quality or by conditional admission — do NOT relax the 0.85 gate globally.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'under_gate',
        exemplars: ['ground beef 90/10', 'ground turkey', 'honey bunches of oats', 'panera bacon turkey bravo sandwich'],
        exemplarRows: [
            { rawLine: 'ground beef 90/10', normalizedForm: 'ground beef 90/10', funnelStage: 'under_gate', dropReason: 'under_gate:simple_rerank', source: 'openfoodfacts', foodName: 'Ground Beef 85% Lean 15% Fat', brandName: "Rastelli's", grams: 112, kcalPer100g: 232, proteinPer100g: 19, carbsPer100g: 0, fatPer100g: 17, confidence: 0.78 },
            { rawLine: 'ground turkey', normalizedForm: 'ground turkey', funnelStage: 'under_gate', dropReason: 'under_gate:clear_winner', source: 'openfoodfacts', foodName: '85% lean ground turkey', grams: 112, kcalPer100g: 214, proteinPer100g: 17, carbsPer100g: 0, fatPer100g: 15, confidence: 0.83 },
            { rawLine: 'honey bunches of oats', normalizedForm: 'honey bunches of oats', funnelStage: 'under_gate', dropReason: 'under_gate:close_match', source: 'openfoodfacts', foodName: 'Honey Bunches of Oats', brandName: 'Post', grams: 53, kcalPer100g: 433.9, proteinPer100g: 7, carbsPer100g: 85, fatPer100g: 5, confidence: 0.82 },
            { rawLine: 'panera bacon turkey bravo sandwich', normalizedForm: 'panera bacon turkey bravo sandwich', funnelStage: 'under_gate', dropReason: 'under_gate:close_match', source: 'fatsecret', foodName: 'Bacon Turkey Bravo Sandwich on Tomato Basil - Whole', brandName: 'Panera Bread', grams: 435, kcalPer100g: 200, proteinPer100g: 12, carbsPer100g: 20, fatPer100g: 8, confidence: 0.71 },
        ],
        counterRows: [
            { rawLine: 'clif bar', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'CLIF BAR', brandName: 'CLIF', grams: 68, kcalPer100g: 367.6, proteinPer100g: 14, carbsPer100g: 66, fatPer100g: 7 },
            { rawLine: 'pretzels', funnelStage: 'save_rejected', dropReason: 'save_rejected:cross_source_margin', source: 'fatsecret', foodName: 'Pretzels', grams: 3, kcalPer100g: 380 },
        ],
        goldenCaseIds: [],
        fixPRs: [139],
        status: 'open',
        discoveredAt: '2026-07-24',
        dropClasses: ['close_match', 'clear_winner', 'simple_rerank', 'fallback_after_serving_failure', 'single_candidate'],
        residual: true,
    },

    // ===================== retrieval / corpus stages =====================
    {
        id: 'venue-brand-blackout-tripwire',
        stage: 'all_filtered',
        alsoStages: ['no_candidates'],
        title: 'TRIPWIRE: a venue-branded query lost its whole candidate pool',
        description:
            'Regression tripwire for the shipped venue-brand blackout (PR #150, 2026-07-25). '
            + 'UNRELATED_INDICATORS was tested against name + brandName, so every chain branded Grill / Kitchen / '
            + 'Cafe / Diner / Bistro / Restaurant had its ENTIRE catalogue rejected pre-rerank: 476 FatSecret '
            + 'records across 66-77 brands, invisible because FilterResult.reason is a blanket label rather than '
            + 'the cause. Two plausible diagnoses were wrong before running gather+filter with debug:true settled '
            + 'it. This is a QUERY-SIDE proxy (venue word in the query, whole pool filtered), so it should never '
            + 'fire post-#150; a hit means a filter regression, and the diagnosis method is the debug:true trace, '
            + 'not the reason string.',
        fixKind: 'pipeline',
        detector: row => atStage(row, ['all_filtered', 'no_candidates'])
            && /\b(grill|grille|kitchen|cafe|caf|diner|bistro|restaurant|brewhouse|tavern|creamery)\b/i.test(row.rawLine),
        exemplars: ['restaurant orange chicken', 'restaurant shrimp scampi'],
        exemplarRows: [
            { rawLine: 'restaurant orange chicken', normalizedForm: 'orange chicken', funnelStage: 'all_filtered', dropReason: 'all_filtered:no_candidate_survived_filters', source: 'ai_estimated', foodName: 'Orange Chicken', grams: 100, kcalPer100g: 250, proteinPer100g: 12, carbsPer100g: 30, fatPer100g: 9, confidence: 0.6 },
            { rawLine: 'restaurant shrimp scampi', normalizedForm: 'shrimp scampi', funnelStage: 'all_filtered', dropReason: 'all_filtered:no_candidate_survived_filters', source: 'ai_estimated', foodName: 'Shrimp Scampi', grams: 100, kcalPer100g: 220, proteinPer100g: 12, carbsPer100g: 10, fatPer100g: 14, confidence: 0.62 },
        ],
        counterRows: [
            { rawLine: 'qdoba steak bowl', funnelStage: 'all_filtered', dropReason: 'all_filtered:no_candidate_survived_filters', source: 'ai_estimated', foodName: 'Qdoba Steak Bowl', grams: 100, kcalPer100g: 250 },
            { rawLine: 'restaurant orange chicken', funnelStage: 'save_rejected', dropReason: 'save_rejected:core_token_mismatch', source: 'openfoodfacts', foodName: "BJ's Restaurant & Brewhouse, Orange Juice", brandName: "BJ's Restaurant & Brewhouse", grams: 100, kcalPer100g: 124 },
        ],
        goldenCaseIds: [],
        fixPRs: [150],
        status: 'closed',
        discoveredAt: '2026-07-25',
    },
    {
        id: 'all-filtered-over-rejection',
        stage: 'all_filtered',
        title: 'RESIDUAL: candidates existed and every one was filtered out',
        description:
            'Retrieval found records and the filter stage killed them all, so an AI 100g estimate answered instead '
            + '("qdoba steak bowl"). Only 7 live events / 5 distinct keys, but this stage is where OVER-REJECTION '
            + 'shows up and over-rejection has been the expensive class twice: the venue-brand blackout (PR #150) '
            + 'and the FatSecret lane truncation behind composite drift. Standing suspect on the variant-generation '
            + 'side: three CRUDER local singularize() copies shadow the exported one (filter-candidates.ts:113, '
            + 'gather-candidates.ts:847, map-ingredient-with-fallback.ts:435), stripping two chars from ANY -es and '
            + 'producing "oliv", "nood", "sauc", "juic". Diagnose by running gather+filter with debug:true and '
            + 'reading the per-candidate trace — FilterResult.reason is a blanket label, not the cause.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'all_filtered',
        exemplars: ['qdoba steak bowl'],
        exemplarRows: [
            { rawLine: 'qdoba steak bowl', normalizedForm: 'steak bowl', funnelStage: 'all_filtered', dropReason: 'all_filtered:no_candidate_survived_filters', source: 'ai_estimated', foodName: 'Qdoba Steak Bowl', grams: 100, kcalPer100g: 250, proteinPer100g: 12, carbsPer100g: 25, fatPer100g: 10, confidence: 0.64 },
        ],
        counterRows: [
            { rawLine: 'lemon', funnelStage: 'no_candidates', dropReason: 'no_candidates:dataset_gap', source: 'ai_estimated', foodName: 'Lemon', grams: 100, kcalPer100g: 29 },
        ],
        goldenCaseIds: ['n-mq-42'],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-24',
        dropClasses: ['no_candidate_survived_filters'],
        residual: true,
    },
    {
        id: 'ingest-gap-no-candidates',
        stage: 'no_candidates',
        title: 'No record exists in any lane — INGEST, never a fix-agent',
        description:
            'Retrieval returned nothing at all: a dataset gap, not a ranking gap. Sending a pipeline fix-agent at '
            + 'this class burns a session and changes nothing. Confirmed members: n-cook-06 "cooked oats" (the '
            + 'corpus has no cooked-oatmeal record; the 2026-07-21 deploy probe on n-mq-27 "lemon" returned '
            + 'lemon-pepper turkey, danish pastry, Fanta Lemon and Ritz Lemon crackers as the top hits), plus '
            + 'cooked quinoa. Route to the ingest queue and re-run the eval after the next ingest, not before. '
            + 'Zero live events in the 2026-07-25 read, which is itself informative: today the corpus almost '
            + 'always returns SOMETHING, so gaps surface as all_filtered or as an ai_estimated backfill rather '
            + 'than as an honest empty result.',
        fixKind: 'ingest',
        detector: row => row.funnelStage === 'no_candidates',
        exemplars: ['cooked oats', 'cooked quinoa'],
        exemplarRows: [
            { rawLine: 'cooked oats', normalizedForm: 'cooked oats', funnelStage: 'no_candidates', dropReason: 'no_candidates:dataset_gap', source: 'ai_estimated', foodName: 'Cooked Oats', grams: 100, kcalPer100g: 71, proteinPer100g: 2.5, carbsPer100g: 12, fatPer100g: 1.4, confidence: 0.5 },
            { rawLine: 'cooked quinoa', normalizedForm: 'cooked quinoa', funnelStage: 'no_candidates', dropReason: 'no_candidates:dataset_gap', source: 'ai_estimated', foodName: 'Cooked Quinoa', grams: 100, kcalPer100g: 120, proteinPer100g: 4.4, carbsPer100g: 21, fatPer100g: 1.9, confidence: 0.5 },
        ],
        counterRows: [
            { rawLine: 'qdoba steak bowl', funnelStage: 'all_filtered', dropReason: 'all_filtered:no_candidate_survived_filters', source: 'ai_estimated', foodName: 'Qdoba Steak Bowl', grams: 100, kcalPer100g: 250 },
        ],
        goldenCaseIds: ['n-cook-06', 'n-mq-27'],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-21',
        dropClasses: ['dataset_gap'],
    },
    {
        id: 'no-match-total-abstention',
        stage: 'no_match',
        title: 'Mapper abstained: best pick below MIN_ACCEPTABLE_CONFIDENCE',
        description:
            'The no-pick branch echoes the query back as foodName with foodId undefined and confidence 0.0, and '
            + 'run-eval scored that as a PASS on 47 of 238 nlp cases until commit 6beba93 — a positive name '
            + 'assertion matched trivially against the echoed query. Treat any regression here as scoring-critical. '
            + 'For composite dishes an abstention is NOT evidence of a corpus gap: 3 of the 4 assembled records '
            + 'behind n-mq-38..41 are already in Postgres, and the cause is `filtered.slice(0, 10)` truncating the '
            + 'FatSecret lane before rerank.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'no_match',
        exemplars: ['chipotle chicken burrito'],
        exemplarRows: [
            { rawLine: 'chipotle chicken burrito', normalizedForm: 'chipotle chicken burrito', funnelStage: 'no_match', dropReason: 'no_match:confidence_too_low', source: 'ai_estimated', foodName: 'chipotle chicken burrito', grams: 0, totalKcal: 0, confidence: 0 },
        ],
        counterRows: [
            { rawLine: 'chipotle chicken burrito', funnelStage: 'saved', source: 'fatsecret', foodName: 'Chicken Burrito Filling', brandName: 'Chipotle', grams: 118, totalKcal: 166, kcalPer100g: 141, proteinPer100g: 12, carbsPer100g: 8, fatPer100g: 7 },
        ],
        goldenCaseIds: ['n-mq-38'],
        fixPRs: [],
        status: 'open',
        discoveredAt: '2026-07-25',
        dropClasses: ['confidence_too_low', 'no_winner_selected'],
    },

    // ===================== fast path =====================
    {
        id: 'fast-path-water-substring-hijack',
        stage: 'fast_path',
        title: 'TRIPWIRE: a food that merely CONTAINS water took the zero-calorie fast path',
        description:
            'Regression tripwire. "canned tuna in water" short-circuited to Water and billed 0 kcal (map:565, '
            + 'logged HIGH severity), and "vitamin water" is ~30 kcal, not 0. Fixed in the cache-first sprint '
            + '(PR #120) by requiring the query to BE water/ice rather than to mention it. Fires when a fast_path '
            + 'line carries content tokens beyond water/ice, so it should never fire post-#120. Note fast_path '
            + 'rows log normalizedForm as null (47 live events, 0 distinct forms), so only rawLine is available '
            + 'here.',
        fixKind: 'pipeline',
        detector: row => row.funnelStage === 'fast_path' && !isPureWaterQuery(row.rawLine),
        exemplars: ['canned tuna in water', 'vitamin water'],
        exemplarRows: [
            { rawLine: 'canned tuna in water', funnelStage: 'fast_path', dropReason: 'fast_path:zero_calorie', source: 'fatsecret', foodName: 'Water', grams: 237, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 1 },
            { rawLine: 'vitamin water', funnelStage: 'fast_path', dropReason: 'fast_path:zero_calorie', source: 'fatsecret', foodName: 'Water', grams: 237, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 1 },
        ],
        counterRows: [
            { rawLine: '2 cups water', funnelStage: 'fast_path', dropReason: 'fast_path:zero_calorie', source: 'fatsecret', foodName: 'Water', grams: 474, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
            { rawLine: 'water', funnelStage: 'fast_path', dropReason: 'fast_path:zero_calorie', source: 'fatsecret', foodName: 'Water', grams: 237, kcalPer100g: 0 },
        ],
        goldenCaseIds: [],
        fixPRs: [120],
        status: 'closed',
        discoveredAt: '2026-07-21',
    },
    {
        id: 'fast-path-zero-calorie',
        stage: 'fast_path',
        title: 'Zero-calorie fast path (BY DESIGN)',
        description:
            'Water and ice short-circuit before the corpus is consulted, so they never reach a save and never '
            + 'reach the degenerate-nutrition gate. 47 live events. Counted only so the stage stops looking like a '
            + 'drop: nothing failed here. The detector requires the line to BE water/ice, so a substring hijack '
            + 'cannot hide in this class.',
        fixKind: 'healthy',
        detector: row => row.funnelStage === 'fast_path' && isPureWaterQuery(row.rawLine),
        exemplars: ['water', '2 cups water', 'ice'],
        exemplarRows: [
            { rawLine: 'water', funnelStage: 'fast_path', dropReason: 'fast_path:zero_calorie', source: 'fatsecret', foodName: 'Water', grams: 237, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 1 },
            { rawLine: '2 cups water', funnelStage: 'fast_path', dropReason: 'fast_path:zero_calorie', source: 'fatsecret', foodName: 'Water', grams: 474, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 1 },
            { rawLine: 'ice', funnelStage: 'fast_path', dropReason: 'fast_path:zero_calorie', source: 'fatsecret', foodName: 'Ice', grams: 100, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, confidence: 1 },
        ],
        counterRows: [
            { rawLine: 'canned tuna in water', funnelStage: 'fast_path', dropReason: 'fast_path:zero_calorie', source: 'fatsecret', foodName: 'Water', grams: 237, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
        ],
        goldenCaseIds: [],
        fixPRs: [120],
        status: 'by-design',
        discoveredAt: '2026-07-24',
        dropClasses: ['zero_calorie'],
    },

    // ===================== healthy conversions =====================
    {
        id: 'cache-hit-healthy',
        stage: 'cache_hit',
        title: 'Served from the validated cache with no quality flag (BY DESIGN)',
        description:
            'The dominant stage — 11,144 of 13,452 live events — and by far the cheapest path (nlp p50 18ms on '
            + 'the box). Counted explicitly so the registry can state an unclassified rate honestly instead of '
            + 'leaving 83% of live rows uncategorised. A cache_hit that carries ANY quality flag is excluded by the '
            + 'detector itself, not merely by precedence — so this class is a positive claim of cleanliness, which '
            + 'is the whole point of finding 4.',
        fixKind: 'healthy',
        detector: row => row.funnelStage === 'cache_hit' && !hasQualityFlag(row),
        exemplars: ['yellow bell pepper', 'chicken thigh', 'salmon fillet', 'egg white'],
        exemplarRows: [
            { rawLine: 'yellow bell pepper', normalizedForm: 'yellow bell pepper', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Yellow Bell Pepper', grams: 164, kcalPer100g: 27, proteinPer100g: 1, carbsPer100g: 6, fatPer100g: 0.2, confidence: 0.95, hadIncumbent: true },
            { rawLine: 'chicken thigh', normalizedForm: 'chicken thigh', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Chicken Thigh', brandName: 'One Fine Chicken', grams: 113, kcalPer100g: 115, proteinPer100g: 19, carbsPer100g: 0, fatPer100g: 4, confidence: 0.95, hadIncumbent: true },
            { rawLine: 'salmon fillet', normalizedForm: 'salmon fillet', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Salmon Fillet', brandName: 'Keohane Seafoods', grams: 120, kcalPer100g: 202, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13, confidence: 0.95, hadIncumbent: true },
            { rawLine: 'egg white', normalizedForm: 'egg white', funnelStage: 'cache_hit', source: 'fdc', foodName: 'Eggs, Grade A, Large, egg white', grams: 33, kcalPer100g: 55, proteinPer100g: 11, carbsPer100g: 0.7, fatPer100g: 0.2, confidence: 0.95, hadIncumbent: true },
        ],
        counterRows: [
            { rawLine: 'spinach', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Spinach', grams: 100, kcalPer100g: 16.3, proteinPer100g: 2.9, carbsPer100g: 1.4, fatPer100g: 0.4 },
            { rawLine: 'clif bar', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'CLIF BAR', brandName: 'CLIF', grams: 68, kcalPer100g: 367.6, proteinPer100g: 14, carbsPer100g: 66, fatPer100g: 7 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'by-design',
        discoveredAt: '2026-07-24',
    },
    {
        id: 'saved-healthy',
        stage: 'saved',
        title: 'Fresh pick cleared the 0.85 gate and was cached with no quality flag (BY DESIGN)',
        description:
            'A real conversion: 1,386 live events. This is the number cache-warming is trying to grow (coverage '
            + '28.8% -> 33.6% after the fast-casual pilot warm, ~73% conversion on 93 added keys, tracked nightly '
            + 'by flywheel-sweep step 4c). The detector requires an empty quality block, so "saved" in this summary '
            + 'means clean-saved — NOT saved-including-the-38-all-zero-rows, which is how the funnel alone reads it.',
        fixKind: 'healthy',
        detector: row => row.funnelStage === 'saved' && !hasQualityFlag(row),
        exemplars: ['clif bar', 'goldfish crackers', 'fairlife core power', 'pop tarts'],
        exemplarRows: [
            { rawLine: 'clif bar', normalizedForm: 'clif bar', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'CLIF BAR', brandName: 'CLIF', grams: 68, kcalPer100g: 367.6, proteinPer100g: 14, carbsPer100g: 66, fatPer100g: 7, confidence: 0.95 },
            { rawLine: 'goldfish crackers', normalizedForm: 'goldfish crackers', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'Goldfish crackers', brandName: 'Goldfish', grams: 30, kcalPer100g: 466.7, proteinPer100g: 10, carbsPer100g: 66, fatPer100g: 17, confidence: 0.96 },
            { rawLine: 'fairlife core power', normalizedForm: 'fairlife core power', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'Fairlife core power elite', brandName: 'Fairlife', grams: 250, kcalPer100g: 230, proteinPer100g: 12, carbsPer100g: 8, fatPer100g: 5, confidence: 0.97 },
            { rawLine: 'pop tarts', normalizedForm: 'pop tarts', funnelStage: 'saved', source: 'openfoodfacts', foodName: 'Pop Tarts', brandName: "Kellogg's", grams: 96, kcalPer100g: 395.8, proteinPer100g: 4, carbsPer100g: 72, fatPer100g: 9, confidence: 0.96 },
        ],
        counterRows: [
            { rawLine: 'brazil nuts', funnelStage: 'saved', source: 'fatsecret', foodName: 'Brazil Nuts', grams: 100, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
            { rawLine: 'yellow bell pepper', funnelStage: 'cache_hit', source: 'openfoodfacts', foodName: 'Yellow Bell Pepper', grams: 164, kcalPer100g: 27, proteinPer100g: 1, carbsPer100g: 6, fatPer100g: 0.2 },
        ],
        goldenCaseIds: [],
        fixPRs: [],
        status: 'by-design',
        discoveredAt: '2026-07-24',
    },
];

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const UNCLASSIFIED = 'unclassified';

/** Tag a row with the FIRST matching class (registry order is precedence order). */
export function classifyRow(row: FunnelRow): { classId: string; cls: FailureClass | null } {
    for (const cls of FAILURE_CLASSES) {
        let matched = false;
        try {
            matched = cls.detector(row);
        } catch {
            matched = false;
        }
        if (matched) return { classId: cls.id, cls };
    }
    return { classId: UNCLASSIFIED, cls: null };
}

export function classById(id: string): FailureClass | undefined {
    return FAILURE_CLASSES.find(c => c.id === id);
}

/** Every stage a class declares it can fire on. */
export function classStages(cls: FailureClass): FunnelStage[] {
    return [cls.stage, ...(cls.alsoStages ?? [])];
}

// ---------------------------------------------------------------------------
// Measured ground truth + caveats that are facts, not classes
// ---------------------------------------------------------------------------

/**
 * The 19 dropReason classes actually observed on the live box, 2026-07-25
 * (13,452 MappingEventLog rows carrying funnelStage). Used by the coverage test
 * and by the generated doc: every one of these MUST classify to something, even
 * if that something is fixKind 'healthy'.
 */
export interface LiveDropReason {
    dropReason: string;
    stage: FunnelStage;
    events: number;
    distinctForms: number;
    /**
     * rawLine to use when probing coverage for this dropReason. Only needed where a
     * class is decided by the LINE and not by the reason: fast_path has two classes
     * separated by whether the query IS water, so a placeholder probe would land on
     * the substring-hijack tripwire and misreport the owner.
     */
    probeRawLine?: string;
}

/** Default rawLine for a coverage probe. */
export const COVERAGE_PROBE_LINE = 'coverage probe';

/** The rawLine to classify when auditing coverage for a live dropReason. */
export function probeLineFor(live: LiveDropReason): string {
    return live.probeRawLine ?? COVERAGE_PROBE_LINE;
}

export const LIVE_DROP_REASONS: LiveDropReason[] = [
    { dropReason: 'save_rejected:cross_source_margin', stage: 'save_rejected', events: 404, distinctForms: 21 },
    { dropReason: 'under_gate:close_match', stage: 'under_gate', events: 133, distinctForms: 46 },
    { dropReason: 'under_gate:clear_winner', stage: 'under_gate', events: 102, distinctForms: 25 },
    { dropReason: 'save_rejected:sub_threshold_no_displace', stage: 'save_rejected', events: 61, distinctForms: 3 },
    { dropReason: 'save_rejected:brand_mismatch', stage: 'save_rejected', events: 50, distinctForms: 10 },
    { dropReason: 'under_gate:simple_rerank', stage: 'under_gate', events: 48, distinctForms: 45 },
    { dropReason: 'fast_path:zero_calorie', stage: 'fast_path', events: 47, distinctForms: 0, probeRawLine: 'water' },
    { dropReason: 'save_rejected:core_token_mismatch', stage: 'save_rejected', events: 23, distinctForms: 4 },
    { dropReason: 'save_rejected:implausible_macros:category:fresh_produce_kcal_over', stage: 'save_rejected', events: 17, distinctForms: 15 },
    { dropReason: 'under_gate:fallback_after_serving_failure', stage: 'under_gate', events: 13, distinctForms: 13 },
    { dropReason: 'all_filtered:no_candidate_survived_filters', stage: 'all_filtered', events: 7, distinctForms: 5 },
    { dropReason: 'save_rejected:implausible_macros:category:lean_cut_protein_below_floor', stage: 'save_rejected', events: 5, distinctForms: 4 },
    { dropReason: 'save_rejected:serving_downgrade', stage: 'save_rejected', events: 4, distinctForms: 4 },
    { dropReason: 'save_rejected:implausible_macros:estimate:kcal_vs_expected', stage: 'save_rejected', events: 3, distinctForms: 2 },
    { dropReason: 'save_rejected:implausible_macros:floor:produce_kcal_below', stage: 'save_rejected', events: 1, distinctForms: 1 },
    { dropReason: 'save_rejected:implausible_macros:estimate:protein_over_expected', stage: 'save_rejected', events: 1, distinctForms: 1 },
    { dropReason: 'save_rejected:implausible_macros:atwater:kcal_exceeds_computed', stage: 'save_rejected', events: 1, distinctForms: 1 },
    { dropReason: 'save_rejected:bare_category_takeover', stage: 'save_rejected', events: 1, distinctForms: 1 },
    { dropReason: 'under_gate:single_candidate', stage: 'under_gate', events: 1, distinctForms: 1 },
];

/** Live stage histogram, same read. */
export const LIVE_STAGE_COUNTS: Record<string, number> = {
    cache_hit: 11144,
    saved: 1386,
    save_rejected: 571,
    under_gate: 297,
    fast_path: 47,
    all_filtered: 7,
};

/**
 * Verified-in-code facts that are NOT classes — nothing can detect them from a
 * row, but every consumer of the funnel needs to know them before drawing a
 * conclusion. Rendered into the generated doc.
 */
export const FUNNEL_CAVEATS: { id: string; note: string }[] = [
    {
        id: 'error-stage-is-dead-code',
        note: "funnelStage 'error' is UNREACHABLE. mapIngredientWithFallback uses try/finally with no catch, so a "
            + 'throw 500s the request and writes ZERO MappingEventLog rows. An errored line is INVISIBLE to the '
            + "funnel, not tagged 'error' — never read a 0 in the error bucket as 'nothing threw'.",
    },
    {
        id: 'fdc-bypasses-two-save-guards',
        note: 'fdc <-> off and fdc <-> fs displacements bypass BOTH the serving-downgrade guard AND the '
            + 'cross-source displacement margin, because newTargetKey/existingTargetKey read only offBarcode then '
            + 'fsId — fdcId is never considered (validated-mapping-helpers.ts:720-723). Latent gap: an fdc row can '
            + 'be silently displaced by a lower-confidence pick with no serving shape.',
    },
    {
        id: 'zero-macros-gate-skipped-at-zero-grams',
        note: 'The degenerate-nutrition gate is skipped entirely when grams is 0, because nutrientsPer100g is only '
            + 'passed when result.grams > 0 (map-ingredient-with-fallback.ts:2611-2616).',
    },
    {
        id: 'human-row-reason-conflates-two-outcomes',
        note: "save_rejected:human_row means EITHER a successful usage-bump on the same record OR a genuine skip on "
            + 'a different one: markSaveRejected sits outside the if/else at validated-mapping-helpers.ts:684-704. '
            + 'Tracked as class gate-human-row-conflated.',
    },
    {
        id: 'three-shadowing-singularize-copies',
        note: 'Three cruder local singularize() copies shadow the exported one on the filter/retrieval path '
            + '(filter-candidates.ts:113, gather-candidates.ts:847, map-ingredient-with-fallback.ts:435). They '
            + 'strip two chars from ANY -es, producing "oliv", "nood", "sauc", "juic" — a candidate cause of '
            + 'filter misses in all-filtered-over-rejection.',
    },
    {
        id: 'event-log-key-is-not-the-cache-key',
        note: 'MappingEventLog.normalizedForm is PRE-canonicalization; FoodMapping.normalizedForm is canonicalized, '
            + 'singularized and token-SORTED. "chicken breast" -> "breast chicken", "eggs" -> "egg", "pretzels" -> '
            + '"pretzel". Always canonicalizeCacheKey() before joining, or the join reports cached keys as cold and '
            + 'inverts the conclusion.',
    },
    {
        id: 'incumbent-is-measured-now-not-at-event-time',
        note: 'hadIncumbent is resolved by looking FoodMapping up at report time, not at event time, and it is '
            + 'wrong in BOTH directions. A key cached after the event reads hadIncumbent=true; a key EVICTED after '
            + 'the event reads hadIncumbent=false. The second direction is the one that bites: the first real run '
            + '(2026-07-25, since 07-24) reported 8 "cold" gate-cross-source-margin events, which is impossible — '
            + 'that gate is nested inside a block requiring an incumbent and cannot fire on a cold key. They were '
            + 'events whose rows had been evicted hours later by the composite cache refresh. So a small cold count '
            + 'on a gate that provably needs an incumbent is a timing artifact, NOT a refutation. Read hadIncumbent '
            + 'as evidence about a class (does this gate ever fire cold?), never as per-row history, and treat a '
            + 'LARGE cold count on such a gate as the real signal that something is wrong.',
    },
    {
        id: 'dropreason-vocabularies-interpolate-measurements',
        note: 'Macro-plausibility reasons embed live numbers (atwater:kcal_412_exceeds_computed_388.5) and '
            + 'selectionReason can carry free-form AI rationale. ALWAYS normalize via normalizeClassId before '
            + 'grouping; stored raw, dropReason is near-unique per row.',
    },
];

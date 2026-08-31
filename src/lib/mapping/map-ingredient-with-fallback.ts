/**
 * Unified Ingredient Mapping Pipeline
 * 
 * New architecture that:
 * 1. Gathers candidates from Cache + FatSecret API + FDC in parallel
 * 2. Applies unified must-have token filtering
 * 3. Uses simple token-based reranking to select the best candidate
 * 4. Handles serving selection and backfill
 */

import { parseIngredientLine, QUANTITY_WORD_NUMBERS, type ParsedIngredient } from '../parse/ingredient-line';
import { IDENTITY_QUALIFIERS } from '../parse/qualifiers';
import { normalizeIngredientName } from './normalization-rules';
import { gatherCandidates, confidenceGate, assessConfidence, type UnifiedCandidate, type GatherOptions } from './gather-candidates';
import { funnelReason, type FunnelStage, type FunnelSink } from './funnel';
import {
    filterCandidatesByTokens,
    hasCriticalModifierMismatch,
    isCategoryMismatch,
    isMultiIngredientMismatch,
    isReplacementMismatch,
    hasCoreTokenMismatch,
    hasNullOrInvalidMacros,
    detectGrainCookingContext,
} from './filter-candidates';
import {
    simpleRerank,
    toRerankCandidate,
    stripPrepModifiers,
    hasDecisiveBrandContext,
    candidateMatchesTargetBrand,
    coversNonBrandQueryToken,
} from './simple-rerank';
import { buildRerankPool, rerankPoolRemainder, RERANK_POOL_LIMIT } from './rerank-pool';
import { servingAiCallForTier } from './serving-ai-tiers';
import { countedPieceNoun, servingLabelCountsPiece } from './count-label';
import { getValidatedMappingByNormalizedName, saveValidatedMapping, getAiNormalizeCache, isTrustedHumanRow, isHumanTrustSkippableEscape, targetKeyOfFoodId, type CacheLookupRejection, type ReadEscapeRecord } from './validated-mapping-helpers';
import { logMappingAnalysis } from './mapping-logger';
import { shouldRunCacheValidator, kickCacheValidation } from './cache-validator';
import { logger } from '../logger';
import type { FatSecretServing } from './client';
import { insertAiServing, backfillWeightServing } from './ai-backfill';
import { aiNormalizeIngredient } from './ai-normalize';
import { aiParseIngredient } from './ai-parse';
import { hydrateSingleCandidate } from './hydrate-cache';
import { queueForDeferredHydration, proactiveProduceBackfill } from './deferred-hydration';
import { findCanonicalName, getKnownSynonyms, saveSynonyms } from './ai-synonym-generator';
import { classifyUnit } from './unit-type';
import { shouldNormalizeLlm } from './normalize-gate';
import { extractModifierConstraints } from './modifier-constraints';
import { incrementSkippedByGate, incrementCacheHit } from '../ai/structured-client';
import { extractPrepModifier } from './preemptive-backfill';
import {
    requestAiNutrition, extractBaseFoodContext, getAiServingGrams,
    createAiNutritionBudget, type AiNutritionBudget,
} from './ai-nutrition-backfill';
import {
    AI_NUTRITION_BACKFILL_ENABLED, AI_NUTRITION_MAX_PER_REQUEST,
    AI_NUTRITION_HYDRATION_MAX_PER_REQUEST, MAPPING_ANALYSIS_TOP_N,
} from './config';
import { detectBrandInQuery } from './brand-detector';
import { assessSubThresholdAdmission, RERANK_DECLINED_CONFIDENCE } from './sub-threshold-admission';
import { assessMacroPlausibility, assessRankTimePlausibility } from './macro-plausibility';
import { isDenylistedOffRecord } from './corrupt-denylist';
import { isCorruptExclusionEnabled } from './corrupt-mark';
import { deriveMappingCacheKey, deriveCacheKeyName, isMalformedCacheKey, stripPartitiveOfResidue, IDENTITY_UNIT_HINTS, type BrandKeyInput } from './cache-key';
import { stripIntroducedFoodTokens, resolveIsBrandedQuery, restoreNutritionModifiers } from './llm-output-guards';
import { isBarePluralRequest } from '../servings/bare-query-guard';
import type { CachedMappedIngredient } from './validated-mapping-helpers';
import { buildFatSecretResult } from './build-fatsecret-result';
// THE reader for FatSecretServing.nutrients — the cache-escape decision must ask
// "is this billable?" through the exact function the fs lane bills with, never a
// re-derived one (see the module header in ./fs-serving-macros).
import { servingMacros } from './fs-serving-macros';
import {
    hydrateAndSelectServing,
    candidateHasCountLabel, requestBillsByServing, candidateHasServingData,
    isMatchableVolumeUnit, candidateHasVolumeServing,
} from './serving/hydration-lane';
// Facade re-exports: the public serving API moved to ./serving/hydration-lane
// (Phase 1 stage 1a); instruments and tests import it from this module's path.
export {
    hydrateAndSelectServing, findOwnFdcVolumeServing, findOwnFdcSizeServing,
    candidateHasVolumeServing, isTightNameGroup, buildOffResult,
} from './serving/hydration-lane';

/**
 * Unit-class predicates for Step 5a's isWeightUnit / isVolumeUnit flags,
 * hoisted above the cascade in Phase 1 stage 1d. They evaluate parsed.unit
 * BEFORE the hydration lane runs — and hydrateAndSelectServing (no `()` here:
 * the budget migration guard scans this file's text for call sites, comments
 * included) mutates parsed.unit via trailing-unit recovery,
 * TRAILING_UNIT_REGEX in ./serving/hydration-lane. The hoist is only
 * divergence-free while the trailing-unit set matches NEITHER regex; exported so
 * __tests__/trailing-unit-hoist-divergence.test.ts can pin that disjointness
 * against the real symbols (log/2026-08-07_0230, Findings).
 */
export const WEIGHT_UNIT_REGEX = /^(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg|kilogram|kilograms)$/i;
export const VOLUME_UNIT_REGEX = /^(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|ml|milliliter|milliliters|floz|fl\s*oz|fluid\s*ounce|l|liter|liters)$/i;

// ============================================================
// Symmetric cache lookup with legacy-key fallback (Track 1c)
// ============================================================
// Primary lookup uses deriveMappingCacheKey — THE shared read/write key.
// But every FoodMapping row written before Track 1c was keyed by the OLD
// read scheme (deriveCacheKeyName, no brand prefix), so whenever the new
// key differs from the legacy key a miss falls back to ONE extra indexed
// point-read on the legacy key. The write path stays new-scheme-only, so
// legacy rows migrate forward naturally on their next save.
//
// Guard: the fallback must never look up a MALFORMED legacy key (adjacent
// duplicate tokens — the "oiko oiko"/"canned canned" rows the cleanup
// script deletes). Resurrecting those zombie rows would undo the fix, so
// isMalformedCacheKey (the script's own predicate) gates the fallback.
async function lookupValidatedMappingWithLegacyFallback(
    normalizedName: string,
    parsed: import('../parse/ingredient-line').ParsedIngredient | null | undefined,
    brandDetection: BrandKeyInput,
    rawLine: string,
    rejection?: CacheLookupRejection,
    /**
     * Name to derive the LEGACY key from, when it differs from the name used
     * for the symmetric key.
     *
     * The brand-preservation repair re-injects a decisive brand into
     * `normalizedName`. Deriving the brandless legacy key from that repaired
     * value would make `legacyKey === symmetricKey`, short-circuit this
     * fallback, and orphan every pre-Track-1c row that only exists under a
     * brandless key. MEASURED 2026-08-03 over the whole observed corpus (5,585
     * distinct lines / 64,046 events): 0 rows are actually lost, because
     * `legacyHitReflectsBrand()` below already refuses all 15 legacy hits that
     * occur. But the corpus is not a complete record of queries, and the
     * corpus-independent bound is 142 always-decisive rows — 5 of them at 100+
     * uses, one `human-triage`. Passing the pre-injection name removes the
     * exposure by construction rather than relying on that measurement.
     */
    legacyName?: string,
): Promise<CachedMappedIngredient | null> {
    const symmetricKey = deriveMappingCacheKey(normalizedName, parsed, brandDetection, rawLine);
    const hit = await getValidatedMappingByNormalizedName(symmetricKey, 'fatsecret', rawLine, rejection);
    if (hit) return hit;

    const legacyKey = deriveCacheKeyName(legacyName ?? normalizedName, parsed);
    if (legacyKey === symmetricKey || isMalformedCacheKey(legacyKey)) return null;

    const legacyHit = await getValidatedMappingByNormalizedName(legacyKey, 'fatsecret', rawLine, rejection);
    if (legacyHit) {
        // Branded-query guard: the legacy key (deriveCacheKeyName) is BRANDLESS,
        // so when a brand was detected and stripped it can wrongly match a
        // GENERIC record — e.g. "one bar birthday cake" detects brand "one bar",
        // normalizes to "birthday cake", and the legacy key hits a generic
        // "Birthday Cake" instead of "One birthday cake protein bars". Only
        // accept a legacy hit that actually reflects the detected brand (in its
        // name or brandName); otherwise fall through to the full pipeline.
        if (
            brandDetection.matchedBrand &&
            !legacyHitReflectsBrand(legacyHit, brandDetection.matchedBrand)
        ) {
            logger.debug('mapping.legacy_cache_key_brand_mismatch_skipped', {
                rawLine,
                legacyKey,
                matchedBrand: brandDetection.matchedBrand,
                cachedFood: legacyHit.foodName,
            });
            if (rejection) {
                rejection.reason = 'legacy_brand_mismatch';
                rejection.normalizedForm = legacyKey;
                rejection.foodName = legacyHit.foodName;
                // targetKey MUST be rewritten here, not left alone. `rejection`
                // is ONE slot shared by both lookups above, and the symmetric-key
                // lookup may already have written the identity of a DIFFERENT
                // refused row into it. Leaving it would make the record named by
                // `targetKey` disagree with the row named by `reason`/`foodName`
                // in the same object — and that object is what feeds both
                // `readEscapes` (the save-time forfeit) and the
                // `cross_source_margin_waived_read_escape` audit line, so the one
                // counter for waivers would point at the wrong row. Both rows
                // were genuinely refused, so either is a legitimate forfeit; only
                // a self-consistent one is diagnosable.
                rejection.targetKey = targetKeyOfFoodId(legacyHit.foodId);
            }
            return null;
        }
        // A legacy hit that IS accepted clears any rejection the symmetric-key
        // lookup recorded above — the caller got a row, so nothing was bypassed.
        if (rejection) rejection.reason = null;
        logger.debug('mapping.legacy_cache_key_fallback_hit', {
            rawLine,
            symmetricKey,
            legacyKey,
        });
    }
    return legacyHit;
}

/**
 * True when a cached record reflects the detected brand — any significant brand
 * token (≥3 chars) appears as a whole word in the record's name or brandName.
 * Used to reject brandless-legacy-key hits on GENERIC records for branded
 * queries (see lookupValidatedMappingWithLegacyFallback). Conservative: it only
 * blocks a fallback hit that shows no trace of the brand at all.
 */
export function legacyHitReflectsBrand(
    hit: Pick<CachedMappedIngredient, 'foodName' | 'brandName'>,
    matchedBrand: string,
): boolean {
    const tokens = matchedBrand
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(t => t.length >= 3);
    if (tokens.length === 0) return true; // nothing specific to match on — don't block
    const hay = `${hit.foodName ?? ''} ${hit.brandName ?? ''}`.toLowerCase();
    return tokens.some(t =>
        new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay),
    );
}

// ============================================================
// In-Flight Lock (Prevents race conditions in parallel processing)
// ============================================================
// When multiple threads try to map the same ingredient simultaneously,
// only the first one runs the full pipeline. Others wait for its result.
const inFlightLocks = new Map<string, Promise<FatsecretMappedIngredient | null>>();

// ============================================================
// AI Parse Event Logger (for debugging/learning)
// ============================================================
// Logs every AI parse assist call to a dedicated file so we can:
// 1. See exactly which ingredients triggered AI parsing
// 2. Compare regex parser output vs AI output
// 3. Identify patterns to improve the regex parser
//
// GUARDED, and deliberately opt-in. This is a SYNCHRONOUS appendFileSync on a
// request path, and it ran unguarded in production for 17 days (496 events into
// logs/ai-parse-events.jsonl on the box). Every one of the ten sibling analysis
// writes in this file is already behind ENABLE_MAPPING_ANALYSIS; this one was
// simply missed. The volume is trivial (~29/day) — the reason to guard it is
// that neither required CI gate can see an unguarded disk write, so nothing
// else was ever going to.
//
// The structured logger.* calls at each call site are NOT guarded and must stay
// that way: they are the observability, this file is the debugging convenience.
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ENABLE_AI_PARSE_LOG = process.env.ENABLE_AI_PARSE_LOG === 'true';

interface AiParseLogEntry {
    rawLine: string;
    regexResult: unknown;
    triggerReason: string;
    aiResult: unknown;
    outcome: 'success' | 'rejected_absurd_qty' | 'ai_failed';
}

function logAiParseEvent(entry: AiParseLogEntry): void {
    if (!ENABLE_AI_PARSE_LOG) return;
    try {
        const logsDir = join(process.cwd(), 'logs');
        if (!existsSync(logsDir)) {
            mkdirSync(logsDir, { recursive: true });
        }
        const logPath = join(logsDir, 'ai-parse-events.jsonl');
        const logEntry = {
            timestamp: new Date().toISOString(),
            ...entry,
        };
        appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
    } catch (err) {
        // Don't fail the pipeline for logging errors
        logger.warn('ai_parse_log.write_failed', { error: (err as Error).message });
    }
}

function getLockKey(name: string): string {
    return name.toLowerCase().trim();
}

// ============================================================
// Types
// ============================================================

export type FatsecretMappedIngredient = {
    source: 'fatsecret' | 'fdc' | 'cache' | 'ai_generated' | 'openfoodfacts';
    foodId: string;
    foodName: string;
    brandName?: string | null;
    servingId?: string | null;
    servingDescription?: string | null;
    grams: number;
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    confidence: number;
    quality: 'high' | 'medium' | 'low';
    rawLine: string;
    aiValidation?: {
        approved: boolean;
        confidence: number;
        reason: string;
        category?: string;
        detectedIssues?: string[];
    };
    /**
     * Gram-resolution branch that billed this result (weight_unit,
     * label_count_derived, flat_100g_default, ...). Recorded in
     * MappingEventLog; undefined on the legacy fatsecret/ai serving path.
     */
    servingTier?: string;
    /**
     * TRUE when this row's per-100g PANEL came from the LLM rather than from the
     * record the `foodId` names. Set only by `buildOffResult()`'s AI-nutrition
     * backfill branch, which returns an `off_` id — so without this flag the
     * parse route derives `source: 'openfoodfacts'` from the prefix and renders
     * the ODbL credit beside numbers Open Food Facts did not supply.
     * Over-attribution is a defect in both directions (mobile CLAUDE.md
     * §Attribution), so the route floors this to `ai_estimated`, the one
     * non-badging member of the contract union.
     *
     * OMITTED rather than `false` when honest, matching the `portionEstimated`
     * convention — an absent key keeps the wire byte-identical for every row
     * that does not need it.
     *
     * The producing branch is currently UNREACHABLE in production; it is
     * guarded by the claim `off-food-rows-all-carry-a-panel`, which is what
     * turns "latent" into "monitored". See that claim for why, and do not read
     * the flag's absence from live traffic as evidence it is unnecessary.
     */
    panelFromAi?: true;
};

/**
 * Telemetry sink for MappingEventLog: the caller passes an empty object via
 * options and the mapper mutates it with cache-path facts (which cache layer
 * served the line, or why a cached row was bypassed). Mutation-based so the
 * facts survive the mapper's many internal return paths without threading
 * them through every result construction.
 */
export interface MappingTelemetry extends FunnelSink {
    /** The mapper's own cache-key input (post-normalization), not the segmenter hint. */
    normalizedForm?: string;
    /** Set when a FoodMapping row served the line: which cache layer hit. */
    cacheHit?: 'early' | 'normalized';
    /** Set when a cached row existed but was bypassed: 'early:grain_cooked', 'normalized:core_token_mismatch', ... */
    cacheEscape?: string;
    // funnelStage / dropReason come from FunnelSink — the funnel bucket this
    // line ended in and, when it dropped, the namespaced class ID for why.
}

/**
 * Record the funnel outcome for a line. Later calls win: a fresh pick is marked
 * 'saved' optimistically and downgraded to 'save_rejected' by whichever save
 * gate blocks the write.
 */
function markFunnel(
    telemetry: MappingTelemetry | undefined,
    stage: FunnelStage,
    classId?: string | null,
): void {
    if (!telemetry) return;
    telemetry.funnelStage = stage;
    // Successful stages carry no drop reason; clear any earlier one so a
    // recovered line (e.g. fallback search after a cache miss) isn't tagged.
    telemetry.dropReason = (stage === 'cache_hit' || stage === 'saved')
        ? undefined
        : funnelReason(stage, classId);
}

/**
 * Returned when skipOnLock is true and the ingredient is currently locked.
 * The caller should retry this ingredient after other ingredients are processed.
 */
export type MapIngredientPendingResult = {
    status: 'pending';
    lockKey: string;
    rawLine: string;
};

export interface MapIngredientOptions {
    minConfidence?: number;
    allowLiveFallback?: boolean;
    debug?: boolean;
    skipAiValidation?: boolean;
    skipCache?: boolean;
    /**
     * Do not WRITE the FoodMapping cache. Sibling of `skipCache`, which only
     * gates the two read layers.
     *
     * Why it exists: a cold audit run (`skipCache`) still called
     * `saveValidatedMapping()` for every line, so measuring the pipeline
     * rewrote the thing being measured. On 2026-08-02 a single cold golden run
     * changed 20 rows and added 3 in a cache that had just been agent-screened,
     * replacing screened rows with unscreened ones.
     *
     * SCOPE, PRECISELY: this option gates ONE write — FoodMapping, the curated
     * identity map. It is not the whole of what `nosave=1` means, and it never
     * was: passing it does not by itself make a request read-only.
     *
     * WHAT DOES THE REST (2026-08-18, P6). `/api/nlp/parse?nosave=1` now also
     * opens a request-scoped write policy (`src/lib/write-policy.ts`) that
     * refuses the AI-serving writes and the segmentation-cache write at their
     * writers: `insertFdcAiServing()`, `insertAiServing()`,
     * `backfillWeightServing()`, the ambiguous-unit `upsertServing()` and
     * `writeSegmentationCache()`. That policy travels through
     * AsyncLocalStorage, NOT through this options object, which is why this
     * docstring and that mechanism have to be read together — a caller that
     * sets `skipSave` WITHOUT opening a policy (every script, every other
     * route) still gets the narrow meaning described above and still persists
     * FdcServing/OffServing/AiGenerated* rows.
     *
     * Still unsuppressed under either: MappingEventLog (the measurement
     * itself), the FoodMapping usedCount/lastUsedAt bumps on a warm READ, and
     * the upstream mirrors FatSecretFood/OffFood/AiGeneratedFood/LearnedSynonym.
     * Owner: mobile:sync-docs/reports/2026-08-17_request-scoped-write-suppression-design.md
     */
    skipSave?: boolean;
    skipFdc?: boolean;
    /** Internal flag - skip in-flight lock for recursive fallback calls */
    _skipInFlightLock?: boolean;
    /** Internal flag - skip fallback to prevent infinite recursion */
    _skipFallback?: boolean;
    /** If true, return 'pending' immediately when lock is held instead of blocking */
    skipOnLock?: boolean;
    brand?: string;
    normalizedForm?: string;
    /** Optional telemetry sink — mutated with cache-path facts (see MappingTelemetry). */
    telemetry?: MappingTelemetry;
    /**
     * LAST-RESORT LLM nutrition allowance, owned by the CALLER — spent only when
     * NOTHING matched and the line would otherwise be dropped.
     * A looping caller (a warm run, a batch import) must create ONE budget and
     * pass the SAME OBJECT to every query — that is what bounds the run. Omit it
     * and this call gets its own AI_NUTRITION_MAX_PER_REQUEST allowance.
     *
     * It is deliberately NOT the budget the hydration path spends: see
     * `aiHydrationBudget` below for why they must not share a pool.
     */
    aiNutritionBudget?: AiNutritionBudget;
    /**
     * HYDRATION LLM nutrition allowance, owned by the CALLER. Separate pool,
     * spent only by `buildOffResult()` on a candidate that ALREADY WON
     * retrieval but whose OFF panel failed the Atwater gate.
     *
     * Kept apart from `aiNutritionBudget` because exhaustion here is not a
     * degradation, it is a DELETION: `buildOffResult()` returns null and the
     * pipeline bills a different record, which is then written as a sticky
     * FoodMapping row. Sharing one pool made that identity depend on how many
     * last-resort calls the OTHER concurrent items of the same request had
     * already fired. Same object-identity contract as above; omit it and this
     * call gets its own AI_NUTRITION_HYDRATION_MAX_PER_REQUEST allowance.
     */
    aiHydrationBudget?: AiNutritionBudget;
}

const ENABLE_MAPPING_ANALYSIS = process.env.ENABLE_MAPPING_ANALYSIS === 'true';

// ============================================================
// Rank-time plausibility partition + denylist (PR D pt3, Lever B)
// Pure helpers, exported for tests. Kill-switch RANK_PLAUSIBILITY_PARTITION='0'
// disables the floor-hit reordering AND the denylist drop together.
// ============================================================

function isRankPlausibilityPartitionEnabled(): boolean {
    return process.env.RANK_PLAUSIBILITY_PARTITION !== '0';
}

/**
 * Ids of candidates whose per-100g macros hit a floor-grade plausibility check
 * for this query. Candidates without inline per-100g nutrition are never
 * flagged (they rank as plausible). `normalizedName` must keep original word
 * order — never a token-sorted cache key (see assessRankTimePlausibility).
 */
export function computeFloorHitIds(
    normalizedName: string,
    candidates: UnifiedCandidate[]
): Set<string> {
    const ids = new Set<string>();
    if (!isRankPlausibilityPartitionEnabled()) return ids;
    for (const c of candidates) {
        if (!c.nutrition?.per100g) continue;
        if (assessRankTimePlausibility(normalizedName, c.name, c.nutrition).floorHit) {
            ids.add(c.id);
        }
    }
    return ids;
}

/** Floor-hit check for a single fallback-loop candidate (same kill-switch). */
export function candidateHitsPlausibilityFloor(
    normalizedName: string,
    candidate: UnifiedCandidate
): boolean {
    if (!isRankPlausibilityPartitionEnabled()) return false;
    if (!candidate.nutrition?.per100g) return false;
    return assessRankTimePlausibility(normalizedName, candidate.name, candidate.nutrition).floorHit;
}

/**
 * Drop triage-confirmed corrupt OFF records. All-drop restore: if every
 * candidate is denylisted, keep the original list (same pattern as the
 * plausibility escape) so corpus-gap queries cannot strand.
 */
export function dropDenylistedCandidates(
    candidates: UnifiedCandidate[],
    rawLine: string
): UnifiedCandidate[] {
    if (!isRankPlausibilityPartitionEnabled()) return candidates;
    const kept = candidates.filter(c => !isDenylistedOffRecord(c.id));
    if (kept.length === candidates.length || kept.length === 0) return candidates;
    for (const c of candidates) {
        if (isDenylistedOffRecord(c.id)) {
            logger.warn('mapping.denylisted_candidate_dropped', {
                rawLine,
                candidate: c.name,
                foodId: c.id,
            });
        }
    }
    return kept;
}

/**
 * Comparator for the pre-confidenceGate sort. Floor-hit candidates rank
 * strictly below plausible ones REGARDLESS of raw score: OFF raw scores
 * (~0-10) dwarf FDC's (~0-1.5), so a score multiply alone can never demote a
 * corrupt high-score OFF record below a plausible FDC one — and this ordering
 * is exactly what confidenceGate's basic_produce_bypass consumes (finding 1).
 * All-floor-hit input degrades to the plain score sort (pure comparative).
 * Pass an empty floorHitIds set to get the pre-PR-D-pt3 ordering.
 */
export function makeSortedFilteredComparator(
    normalizedName: string,
    isBasicProduce: boolean,
    floorHitIds: ReadonlySet<string>
): (a: UnifiedCandidate, b: UnifiedCandidate) => number {
    return (a, b) => {
        const aFloor = floorHitIds.has(a.id);
        const bFloor = floorHitIds.has(b.id);
        if (aFloor !== bFloor) return aFloor ? 1 : -1;

        // Primary: sort by score descending
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 0.001) return scoreDiff;

        // Tiebreaker for basic produce: prefer FDC (USDA data) over FatSecret
        // BUT only if FDC candidate name EXACTLY matches the ingredient (not "potato bread")
        if (isBasicProduce) {
            const aNameLower = a.name.toLowerCase();
            const bNameLower = b.name.toLowerCase();
            const ingredientLower = normalizedName.toLowerCase();

            // Helper to singularize words (handles -oes → -o, -es → empty, -s → empty)
            const singularize = (word: string): string => {
                if (word.endsWith('oes')) return word.slice(0, -2);  // potatoes → potato
                if (word.endsWith('es')) return word.slice(0, -2);   // tomatoes → tomato (also handles -ches, etc.)
                if (word.endsWith('s')) return word.slice(0, -1);    // carrots → carrot
                return word;
            };
            // Helper to pluralize words (handles -o → -oes, others → -s)
            const pluralize = (word: string): string => {
                if (word.endsWith('o')) return word + 'es';  // potato → potatoes
                return word + 's';
            };

            const ingredientSingular = singularize(ingredientLower);
            const ingredientPlural = pluralize(ingredientSingular);
            const aNameSingular = singularize(aNameLower);
            const bNameSingular = singularize(bNameLower);

            // Check for EXACT match (considering singular/plural variants)
            // e.g., "potato" matches "potatoes", "potatoes" matches "potato"
            const aIsExactMatch = aNameLower === ingredientLower ||
                aNameLower === ingredientSingular ||
                aNameLower === ingredientPlural ||
                aNameSingular === ingredientLower ||
                aNameSingular === ingredientSingular;
            const bIsExactMatch = bNameLower === ingredientLower ||
                bNameLower === ingredientSingular ||
                bNameLower === ingredientPlural ||
                bNameSingular === ingredientLower ||
                bNameSingular === ingredientSingular;

            // Prefer FDC only when it's an exact name match
            if (aIsExactMatch && a.source === 'fdc' && (!bIsExactMatch || b.source !== 'fdc')) return -1;
            if (bIsExactMatch && b.source === 'fdc' && (!aIsExactMatch || a.source !== 'fdc')) return 1;
        }

        return 0;
    };
}

// ============================================================
// Bare-plural request detection (PR D pt3, Lever A3)
//
// The predicate moved to `src/lib/servings/bare-query-guard.ts`, which owns
// every bare-request eligibility rule and — unlike this file — can be imported
// by `buildFatSecretResult` without an import cycle. It lived here, called from
// exactly one place, while the FatSecret count branch had no bare-plural
// suppression at all. Re-exported so existing importers keep working.
// ============================================================
export { isBarePluralRequest };

// ============================================================
// Preflight: Steps 0a–1-WATER — synonym canonicalization, pre-parse unit
// cleanup, parse + identity restoration, AI parse fallback, unit-only
// rejection, and the zero-calorie early exit. Runs entirely BEFORE the
// in-flight lock is registered, so a `done` outcome returns to the caller
// without any lock bookkeeping.
// ============================================================

type PreflightOutcome =
    | { done: true; result: FatsecretMappedIngredient | null }
    | { done: false; parsed: ParsedIngredient | null; baseName: string };

/**
 * WORD-NUMBER SEAM — the segmenter spends a word-number the parser already
 * spent, and the leftover lands in the cache KEY.
 *
 * `one slice of Swiss cheese` parses to {qty 1, unit slice, name "Swiss
 * cheese"} — the parser read `one` as the quantity. The AI segmenter's
 * `normalizedForm` for the same item is `one Swiss cheese`: it KEPT the number
 * and DROPPED the unit. That string is the cache-key input, so the key became
 * `cheese one swiss` — token-sorted and orphaned on arrival, because nothing a
 * user types as `swiss cheese` can ever reach it. Two such rows exist
 * (`cheese one swiss`, `banana one`, usedCount 1 each).
 *
 * IT KEYS ON THE DISAGREEMENT, NOT ON THE TOKEN, and that is the whole design.
 * Twelve of the 14 word-number keys in the cache are legitimate — the number is
 * the PRODUCT NAME (`cheese four freschetta pizza`, `panera soup ten
 * vegetable`) or the BRAND (`birthday cake one`, usedCount 242; `milk one`,
 * 203). Both obvious fixes are refuted in writing and break exactly those rows:
 *   (a) a blanket strip of a leading word-number, and
 *   (b) re-running normalizedForm through parseIngredientLine(), which reads a
 *       product-name number as a quantity (`four cheese pizza` -> qty 4;
 *       `one bar birthday cake` -> the ONE brand eaten).
 * Owner: `sync-docs/reports/2026-08-25_the-word-number-key-and-why-both-obvious-fixes-break-it.md`
 * (mobile repo) §3-§4.
 *
 * The conjuncts are what make it narrow. The RAW line must lead with the
 * word-number AND the parser must have spent it as a quantity alongside a UNIT
 * — so `four cheese pizza`, which yields no unit, cannot fire — and the
 * segmenter's name must lead with that SAME number while omitting that unit —
 * so `one slice whole wheat bread`, which keeps `slice`, is not a disagreement
 * at all. Verified against all 15 MappingEventLog pairs carrying the shape: it
 * fires on exactly the 2 that produced orphaned keys.
 *
 * The word list is IMPORTED from the parser rather than restated: that module's
 * own comment calls a second copy "the bug, not the design".
 *
 * @returns the stripped name, or null when this is not a disagreement.
 */
export function stripSpentWordNumber(
    rawLine: string,
    baseName: string,
    parsed: ParsedIngredient | null | undefined,
): string | null {
    if (!parsed) return null;
    const spentUnit = (parsed.unit ?? parsed.rawUnit ?? '').toString().toLowerCase();
    if (!spentUnit || !(parsed.qty >= 1)) return null;

    const rawLead = rawLine.trim().toLowerCase().split(/\s+/)[0];
    if (!QUANTITY_WORD_NUMBERS.has(rawLead)) return null;

    const nameTokens = baseName.split(/\s+/).filter(Boolean);
    if (nameTokens.length < 2) return null;                       // never strip to empty
    if (nameTokens[0].toLowerCase() !== rawLead) return null;     // must be the SAME number
    if (nameTokens.some(t => t.toLowerCase() === spentUnit)) return null;  // unit kept => no disagreement

    return nameTokens.slice(1).join(' ');
}

async function preflightIngredientLine(
    rawLine: string,
    trimmed: string,
    options: MapIngredientOptions,
): Promise<PreflightOutcome> {
    const { _skipFallback = false, telemetry } = options;

    // Step 0a: Check if this is a known synonym, use canonical name if so
    const canonicalName = await findCanonicalName(trimmed);
    const effectiveQuery = canonicalName || trimmed;

    if (canonicalName) {
        logger.debug('mapping.synonym_found', { rawLine: trimmed, canonicalName });
    }

    // Step 0b: Pre-parse unit cleanup
    // The parser doesn't recognize "second spray" as a unit (e.g., "0.33 second spray")
    // Replace it with just "spray" before parsing so the quantity and "spray" unit separate cleanly.
    let preProcessLine = effectiveQuery
        .replace(/\bseconds?\s+(spray|squirt)s?\b/gi, '$1')
        .replace(/\bsec\s+(spray|squirt)s?\b/gi, '$1');

    // Step 1: Parse and normalize
    // NOTE: Cache lookup now only happens after normalization (see "EARLY CACHE CHECK" below)
    // This eliminates "selection drift" where raw line variations would get different mappings
    let parsed = parseIngredientLine(preProcessLine);
    // LANE S: strip a partitive-`of` residue off ALL three branches, so the
    // parser path and the free-text/LLM paths (normalizedForm / preProcessLine,
    // which never pass through the parser's #350 skip) converge on the same
    // baseName. baseName is the retrieval query AND the deriveMappingCacheKey
    // input, so query and key move together (playbook §11 class-D defense),
    // and lookupValidatedMappingWithLegacyFallback's legacy-key fallback stops
    // resurrecting `garlic of`-class fork rows on the main path.
    let baseName = stripPartitiveOfResidue((options.normalizedForm?.trim() || parsed?.name?.trim() || preProcessLine).trim());

    // WORD-NUMBER SEAM — see stripSpentWordNumber() for the full reasoning.
    if (options.normalizedForm?.trim()) {
        const seamStripped = stripSpentWordNumber(trimmed, baseName, parsed);
        if (seamStripped !== null) {
            logger.info('mapping.word_number_seam_stripped', {
                rawLine: trimmed, normalizedForm: options.normalizedForm,
                qty: parsed?.qty, unit: parsed?.unit ?? parsed?.rawUnit, baseName,
                stripped: seamStripped,
            });
            baseName = seamStripped;
        }
    }

    // IDENTITY HINT RESTORATION — the discriminator survives into the cache KEY
    // and was being lost from the search QUERY.
    //
    // `extractUnitHint()` strips `white`/`yolk` off the name, so
    // `parseIngredientLine("egg whites")` yields `name: "egg"` with
    // `unitHint: "white"`, and baseName — the primary search term — became bare
    // `egg`. Measured cold: `MappingEventLog.normalizedForm` is `egg` for BOTH
    // `egg whites` and `egg yolk`, and both resolve to `fs_3092` "Egg"
    // (147 kcal, 9.9 g fat) — one record answering two opposite halves of a food
    // (golden n-mq-31 fat100 [0,1], n-mq-32 fat100 [20,40]).
    //
    // `deriveCacheKeyName()` in cache-key-core.ts already restores exactly these
    // hints via IDENTITY_UNIT_HINTS, which is why the WARM keys `egg white` and
    // `egg yolk` hold the correct FDC records and pass. Nothing did the same for
    // retrieval: the only code that ever did is `buildCoreQuery()` in
    // query-builder.ts, which has NO runtime importer anywhere (re-derive:
    // `grep -rn 'query-builder\|buildCoreQuery' src scripts` — the only hits are
    // a doc comment and winner-gate.sh's RETRIEVAL_PATHS, both of which believe
    // it is live). So this is the same "one owner, not every caller" shape as the
    // serving cascades, with the caller being dead code rather than absent.
    //
    // Reuses IDENTITY_UNIT_HINTS rather than re-deriving the set, so the key and
    // the query cannot drift apart again. Scoped tight: the set is {white, yolk},
    // `white` is egg-scoped at the parse layer, and this only fires when the
    // caller supplied no normalizedForm of its own.
    if (!options.normalizedForm?.trim()
        && parsed?.unitHint
        && IDENTITY_UNIT_HINTS.has(parsed.unitHint.toLowerCase())
        && !baseName.toLowerCase().split(/\s+/).includes(parsed.unitHint.toLowerCase())) {
        const withHint = `${baseName} ${parsed.unitHint.toLowerCase()}`.trim();
        logger.info('mapping.identity_hint_restored', {
            rawLine: trimmed, baseName, unitHint: parsed.unitHint, restored: withHint,
        });
        baseName = withHint;
    }

    // The SAME gap, one set over: IDENTITY_QUALIFIERS.
    //
    // `deriveCacheKeyName()` restores unit hints AND qualifiers into the key; the
    // block above restored only the hints into the QUERY. So `extractQualifiers()`
    // strips `cooked` out of `parsed.name`, the key keeps it, and the search term
    // does not — `1 cup cooked quinoa` is retrieved as bare `quinoa`.
    //
    // Measured 2026-08-03 with filter-trace-probe: on query `quinoa` the FDC record
    // "cooked quinoa" is gathered and then DROPPED by filterCandidatesByTokens
    // (the extra `cooked` token reads as bloat against a bare query), leaving
    // "uncooked quinoa" to win. On `cooked quinoa` it is kept. So this is an
    // ADMISSION defect, not a ranking one — pool never contained the right answer.
    //
    // Note this NARROWS the query, which is the opposite of the usual relaxation,
    // so it cannot be waved through as admit-only. Blast radius measured before
    // shipping: 12 of 348 golden cases carry one of these tokens and 57 of 5,586
    // distinct live lines (1.0%). `whole` reaches here as of 2026-08-04 on the
    // three PROTECTED_PRODUCT_PHRASES identity lines (`whole milk`, `whole wheat`,
    // `whole grain`) — previously `unit.ts` consumed it as a count unit first and
    // it could never fire. Elsewhere `whole` is still a portion word and is still
    // consumed as a unit, so this fires for those three plus cooked/raw/dried/canned.
    //
    // Reuses IDENTITY_QUALIFIERS rather than re-deriving it, for the same reason
    // the block above reuses IDENTITY_UNIT_HINTS: the key and the query must not
    // drift apart again.
    if (!options.normalizedForm?.trim() && parsed?.qualifiers?.length) {
        const present = new Set(baseName.toLowerCase().split(/\s+/));
        const restore = parsed.qualifiers
            .map(q => q.toLowerCase())
            .filter(q => IDENTITY_QUALIFIERS.has(q) && !present.has(q));
        if (restore.length) {
            const withQualifiers = `${[...new Set(restore)].join(' ')} ${baseName}`.trim();
            logger.info('mapping.identity_qualifier_restored', {
                rawLine: trimmed, baseName, qualifiers: restore, restored: withQualifiers,
            });
            baseName = withQualifiers;
        }
    }

    // Brand-preservation guard.
    // A segmenter — especially the LLM splitter in /api/nlp/parse — can hand us a
    // normalizedForm that dropped the query's brand token
    // ("2 scoops ghost vegan protein cinnamon roll" -> "vegan protein cinnamon roll").
    // baseName is the primary search term, so a brand-blind baseName retrieves
    // brand-blind candidates and a same-flavor competitor ("Optimum Nutrition
    // Cinnamon Roll Protein") hijacks the match — even though brand detection
    // downstream still flags the query as branded. If the raw line names a brand
    // (explicit `brand` hint or one detected in rawLine) that the chosen baseName
    // lost, re-derive baseName from the raw line (the mapper is proven robust on
    // the raw line) so the brand token survives into candidate retrieval.
    if (options.normalizedForm?.trim()) {
        const targetBrand = options.brand?.trim() || detectBrandInQuery(rawLine).matchedBrand;
        if (targetBrand && !baseName.toLowerCase().includes(targetBrand.toLowerCase())) {
            const rederived = parsed?.name?.trim() || preProcessLine;
            baseName = rederived.toLowerCase().includes(targetBrand.toLowerCase())
                ? rederived
                : `${targetBrand} ${rederived}`.trim();
            logger.debug('mapping.normalizedform_dropped_brand', {
                rawLine,
                normalizedForm: options.normalizedForm,
                targetBrand,
                rederivedBaseName: baseName,
            });
        }
    }

    // Step 1-AI-FALLBACK: If regex parser didn't detect a unit but input looks complex,
    // try AI to extract qty/unit/name. This handles edge cases like "1 5 floz serving red wine"
    // where the parser gets confused by the leading "1" serving count.
    const looksLikeHasUnit = /\d+\s*(floz|fl\s*oz|oz|cup|tbsp|tsp|ml|g|lb|lbs|serving)\b/i.test(trimmed);
    if (!parsed?.unit && looksLikeHasUnit && !_skipFallback) {
        logger.info('mapping.ai_parse_fallback_attempt', { rawLine: trimmed });
        const aiParsed = await aiParseIngredient(trimmed);
        if (aiParsed.status === 'success' && aiParsed.name) {
            // SANITY CHECK: Reject absurd quantity values
            // This catches OCR/import artifacts like "0 311625 cup" where the AI
            // might misinterpret malformed numbers as quantities
            const MAX_REASONABLE_QTY = 1000;
            const aiQty = aiParsed.qty ?? 1;

            if (aiQty > MAX_REASONABLE_QTY) {
                logger.warn('mapping.ai_parse_qty_rejected', {
                    rawLine: trimmed,
                    aiQty,
                    reason: 'exceeds_max_reasonable_qty',
                });
                // Don't use AI result - keep original parsed values

                // Log to dedicated file for debugging
                logAiParseEvent({
                    rawLine: trimmed,
                    regexResult: parsed,
                    triggerReason: 'unit_pattern_detected_but_not_parsed',
                    aiResult: aiParsed,
                    outcome: 'rejected_absurd_qty',
                });
            } else {
                // Update parsed with AI results
                parsed = {
                    qty: aiQty,
                    multiplier: 1,
                    unit: aiParsed.unit,
                    rawUnit: aiParsed.unit,
                    name: aiParsed.name,
                    notes: aiParsed.notes ?? null,
                    qualifiers: undefined,
                    unitHint: null,
                };
                baseName = aiParsed.name;
                logger.info('mapping.ai_parse_fallback_success', {
                    rawLine: trimmed,
                    qty: parsed.qty,
                    unit: parsed.unit,
                    name: parsed.name,
                });

                // Log to dedicated file for debugging
                logAiParseEvent({
                    rawLine: trimmed,
                    regexResult: { qty: null, unit: null, name: trimmed },  // Original failed parse
                    triggerReason: 'unit_pattern_detected_but_not_parsed',
                    aiResult: aiParsed,
                    outcome: 'success',
                });
            }
        } else {
            // This is the ONLY record of an aiParseIngredient() failure. The two
            // sibling branches above each emit a structured logger.* line before
            // their logAiParseEvent() call; this one did not, so once the file
            // write went behind ENABLE_AI_PARSE_LOG the outcome would have gone
            // dark entirely. Keep the warn unguarded.
            logger.warn('mapping.ai_parse_failed', {
                rawLine: trimmed,
                reason: aiParsed.status === 'error' ? aiParsed.reason : 'no_result',
            });

            // Log failed AI parse attempts
            logAiParseEvent({
                rawLine: trimmed,
                regexResult: parsed,
                triggerReason: 'unit_pattern_detected_but_not_parsed',
                aiResult: aiParsed.status === 'error' ? { error: aiParsed.reason } : null,
                outcome: 'ai_failed',
            });
        }
    }

    // Step 1-VALIDATION: Reject lines with no actual food name (only qty/unit)
    // e.g., "4 1/2 oz" has no food name - should not map to anything
    const UNIT_ONLY_PATTERN = /^\s*(\d[\d\s\/\.]*\s*)?(oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|cup|cups|tbsp|tsp|quart|gallon)?\s*$/i;
    if (!baseName || UNIT_ONLY_PATTERN.test(baseName.trim())) {
        logger.warn('mapping.no_food_name', { rawLine: trimmed, baseName });
        return { done: true, result: null };
    }

    // ============================================================
    // Step 1-WATER: Early exit for ice/water - always zero calories
    // ============================================================
    // These ingredients have no nutritional value and should never map to food.
    // IMPORTANT: the match is anchored to the WHOLE line (after qty/unit stripping) —
    // the old suffix/last-word matching made "canned tuna in water" bill 0 kcal.
    // Lines that merely CONTAIN water phrasing must proceed through normal mapping.
    // Note: "liquid" added to handle ambiguous inputs like "100% liquid" that normalize to just "liquid"
    const ZERO_CALORIE_INGREDIENTS = [
        'ice', 'ice cubes', 'crushed ice', 'shaved ice',
        'water', 'tap water', 'cold water', 'hot water', 'warm water', 'ice water', 'iced water',
        'still water', 'sparkling water', 'mineral water', 'spring water', 'carbonated water',
        'filtered water', 'drinking water',
        'liquid',
    ];
    // Strip leading "100%"-style prefixes so "100% liquid" → "liquid" still matches whole-line
    const baseNameLowerForWaterCheck = baseName.toLowerCase().trim().replace(/^\d+(?:\.\d+)?\s*%\s*/, '');
    if (ZERO_CALORIE_INGREDIENTS.includes(baseNameLowerForWaterCheck)) {
        logger.info('mapping.zero_calorie_default', { rawLine: trimmed, baseName });
        markFunnel(telemetry, 'fast_path', 'zero_calorie');

        // Calculate grams from parsed quantity using standard conversions
        const WATER_UNIT_GRAMS: Record<string, number> = {
            'cup': 237, 'cups': 237,
            'ml': 1, 'milliliter': 1, 'milliliters': 1,
            'l': 1000, 'liter': 1000, 'liters': 1000,
            'oz': 29.57, 'ounce': 29.57, 'ounces': 29.57,
            'fl oz': 29.57, 'floz': 29.57, 'fluid ounce': 29.57,
            'tbsp': 14.79, 'tablespoon': 14.79,
            'tsp': 4.93, 'teaspoon': 4.93,
            'g': 1, 'gram': 1, 'grams': 1,
        };
        const unitLower = parsed?.unit?.toLowerCase() || 'cup';
        const gramsPerUnit = WATER_UNIT_GRAMS[unitLower] || 237;  // Default to 1 cup
        const qty = parsed ? parsed.qty * parsed.multiplier : 1;
        const totalGrams = gramsPerUnit * qty;

        const waterResult: FatsecretMappedIngredient = {
            source: 'cache',
            foodId: 'water_default',
            foodName: 'Water',
            brandName: null,
            servingId: null,
            servingDescription: `${qty} ${parsed?.unit || 'cup'}`,
            grams: totalGrams,
            kcal: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            confidence: 1.0,
            quality: 'high',
            rawLine,
        };
        return { done: true, result: waterResult };
    }

    // NUTRITION-MODIFIER RESTORATION (site A). Placed LAST in preflight on
    // purpose: `baseName` is reassigned wholesale by three later steps — the
    // brand guard, the AI-parse fallback and `GENERIC_FALLBACKS` — so a
    // restoration nearer the top is silently clobbered by any of them.
    //
    // MEASURED 2026-08-15: the segmenter's per-item `normalizedForm` becomes
    // `baseName` outright for a composite line, and it strips the modifier while
    // the sibling `rawText` keeps it — 16 of 23 modifier-bearing cached segments.
    // `rawText` is what arrives here as `rawLine` (see the mapper's call site in
    // `app/api/nlp/parse/route.ts`), so the user's own words are the evidence.
    //
    // Live consequence this repairs: `a plate with sugar free greek yogurt`
    // derived the cache key for bare `greek yogurt`, hit that row, and billed
    // 3.9 g of sugar; the solo path resolved the same request to a genuinely
    // sugar-free record at 0 g. The composite request was being served the
    // unmodified food.
    //
    // It ADDS ONLY, and only words already present in the user's text, so it
    // cannot manufacture a claim the user did not make. That is what makes it
    // safe to run unconditionally — the two existing restorations here are both
    // gated `!options.normalizedForm?.trim()` and are therefore structurally
    // unable to fire on the composite path, which is the only path with this bug.
    const modifierRepair = restoreNutritionModifiers(`${rawLine} ${baseName}`, baseName);
    if (modifierRepair.added.length > 0) {
        logger.info('mapping.nutrition_modifier_restored', {
            rawLine,
            site: 'preflight',
            before: baseName,
            after: modifierRepair.restored,
            restored: modifierRepair.added,
        });
        baseName = modifierRepair.restored;
    }

    return { done: false, parsed, baseName };
}

// ============================================================
// Main Entry Point
// ============================================================

export async function mapIngredientWithFallback(
    rawLine: string,
    options: MapIngredientOptions = {}
): Promise<FatsecretMappedIngredient | MapIngredientPendingResult | null> {
    const {
        minConfidence = 0,
        debug = false,
        skipCache = false,
        skipSave = false,
        skipFdc = false,
        allowLiveFallback = true,
        _skipInFlightLock = false,
        _skipFallback = false,
        skipOnLock = false,
        telemetry,
        // THE single decision point for callers that decline to own a budget:
        // one fresh per-call allowance. A looping caller MUST pass its own
        // shared object instead (see MapIngredientOptions.aiNutritionBudget) —
        // otherwise every query in the loop mints a new allowance and the run
        // is unbounded.
        aiNutritionBudget = createAiNutritionBudget(AI_NUTRITION_MAX_PER_REQUEST),
        // The SECOND allowance. Defaulted independently — a caller that owns one
        // budget and not the other must not silently get its last-resort pool
        // spent on hydration (or the reverse).
        aiHydrationBudget = createAiNutritionBudget(AI_NUTRITION_HYDRATION_MAX_PER_REQUEST),
    } = options;

    const trimmed = rawLine.trim();
    if (!trimmed) return null;

    const pre = await preflightIngredientLine(rawLine, trimmed, options);
    if (pre.done) return pre.result;
    let { parsed, baseName } = pre;

    // ============================================================
    // IN-FLIGHT LOCK: Prevent parallel processing of identical ingredients
    // ============================================================
    // CRITICAL: Use baseName (before AI normalization) as the lock key.
    // AI normalization is non-deterministic and can return different values
    // for the same input. Using baseName ensures ALL threads for the same
    // parsed ingredient wait for the first one to finish.
    const lockKey = getLockKey(baseName);
    const existingLock = inFlightLocks.get(lockKey);

    // Skip lock check if this is a recursive fallback call (to prevent self-deadlock)
    if (existingLock && !_skipInFlightLock) {
        // If skipOnLock is enabled, return pending immediately instead of blocking
        if (skipOnLock) {
            logger.debug('mapping.skip_on_lock', { baseName, lockKey });
            return { status: 'pending', lockKey, rawLine: trimmed };
        }

        logger.debug('mapping.waiting_for_lock', { baseName, lockKey });
        await existingLock;  // Wait for the other thread to finish

        // After lock released, check cache - the first thread should have saved
        const normalizedForCache = normalizeIngredientName(baseName).cleaned || baseName;
        const cachedAfterLock = await getValidatedMappingByNormalizedName(normalizedForCache, 'fatsecret', trimmed);
        if (cachedAfterLock) {
            logger.debug('mapping.cache_hit_after_lock', { baseName, foodName: cachedAfterLock.foodName });
            const cachedCandidate: UnifiedCandidate = {
                id: cachedAfterLock.foodId,
                name: cachedAfterLock.foodName,
                brandName: cachedAfterLock.brandName || undefined,
                source: cachedAfterLock.source as any,
                score: cachedAfterLock.confidence,
                foodType: 'generic',
                rawData: {},
            };
            const hydratedResult = await hydrateAndSelectServing(
                cachedCandidate, parsed, cachedAfterLock.confidence, rawLine, aiHydrationBudget
            );
            if (hydratedResult) {
                // Track and log cache hit
                incrementCacheHit();
                if (ENABLE_MAPPING_ANALYSIS) {
                    logMappingAnalysis({
                        rawIngredient: trimmed,
                        parsed: {
                            amount: parsed?.qty,
                            unit: parsed?.unit,
                            ingredient: parsed?.name,
                        },
                        topCandidates: [],
                        selectedCandidate: {
                            foodId: cachedAfterLock.foodId,
                            foodName: cachedAfterLock.foodName,
                            brandName: cachedAfterLock.brandName || '',
                            confidence: cachedAfterLock.confidence,
                            selectionReason: 'cache_hit_after_lock',
                        },
                        selectedNutrition: {
                            calories: hydratedResult.kcal,
                            protein: hydratedResult.protein,
                            carbs: hydratedResult.carbs,
                            fat: hydratedResult.fat,
                            perGrams: hydratedResult.grams,
                        },
                        servingSelection: {
                            servingDescription: hydratedResult.servingDescription || 'N/A',
                            grams: hydratedResult.grams,
                            backfillUsed: false,
                        },
                        finalResult: 'success',
                        source: 'early_cache',
                        aiCalls: undefined,
                    });
                }
                return hydratedResult;
            }
        }
        logger.warn('mapping.lock_released_but_no_cache', { baseName });
    }

    // Register lock - this thread will process this ingredient
    let resolveLock: (result: FatsecretMappedIngredient | null) => void;
    const lockPromise = new Promise<FatsecretMappedIngredient | null>((resolve) => {
        resolveLock = resolve;
    });
    inFlightLocks.set(lockKey, lockPromise);

    try {

        // Step 1a: Expand overly generic single-word ingredients to sensible defaults
        // This prevents failures on terms like "oil", "liquid" that are too vague
        const GENERIC_FALLBACKS: Record<string, string> = {
            'oil': 'vegetable oil',
            'liquid': 'water',
            'fat': 'vegetable oil',
            'shortening': 'vegetable shortening',
            'broth': 'chicken broth',
            'stock': 'chicken stock',
            'vinegar': 'white vinegar',
            'wine': 'white wine',
            'cheese': 'cheddar cheese',
            'flour': 'all purpose flour',
            'sugar': 'granulated sugar',
            'syrup': 'maple syrup',
            'cream': 'heavy cream',
            'extract': 'vanilla extract',
        };

        const baseNameLower = baseName.toLowerCase().trim();
        let usedGenericFallback = false;
        if (GENERIC_FALLBACKS[baseNameLower]) {
            logger.info('mapping.generic_fallback', {
                original: baseName,
                fallback: GENERIC_FALLBACKS[baseNameLower]
            });
            baseName = GENERIC_FALLBACKS[baseNameLower];
            usedGenericFallback = true;
        }

        let normalizedName = normalizeIngredientName(baseName).cleaned || baseName;
        // Set only when the brand-preservation repair below rewrites
        // normalizedName. The legacy (brandless) cache key must keep being
        // derived from the PRE-injection value or the legacy fallback
        // short-circuits — see lookupValidatedMappingWithLegacyFallback().
        let preBrandNormalizedName: string | undefined;

        // ── Brand detection (static list + AI passed brand) ─────────────
        // Must run before the early cache check so the brand guard is available
        // when validating cached results against the user's intended brand.
        const brandDetectionResult = detectBrandInQuery(rawLine);
        const brandDetection = {
            isBranded: brandDetectionResult.isBranded || !!options.brand?.trim(),
            matchedBrand: options.brand?.trim() || brandDetectionResult.matchedBrand
        };
        let isBrandedQuery = brandDetection.isBranded;
        // Whether the static brand evidence spans two words, and so outranks a
        // model that answers is_branded=false. Computed here because both
        // overwrite sites below need it and only this scope has the raw line.
        // See resolveIsBrandedQuery() for why an unconditional upgrade-only
        // rule is refuted.
        const decisiveBrandContext = brandDetection.matchedBrand
            ? hasDecisiveBrandContext(trimmed, brandDetection.matchedBrand.trim())
            : false;
        if (brandDetection.isBranded) {
            logger.debug('brand_detector.matched', {
                rawLine,
                matchedBrand: brandDetection.matchedBrand,
            });
        }


        // ============================================================
        // EARLY CACHE CHECK - Skip AI if we've seen this ingredient before
        // ============================================================
        // Check ValidatedMapping for normalized name BEFORE calling AI
        // This is the key optimization: "1 cup chopped onion" → normalized "onion" → cache hit!
        if (telemetry) telemetry.normalizedForm = normalizedName;
        // ESCAPED INCUMBENTS FORFEIT (2026-08-01). Every cached row the read
        // path refuses below is appended here, by RECORD identity, and handed to
        // saveValidatedMapping as `readEscapes`. A row that could not serve this
        // request has proven itself unusable, so it forfeits its cross-source
        // displacement margin — otherwise the escape→re-resolve→blocked-save
        // loop freezes it in place forever. Explicit and typed on purpose:
        // nothing downstream infers it from telemetry.
        //
        // Deliberately NOT recorded: the post-hit `early_cache_hydration_failed`
        // fall-through below. Every escape here is a property of the ROW (or of
        // row-vs-query identity) and so recurs on every request; hydration
        // depends on THIS request's qty/unit, and one odd unit must not strip a
        // healthy incumbent's protection. It is labelled for telemetry so the
        // population can be measured before anyone widens this.
        const readEscapes: ReadEscapeRecord[] = [];
        const noteReadEscape = (targetKey: string | null | undefined, reason: string) => {
            if (targetKey) readEscapes.push({ targetKey, reason });
        };

        // PR D pt3 (C1) + key symmetry (Track 1c): lookup key carries identity
        // discriminators (egg white/yolk, cooked, whole) AND the brand-prefix
        // decision — deriveMappingCacheKey is THE key function, used verbatim
        // at the step-1c lookup and the Step-6 save key. brandDetection (not
        // the AI-mutable isBrandedQuery) is the brand input at all three
        // sites: it's the only brand signal that exists this early. A miss
        // additionally falls back to the legacy (pre-Track-1c) key so rows
        // written under the old scheme stay reachable.
        const earlyLookupRejection: CacheLookupRejection = { reason: null };
        const earlyCacheHit = skipCache ? null : await lookupValidatedMappingWithLegacyFallback(normalizedName, parsed, brandDetection, trimmed, earlyLookupRejection);
        if (!earlyCacheHit && earlyLookupRejection.reason) {
            // A row existed under this key and the read path rejected it. Without
            // this the event is indistinguishable from a cold key, which is how
            // rows that are written and then never servable stayed invisible.
            if (telemetry) telemetry.cacheEscape = 'lookup_early:' + earlyLookupRejection.reason;
            noteReadEscape(earlyLookupRejection.targetKey, 'lookup_early:' + earlyLookupRejection.reason);
        }
        if (earlyCacheHit) {
            logger.info('mapping.early_cache_hit', { rawLine: trimmed, normalizedName, foodName: earlyCacheHit.foodName });

            // Validate cached mapping against current filters
            // Cached mappings from before filter improvements may have bad mappings
            const earlyCoreTokenMismatch = hasCoreTokenMismatch(normalizedName, earlyCacheHit.foodName, earlyCacheHit.brandName);

            let earlyNutritionInvalid = false;
            let earlyCorruptMarked = false;
            // fs_ only: the record has no per-100g panel but DOES carry per-serving
            // macros, which buildFatSecretResult() bills directly. Suppresses the
            // missing-nutrition safety net below — see the fs_ arm for the measurement.
            let fsBillableViaServings = false;
            let loadedFdcNutrition: any = null;
            let cachedOffServing: { servingSize: string | null; servingGrams: number | null } | null = null;
            let cachedKcal100: number | null = null;
            let cachedCarbs100: number | null = null;

            if (!earlyCoreTokenMismatch) {
                const { prisma } = await import('../db');
                if (earlyCacheHit.foodId.startsWith('fdc_')) {
                    const fdcId = parseInt(earlyCacheHit.foodId.replace('fdc_', ''), 10);
                    const cachedFdc = await prisma.fdcFood.findUnique({
                        where: { fdcId },
                        select: { nutrientsPer100g: true }
                    });
                    if (cachedFdc?.nutrientsPer100g) {
                        const rawFdc: any = cachedFdc.nutrientsPer100g;
                        loadedFdcNutrition = {
                            kcal: rawFdc.calories ?? rawFdc.energy ?? rawFdc.kcal ?? 0,
                            protein: rawFdc.protein ?? 0,
                            carbs: rawFdc.carbohydrate ?? rawFdc.carbs ?? 0,
                            fat: rawFdc.fat ?? 0,
                            per100g: true,
                        };
                        cachedKcal100 = loadedFdcNutrition.kcal || null;
                        cachedCarbs100 = loadedFdcNutrition.carbs || null;
                        earlyNutritionInvalid = hasNullOrInvalidMacros(loadedFdcNutrition);
                        if (earlyNutritionInvalid) {
                            logger.warn('mapping.early_cache_bad_nutrition', {
                                rawLine: trimmed,
                                cachedFood: earlyCacheHit.foodName,
                                nutrients: loadedFdcNutrition,
                            });
                        }
                    }
                } else {
                    let nutrients: any = null;
                    if (earlyCacheHit.foodId.startsWith('off_')) {
                        const barcode = earlyCacheHit.foodId.replace('off_', '');
                        const off = await prisma.offFood.findUnique({
                            where: { barcode },
                            select: { nutrientsPer100g: true, servingSize: true, servingGrams: true, corruptReason: true }
                        });
                        nutrients = off?.nutrientsPer100g;
                        if (off) {
                            cachedOffServing = { servingSize: off.servingSize, servingGrams: off.servingGrams };
                            earlyCorruptMarked = off.corruptReason != null && isCorruptExclusionEnabled();
                        }
                    } else if (earlyCacheHit.foodId.startsWith('fs_')) {
                        // FatSecret cache hits were NOT validated here until 2026-08-01.
                        // This arm used to be an `aiGeneratedFood.findUnique({ id: foodId })`,
                        // which executed on every fs_ hit and could never match: measured, 0
                        // of the 149 AiGeneratedFood ids carry an fs_/off_/fdc_ prefix (they
                        // are cuids). So `nutrients` stayed null, and because the
                        // missing-nutrition safety net below was gated on off_ alone, fs_
                        // hits skipped hasNullOrInvalidMacros() entirely.
                        // An empty per-100g panel is NOT the same as "no nutrition" for the
                        // fs lane. FatSecret's generic restaurant records are exactly the
                        // shape `nutrientsPer100g = {}` + a "1 serving" FatSecretServing
                        // carrying full macros and no grams, and buildFatSecretResult()
                        // bills those serving macros directly (its `anyServingHasMacros`
                        // branch, added deliberately for "Impossible Whopper" and friends).
                        // MEASURED 2026-08-01 on the live DB: of the 570 FoodMapping rows
                        // carrying an fsId, 35 have an empty panel — and ALL 35 have a
                        // macro-bearing serving, i.e. every one is correctly billable today
                        //   SELECT count(*) FROM "FoodMapping" m
                        //     JOIN "FatSecretFood" f ON f."fsId"=m."fsId"
                        //    WHERE f."nutrientsPer100g"::text='{}'
                        //      AND EXISTS (SELECT 1 FROM "FatSecretServing" s
                        //                   WHERE s."fsId"=f."fsId"
                        //                     AND s.nutrients->>'calories' IS NOT NULL);
                        //   -> 35 ; the NOT EXISTS form -> 0
                        // Escaping on the panel alone would therefore have been a 100%
                        // false-positive rule: it would re-resolve "Quarter Pounder with
                        // Cheese" / "Pad Thai (Small)" on EVERY request forever (the
                        // re-resolution's winner is the same fs row, so the upsert rewrites
                        // an identical row and the next request escapes again).
                        // So ask the question the billing path asks, through the SAME reader
                        // it bills with — servingMacros() from ./fs-serving-macros.
                        const fsId = earlyCacheHit.foodId.replace('fs_', '');
                        const fsFood = await prisma.fatSecretFood.findUnique({
                            where: { fsId },
                            select: { nutrientsPer100g: true, servings: { select: { nutrients: true } } }
                        });
                        const fsPanel = fsFood?.nutrientsPer100g as Record<string, any> | null | undefined;
                        nutrients = fsPanel && Object.keys(fsPanel).length > 0 ? fsPanel : null;
                        fsBillableViaServings = (fsFood?.servings ?? []).some(
                            s => servingMacros(s.nutrients as Record<string, unknown> | null) != null);
                    } else {
                        // No recognised prefix. Every candidate id is prefixed by
                        // construction (gatherCandidates forces fdc_/fs_, OFF candidates are
                        // built as off_${barcode}), and getValidatedMappingByNormalizedName
                        // no longer fabricates an unprefixed id from normalizedForm — it
                        // refuses the row instead. So reaching here should be impossible.
                        //
                        // INSTRUMENT ONLY, deliberately: this does NOT force
                        // earlyNutritionInvalid. Refusing here would change behaviour only
                        // for a shape that measurably cannot occur (0 of 3,509 FoodMapping
                        // rows have all three target columns null), while the fail-closed
                        // guarantee already lives at the source in the read path, where it
                        // is measured and tested. Audit is non-suppressible, so if this ever
                        // does fire we will see it and can then decide with evidence.
                        logger.audit('cache.unrecognised_food_id_prefix', {
                            foodId: earlyCacheHit.foodId,
                            cachedFood: earlyCacheHit.foodName,
                        });
                    }
                    if (nutrients) {
                        const loadedNutrition = {
                            kcal: nutrients.calories ?? nutrients.energy ?? nutrients.kcal ?? 0,
                            protein: nutrients.protein ?? 0,
                            carbs: nutrients.carbohydrate ?? nutrients.carbs ?? 0,
                            fat: nutrients.fat ?? 0,
                            per100g: true,
                        };
                        cachedKcal100 = loadedNutrition.kcal || null;
                        cachedCarbs100 = loadedNutrition.carbs || null;
                        // The food name matters: it is what lets hasNullOrInvalidMacros apply
                        // its sweetener / zero-calorie exceptions. Measured — without it the
                        // fs_ check newly rejects "Stevia" (0 kcal, 50g carbs) as a
                        // macro/calorie inconsistency; with it, 0 of the 535 non-empty fs
                        // panels are false-positived.
                        earlyNutritionInvalid = hasNullOrInvalidMacros(loadedNutrition, earlyCacheHit.foodName);
                        if (earlyNutritionInvalid) {
                            logger.warn('mapping.early_cache_bad_nutrition', {
                                rawLine: trimmed,
                                cachedFood: earlyCacheHit.foodName,
                                nutrients,
                            });
                        }
                    } else if (earlyCacheHit.foodId.startsWith('off_')
                        || (earlyCacheHit.foodId.startsWith('fs_') && !fsBillableViaServings)) {
                        // The cached mapping points at a record that is missing or has no
                        // nutrition at all (corrupt legacy rows, e.g. a normalized name
                        // ingested as a barcode; an fs record with neither a per-100g panel
                        // NOR any macro-bearing serving). Treat as invalid so the full
                        // pipeline re-maps instead of serving null-backed nutrition.
                        // Extended from off_ to fs_ on 2026-08-01; deliberately NOT extended
                        // to fdc_ or to unrecognised prefixes, which are separate unmeasured
                        // changes. MEASURED 2026-08-01: 0 of the 570 live fs_ mappings are
                        // in the no-panel-and-no-serving-macros state, so this arm is a
                        // guard against future ingests, not a live eviction.
                        earlyNutritionInvalid = true;
                        logger.warn('mapping.early_cache_missing_nutrition', {
                            rawLine: trimmed,
                            cachedFood: earlyCacheHit.foodName,
                            foodId: earlyCacheHit.foodId,
                        });
                    }
                }
            }

            // Counted-piece cache escape (Cluster A pt2, Jul 2026): the user is
            // counting pieces but the cached OFF food's label can't provide a
            // per-piece weight. Fall through to the full pipeline so rerank's
            // count-label preference can pick a SKU that can. NOT a one-time
            // re-resolution: when no count-labeled SKU exists to win, the same
            // form escapes on every request (measured 2026-08-09/12: 1,261+
            // events over 34+ forms, up to 271 per form). countedPieceNoun's
            // qty >= 2 gate keeps bare/qty-1 lines — the bulk of that loop —
            // out of this escape entirely; the owner is
            // sync-docs/reports/2026-08-09_serving-class-keys-the-pick-is-already-unit-aware.md §8.
            const earlyCountedNoun = countedPieceNoun(parsed);
            const earlyCountLabelEscape = earlyCountedNoun != null
                && earlyCacheHit.foodId.startsWith('off_')
                && !servingLabelCountsPiece(cachedOffServing?.servingSize, cachedOffServing?.servingGrams, earlyCountedNoun);

            // Cooked-grain cache escape (cooked-vs-dry fix, Jul 2026): the line
            // is a volume-unit grain (prefers cooked basis) but the cached food
            // doesn't demonstrably look cooked — no cooked token in its name
            // and its nutrition is outside the cooked-grain window. Fall
            // through so the full pipeline's cooked preference re-resolves;
            // the write-back makes this a one-time re-resolution per name.
            const earlyCachedLooksCooked = /\b(cooked|boiled|steamed|prepared)\b/i.test(earlyCacheHit.foodName)
                || (cachedKcal100 != null && cachedKcal100 > 60 && cachedKcal100 <= 250
                    && cachedCarbs100 != null && cachedCarbs100 >= 12);
            const earlyGrainCookedEscape = detectGrainCookingContext(trimmed, normalizedName).softCooked === true
                && !earlyCachedLooksCooked;

            // Escape reason doubles as the telemetry label (PR D pt3 split the
            // former catch-all 'filter_mismatch' into per-condition labels).
            // Same predicates, same evaluation order as the former || chain.
            let earlyEscapeReason =
                earlyCorruptMarked ? 'corrupt_record'
                : earlyCoreTokenMismatch ? 'core_token_mismatch'
                : earlyNutritionInvalid ? 'nutrition_invalid'
                : earlyCountLabelEscape ? 'count_label'
                : earlyGrainCookedEscape ? 'grain_cooked'
                : isCategoryMismatch(normalizedName, earlyCacheHit.foodName, earlyCacheHit.brandName) ? 'category_mismatch'
                : isMultiIngredientMismatch(normalizedName, earlyCacheHit.foodName) ? 'multi_ingredient'
                : hasCriticalModifierMismatch(trimmed, earlyCacheHit.foodName, 'cache') ? 'modifier_mismatch'
                : isReplacementMismatch(trimmed, earlyCacheHit.foodName, earlyCacheHit.brandName) ? 'replacement_mismatch'
                // Branded query guard: if a target brand is detected (e.g. "heinz") and the cached
                // food belongs to a DIFFERENT brand (e.g. WEIS), reject the cache hit so the full
                // pipeline runs and finds the correct brand.
                : (isBrandedQuery &&
                    brandDetection.matchedBrand != null &&
                    earlyCacheHit.brandName != null &&
                    !earlyCacheHit.brandName.toLowerCase().includes(brandDetection.matchedBrand.toLowerCase())
                ) ? 'brand_guard'
                : null;

            // Read-time trust (PR D pt3, HUMAN_ROW_TRUST): human-triage rows
            // are deliberate identity repoints — the five NAME-heuristic
            // escapes must not evict them (see isTrustedHumanRow). Kept
            // active for ALL rows: corrupt_record, core_token_mismatch,
            // nutrition_invalid, count_label and grain_cooked — a repoint
            // fixes identity, not data validity or serving shape.
            if (earlyEscapeReason
                && isHumanTrustSkippableEscape(earlyEscapeReason)
                && isTrustedHumanRow(earlyCacheHit.validatedBy)) {
                logger.info('cache.human_row_trusted', {
                    key: normalizedName,
                    foodId: earlyCacheHit.foodId,
                    skippedRejection: 'early:' + earlyEscapeReason,
                });
                earlyEscapeReason = null;
            }

            if (earlyEscapeReason) {
                logger.warn('mapping.early_cache_filter_mismatch', {
                    rawLine: trimmed,
                    cachedFood: earlyCacheHit.foodName,
                    normalized: normalizedName,
                    coreTokenMismatch: earlyCoreTokenMismatch,
                    nutritionInvalid: earlyNutritionInvalid,
                    countLabelEscape: earlyCountLabelEscape,
                    grainCookedEscape: earlyGrainCookedEscape,
                });
                if (telemetry) {
                    telemetry.cacheEscape = 'early:' + earlyEscapeReason;
                }
                noteReadEscape(targetKeyOfFoodId(earlyCacheHit.foodId), 'early:' + earlyEscapeReason);
                // Fall through to normal search - don't use stale cached mapping
            } else {
                // Create synthetic candidate from cached result
                const cachedCandidate: UnifiedCandidate = {
                    id: earlyCacheHit.foodId,
                    name: earlyCacheHit.foodName,
                    brandName: earlyCacheHit.brandName || undefined,
                    source: earlyCacheHit.source as any,
                    score: earlyCacheHit.confidence,
                    foodType: 'generic',
                    rawData: {},
                    ...(loadedFdcNutrition ? { nutrition: loadedFdcNutrition } : {})
                };

                // Hydrate with current request's quantity/unit
                const hydratedResult = await hydrateAndSelectServing(
                    cachedCandidate,
                    parsed,
                    earlyCacheHit.confidence,
                    trimmed,
                    aiHydrationBudget
                );

                if (hydratedResult) {
                    // Track cache hit for metrics
                    incrementCacheHit();
                    if (telemetry) telemetry.cacheHit = 'early';
                    markFunnel(telemetry, 'cache_hit');

                    // Log the early cache hit
                    if (ENABLE_MAPPING_ANALYSIS) {
                        logMappingAnalysis({
                            rawIngredient: trimmed,
                            parsed: {
                                amount: parsed?.qty,
                                unit: parsed?.unit,
                                ingredient: parsed?.name,
                            },
                            topCandidates: [],
                            selectedCandidate: {
                                foodId: earlyCacheHit.foodId,
                                foodName: earlyCacheHit.foodName,
                                brandName: earlyCacheHit.brandName || '',
                                confidence: earlyCacheHit.confidence,
                                selectionReason: 'early_cache_hit_after_normalize',
                            },
                            selectedNutrition: {
                                calories: hydratedResult.kcal,
                                protein: hydratedResult.protein,
                                carbs: hydratedResult.carbs,
                                fat: hydratedResult.fat,
                                perGrams: hydratedResult.grams,
                            },
                            servingSelection: {
                                servingDescription: hydratedResult.servingDescription || 'N/A',
                                grams: hydratedResult.grams,
                                backfillUsed: false,
                            },
                            finalResult: 'success',
                            source: 'early_cache',
                            aiCalls: undefined,  // No AI calls for cache hits
                        });
                    }
                    return hydratedResult;
                }
                // If hydration fails, continue with normal flow. Labelled (it was
                // a silent fall-through) but NOT a forfeit — see readEscapes.
                if (telemetry) telemetry.cacheEscape = 'early:hydration_failed';
                logger.warn('mapping.early_cache_hydration_failed', { rawLine: trimmed, foodId: earlyCacheHit.foodId });
            }
        }

        // Step 1b: Check for learned synonyms BEFORE calling AI
        const { getLearnedSynonyms, extractTermsFromIngredient } = await import('./learned-synonyms');
        const ingredientTerms = extractTermsFromIngredient(normalizedName);
        let learnedSynonyms: string[] = [];

        for (const term of ingredientTerms.slice(0, 3)) { // Check top 3 terms
            const synonyms = await getLearnedSynonyms(term);
            if (synonyms.length > 0) {
                learnedSynonyms.push(...synonyms);
            }
        }

        // Try AI normalization for better search terms
        // SKIP if we already applied a generic fallback (to avoid AI changing "vegetable oil" to "cooking oil")
        // ============================================================
        // STEP 5: NORMALIZE GATE - Skip LLM if heuristics are sufficient
        // ============================================================
        let aiSynonyms: string[] = [];
        let aiNutritionEstimate: { caloriesPer100g: number; proteinPer100g: number; carbsPer100g: number; fatPer100g: number; confidence: number } | undefined;
        let aiCanonicalBase: string | undefined;  // For cache key consolidation
        let aiCookingModifier: string | undefined;  // Persisted to FoodMapping.cookingModifier (grouping only)
        let skippedLlmNormalize = false;
        // ── Brand detection (already computed above, available here too) ────
        // isBrandedQuery and brandDetection are set before the early cache check.
        // The LLM result below may upgrade isBrandedQuery to true if the AI
        // returns isBranded=true even when the static detector missed it, and
        // may downgrade it only where the static brand evidence is not decisive
        // — both through resolveIsBrandedQuery(). Until 2026-08-03 the
        // assignments were unconditional, so this comment described an
        // upgrade-only rule the code did not implement.

        // Kept from the quick gate check so the full gather can reuse the FDC
        // results instead of re-running identical searches.
        let quickGatherCandidates: UnifiedCandidate[] | null = null;
        let quickGatherName = '';

        if (!usedGenericFallback) {
            // First gather candidates to check if LLM is needed
            const quickGatherOptions: GatherOptions = {
                skipCache,
                skipFdc,
                skipOff: true,  // Always skip OFF during quick gate check (saves API quota)
                aiSynonyms: learnedSynonyms,  // Use only learned synonyms for quick check
            };

            const quickCandidates = await gatherCandidates(rawLine, parsed, normalizedName, quickGatherOptions);
            quickGatherCandidates = quickCandidates;
            quickGatherName = normalizedName;
            const modConstraints = extractModifierConstraints(trimmed);
            const gateDecision = shouldNormalizeLlm(trimmed, quickCandidates, modConstraints);

            if (gateDecision.shouldCallLlm) {
                logger.info('normalize_gate.calling_llm', {
                    rawLine: trimmed,
                    reason: gateDecision.reason,
                    candidateCount: quickCandidates.length
                });

                // FIX: Pass baseName instead of rawLine so the LLM output is cached by the normalized quantity-free string
                const aiHint = await aiNormalizeIngredient(baseName, normalizedName);
                if (aiHint.status === 'success') {
                    // The model's output is otherwise taken on trust here. Strip
                    // any food-REPLACING token it introduced that the user never
                    // typed: `vanilla yogurt` -> `vanilla yogurt extract` sends a
                    // 288 kcal/100g ingredient to retrieval and wins with it.
                    // Compared against the raw line AND baseName, so a user who
                    // really did say "extract" (or GENERIC_FALLBACKS expanding the
                    // bare word into one) is never second-guessed.
                    const guardInput = `${trimmed} ${baseName}`;
                    if (aiHint.normalizedName) {
                        const repaired = stripIntroducedFoodTokens(guardInput, aiHint.normalizedName);
                        if (repaired.removed.length > 0) {
                            logger.info('mapping.llm_introduced_food_token', {
                                rawLine: trimmed,
                                llmOutput: aiHint.normalizedName,
                                repaired: repaired.cleaned,
                                removed: repaired.removed,
                            });
                        }
                        // Re-strip after the guard: removing an introduced food token can leave
                        // a partitive `of` at an edge (`clove of garlic` minus `clove` -> `of
                        // garlic`). The key site's step 0 would catch the KEY, but this name is
                        // also the retrieval query and the telemetry `normalizedForm`, so the
                        // residue must not reach either (plan 10, 2026-08-21).
                        normalizedName = stripPartitiveOfResidue(repaired.cleaned);
                    }
                    // canonicalBase carries the same pollution and becomes the
                    // rerank query verbatim, so it needs the same repair.
                    aiCanonicalBase = aiHint.canonicalBase
                        ? stripIntroducedFoodTokens(guardInput, aiHint.canonicalBase).cleaned
                        : aiHint.canonicalBase;

                    // NUTRITION-MODIFIER RESTORATION (site C). The LLM normalizer
                    // is a SECOND dropper of the same words, independent of the
                    // segmenter, and it overwrites whatever site A restored — so
                    // site A alone would be undone here on every line that reaches
                    // the model. `ai-normalize.ts`'s prompt already orders this
                    // preservation with a worked example and is not obeyed, which
                    // is why the enforcement is code and not a prompt edit.
                    //
                    // `aiCanonicalBase` gets the same treatment because it becomes
                    // the rerank query verbatim, exactly as the strip above argues.
                    //
                    // Runs AFTER stripIntroducedFoodTokens and BEFORE the brand
                    // re-assert below: the two guards move in opposite directions
                    // (one removes invented tokens, this one restores dropped
                    // ones) and cannot fight, and leaving the brand block last
                    // preserves its leading word order and `preBrandNormalizedName`.
                    const aiModifierRepair = restoreNutritionModifiers(guardInput, normalizedName);
                    if (aiModifierRepair.added.length > 0) {
                        logger.info('mapping.nutrition_modifier_restored', {
                            rawLine: trimmed,
                            site: 'ai_normalize',
                            before: normalizedName,
                            after: aiModifierRepair.restored,
                            restored: aiModifierRepair.added,
                        });
                        normalizedName = aiModifierRepair.restored;
                    }
                    if (aiCanonicalBase) {
                        aiCanonicalBase = restoreNutritionModifiers(guardInput, aiCanonicalBase).restored;
                    }

                    // Brand preservation over the model's OWN output. The guard
                    // near the top of this function cannot cover this: it is
                    // gated on a caller-supplied options.normalizedForm AND it
                    // runs before these assignments overwrite normalizedName.
                    // The prompt does carry the rule ("INCLUDE the brand name in
                    // canonical_base when is_branded") and nothing enforces it —
                    // measured 2026-08-03, the brand is dropped on ~58 of 1,776
                    // brand-bearing lines in AiNormalizeCache.
                    //
                    // GATED ON DECISIVENESS, and that gate is the design. An
                    // UNCONDITIONAL prefix is already refuted: `bell pepper`
                    // matches the lexicon brand `bell` (Bell & Evans), the model
                    // rewrites the food to `capsicum`, and prefixing produced key
                    // `bell capsicum` — orphaning the live human-triage
                    // `capsicum` row (golden n-mq-30). See deriveMappingCacheKey()
                    // and cache-key-symmetry.test.ts, which pins it.
                    // llm-brand-preservation.test.ts asserts the two symptoms
                    // stay separated; if they ever converge, disable this repair
                    // rather than re-tuning it.
                    //
                    // REPAIRS, never rejects: dropping the model's name would
                    // also discard its typo repair and cooked-state retention.
                    const targetBrand = brandDetection.matchedBrand?.trim();
                    if (targetBrand && hasDecisiveBrandContext(trimmed, targetBrand)) {
                        const keepBrand = (s: string | undefined) =>
                            s && !candidateMatchesTargetBrand(undefined, s, targetBrand)
                                ? `${targetBrand} ${s}`.trim()
                                : s;
                        const rebranded = keepBrand(normalizedName);
                        if (rebranded !== normalizedName) {
                            logger.info('mapping.llm_dropped_decisive_brand', {
                                rawLine: trimmed,
                                llmOutput: normalizedName,
                                repaired: rebranded,
                                brand: targetBrand,
                            });
                            preBrandNormalizedName = normalizedName;
                        }
                        normalizedName = rebranded ?? normalizedName;
                        aiCanonicalBase = keepBrand(aiCanonicalBase);
                    }
                    aiCookingModifier = aiHint.cookingModifier;
                    aiSynonyms = aiHint.synonyms || [];
                    if (aiSynonyms.length > 0) {
                        logger.info('mapping.ai_synonyms', { rawLine: trimmed, synonyms: aiSynonyms });
                    }
                    aiNutritionEstimate = aiHint.nutritionEstimate;
                    // Upgrade freely; downgrade only where the static evidence
                    // is not decisive. Measured rationale in the guard.
                    isBrandedQuery = resolveIsBrandedQuery(
                        brandDetection.isBranded,
                        aiHint.isBranded,
                        decisiveBrandContext,
                    );
                }
            } else {
                logger.info('normalize_gate.skipped_llm', {
                    rawLine: trimmed,
                    reason: gateDecision.reason,
                    confidence: gateDecision.confidence.toFixed(2),
                    candidateCount: quickCandidates.length
                });
                skippedLlmNormalize = true;
                incrementSkippedByGate();  // Track for metrics

                // Even when LLM is skipped, retrieve cached nutrition estimate
                // (from a previous LLM call) for the reranker's nutrition tiebreaker.
                // This is critical for cases like rice vinegar where all candidates
                // score identically but have vastly different calorie profiles.
                // FIX: Use baseName instead of rawLine to hit the cache for quantity variations!
                const cachedNormalize = await getAiNormalizeCache(baseName);
                if (cachedNormalize?.nutritionEstimate) {
                    aiNutritionEstimate = cachedNormalize.nutritionEstimate;
                    // Same repair as the live path: AiNormalizeCache is 86.5%
                    // v1 rows written before this guard existed, so the polluted
                    // canonicalBase is replayed from here too.
                    aiCanonicalBase = cachedNormalize.canonicalBase
                        ? stripIntroducedFoodTokens(
                              `${trimmed} ${baseName}`,
                              cachedNormalize.canonicalBase,
                          ).cleaned
                        : cachedNormalize.canonicalBase;
                    logger.debug('normalize_gate.cached_nutrition_estimate', {
                        baseName,
                        estimate: aiNutritionEstimate.caloriesPer100g,
                        confidence: aiNutritionEstimate.confidence,
                    });
                }
                // Also restore isBranded from cached normalize result. Same
                // resolution as the live path: this replays a STORED model
                // answer, so it can downgrade exactly as the live one does, and
                // 85.7% of AiNormalizeCache rows were written on warm-campaign
                // days — the replay is the common case, not the rare one.
                if (cachedNormalize) {
                    isBrandedQuery = resolveIsBrandedQuery(
                        brandDetection.isBranded,
                        (cachedNormalize as any).isBranded,
                        decisiveBrandContext,
                    );
                }
            }
        }

        // Context-dependent normalization: bare "pepper" in spice context → "black pepper"
        // Applied AFTER AI normalization to prevent AI from overriding the rewrite.
        // When the unit is a spice measure (dash, pinch, tsp, tbsp), the user means black pepper,
        // not bell/poblano/hungarian peppers.
        const SPICE_CONTEXT_UNITS_FB = new Set(['dash', 'pinch', 'tsp', 'tbsp', 'teaspoon', 'tablespoon']);
        const parsedUnitForContextFB = parsed?.unit?.toLowerCase() ?? '';
        if (/^pepper$/i.test(normalizedName.trim()) && SPICE_CONTEXT_UNITS_FB.has(parsedUnitForContextFB)) {
            logger.info('fatsecret.map.pepper_spice_rewrite', { rawLine: trimmed, originalName: normalizedName, unit: parsedUnitForContextFB });
            normalizedName = 'black pepper';
        }

        // Context-dependent bouillon rewrite: "bouillon" with volume unit -> "broth"
        // This prevents mapping "1 cup beef bouillon" to powdered concentrate and getting 300kcal/cup
        const VOLUME_UNITS = new Set(['cup', 'cups', 'floz', 'fl oz', 'quart', 'quarts', 'gallon', 'gallons', 'ml', 'liter', 'liters', 'pint', 'pints']);
        if (/\bbouillon\b/i.test(normalizedName) && VOLUME_UNITS.has(parsedUnitForContextFB)) {
            logger.info('fatsecret.map.bouillon_broth_rewrite', { rawLine: trimmed, originalName: normalizedName, unit: parsedUnitForContextFB });
            normalizedName = normalizedName.replace(/\bbouillon\b/gi, 'broth');
        }

        // Context-dependent corn rewrite: "corn" in a can should map to sweet corn, not dry corn grain
        if (/\bcorn\b/i.test(normalizedName) && (parsedUnitForContextFB === 'can' || /\bcanned\b/i.test(trimmed))) {
            logger.info('fatsecret.map.canned_corn_rewrite', { rawLine: trimmed, originalName: normalizedName });
            if (!normalizedName.toLowerCase().includes('sweet')) {
                normalizedName = normalizedName.replace(/\bcorn\b/gi, 'sweet corn');
            }
        }

        // Combine learned + AI synonyms (deduplicated)
        const allSynonyms = [...new Set([...learnedSynonyms, ...aiSynonyms])];
        if (learnedSynonyms.length > 0) {
            logger.info('mapping.learned_synonyms_used', {
                rawLine: trimmed,
                learnedCount: learnedSynonyms.length,
                aiCount: aiSynonyms.length
            });
        }

        // Variables for selection (unified across Cache / Search / Fallback)
        // Variables for selection (unified across Cache / Search / Fallback)
        let winner: UnifiedCandidate | null = null;
        let confidence = 0;
        let selectionReason = '';
        let filtered: UnifiedCandidate[] = [];
        /**
         * The reranker's own ordering of the pool, by candidate id, captured when
         * it runs so the SERVING FALLBACK can honour it. `filtered` is in GATHER
         * order — `gatherCandidates()` pushes FDC, then OFF, then the FatSecret
         * lane — so a fallback taken off the front of `filtered` is "the OFF
         * lane's top retrieval hits", whatever the reranker thought of them.
         * Null when the reranker never ran (a cache hit, or a pool too small to
         * rerank), which the fallback reads as "no order to honour".
         */
        let rerankSortedIds: string[] | null = null;

        // Step 1c: Check validated cache for normalized name (User Optimization)
        // "1 cup chopped onion" -> normalized "onion" -> checks cache for "onion"
        const cacheSel = await lookupNormalizedCacheProducer({
            normalizedName, preBrandNormalizedName, parsed, brandDetection, trimmed,
            skipCache, isBrandedQuery, telemetry, noteReadEscape,
        });
        if (cacheSel) {
            winner = cacheSel.winner;
            confidence = cacheSel.confidence;
            selectionReason = cacheSel.selectionReason;
        }

        let allCandidates: UnifiedCandidate[] = [];

        // Step 2: Gather all candidates (If not found in cache)
        if (!winner) {
            // Reuse the quick-gate gather's FDC results when nothing changed
            // since that pass: same normalized name (no AI/context rewrite),
            // no new AI synonyms, and not a branded query (the quick gather ran
            // without targetBrand, so its FDC ranking lacks the brand boost).
            // The full gather then only adds OFF + semantic.
            const canReuseQuickGather =
                quickGatherCandidates !== null &&
                quickGatherName === normalizedName &&
                aiSynonyms.length === 0 &&
                !isBrandedQuery;

            const gatherOptions: GatherOptions = {
                skipCache,
                skipFdc: skipFdc || canReuseQuickGather,
                isBrandedQuery,
                targetBrand: brandDetection.matchedBrand ?? undefined,
                aiSynonyms: allSynonyms,
                seedCandidates: canReuseQuickGather ? quickGatherCandidates! : undefined,
            };

            allCandidates = await gatherCandidates(rawLine, parsed, normalizedName, gatherOptions);

            if (allCandidates.length === 0) {
                logger.warn('mapping.no_candidates', { rawLine: trimmed, normalizedName });
                // Fall through to Fallback Step
            } else {
                // Step 3: Apply must-have token filter
                const filterResult = filterCandidatesByTokens(
                    allCandidates,
                    normalizedName,
                    { debug, rawLine: trimmed }
                );
                filtered = filterResult.filtered;
                const removedCount = filterResult.removedCount;

                // Step 3b: Apply core token validation to filtered candidates
                // This catches cases like "dry brown rice" → "dry brown beans" (missing "rice" token)
                const beforeCoreFilter = filtered.length;
                const rescueBrand = brandDetection.matchedBrand?.toLowerCase().trim();
                filtered = filtered.filter(c => {
                    const mismatch = hasCoreTokenMismatch(normalizedName, c.name, c.brandName);
                    if (!mismatch) return true;

                    // Brand rescue: if the query names a brand and THIS candidate
                    // carries it, don't hard-drop for a missing core token — the
                    // "missing" token is usually a flavor the brand spells
                    // differently ("cinnamon" vs a "Cinnabon" product name).
                    // simpleRerank still ranks it on token overlap, so a genuinely
                    // wrong match won't win. (The Ghost cinnamon-roll drop.)
                    // OFF records often embed the brand in the NAME with an empty
                    // brand field ("Ghost Whey Protein (Cinnabon)", brand "") —
                    // check both.
                    if (rescueBrand && (
                        c.brandName?.toLowerCase().includes(rescueBrand) ||
                        new RegExp(`\\b${rescueBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(c.name.toLowerCase())
                    )) {
                        if (debug) {
                            logger.debug('mapping.core_token_brand_rescued', {
                                normalizedName, candidate: c.name, brand: c.brandName,
                            });
                        }
                        return true;
                    }

                    if (debug) {
                        logger.debug('mapping.core_token_filtered', {
                            normalizedName,
                            candidate: c.name,
                            reason: 'core_token_mismatch',
                        });
                    }
                    return false;
                });
                const coreFilterRemoved = beforeCoreFilter - filtered.length;
                if (coreFilterRemoved > 0) {
                    logger.info('mapping.core_token_filter_applied', {
                        rawLine: trimmed,
                        removed: coreFilterRemoved,
                        remaining: filtered.length,
                    });
                }

                // Step 3c: Drop candidates whose inline nutrition is clearly
                // corrupted (all-zero macros on foods that must have calories,
                // e.g. "1 Dozen Farm Fresh Eggs" with 0g protein). Candidates
                // without inline nutrition pass through — they're validated
                // after hydration. If every candidate fails, keep the original
                // list rather than returning nothing.
                const macroValid = filtered.filter(c =>
                    !c.nutrition?.per100g || !hasNullOrInvalidMacros(c.nutrition, c.name)
                );
                if (macroValid.length > 0 && macroValid.length < filtered.length) {
                    logger.info('mapping.zero_macro_filter_applied', {
                        rawLine: trimmed,
                        removed: filtered.length - macroValid.length,
                        remaining: macroValid.length,
                    });
                    filtered = macroValid;
                }

                // Step 3d: Macro plausibility gate. Physically impossible
                // per-100g values (negative macros, sum > 105g, kcal > 900)
                // are dropped; implausible-but-conceivable values (0-protein
                // beans, 224 kcal spinach) are penalized in ranking so better
                // data wins without eliminating the candidate outright.
                // If every candidate would be dropped, keep the original list.
                const plausibilityChecked = filtered.map(c => {
                    if (!c.nutrition?.per100g) return c;
                    const assessment = assessMacroPlausibility(normalizedName, c.name, c.nutrition);
                    if (assessment.plausible) return c;
                    if (assessment.impossible) {
                        logger.warn('mapping.macro_implausible_dropped', {
                            rawLine: trimmed,
                            candidate: c.name,
                            source: c.source,
                            reasons: assessment.reasons,
                        });
                        return null;
                    }
                    logger.warn('mapping.macro_implausible_penalized', {
                        rawLine: trimmed,
                        candidate: c.name,
                        source: c.source,
                        reasons: assessment.reasons,
                        penalty: assessment.penalty,
                    });
                    return { ...c, score: c.score * assessment.penalty };
                });
                const plausibleCandidates = plausibilityChecked.filter(
                    (c): c is NonNullable<typeof c> => c !== null
                );
                if (plausibleCandidates.length > 0) {
                    filtered = plausibleCandidates;
                }

                // Step 3e (PR D pt3): drop triage-confirmed corrupt OFF
                // records (all-drop restore inside the helper).
                filtered = dropDenylistedCandidates(filtered, trimmed);

                if (filtered.length === 0) {
                    // Retry with relaxed filtering before giving up
                    const relaxedFilterResult = filterCandidatesByTokens(
                        allCandidates,
                        normalizedName,
                        { debug, rawLine: trimmed, relaxed: true }
                    );
                    
                    if (relaxedFilterResult.filtered.length > 0) {
                        filtered = relaxedFilterResult.filtered;
                        logger.info('mapping.relaxed_filter_recovery', {
                            rawLine: trimmed,
                            recoveredCount: filtered.length,
                        });
                    } else {
                        logger.warn('mapping.all_filtered', { rawLine: trimmed, removedCount: removedCount + coreFilterRemoved });
                        // Fall through to Fallback
                    }
                }

                // Run selection on ANY surviving candidates — whether they passed
                // the strict filter above OR were recovered by the relaxed retry.
                // Previously this block was the `else` of the empty-check, so
                // relaxed-recovered candidates were never reranked: winner stayed
                // null → brand-stripping aiSimplify fallback (the ghost-protein bug).
                if (filtered.length > 0) {
                    // Step 3a: Confidence Gate
                    // IMPORTANT: Sort by score with tiebreaker preferring FDC for basic produce
                    const searchQuery = parsed?.name || normalizedName;
                    const BASIC_PRODUCE = ['potato', 'potatoes', 'lentil', 'lentils', 'beans', 'chickpea', 'chickpeas', 'spinach', 'broccoli', 'carrot', 'carrots'];
                    const isBasicProduce = BASIC_PRODUCE.some(p => normalizedName.toLowerCase().includes(p));

                    // PR D pt3 (Lever B, finding 1): floor-hit candidates sort
                    // strictly below plausible ones — computed HERE (not at the
                    // step-3d block) so relaxed-recovery candidates are covered
                    // too, and applied inside THIS sort because it rebuilds
                    // ordering from scratch right before confidenceGate
                    // consumes it (a partition of `filtered` upstream would be
                    // destroyed by the score sort and never reach the bypass).
                    const floorHitIds = computeFloorHitIds(normalizedName, filtered);
                    const sortedFiltered = [...filtered].sort(
                        makeSortedFilteredComparator(normalizedName, isBasicProduce, floorHitIds)
                    );

                    const gateResult = confidenceGate(searchQuery, sortedFiltered, trimmed);

                    // Step 3b (Jul 2026): the confidence gate is a BACKSTOP, not a
                    // pre-emption. It used to short-circuit Step 4 outright —
                    // `skipAiRerank` handed back its own pick and simpleRerank never
                    // ran at all — and that shortcut is what three separate
                    // investigations in one week kept tripping over.
                    //
                    // Why the short-circuit had to go:
                    //
                    //  * The gate's judge is PURE RECALL. assessConfidence
                    //    (gather-candidates.ts) is `overlap / queryTokens`, plus a
                    //    position bonus, plus +0.15 for substring containment. It never
                    //    penalises tokens the CANDIDATE carries that the query never
                    //    used, and it reads `candidate.name` only — `brandName` is
                    //    invisible to it. "subway cold cut combo" against
                    //    "Subway, Cold Cut Combo Salad" (15.7 kcal/100g against the
                    //    sandwich's 69.5) scores 0.85 — still enough to exit, because
                    //    the extra noun that changes what the food IS costs nothing.
                    //    It reaches a clean 1.000 when the brand-stripped `parsed.name`
                    //    ("cold cut combo") is what arrives at the gate, which is the
                    //    common case and the sharper statement of the defect.
                    //    simpleRerank is the only stage on this path that carries
                    //    precision terms — and it was the stage being skipped.
                    //
                    //  * The name is a fossil. `skipAiRerank` reads as if the gate is
                    //    saving an expensive LLM call. It is not. Nothing on the
                    //    confidenceGate/simpleRerank path awaits an LLM — simpleRerank
                    //    is pure and synchronous (`grep -c "await " simple-rerank.ts`
                    //    is 0), measured at p50 116µs / p95 253µs over 441 gate lines.
                    //    Be precise about this, because the looser version of the claim
                    //    is false and has already been written down once: there ARE
                    //    LLM clients in this directory (ai-rerank.ts is a full
                    //    OpenAI-compatible client, and `aiSimplifyIngredient` is
                    //    awaited by THIS file further down) — they simply are not on
                    //    the path the gate short-circuits. The gate was buying a
                    //    fraction of a millisecond and paying for it in wrong records.
                    //
                    //  * Measured, not reasoned about. Replayed over the FROZEN
                    //    candidate pool so both paths saw an identical pool, with the
                    //    write guard on (noise floor re-measured at 0.0%): the gate
                    //    fires on 10.6% of logged lines and disagrees with simpleRerank
                    //    on 60.8% of them. All 296 unique disagreements were then
                    //    adjudicated row by row (not sampled and scaled): 115 IMPROVE,
                    //    50 REGRESS, 110 lateral, 12 both-wrong, 9 undetermined —
                    //    net +65, a 2.3:1 ratio. The sharpest screen is class drift: 53
                    //    rows where ONLY the gate's winner carries a food-class noun the
                    //    query never used (salad / soup / sauce / mix), against 2 rows
                    //    for the reranker.
                    //
                    //    The 50 REGRESS rows are pre-existing simpleRerank defects that
                    //    the gate was MASKING, not damage this change causes. They are
                    //    enumerated so they can be fixed where they live. Two caveats
                    //    that survived review and should temper the number: at least
                    //    one row (`popeyes red beans and rice`) is both-wrong rather
                    //    than a regression, and at least one (`dr pepper`) is a
                    //    RETRIEVAL defect — its pool contains no plain Dr Pepper record
                    //    at all because the normalized query is "dr black pepper" — so
                    //    no ranking change can fix it.
                    //
                    // What survives: the gate still RUNS, its verdict is still computed
                    // and logged, and it is still honoured — but only when simpleRerank
                    // declines to name anyone. As a last resort it strictly beats the
                    // raw `sortedFiltered[0].score >= 0.80` grab underneath it, because
                    // it has at least asked a question about the query rather than
                    // trusting the search engine's own ordering.
                    //
                    // Known, accepted cost of the demotion: on lines where the two
                    // stages pick DIFFERENT records, `confidence` now comes from
                    // simpleRerank's scale instead of the gate's, so some formerly
                    // gate-selected lines land under the `confidence >= 0.85` save gate
                    // at Step 6 and reach the cache only through sub-threshold
                    // admission, which is insert-only. That is coverage traded for
                    // record identity, on purpose. Lines where the two stages AGREE on
                    // the record AND the gate exited via `high_confidence_clear_winner`
                    // are held at the higher of the two — see the rerank winner
                    // assignment below; without that, identical answers lost their cache
                    // save (`restaurant hibachi chicken` kept its record and went
                    // 0.917 -> 0.707, under both the 0.85 gate and the 0.75 floor).
                    // `mapping.confidence_gate_overridden` below is how the trade is
                    // watched in production.
                    const gateSelection = gateResult.skipAiRerank ? gateResult.selected : undefined;

                    // Step 4: Simple rerank (Token-based)
                    // Use filtered (not sortedFiltered) to ensure high-overlap candidates aren't pushed out
                    // simpleRerank will do its own scoring based on token overlap + other factors

                    // Count-labeled SKU preference (Cluster A pt2, Jul 2026): when the
                    // user is counting pieces, nudge rerank toward SKUs whose label
                    // declares that piece's count — their per-piece weight is
                    // authoritative via the label-count-derived path in buildOffResult.
                    const countedNoun = countedPieceNoun(parsed);

                    // Enrich Generic candidates with cached nutrition data.
                    //
                    // THE WINDOW IS COMPOSED PER LANE, NOT TAKEN AS A PREFIX.
                    // `filtered` is in GATHER order and gatherCandidates concatenates
                    // its lanes, so a prefix (the old `filtered.slice(0, 10)`) deleted
                    // every later lane whenever the earlier ones filled the window.
                    // Measured cold 2026-08-01 over a 20-query cold-seed population:
                    // 17 of 20 admitted ZERO FatSecret candidates while the lane had
                    // gathered 8 — `grilled chicken breast` gathered
                    // { fdc: 2, openfoodfacts: 14, fatsecret: 8 } and reranked
                    // { fdc: 2, openfoodfacts: 8 }. Rationale, invariants and the
                    // re-derive command: `buildRerankPool()` in
                    // `src/lib/mapping/rerank-pool.ts`.
                    //
                    // The budget is unchanged (RERANK_POOL_LIMIT === the old 10), so
                    // this is a RE-COMPOSITION, not an admission relaxation. It is
                    // non-monotone in both directions — candidates that reach the
                    // reranker today can be evicted — which is why it ships with a
                    // winner-gate regression population and not with an argument.
                    const candidatesForRerank = buildRerankPool(filtered, RERANK_POOL_LIMIT);
                    // Counted queries: let count-labeled SKUs below the cutoff compete
                    // too (they still have to win the rerank on merit). The remainder
                    // is computed by DIFFERENCE, not as `filtered.slice(10)` — the
                    // window is no longer a prefix, so the old form would have
                    // re-offered candidates already inside it.
                    if (countedNoun) {
                        for (const c of rerankPoolRemainder(filtered, candidatesForRerank)) {
                            if (candidatesForRerank.length >= 13) break;
                            if (candidateHasCountLabel(c, countedNoun)) candidatesForRerank.push(c);
                        }
                    }
                    // NOT DONE HERE, DELIBERATELY, AND THE REASON IS WORTH KEEPING.
                    //
                    // The window truncates over GATHER order. On 17 of the 441 measured
                    // gate-firing lines the gate's pick sits past the cutoff, so
                    // simpleRerank cannot re-select it — those lines are a DELETION, not
                    // an adjudication, and the backstop below cannot rescue them because
                    // the reranker did return a winner, just a different one.
                    // `kirkland almonds` is the sharpest: the Kirkland record is at
                    // gather index 22, so the reranker only ever sees a Members Mark
                    // record. Per-lane composition NARROWS this — a starved lane is no
                    // longer deleted wholesale — but it does not close it: a candidate
                    // past its own lane's share of the window is still unseen, and
                    // `kirkland almonds` gathers 16 OFF rows for 5 lane slots.
                    //
                    // The obvious repair — append `gateSelection` to candidatesForRerank
                    // — was written, measured, and REVERTED. Scored against the project's
                    // own adjudication of all 296 disagreements it bought nothing: it
                    // restored 5 of the 17, of which 2 were adjudicated rerank-better, so
                    // the regression count did not move. It only changed WHICH rows were
                    // wrong. And it was not free: combined with the confidence
                    // restoration below it took `buffalo wild wings boneless wings` from
                    // 0.710 (below the sub-threshold floor, so not cached at all) to
                    // 1.000 — a full displacing upsert of an adjudicated-WRONG record
                    // ("Buffalo style alaska wild wings", a frozen seafood product, over
                    // the real BWW 6-count). Turning a transient wrong answer into a
                    // cached one is the worse failure.
                    //
                    // It also flattered its own measurement: restored rows become SAME in
                    // a baseline-vs-change diff, so they drop out of the screen population
                    // and the class-drift number is computed on a set with the change's
                    // own regressions removed by construction.
                    //
                    // The real defect is the truncation itself — `slice(0, 10)` over
                    // gather order is the same mechanism as the composite-to-component
                    // drift class. Fix that where it lives, with its own gate. Do not
                    // special-case the gate pick past it.
                    const fsCandidatesMissingNutr = candidatesForRerank
                        .filter(c => c.source === 'ai_generated' && !c.nutrition);
                    if (fsCandidatesMissingNutr.length > 0) {
                        // INSTRUMENTED, NOT DELETED (2026-08-01). Enumerating every
                        // producer of this pool says 'ai_generated' is unreachable:
                        // `filtered` derives solely from gatherCandidates(), whose only
                        // sources are searchFdcLocal ('fdc'), searchOffSimple/
                        // searchOffSemantic ('openfoodfacts'), searchFatSecretLane
                        // ('fatsecret') and options.seedCandidates (itself a prior
                        // gatherCandidates result). But that is REASONED, not measured —
                        // and it could not be measured, because the surrounding evidence
                        // (gather.candidates.complete, mapping.weight_backfill_attempt) is
                        // logger.info and was being stripped from the production bundle.
                        // Audit is non-suppressible, so this line survives any LOG_LEVEL.
                        // Delete these arms only after a measured window with zero hits.
                        logger.audit('rerank.ai_generated_candidate_seen', {
                            count: fsCandidatesMissingNutr.length,
                            ids: fsCandidatesMissingNutr.slice(0, 5).map(c => c.id),
                            names: fsCandidatesMissingNutr.slice(0, 5).map(c => c.name),
                        });
                        const { prisma } = await import('../db');
                        const fsIds = fsCandidatesMissingNutr.map(c => c.id);
                        const cachedFoods = await prisma.aiGeneratedFood.findMany({
                            where: { id: { in: fsIds } },
                            select: {
                                id: true,
                                caloriesPer100g: true,
                                proteinPer100g: true,
                                carbsPer100g: true,
                                fatPer100g: true,
                            },
                        });
                        for (const cf of cachedFoods) {
                            const cand = candidatesForRerank.find(c => c.id === cf.id);
                            if (cand && !cand.nutrition) {
                                cand.nutrition = {
                                    kcal: cf.caloriesPer100g,
                                    protein: cf.proteinPer100g,
                                    carbs: cf.carbsPer100g,
                                    fat: cf.fatPer100g,
                                    per100g: true,
                                };
                            }
                        }
                    }

                    // FDC-based fallback for AI nutrition estimate.
                    // FDC candidates always have per-100g nutrition inline from
                    // the search API. When no AI estimate is available (LLM gate
                    // skipped and no cached estimate), use the best-matching FDC
                    // candidate's nutrition as a synthetic reference for the tiebreaker.
                    if (!aiNutritionEstimate) {
                        const fdcRef = candidatesForRerank.find(
                            c => c.source === 'fdc' && c.nutrition?.per100g && (c.nutrition.kcal > 0 || c.nutrition.protein > 0)
                        );
                        if (fdcRef && fdcRef.nutrition) {
                            aiNutritionEstimate = {
                                caloriesPer100g: fdcRef.nutrition.kcal,
                                proteinPer100g: fdcRef.nutrition.protein,
                                carbsPer100g: fdcRef.nutrition.carbs,
                                fatPer100g: fdcRef.nutrition.fat,
                                confidence: 0.6,  // Lower confidence than LLM estimate
                            };
                            logger.debug('mapping.fdc_nutrition_fallback', {
                                rawLine: trimmed,
                                fdcName: fdcRef.name,
                                fdcId: fdcRef.id,
                                estimate: aiNutritionEstimate.caloriesPer100g,
                            });
                        }
                    }

                    const billsByServing = requestBillsByServing(parsed);
                    // Cooked-grain volume requests (n-serv-06): the re-retrieval must
                    // prefer candidates that OWN a matching volume serving over ones
                    // that would fall back to generic density. requestBillsByServing
                    // excludes explicit volume units by design (PR D pt2), so the
                    // serving-shape flag is wired through this grain-scoped path.
                    const grainVolumeUnit = !billsByServing && parsed?.unit
                        && isMatchableVolumeUnit(parsed.unit)
                        && detectGrainCookingContext(trimmed, normalizedName).softCooked === true
                        ? parsed.unit : null;
                    const rerankCandidates = candidatesForRerank.map(c => toRerankCandidate({
                        id: c.id,
                        name: c.name,
                        brandName: c.brandName,
                        foodType: c.foodType,
                        score: c.score,
                        source: c.source,
                        nutrition: c.nutrition,  // Include for Route C macro sanity check + nutrition tiebreaker
                        countLabelMatch: countedNoun ? candidateHasCountLabel(c, countedNoun) : undefined,
                        servingLabelMatch: billsByServing ? candidateHasServingData(c)
                            : grainVolumeUnit ? candidateHasVolumeServing(c, grainVolumeUnit) : undefined,
                    }));

                    // Hybrid prep stripping: prefer AI canonicalBase (strips prep but preserves
                    // nutritional modifiers), fall back to local prep-word stripping.
                    // The raw line (trimmed) is still passed for modifier constraint extraction.
                    const rerankQuery = aiCanonicalBase || stripPrepModifiers(searchQuery);
                    const rerankResult = simpleRerank(rerankQuery, rerankCandidates, aiNutritionEstimate, trimmed, isBrandedQuery, brandDetection.matchedBrand ?? undefined, countedNoun != null);
                    rerankSortedIds = rerankResult.sortedCandidates.map(c => c.id);

                    if (rerankResult && rerankResult.winner) {
                        const selected = filtered.find(c => c.id === rerankResult.winner!.id);
                        if (selected) {
                            winner = selected;
                            confidence = rerankResult.confidence;
                            selectionReason = rerankResult.reason;
                            // AGREEMENT KEEPS THE HIGHER CONFIDENCE.
                            //
                            // This change is about WHICH RECORD wins, not about how sure
                            // we are. But `confidence` is also the cache-admission
                            // signal (`admitToCache = confidence >= 0.85 || ...` below),
                            // and the two stages report on different scales.
                            //
                            // Be careful about HOW they differ — an earlier draft of
                            // this comment said simpleRerank returns
                            // `min(0.5 + score*0.5, 0.95)` with a 0.70 floor, and that
                            // is wrong for most of the corpus: `exact_match` adds +0.1
                            // capped at 0.98, `branded_exact_match` lifts to 0.88, and
                            // `cooked_grain_preference` floors at 0.75. Measured over
                            // the 3,475 pure-rerank rows, 2,454 sit at exactly 0.98.
                            // simpleRerank is NOT systematically lower than the gate.
                            //
                            // The real asymmetry is narrower and is what this guards:
                            // on the rows where the gate fired and BOTH stages then
                            // picked the same record, the reranker's number can still
                            // land under 0.85 while the gate's did not. Taking the
                            // rerank number unconditionally there silently DEMOTES a
                            // line whose answer did not change — the record is
                            // identical and the cache save disappears.
                            //
                            // Measured on the 441 gate-firing lines: 37 fall under the
                            // 0.85 save gate, 9 of them with an UNCHANGED winner, and 2
                            // of those also fall under SUB_THRESHOLD_SAVE_FLOOR (0.75)
                            // so they are not cached at all. `restaurant hibachi
                            // chicken` keeps the same record while going 0.917 -> 0.707.
                            // Worse, the 7 that survive via `insertOnly` can never be
                            // REFRESHED afterwards, which is exactly what the parity
                            // sweep and the nightly flywheel rely on.
                            //
                            // TWO scopes, both load-bearing.
                            //
                            // (1) Agreement only. When the reranker names a DIFFERENT
                            // record, the gate's confidence describes a candidate we
                            // just rejected, and carrying it over would be laundering.
                            //
                            // (2) `high_confidence_clear_winner` only. The gate has
                            // three exits and they are NOT on the same scale, despite
                            // what "the gate exits at >= 0.85" suggests. Only this one
                            // returns assessConfidence's actual match score.
                            // `basic_produce_bypass` returns
                            // `Math.min(RERANK_DECLINED_CONFIDENCE, Math.max(0, Math.min(1, top1.score)))`
                            // — a CLAMPED RAW ENGINE SCORE under a ceiling (OFF runs
                            // ~0-10 and FDC ~0-1.5), so it says nothing about match
                            // quality at any value; before the ceiling was added it
                            // saturated at exactly 1.000 for any OFF candidate, which is
                            // the form the measurement below was taken against.
                            // `yeast_variant_preference` returns a hardcoded 0.95.
                            // Restoring those would launder a retrieval score into the
                            // cache-admission signal. Measured: of the 132 rows this
                            // lift touched unscoped, 27 were basic_produce_bypass, every
                            // one at exactly 1.000, and 5 of them crossed the 0.85 save
                            // gate on it (steamed broccoli, boiled potatoes, roasted
                            // carrots, roasted sweet potato, 100g cooked rice white).
                            if (
                                gateSelection
                                && winner.id === gateSelection.id
                                && gateResult.reason === 'high_confidence_clear_winner'
                            ) {
                                confidence = Math.max(confidence, gateResult.confidence);
                            }
                        }
                    }

                    // Monitoring hook for the demotion above. Fires on exactly the
                    // population the change exists to move — the gate would have
                    // pre-empted, and the reranker named someone else — and carries
                    // BOTH records (id + name + source) plus the gate's own reason, so
                    // a production read can be adjudicated the same way the offline
                    // replay was without reconstructing the pool. `poolSize` is here
                    // because pool=1/pool=2 is a diagnosis in its own right: a
                    // disagreement over a pool of one is an admission defect upstream,
                    // not a ranking one. Silence on a gate line means the two agree and
                    // the demotion was inert there.
                    if (gateSelection && winner && winner.id !== gateSelection.id) {
                        logger.audit('mapping.confidence_gate_overridden', {
                            rawLine: trimmed,
                            query: searchQuery,
                            gateReason: gateResult.reason,
                            gateId: gateSelection.id,
                            gateName: gateSelection.name,
                            gateBrand: gateSelection.brandName ?? null,
                            gateSource: gateSelection.source,
                            gateConfidence: gateResult.confidence,
                            rerankId: winner.id,
                            rerankName: winner.name,
                            rerankBrand: winner.brandName ?? null,
                            rerankSource: winner.source,
                            rerankConfidence: confidence,
                            rerankReason: selectionReason,
                            poolSize: filtered.length,
                        });
                    }

                    if (!winner) {
                        if (gateSelection) {
                            // BACKSTOP. simpleRerank declined to name anyone, so the
                            // gate's pick is the best-informed candidate left standing.
                            // Deliberately ahead of the raw-score grab below: the gate
                            // at least scored the candidate against the query.
                            //
                            // Distinct selectionReason so telemetry can separate a
                            // backstop from the old pre-emptive firing (the previous
                            // strings 'high_confidence_clear_winner' /
                            // 'basic_produce_bypass' / 'yeast_variant_preference' now
                            // vanish from the under_gate column entirely — expect that
                            // in any run-over-run histogram). It is a bare constant with
                            // no digits and no parentheses on purpose: the under_gate
                            // class is `selectionReason.split(':')[0]` through
                            // normalizeClassId, which strips both.
                            // Takes the gate's confidence with NO reason scope — unlike
                            // the agreement lift above — but UNDER THE DECLINED CEILING:
                            // min(RERANK_DECLINED_CONFIDENCE, x). The two halves have
                            // separate rationales, stated separately, because the two
                            // sites sit 100 lines apart and look inconsistent.
                            //
                            // NO REASON SCOPE: on this branch simpleRerank named nobody,
                            // so there is no second number to choose between — the
                            // alternative is not a better-scaled confidence, it is no
                            // winner at all and a fall-through to the AI-simplify path.
                            // Baseline behaved exactly this way on exactly these rows, so
                            // scoping here would be a NEW regression, and it would leave
                            // the producer emitting the same numbers for every other
                            // consumer anyway.
                            //
                            // THE CEILING: this read used to be unbounded, and it was the
                            // last laundering leg. Of the 9 backstop rows in the
                            // 4,165-query population, 6 were `basic_produce_bypass`
                            // cached at a saturated raw engine score of 1.000; that half
                            // was fixed AT THE PRODUCER (the bypass exit in
                            // gather-candidates.ts caps its return at
                            // RERANK_DECLINED_CONFIDENCE, correcting this site and the
                            // instrument — winner-diff imports confidenceGate live — in
                            // one move). But the producer cap cannot close the leg:
                            // `high_confidence_clear_winner` returns assessConfidence's
                            // real match score, exactly 1.0 on a name==query candidate,
                            // and THAT producer must stay uncapped because the agreement
                            // lift above legitimately consumes it — a rerank WIN the gate
                            // agrees with was declined by nobody. T5 in
                            // __tests__/confidence-gate.test.ts pins the producer on
                            // purpose. So the ceiling lives HERE, on the one consumer
                            // where the reranker DID decline: 2 backstop rows were
                            // observed writing 1.0 on the frozen pool and one carries it
                            // live on the cold gate (n-cook-03, an exact-name pick billed
                            // 240 g vs USDA's 172 g, stored maximally confident). Owner:
                            // mobile:sync-docs/reports/2026-08-05_the-abstention-writes-a-laundered-confidence.md
                            //
                            // min(0.78, x) <= x is MONOTONE-DOWNWARD: it cannot raise the
                            // low tail (the 0.67551 bypass rows stay uncacheable, same
                            // argument as the producer cap), and it cannot change the
                            // winner — `winner` is assigned before `confidence` and no
                            // later winner assignment reads the value.
                            winner = gateSelection;
                            confidence = Math.min(RERANK_DECLINED_CONFIDENCE, gateResult.confidence);
                            selectionReason = 'confidence_gate_backstop';
                            logger.info('mapping.confidence_gate_backstop', {
                                rawLine: trimmed,
                                query: searchQuery,
                                gateReason: gateResult.reason,
                                selectedId: gateSelection.id,
                                selectedName: gateSelection.name,
                                selectedSource: gateSelection.source,
                                confidence,
                                poolSize: filtered.length,
                            });
                        } else if (sortedFiltered.length > 0) {
                            // Fallback to top scorer ONLY if above minimum threshold
                            //
                            // TWO thresholds because the old single one conflated two jobs.
                            //
                            // MIN_FALLBACK_RAW_SCORE is the ORIGINAL 0.80, kept byte-for-byte in
                            // value and deliberately NOT normalised per source. It compares a RAW
                            // cross-source retrieval score, so it is scale-blind: near-inert for
                            // OpenFoodFacts (computeOffScore is unbounded additive, median 6.900 on
                            // this population), partly real for FatSecret (positionScore reaches
                            // 1.425), and a genuine gate only for FDC (computePositionScore is
                            // already [0,1]). Normalising it is plan item #6, which is DE-RANKED —
                            // measured inert in 80.9% of cross-source contests. It stays here
                            // unchanged so this edit cannot LOOSEN admission for any source.
                            //
                            // MIN_FALLBACK_NAME_MATCH is the scale-free term the raw floor never
                            // supplied. assessConfidence() is token coverage over the query, in
                            // [0,1] for every source, and is the same judge confidenceGate uses.
                            // It is a NARROWING-ONLY addition: nothing is admitted that was not
                            // admitted before. Measured 2026-08-05 over the 208 recorded
                            // post-partition abstention decisions, 0.60 drops 13 (6.3%) — and the
                            // choice is flat, because 0.50 and 0.60 drop the identical 13. The
                            // drops fall through to the existing aiSimplify fallback, not to
                            // nothing, and they include `oatmeal` -> "Konjac Cooked Rice oats",
                            // one of this defect's headline outcomes.
                            const MIN_FALLBACK_RAW_SCORE = 0.80;
                            const MIN_FALLBACK_NAME_MATCH = 0.60;
                            const fallbackTop = sortedFiltered[0];
                            const fallbackNameMatch = assessConfidence(searchQuery, fallbackTop);
                            if (fallbackTop.score >= MIN_FALLBACK_RAW_SCORE
                                && fallbackNameMatch >= MIN_FALLBACK_NAME_MATCH) {
                                winner = fallbackTop;
                                // NOT winner.score. See RERANK_DECLINED_CONFIDENCE.
                                confidence = RERANK_DECLINED_CONFIDENCE;
                                selectionReason = 'scored_by_confidence';
                            } else {
                                // Below threshold - let fallback step handle it
                                logger.info('mapping.fallback_rejected', {
                                    rawLine: trimmed,
                                    topCandidate: fallbackTop.name,
                                    score: fallbackTop.score,
                                    nameMatch: fallbackNameMatch,
                                    rawThreshold: MIN_FALLBACK_RAW_SCORE,
                                    nameThreshold: MIN_FALLBACK_NAME_MATCH,
                                });
                            }
                        }
                    }
                }
            }
        }

        // ===== PROACTIVE SIZE ESTIMATION FOR FDC PRODUCE =====
        // If we selected FDC for produce with a size qualifier (small/medium/large),
        // proactively fetch AI size estimates so they're cached for serving selection
        if (winner && winner.source === 'fdc' && parsed?.unit) {
            const SIZE_QUALIFIERS = ['small', 'medium', 'large', 'extra large', 'extra-large'];
            const unitLower = parsed.unit.toLowerCase();
            if (SIZE_QUALIFIERS.some(sq => unitLower.includes(sq))) {
                // requestSizeEstimates was removed — use proactiveProduceBackfill instead
                const requestSizeEstimates: any = null; // TODO: Replace with proper implementation
                const { prisma } = await import('../db');

                // Check if we already have size servings cached (use FDC table, not FatSecret!)
                const fdcIdNumber = parseInt(winner.id, 10);
                if (!isNaN(fdcIdNumber)) {
                    const existingSizes = await prisma.fdcServing.findFirst({
                        where: {
                            fdcId: fdcIdNumber,
                            description: { contains: 'medium', mode: 'insensitive' },
                            isAiEstimated: true,
                        },
                    });

                    if (!existingSizes) {
                        logger.info('proactive_size_estimation.starting', {
                            food: winner.name,
                            unit: parsed.unit,
                        });

                        const sizeResult = requestSizeEstimates ? await requestSizeEstimates(winner.name, 'fdc') : { status: 'skipped' as const };

                        if (sizeResult.status === 'success') {
                            // Cache the size estimates in FdcServingCache
                            const sizes = sizeResult.sizes;
                            const sizeServings = [
                                { desc: 'small', grams: sizes.small },
                                { desc: 'medium', grams: sizes.medium },
                                { desc: 'large', grams: sizes.large },
                            ];

                            // Create size servings in FdcServingCache (skip if already exists)
                            for (const { desc, grams } of sizeServings) {
                                const fdcFoodExists = await prisma.fdcFood.findUnique({
                                    where: { fdcId: fdcIdNumber },
                                });

                                if (fdcFoodExists) {
                                    await prisma.fdcServing.upsert({
                                        where: {
                                            FdcServing_fdcId_description_key: {
                                                fdcId: fdcIdNumber,
                                                description: desc,
                                            },
                                        },
                                        create: {
                                            fdcId: fdcIdNumber,
                                            description: desc,
                                            grams: grams,
                                            source: 'ai',
                                            isAiEstimated: true,
                                        },
                                        update: {
                                            grams: grams,
                                            isAiEstimated: true,
                                        },
                                    });
                                } else {
                                    logger.warn('proactive_size_estimation.fdc_food_not_cached', {
                                        fdcId: fdcIdNumber,
                                        food: winner.name,
                                    });
                                }
                            }

                            logger.info('proactive_size_estimation.complete', {
                                food: winner.name,
                                small: sizes.small,
                                medium: sizes.medium,
                                large: sizes.large,
                            });
                        } else {
                            logger.warn('proactive_size_estimation.failed', {
                                food: winner.name,
                                reason: sizeResult.reason,
                            });
                        }
                    }
                }
            }
        }

        // Step 2b: Semantic Fallback (If no winner at all)
        // Handle complex lines like "buttermilk pancake mix light" -> "Pancake Mix"
        // Also handle cases like "burger relish" -> "Black Bean Burger" (low conf)
        // where AI simplify would correctly return "Pickle Relish"
        // Skip if this is already a recursive fallback call to prevent infinite loops
        // NOTE: Only fire when !winner. If we have a winner from rerank (even with 
        // moderate confidence), let it proceed to hydration + volume backfill (L1108-1232)
        // instead of overriding with a potentially worse fallback candidate.
        const shouldTryFallback = !winner;
        if (shouldTryFallback && !_skipFallback) {
            logger.info('mapping.attempting_fallback', { rawLine: trimmed, currentConfidence: confidence, winner: winner?.name });

            const dietary = await attemptDietaryPrefixFallback({
                trimmed, options, aiNutritionBudget, aiHydrationBudget,
            });
            if (dietary) {
                return dietary.served;
            }

            const simplify = await attemptAiSimplifyFallback({
                trimmed, rawLine, parsed, normalizedName, brandDetection, options,
                aiNutritionBudget, aiHydrationBudget,
            });
            if (simplify.kind === 'served') {
                return simplify.result;
            }
            if (simplify.kind === 'partial') {
                winner = simplify.winner;
                confidence = simplify.confidence;
                selectionReason = simplify.selectionReason;
            }
        }

        if (!winner) {
            return await runAiNutritionBackfillNoWinner({
                normalizedName, trimmed, rawLine, parsed, aiNutritionBudget,
                allCandidates, filtered, skippedLlmNormalize, usedGenericFallback,
                telemetry,
            });
        }

        // Step 4a: Hydrate ONLY the selected candidate immediately
        // Queue remaining candidates for deferred hydration after all mappings complete
        hydrateSingleCandidate(winner).catch(err => {
            logger.debug('mapping.winner_hydration_failed', { error: (err as Error).message });
        });
        queueForDeferredHydration(allCandidates, winner.id, parsed?.unit ? {
            unit: parsed.unit,
            unitType: classifyUnit(parsed.unit),
        } as any : undefined);

        // Retrieval/boost scores are open-scale (winner.score reached 8.85 in
        // the 2026-07-20 parity sweep), but everything downstream treats
        // confidence as a probability: the >=0.85 cache-save gate, the API's
        // matchConfidence field, and FoodMapping.aiConfidence. Clamp once here
        // so no raw score escapes the selection cascade.
        confidence = Math.max(0, Math.min(1, confidence));

        // Step 4b: Reject if confidence is too low (avoid garbage matches)
        const MIN_ACCEPTABLE_CONFIDENCE = 0.3;
        if (confidence < MIN_ACCEPTABLE_CONFIDENCE) {
            if (ENABLE_MAPPING_ANALYSIS) {
                logMappingAnalysis({
                    rawIngredient: trimmed,
                    parsed: {
                        amount: parsed?.qty,
                        unit: parsed?.unit,
                        ingredient: parsed?.name,
                    },
                    topCandidates: filtered.slice(0, MAPPING_ANALYSIS_TOP_N).map((c, i) => ({
                        rank: i + 1,
                        foodId: c.id,
                        foodName: c.name,
                        brandName: c.brandName || null,
                        score: c.score,
                        source: c.source,
                        semanticSimilarity: c.semanticSimilarity ?? null,
                    })),
                    selectedCandidate: {
                        foodId: winner.id,
                        foodName: winner.name,
                        brandName: winner.brandName || '',
                        confidence,
                        selectionReason,
                    },
                    finalResult: 'failed',
                    failureReason: `confidence_too_low (${confidence.toFixed(3)} < ${MIN_ACCEPTABLE_CONFIDENCE})`,
                });
            }
            markFunnel(telemetry, 'no_match', 'confidence_too_low');
            return null;
        }

        // Step 5a: If hydration failed and user requested a weight unit (oz, g, lb),
        // try AI backfill for weight serving on the winner BEFORE falling back to other candidates.
        // This prevents falling back to lower-ranked candidates just because they have gram servings.
        const isWeightUnit = parsed?.unit && WEIGHT_UNIT_REGEX.test(parsed.unit);

        // Step 5a-VOLUME: If hydration failed for a VOLUME unit (cup, tbsp, tsp, etc.),
        // try AI volume backfill to estimate density for the winner BEFORE falling back to other candidates.
        // This prevents falling back to semantically unrelated candidates just because they have volume servings.
        const isVolumeUnit = parsed?.unit && VOLUME_UNIT_REGEX.test(parsed.unit);

        // Extract prep modifier from ingredient line for modifier-aware serving labels
        const prepModifier = extractPrepModifier(rawLine, parsed?.qualifiers);

        // Step 5: Hydrate and select serving with fallback to next candidates
        const hydrated = await hydrateWinnerWithBackfills({
            winner, parsed, confidence, rawLine, aiHydrationBudget,
            isWeightUnit, isVolumeUnit, prepModifier,
        });
        let result = hydrated.result;
        if (hydrated.selectionReason !== undefined) selectionReason = hydrated.selectionReason;

        // If first choice fails (e.g., branded item without serving weights), try next candidates
        // Note: filtered may be empty if winner came from cache hit - skip fallback in that case
        if (!result && filtered.length > 0) {
            const servingFallback = await attemptServingFailureFallback({
                winner, filtered, parsed, confidence, rawLine, trimmed, normalizedName,
                aiHydrationBudget, isWeightUnit, isVolumeUnit, prepModifier,
                rerankSortedIds, targetBrand: brandDetection.matchedBrand ?? undefined,
            });
            if (servingFallback) {
                result = servingFallback.result;
                selectionReason = servingFallback.selectionReason;
            }
        }

        // Step 5b: If winner came from cache and serving selection failed, try full search
        // This handles cases where cached food has missing serving data
        if (!result && filtered.length === 0 && selectionReason === 'normalized_cache_hit') {
            const cacheResearch = await attemptCacheFailureResearch({
                winner, trimmed, normalizedName, parsed, rawLine, confidence, aiHydrationBudget,
                aiNutritionEstimate, aiCanonicalBase, isBrandedQuery, brandDetection,
                allSynonyms, skipCache, skipFdc, debug,
            });
            if (cacheResearch) {
                result = cacheResearch.result;
                selectionReason = cacheResearch.selectionReason;
            }
        }

        if (!result) {
            return await runBackfillAfterWinner({
                winner, trimmed, parsed, filtered, confidence, selectionReason,
                allCandidates, normalizedName, aiNutritionBudget, rawLine,
                skippedLlmNormalize,
            });
        }

        return await finalizeAndSaveResult({
            result,
            confidence,
            selectionReason,
            normalizedName,
            brandDetection,
            aiNutritionEstimate,
            aiCanonicalBase,
            aiCookingModifier,
            readEscapes,
            filtered,
            skippedLlmNormalize,
            usedGenericFallback,
            trimmed,
            parsed,
            rawLine,
            telemetry,
            skipSave,
        });
    } finally {
        // Release the in-flight lock and resolve waiting threads
        inFlightLocks.delete(lockKey);
        resolveLock!(null);  // Resolve with null - waiting threads will re-fetch from cache
    }
}

// ============================================================
// Selection-cascade producers, extracted in stage 1d. Same discipline
// as the tail functions further below: module-private, single params
// object destructured to the original orchestrator identifier names,
// block moved verbatim. Entry guards stay in the orchestrator; each
// function reports back via its return value and never writes
// orchestrator state directly.
// ============================================================

async function lookupNormalizedCacheProducer(params: {
    normalizedName: string;
    preBrandNormalizedName: string | undefined;
    parsed: ParsedIngredient | null;
    brandDetection: BrandKeyInput;
    trimmed: string;
    skipCache: boolean;
    isBrandedQuery: boolean;
    telemetry: MappingTelemetry | undefined;
    noteReadEscape: (targetKey: string | null | undefined, reason: string) => void;
}): Promise<{ winner: UnifiedCandidate; confidence: number; selectionReason: string } | null> {
    const {
        normalizedName, preBrandNormalizedName, parsed, brandDetection, trimmed,
        skipCache, isBrandedQuery, telemetry, noteReadEscape,
    } = params;

    if (telemetry) telemetry.normalizedForm = normalizedName;
    // skipCache must gate this layer too — without it a "cold" (nocache)
    // run would still serve cached rows via step 1c and parity runs
    // against the cache would be meaningless.
    // PR D pt3 (C1) + key symmetry (Track 1c): same derived key
    // (deriveMappingCacheKey incl. brand-prefix decision) as the early
    // lookup and the Step-6 save — recomputed here because AI
    // normalize may have replaced normalizedName. brandDetection is
    // request-stable, so this key matches the save key exactly. A
    // miss falls back to the legacy (pre-Track-1c) key.
    const normalizedLookupRejection: CacheLookupRejection = { reason: null };
    const normalizedCache = skipCache ? null : await lookupValidatedMappingWithLegacyFallback(normalizedName, parsed, brandDetection, trimmed, normalizedLookupRejection, preBrandNormalizedName);
    if (!normalizedCache && normalizedLookupRejection.reason) {
        if (telemetry) telemetry.cacheEscape = 'lookup_normalized:' + normalizedLookupRejection.reason;
        noteReadEscape(normalizedLookupRejection.targetKey, 'lookup_normalized:' + normalizedLookupRejection.reason);
    }
    if (normalizedCache) {
        logger.info('mapping.normalized_cache_hit', { rawLine: trimmed, normalizedName });
        const normalizedCoreTokenMismatch = hasCoreTokenMismatch(normalizedName, normalizedCache.foodName, normalizedCache.brandName);

        // Validate nutrition data - reject cached mappings to foods with zero/null nutrition
        let normalizedNutritionInvalid = false;
        let normalizedCorruptMarked = false;
        // fs_ only — see the matching flag in Step 1a.
        let normalizedFsBillableViaServings = false;
        let normalizedOffServing: { servingSize: string | null; servingGrams: number | null } | null = null;
        let normalizedCachedKcal100: number | null = null;
        let normalizedCachedCarbs100: number | null = null;
        if (!normalizedCoreTokenMismatch) {
            const { prisma } = await import('../db');
            let nutrients: any = null;
            if (normalizedCache.foodId.startsWith('fdc_')) {
                const fdcId = parseInt(normalizedCache.foodId.replace('fdc_', ''), 10);
                const fdc = await prisma.fdcFood.findUnique({
                    where: { fdcId },
                    select: { nutrientsPer100g: true }
                });
                nutrients = fdc?.nutrientsPer100g;
            } else if (normalizedCache.foodId.startsWith('off_')) {
                const barcode = normalizedCache.foodId.replace('off_', '');
                const off = await prisma.offFood.findUnique({
                    where: { barcode },
                    select: { nutrientsPer100g: true, servingSize: true, servingGrams: true, corruptReason: true }
                });
                nutrients = off?.nutrientsPer100g;
                if (off) {
                    normalizedOffServing = { servingSize: off.servingSize, servingGrams: off.servingGrams };
                    normalizedCorruptMarked = off.corruptReason != null && isCorruptExclusionEnabled();
                }
            } else if (normalizedCache.foodId.startsWith('fs_')) {
                // Same gap as Step 1a, same fix — see the comment there for the
                // measurement. This arm was an aiGeneratedFood lookup that executed
                // on every fs_ hit and could never match.
                const fsId = normalizedCache.foodId.replace('fs_', '');
                const fsFood = await prisma.fatSecretFood.findUnique({
                    where: { fsId },
                    select: { nutrientsPer100g: true, servings: { select: { nutrients: true } } }
                });
                const fsPanel = fsFood?.nutrientsPer100g as Record<string, any> | null | undefined;
                nutrients = fsPanel && Object.keys(fsPanel).length > 0 ? fsPanel : null;
                normalizedFsBillableViaServings = (fsFood?.servings ?? []).some(
                    s => servingMacros(s.nutrients as Record<string, unknown> | null) != null);
            } else {
                // Instrument only — see the matching note in Step 1a.
                logger.audit('cache.unrecognised_food_id_prefix', {
                    foodId: normalizedCache.foodId,
                    cachedFood: normalizedCache.foodName,
                });
            }

            if (nutrients) {
                const mappedNutrients = {
                    kcal: nutrients.calories ?? nutrients.energy ?? nutrients.kcal ?? 0,
                    protein: nutrients.protein ?? 0,
                    carbs: nutrients.carbohydrate ?? nutrients.carbs ?? 0,
                    fat: nutrients.fat ?? 0,
                    per100g: true,
                };
                normalizedCachedKcal100 = mappedNutrients.kcal || null;
                normalizedCachedCarbs100 = mappedNutrients.carbs || null;
                normalizedNutritionInvalid = hasNullOrInvalidMacros(mappedNutrients, normalizedCache.foodName);
                if (normalizedNutritionInvalid) {
                    logger.warn('mapping.normalized_cache_bad_nutrition', {
                        rawLine: trimmed,
                        cachedFood: normalizedCache.foodName,
                        nutrients,
                    });
                }
            } else if (normalizedCache.foodId.startsWith('off_')
                || (normalizedCache.foodId.startsWith('fs_') && !normalizedFsBillableViaServings)) {
                // Symmetric with Step 1a's safety net: a cache row pointing at a
                // record with no nutrition panel AND no macro-bearing serving must
                // re-resolve, not be served with nulls. An empty panel alone is not
                // enough — see the measurement in Step 1a's fs_ arm. Deliberately
                // NOT extended to fdc_ here — the fdc_ arm above has never had this
                // net and widening it is a separate, unmeasured behaviour change.
                normalizedNutritionInvalid = true;
                logger.warn('mapping.normalized_cache_missing_nutrition', {
                    rawLine: trimmed,
                    cachedFood: normalizedCache.foodName,
                    foodId: normalizedCache.foodId,
                });
            }
        }

        // Counted-piece cache escape — same rationale as the early-cache
        // check: without it this layer would re-pin the label-less food
        // the early check just escaped from.
        const normalizedCountedNoun = countedPieceNoun(parsed);
        const normalizedCountLabelEscape = normalizedCountedNoun != null
            && normalizedCache.foodId.startsWith('off_')
            && !servingLabelCountsPiece(normalizedOffServing?.servingSize, normalizedOffServing?.servingGrams, normalizedCountedNoun);

        // Cooked-grain cache escape — same rationale as the early-cache check.
        const normalizedCachedLooksCooked = /\b(cooked|boiled|steamed|prepared)\b/i.test(normalizedCache.foodName)
            || (normalizedCachedKcal100 != null && normalizedCachedKcal100 > 60 && normalizedCachedKcal100 <= 250
                && normalizedCachedCarbs100 != null && normalizedCachedCarbs100 >= 12);
        const normalizedGrainCookedEscape = detectGrainCookingContext(trimmed, normalizedName).softCooked === true
            && !normalizedCachedLooksCooked;

        // Escape reason doubles as the telemetry label (PR D pt3 split
        // the former catch-all 'filter_mismatch' into per-condition
        // labels). Same predicates, same order as the former || chain.
        let normalizedEscapeReason =
            normalizedCorruptMarked ? 'corrupt_record'
            : normalizedCoreTokenMismatch ? 'core_token_mismatch'
            : normalizedNutritionInvalid ? 'nutrition_invalid'
            : normalizedCountLabelEscape ? 'count_label'
            : normalizedGrainCookedEscape ? 'grain_cooked'
            : isCategoryMismatch(normalizedName, normalizedCache.foodName, normalizedCache.brandName) ? 'category_mismatch'
            : isMultiIngredientMismatch(normalizedName, normalizedCache.foodName) ? 'multi_ingredient'
            // For branded queries: skip modifier mismatch when the cached food's brand
            // matches the detected brand (e.g. "Oikos" query → "Oikos Triple Zero Vanilla Nonfat"
            // should not be rejected just because "nonfat" is in the food name but not the query).
            : ((!isBrandedQuery || !(
                normalizedCache.brandName &&
                brandDetection.matchedBrand &&
                normalizedCache.brandName.toLowerCase().includes(brandDetection.matchedBrand.toLowerCase())
            )
                ? hasCriticalModifierMismatch(trimmed, normalizedCache.foodName, 'cache')
                : false
            )) ? 'modifier_mismatch'
            : isReplacementMismatch(trimmed, normalizedCache.foodName, normalizedCache.brandName) ? 'replacement_mismatch'
            // For branded queries with a known target brand: reject cached results from a
            // DIFFERENT brand. e.g. "Heinz Tomato Ketchup" query must not serve a cached
            // "TOMATO KETCHUP (WEIS)" result — force a fresh pipeline run to find Heinz.
            : (isBrandedQuery &&
                brandDetection.matchedBrand != null &&
                normalizedCache.brandName != null &&
                !normalizedCache.brandName.toLowerCase().includes(brandDetection.matchedBrand.toLowerCase())
            ) ? 'brand_guard'
            : null;

        // Read-time trust (PR D pt3, HUMAN_ROW_TRUST) — same rationale
        // as the early-cache block: name-heuristic escapes skipped for
        // human-triage rows; corrupt-record, core-token,
        // nutrition-invalid and serving-shape escapes stay active for
        // all rows.
        if (normalizedEscapeReason
            && isHumanTrustSkippableEscape(normalizedEscapeReason)
            && isTrustedHumanRow(normalizedCache.validatedBy)) {
            logger.info('cache.human_row_trusted', {
                key: normalizedName,
                foodId: normalizedCache.foodId,
                skippedRejection: 'normalized:' + normalizedEscapeReason,
            });
            normalizedEscapeReason = null;
        }

        if (normalizedEscapeReason) {
            logger.warn('mapping.normalized_cache_filter_mismatch', {
                rawLine: trimmed,
                cachedFood: normalizedCache.foodName,
                normalized: normalizedName,
                coreTokenMismatch: normalizedCoreTokenMismatch,
                nutritionInvalid: normalizedNutritionInvalid,
            });
            if (telemetry) {
                telemetry.cacheEscape = 'normalized:' + normalizedEscapeReason;
            }
            noteReadEscape(targetKeyOfFoodId(normalizedCache.foodId), 'normalized:' + normalizedEscapeReason);
        } else {
            const winner: UnifiedCandidate = {
                id: normalizedCache.foodId,
                name: normalizedCache.foodName,
                brandName: normalizedCache.brandName || undefined,
                source: normalizedCache.source as any,
                score: normalizedCache.confidence,
                foodType: 'generic', // Assumption
                rawData: {},
            };
            const confidence = normalizedCache.confidence;
            const selectionReason = 'normalized_cache_hit';
            if (telemetry) telemetry.cacheHit = 'normalized';
            markFunnel(telemetry, 'cache_hit');
            return { winner, confidence, selectionReason };
        }
    }

    return null;
}

async function attemptDietaryPrefixFallback(params: {
    trimmed: string;
    options: MapIngredientOptions;
    aiNutritionBudget: AiNutritionBudget;
    aiHydrationBudget: AiNutritionBudget;
}): Promise<{ served: FatsecretMappedIngredient } | null> {
    const { trimmed, options, aiNutritionBudget, aiHydrationBudget } = params;

    // ── Step 2b-i: Dietary-prefix stripping fallback ──────────────
    // If the ingredient has a dietary-attribute prefix (fat-free, gluten-free, sugar-free, etc.),
    // try re-searching WITHOUT it. These prefixes describe what's ABSENT, not what the food IS.
    // We try the full term FIRST (above), and only strip as a fallback.
    // Example flow: "gluten-free salad seasoning" → initial search fails → retry "salad seasoning"
    const DIETARY_PREFIX_PATTERN = /\b(?:fat[- ]?free|nonfat|non[- ]?fat|gluten[- ]?free|sugar[- ]?free|dairy[- ]?free|grain[- ]?free|nut[- ]?free)\s+/gi;
    const strippedLine = trimmed.replace(DIETARY_PREFIX_PATTERN, '').trim();

    if (strippedLine !== trimmed && strippedLine.length > 2) {
        logger.info('mapping.dietary_prefix_fallback', { original: trimmed, stripped: strippedLine });

        const dietaryFallbackResult = await mapIngredientWithFallback(strippedLine, {
            ...options,
            // Explicit, NOT covered by the spread: `options` carries the
            // caller's value, which may be undefined while the
            // destructure above already minted one. Without this a
            // single ingredient line spends a fresh allowance per
            // recursion level.
            aiNutritionBudget,
            // Both allowances forward, for the same reason and with the
            // same explicit-over-spread caveat.
            aiHydrationBudget,
            minConfidence: 0.1,
            _skipInFlightLock: true,
            _skipFallback: true, // Prevent infinite recursion
        });

        if (dietaryFallbackResult && 'confidence' in dietaryFallbackResult && dietaryFallbackResult.confidence > 0) {
            logger.info('mapping.dietary_prefix_fallback_success', {
                original: trimmed,
                stripped: strippedLine,
                food: dietaryFallbackResult.foodName,
                confidence: dietaryFallbackResult.confidence,
            });
            logger.audit('mapping.recovery_path', {
                path: 'dietary_direct_return',
                original: trimmed,
                servedBy: dietaryFallbackResult.foodId,
            });
            return { served: dietaryFallbackResult };
        }
    }

    return null;
}

async function attemptAiSimplifyFallback(params: {
    trimmed: string;
    rawLine: string;
    parsed: ParsedIngredient | null;
    normalizedName: string;
    brandDetection: BrandKeyInput;
    options: MapIngredientOptions;
    aiNutritionBudget: AiNutritionBudget;
    aiHydrationBudget: AiNutritionBudget;
}): Promise<
    | { kind: 'served'; result: FatsecretMappedIngredient }
    | { kind: 'partial'; winner: UnifiedCandidate; confidence: number; selectionReason: string }
    | { kind: 'none' }
> {
    const {
        trimmed, rawLine, parsed, normalizedName, brandDetection, options,
        aiNutritionBudget, aiHydrationBudget,
    } = params;

    // ── Step 2b-ii: LLM-based simplification ──────────────────────
    // LLM-based simplification for complex ingredient names
    const { aiSimplifyIngredient } = await import('./ai-simplify');

    try {
        const result = await aiSimplifyIngredient(trimmed, brandDetection.matchedBrand ?? undefined);

        if (result && result.simplified && result.simplified !== normalizedName) {
            logger.info('mapping.fallback_simplification', { original: trimmed, simplified: result.simplified });

            // Recursively try to map the simplifed name
            // We use a lower minConfidence to accept matches
            // IMPORTANT: Pass _skipInFlightLock to prevent deadlock if simplified name
            // normalizes to the same lock key as the original
            const fallbackResult = await mapIngredientWithFallback(result.simplified, {
                ...options,
                aiNutritionBudget,   // see the dietary-fallback call above
                aiHydrationBudget,   // ditto — both allowances, explicitly
                minConfidence: 0.1, // Accept imperfect matches for fallback
                _skipInFlightLock: true, // Prevent recursive deadlock
                _skipFallback: true, // Prevent infinite fallback recursion
            });

            if (fallbackResult && 'foodId' in fallbackResult) {
                // Fallback found a food, but its serving data was computed without our original qty/unit
                // Re-hydrate using the ORIGINAL parsed input for correct serving selection
                const fbr = fallbackResult as FatsecretMappedIngredient;
                const fallbackCandidate: UnifiedCandidate = {
                    id: fbr.foodId,
                    name: fbr.foodName,
                    brandName: fbr.brandName || undefined,
                    source: fbr.foodId.startsWith('fdc_') ? 'fdc' :
                            fbr.foodId.startsWith('off_') ? 'openfoodfacts' : 'ai_generated',
                    score: fbr.confidence * 0.85,
                    foodType: 'generic',
                    rawData: {},
                };

                // For FDC candidates, populate nutrition from fallback result
                // so buildFdcResult() can compute serving-specific nutrition
                if (fbr.foodId.startsWith('fdc_') && fbr.grams > 0) {
                    const factor = 100 / fbr.grams;
                    fallbackCandidate.nutrition = {
                        kcal: fbr.kcal * factor,
                        protein: fbr.protein * factor,
                        carbs: fbr.carbs * factor,
                        fat: fbr.fat * factor,
                        per100g: true,
                    };
                }

                // Re-hydrate with ORIGINAL parsed input to get correct serving for "0.25 cup"
                const rehydratedResult = await hydrateAndSelectServing(
                    fallbackCandidate,
                    parsed,  // Use original parsed input with qty/unit!
                    fallbackCandidate.score,
                    rawLine,
                    aiHydrationBudget
                );

                if (rehydratedResult) {
                    // Successfully re-hydrated with correct serving
                    logger.info('mapping.fallback_success', {
                        original: trimmed,
                        mappedTo: fbr.foodName,
                        serving: rehydratedResult.servingDescription,
                        grams: rehydratedResult.grams,
                    });
                    logger.audit('mapping.recovery_path', {
                        path: 'simplify_direct_return',
                        original: trimmed,
                        servedBy: rehydratedResult.foodId,
                    });
                    return { kind: 'served', result: rehydratedResult };
                }

                // If re-hydration failed, still create winner for fallback processing
                const winner = fallbackCandidate;
                const confidence = winner.score;
                const selectionReason = `fallback_simplified: ${result.rationale}`;

                logger.info('mapping.fallback_partial', {
                    original: trimmed,
                    mappedTo: fallbackResult.foodName,
                    note: 'rehydration_failed_continuing'
                });
                return { kind: 'partial', winner, confidence, selectionReason };
            }
        }
    } catch (err) {
        logger.error('mapping.fallback_error', { error: (err as Error).message });
    }

    return { kind: 'none' };
}

async function runAiNutritionBackfillNoWinner(params: {
    normalizedName: string;
    trimmed: string;
    rawLine: string;
    parsed: ParsedIngredient | null;
    aiNutritionBudget: AiNutritionBudget;
    allCandidates: UnifiedCandidate[];
    filtered: UnifiedCandidate[];
    skippedLlmNormalize: boolean;
    usedGenericFallback: boolean;
    telemetry: MappingTelemetry | undefined;
}): Promise<FatsecretMappedIngredient | null> {
    const {
        normalizedName, trimmed, rawLine, parsed, aiNutritionBudget,
        allCandidates, filtered, skippedLlmNormalize, usedGenericFallback,
        telemetry,
    } = params;

    // ============================================================
    // AI NUTRITION BACKFILL: Last resort for unmappable ingredients
    // ============================================================
    if (AI_NUTRITION_BACKFILL_ENABLED) {
        const baseFoodContext = extractBaseFoodContext(allCandidates);
        const aiResult = await requestAiNutrition(normalizedName, {
            rawLine: trimmed,
            baseFoodContext,
            budget: aiNutritionBudget,
        });

        if (aiResult.status === 'success') {
            // Compute grams and nutrition for the requested serving
            const parsedQty = parsed ? parsed.qty * parsed.multiplier : 1;
            const parsedUnit = parsed?.unit || 'serving';

            const servingResult = await getAiServingGrams(
                aiResult.foodId,
                parsedUnit,
                parsedQty,
            );

            const grams = servingResult?.grams ?? 100;
            const scale = grams / 100;

            const aiMapped: FatsecretMappedIngredient = {
                source: 'ai_generated',
                foodId: aiResult.foodId,
                foodName: aiResult.displayName,
                brandName: null,
                servingId: null,
                servingDescription: servingResult?.servingLabel ?? `${parsedQty} ${parsedUnit}`,
                grams,
                kcal: aiResult.caloriesPer100g * scale,
                protein: aiResult.proteinPer100g * scale,
                carbs: aiResult.carbsPer100g * scale,
                fat: aiResult.fatPer100g * scale,
                confidence: aiResult.confidence * 0.8,  // Penalize slightly vs API matches
                quality: aiResult.confidence >= 0.7 ? 'medium' : 'low',
                rawLine,
                servingTier: servingResult?.grams != null ? 'ai_generated_serving' : 'flat_100g_default',
            };

            if (ENABLE_MAPPING_ANALYSIS) {
                logMappingAnalysis({
                    rawIngredient: trimmed,
                    parsed: {
                        amount: parsed?.qty,
                        unit: parsed?.unit,
                        ingredient: parsed?.name,
                    },
                    topCandidates: [],
                    selectedCandidate: {
                        foodId: aiResult.foodId,
                        foodName: aiResult.displayName,
                        brandName: '',
                        confidence: aiMapped.confidence,
                        selectionReason: aiResult.cached ? 'ai_nutrition_cache_hit' : 'ai_nutrition_generated',
                    },
                    selectedNutrition: {
                        calories: aiMapped.kcal,
                        protein: aiMapped.protein,
                        carbs: aiMapped.carbs,
                        fat: aiMapped.fat,
                        perGrams: aiMapped.grams,
                    },
                    servingSelection: {
                        servingDescription: aiMapped.servingDescription || 'N/A',
                        grams: aiMapped.grams,
                        backfillUsed: true,
                        backfillType: 'weight',
                    },
                    finalResult: 'success',
                    source: 'full_pipeline',
                    aiCalls: {
                        normalize: {
                            called: !skippedLlmNormalize && !usedGenericFallback,
                            skipped: skippedLlmNormalize,
                        },
                        // 0.5(b). `ai_generated_serving` is NOT an AI call —
                        // getAiServingGrams() only reads AiGeneratedServing rows.
                        serving: servingAiCallForTier(aiMapped.servingTier),
                        nutrition: { called: true, cached: aiResult.cached, success: true },
                    },
                });
            }

            logger.info('mapping.ai_nutrition_backfill_success', {
                rawLine: trimmed,
                foodName: aiResult.displayName,
                confidence: aiMapped.confidence,
                cached: aiResult.cached,
            });

            return aiMapped;
        } else {
            logger.warn('mapping.ai_nutrition_backfill_failed', {
                rawLine: trimmed,
                reason: aiResult.reason,
            });
        }
    }

    // Total failure — log and return null
    if (ENABLE_MAPPING_ANALYSIS) {
        logMappingAnalysis({
            rawIngredient: trimmed,
            parsed: {
                amount: parsed?.qty,
                unit: parsed?.unit,
                ingredient: parsed?.name,
            },
            topCandidates: [],
            selectedCandidate: {
                foodId: '',
                foodName: '',
                brandName: '',
                confidence: 0,
                selectionReason: 'no_candidates_after_fallback',
            },
            finalResult: 'failed',
            failureReason: 'no_candidates_found',
        });
    }
    // Separate a dataset gap (retrieval found nothing to rank) from a
    // filter gap (records existed but every one was dropped pre-rank)
    // from a selection gap — they need completely different fixes.
    if (allCandidates.length === 0) {
        markFunnel(telemetry, 'no_candidates', 'dataset_gap');
    } else if (filtered.length === 0) {
        markFunnel(telemetry, 'all_filtered', 'no_candidate_survived_filters');
    } else {
        markFunnel(telemetry, 'no_match', 'no_winner_selected');
    }
    return null; // Return null if truly failed
}

// ============================================================
// Step 5 cascade tail, extracted in stage 1d. Each function below is
// module-private, takes a single params object destructured to the
// original orchestrator identifier names, and carries its block
// verbatim. Entry guards stay in the orchestrator; each function
// reports back via its return value and never writes orchestrator
// state directly.
// ============================================================

async function hydrateWinnerWithBackfills(params: {
    winner: UnifiedCandidate;
    parsed: ParsedIngredient | null;
    confidence: number;
    rawLine: string;
    aiHydrationBudget: AiNutritionBudget;
    isWeightUnit: boolean | '' | null | undefined;
    isVolumeUnit: boolean | '' | null | undefined;
    prepModifier: string | undefined;
}): Promise<{ result: FatsecretMappedIngredient | null; selectionReason?: string }> {
    const {
        winner, parsed, confidence, rawLine, aiHydrationBudget,
        isWeightUnit, isVolumeUnit, prepModifier,
    } = params;
    let selectionReason: string | undefined;

    let result = await hydrateAndSelectServing(winner, parsed, confidence, rawLine, aiHydrationBudget);

    if (!result && isWeightUnit && winner.source === 'ai_generated') {
        // See the rerank instrumentation note above. If this never fires, weight
        // serving backfill has been silently off since the lane was relabelled
        // 'fatsecret' — corroborated by MEASURED 0 occurrences of the warn-level
        // mapping.weight_backfill_failed in 12 days of production log. The repair
        // would then be to WIDEN this guard to 'fatsecret', not to delete it.
        logger.audit('backfill.ai_generated_winner_seen', {
            foodId: winner.id,
            foodName: winner.name,
            path: 'weight',
        });
        logger.info('mapping.weight_backfill_attempt', {
            foodId: winner.id,
            foodName: winner.name,
            unit: parsed!.unit,
        });

        const backfillResult = await backfillWeightServing(winner.id);

        if (backfillResult.success) {
            // Retry hydration now that we have a weight serving
            result = await hydrateAndSelectServing(winner, parsed, confidence, rawLine, aiHydrationBudget);

            if (result) {
                logger.info('mapping.weight_backfill_success', {
                    foodId: winner.id,
                    foodName: winner.name,
                    unit: parsed!.unit,
                    grams: result.grams,
                });
                selectionReason = 'weight_backfill_success';
            }
        } else {
            logger.warn('mapping.weight_backfill_failed', {
                foodId: winner.id,
                reason: backfillResult.reason,
            });
        }
    }

    // Enable AI backfill for BOTH FatSecret and FDC sources (FDC often lacks volume servings)
    if (!result && isVolumeUnit && (winner.source === 'ai_generated' || winner.source === 'fdc')) {
        if (winner.source === 'ai_generated') {
            logger.audit('backfill.ai_generated_winner_seen', {
                foodId: winner.id,
                foodName: winner.name,
                path: 'volume',
            });
        }
        logger.info('mapping.volume_backfill_attempt', {
            foodId: winner.id,
            foodName: winner.name,
            unit: parsed!.unit,
            source: winner.source,
            prepModifier,
        });

        const volumeBackfillResult = await insertAiServing(winner.id, 'volume', {
            targetServingUnit: parsed?.unit ?? undefined,
            prepModifier,
            candidateData: winner,  // Pass candidate data to avoid DB lookup race condition
        });

        if (volumeBackfillResult.success) {
            // Retry hydration now that we have a volume serving
            result = await hydrateAndSelectServing(winner, parsed, confidence, rawLine, aiHydrationBudget);

            if (result) {
                logger.info('mapping.volume_backfill_success', {
                    foodId: winner.id,
                    foodName: winner.name,
                    unit: parsed!.unit,
                    grams: result.grams,
                });
                selectionReason = 'volume_backfill_success';
            }
        } else {
            logger.warn('mapping.volume_backfill_failed', {
                foodId: winner.id,
                reason: volumeBackfillResult.reason,
            });
        }
    }

    return { result, selectionReason };
}

/**
 * The serving fallback's candidate order.
 *
 * EXPORTED because it is otherwise untestable and UNGATEABLE. winner-diff's
 * --with-serving stage hydrates the WINNER and only the winner (resolveServings(),
 * section 9) and never runs the mapper's fallback at all, so a frozen-pool receipt
 * is silent about this ordering in both directions. A unit pin is the only
 * instrument that sees it.
 *
 * (The hydration entry point is named without its parens just above, on purpose:
 * the hydration-pool migration guard balanced-paren-scans BOTH mapper source
 * files for `<name>(` and reads a mention inside a comment as one more call site
 * passing no budget — the "the anchor matched a comment" trap that file warns
 * about, reproduced here at a cost of one red suite.)
 *
 * Stable by construction: `Array.prototype.sort` is stable in every runtime this
 * ships on, and candidates absent from the rerank order share one rank key, so
 * they keep their gather order behind the ranked ones rather than shuffling.
 * A null order (the reranker never ran — a cache hit, or a pool too small)
 * returns the input untouched.
 */
export function orderFallbacksByRerank<T extends { id: string }>(
    eligible: readonly T[],
    rerankSortedIds: string[] | null,
): T[] {
    if (!rerankSortedIds) return [...eligible];
    const rank = new Map(rerankSortedIds.map((id, i) => [id, i]));
    return [...eligible].sort((a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

async function attemptServingFailureFallback(params: {
    winner: UnifiedCandidate;
    filtered: UnifiedCandidate[];
    parsed: ParsedIngredient | null;
    confidence: number;
    rawLine: string;
    trimmed: string;
    normalizedName: string;
    aiHydrationBudget: AiNutritionBudget;
    isWeightUnit: boolean | '' | null | undefined;
    isVolumeUnit: boolean | '' | null | undefined;
    prepModifier: string | undefined;
    /** The reranker's ordering of the pool, by id; null when it never ran. */
    rerankSortedIds: string[] | null;
    /** The detected brand, when the line is brand-led. Arms the coverage guard. */
    targetBrand: string | undefined;
}): Promise<{ result: FatsecretMappedIngredient; selectionReason: string } | null> {
    const {
        winner, filtered, parsed, confidence, rawLine, trimmed, normalizedName,
        aiHydrationBudget, isWeightUnit, isVolumeUnit, prepModifier,
        rerankSortedIds, targetBrand,
    } = params;
    let result: FatsecretMappedIngredient | null = null;
    let selectionReason = '';

    logger.info('mapping.hydration_failed_retrying', {
        failedId: winner.id,
        failedName: winner.name,
        remainingCandidates: filtered.length - 1
    });

    // TRY THE NEXT 3 IN RERANK ORDER, NOT GATHER ORDER (A8 row 1, 2026-08-25).
    //
    // `filtered` is in GATHER order: gatherCandidates() pushes searchFdcLocal,
    // then OFF, then the FatSecret lane. So `filtered.slice(0, 3)` was "the OFF
    // lane's top three retrieval hits", chosen with no reference to what the
    // reranker made of them — and this function runs precisely when a FatSecret
    // winner failed to hydrate, i.e. on the lines where the FS lane is last in
    // the list and the reranker's opinion is the only thing that distinguishes
    // the substitutes. Measured on the A8 within-brand census: 9 of the 12
    // logged fallback winners were `off_` rows, and on 5 of those the offline
    // reranker's own winner was the RIGHT record, sitting further down
    // `filtered` than the slice reached.
    //
    // `attemptCacheFailureResearch()` below already does exactly this — it maps
    // `rerankResult.sortedCandidates` back onto its filtered set — so this is
    // the two serving-failure paths agreeing rather than a new policy.
    //
    // Falls back to gather order when the reranker never ran (a cache hit, a
    // pool of one): there is then no order to honour, and refusing to try
    // anything would trade a wrong record for no record.
    const eligible = filtered.filter(c => c.id !== winner.id);
    const ordered = orderFallbacksByRerank(eligible, rerankSortedIds);
    const fallbackCandidates = ordered.slice(0, 3);
    // `audit`, not `info`: the box runs at LOG_LEVEL=warn, so an info line does not
    // survive to `next-start.log` and this change's firing population would be
    // unmeasurable in production — the same channel `mapping.recovery_path` already
    // uses, which is why `serving_failure_fallback` reads 357 there and
    // `mapping.fallback_success` reads 2.
    if (rerankSortedIds && fallbackCandidates.some((c, i) => c.id !== eligible[i]?.id)) {
        logger.audit('mapping.fallback_reordered_by_rerank', {
            failedId: winner.id,
            gatherOrder: eligible.slice(0, 3).map(c => c.id),
            rerankOrder: fallbackCandidates.map(c => c.id),
        });
    }

    const failedWinnerId = winner.id;
    const tryFallbackCandidate = async (fallback: UnifiedCandidate): Promise<boolean> => {
        let fallbackResult = await hydrateAndSelectServing(
            fallback, parsed, confidence * 0.95, rawLine, aiHydrationBudget
        );

        // If hydration failed for a FatSecret candidate, try backfill before giving up
        if (!fallbackResult && fallback.source === 'ai_generated') {
            logger.audit('backfill.ai_generated_winner_seen', {
                foodId: fallback.id,
                foodName: fallback.name,
                path: 'fallback',
            });
            if (isVolumeUnit) {
                logger.info('mapping.fallback_volume_backfill_attempt', {
                    foodId: fallback.id,
                    foodName: fallback.name,
                    unit: parsed?.unit,
                    prepModifier,
                });
                const backfillResult = await insertAiServing(fallback.id, 'volume', {
                    targetServingUnit: parsed?.unit ?? undefined,
                    prepModifier,
                    candidateData: fallback,  // Pass candidate data to avoid DB lookup race condition
                });
                if (backfillResult.success) {
                    fallbackResult = await hydrateAndSelectServing(
                        fallback, parsed, confidence * 0.95, rawLine, aiHydrationBudget
                    );
                }
            } else if (isWeightUnit) {
                logger.info('mapping.fallback_weight_backfill_attempt', {
                    foodId: fallback.id,
                    foodName: fallback.name,
                    unit: parsed?.unit,
                });
                const backfillResult = await backfillWeightServing(fallback.id);
                if (backfillResult.success) {
                    fallbackResult = await hydrateAndSelectServing(
                        fallback, parsed, confidence * 0.95, rawLine, aiHydrationBudget
                    );
                }
            }
        }

        if (fallbackResult) {
            logger.info('mapping.fallback_success', {
                originalId: failedWinnerId,
                fallbackId: fallback.id,
                fallbackName: fallback.name,
            });
            logger.audit('mapping.recovery_path', {
                path: 'serving_failure_fallback',
                from: failedWinnerId,
                to: fallback.id,
            });
            result = fallbackResult;
            selectionReason = 'fallback_after_serving_failure';
            return true;
        }
        return false;
    };

    // PR D pt3 (B4): floor-hit fallbacks are set aside and only tried
    // as a last resort; denylisted records are never accepted.
    const floorRejectedFallbacks: UnifiedCandidate[] = [];

    for (const fallback of fallbackCandidates) {
        // CRITICAL: Validate semantic relevance before accepting fallback
        // This prevents "golden flaxseed meal" → "Golden Delicious Apples" syndrome
        // where the fallback is selected just because it has the right serving,
        // despite being semantically unrelated to the query
        if (hasCoreTokenMismatch(normalizedName, fallback.name, fallback.brandName)) {
            logger.debug('mapping.fallback_rejected_token_mismatch', {
                query: normalizedName,
                fallbackName: fallback.name,
                fallbackBrand: fallback.brandName,
            });
            continue; // Skip this fallback, try next one
        }
        // ON A BRAND-LED LINE THE SUBSTITUTE MUST STILL BE THE ITEM ASKED FOR.
        //
        // `hasCoreTokenMismatch()` is the only identity guard this path has had,
        // and it checks membership of CORE_FOOD_TOKENS — a list carrying no
        // `bacon`, `burger`, `fries`, `wings`, `nachos`, `sandwich` or `biscuit`,
        // so it declines to guard eight of the eleven venue rows the A8 census
        // measured. `first watch million dollar bacon` fell to a granola and
        // `yard house poke nachos` to a stack, both silently.
        //
        // The rule is the reranker's own: a candidate that shares the brand but
        // covers no non-brand token of the query is the wrong item under the
        // right sign. Same predicate, imported not restated — it is what
        // `DECISIVE_BRAND_BOOST` already requires before it will prefer a
        // same-brand record.
        //
        // The honest consequence, and it is intended: when nothing in the pool
        // covers a food token, this line now falls through to the AI-stub lane
        // (`ai_estimated`, no badge) instead of billing a wrong same-brand
        // record. "We estimated this" beats a confident wrong panel.
        if (targetBrand && !coversNonBrandQueryToken(fallback.name, normalizedName, targetBrand)) {
            logger.audit('mapping.fallback_rejected_no_food_token', {
                query: normalizedName,
                targetBrand,
                fallbackName: fallback.name,
                fallbackId: fallback.id,
            });
            continue;
        }
        if (isRankPlausibilityPartitionEnabled() && isDenylistedOffRecord(fallback.id)) {
            logger.warn('mapping.denylisted_candidate_dropped', {
                rawLine: trimmed,
                candidate: fallback.name,
                foodId: fallback.id,
            });
            continue;
        }
        if (candidateHitsPlausibilityFloor(normalizedName, fallback)) {
            logger.debug('mapping.fallback_rejected_plausibility_floor', {
                query: normalizedName,
                fallbackName: fallback.name,
            });
            floorRejectedFallbacks.push(fallback);
            continue;
        }

        if (await tryFallbackCandidate(fallback)) break;
    }

    // Last resort: every acceptable fallback was floor-hit — a
    // floor-hit record still beats returning nothing (floors demote,
    // never drop).
    if (!result) {
        for (const fallback of floorRejectedFallbacks) {
            if (await tryFallbackCandidate(fallback)) break;
        }
    }

    return result ? { result, selectionReason } : null;
}

async function attemptCacheFailureResearch(params: {
    winner: UnifiedCandidate;
    trimmed: string;
    normalizedName: string;
    parsed: ParsedIngredient | null;
    rawLine: string;
    confidence: number;
    aiHydrationBudget: AiNutritionBudget;
    aiNutritionEstimate: { caloriesPer100g: number; proteinPer100g: number; carbsPer100g: number; fatPer100g: number; confidence: number } | undefined;
    aiCanonicalBase: string | undefined;
    isBrandedQuery: boolean;
    brandDetection: BrandKeyInput;
    allSynonyms: string[];
    skipCache: boolean;
    skipFdc: boolean;
    debug: boolean;
}): Promise<{ result: FatsecretMappedIngredient; selectionReason: string } | null> {
    const {
        winner, trimmed, normalizedName, parsed, rawLine, confidence, aiHydrationBudget,
        aiNutritionEstimate, aiCanonicalBase, isBrandedQuery, brandDetection,
        allSynonyms, skipCache, skipFdc, debug,
    } = params;
    let result: FatsecretMappedIngredient | null = null;
    let selectionReason = '';

    logger.info('mapping.cache_serving_failed_retrying_search', {
        failedId: winner.id,
        failedName: winner.name,
    });
    logger.audit('mapping.recovery_path', {
        path: 'cache_failure_research',
        from: winner.id,
    });

    // Run full search to find candidates with working servings
    const searchGatherOptions: GatherOptions = {
        skipCache,
        skipFdc,
        isBrandedQuery,
        targetBrand: brandDetection.matchedBrand ?? undefined,
        aiSynonyms: allSynonyms,
    };

    const searchCandidates = await gatherCandidates(rawLine, parsed, normalizedName, searchGatherOptions);

    if (searchCandidates.length > 0) {
        const searchFilterResult = filterCandidatesByTokens(searchCandidates, normalizedName, { debug, rawLine: trimmed });

        // Run reranker to ensure anomaly penalties (e.g. canned beans) are applied
        const countedNounFB = countedPieceNoun(parsed);
        const billsByServingFB = requestBillsByServing(parsed);
        // Same grain-scoped volume serving-shape wiring as the primary
        // rerank site (n-serv-06).
        const grainVolumeUnitFB = !billsByServingFB && parsed?.unit
            && isMatchableVolumeUnit(parsed.unit)
            && detectGrainCookingContext(trimmed, normalizedName).softCooked === true
            ? parsed.unit : null;
        const rerankCandidates = searchFilterResult.filtered.map(c => toRerankCandidate({
            id: c.id,
            name: c.name,
            brandName: c.brandName,
            foodType: c.foodType,
            score: c.score,
            source: c.source,
            nutrition: c.nutrition,
            countLabelMatch: countedNounFB ? candidateHasCountLabel(c, countedNounFB) : undefined,
            servingLabelMatch: billsByServingFB ? candidateHasServingData(c)
                : grainVolumeUnitFB ? candidateHasVolumeServing(c, grainVolumeUnitFB) : undefined,
        }));
        const rerankQuery = aiCanonicalBase || stripPrepModifiers(normalizedName);
        const rerankResult = simpleRerank(rerankQuery, rerankCandidates, aiNutritionEstimate, trimmed, isBrandedQuery, brandDetection.matchedBrand ?? undefined, countedNounFB != null);

        // simpleRerank returns the fully sorted list based on semantic score, nutrition ties, and FDC preferencing
        const sortedFallbackCandidates = rerankResult.sortedCandidates.map(
            rerankCand => searchFilterResult.filtered.find(c => c.id === rerankCand.id)!
        ).filter(Boolean);

        // Try each candidate until one works — denylisted records are
        // never accepted; floor-hit ones only as a last resort (PR D pt3 B4).
        const failedCacheWinnerId = winner.id;
        const tryCacheFallbackCandidate = async (candidate: UnifiedCandidate): Promise<boolean> => {
            const retryResult = await hydrateAndSelectServing(candidate, parsed, confidence * 0.9, rawLine, aiHydrationBudget);
            if (!retryResult) return false;
            logger.info('mapping.cache_fallback_search_success', {
                originalId: failedCacheWinnerId,
                fallbackId: candidate.id,
                fallbackName: candidate.name,
            });
            logger.audit('mapping.recovery_path', {
                path: 'cache_failure_rebilled',
                from: failedCacheWinnerId,
                to: candidate.id,
            });
            result = retryResult;
            selectionReason = 'fallback_search_after_cache_failure';
            return true;
        };

        const floorRejectedRetries: UnifiedCandidate[] = [];
        for (const candidate of sortedFallbackCandidates.slice(0, 5)) {
            if (isRankPlausibilityPartitionEnabled() && isDenylistedOffRecord(candidate.id)) {
                logger.warn('mapping.denylisted_candidate_dropped', {
                    rawLine: trimmed,
                    candidate: candidate.name,
                    foodId: candidate.id,
                });
                continue;
            }
            if (candidateHitsPlausibilityFloor(normalizedName, candidate)) {
                logger.debug('mapping.fallback_rejected_plausibility_floor', {
                    query: normalizedName,
                    fallbackName: candidate.name,
                });
                floorRejectedRetries.push(candidate);
                continue;
            }
            if (await tryCacheFallbackCandidate(candidate)) break;
        }
        if (!result) {
            for (const candidate of floorRejectedRetries) {
                if (await tryCacheFallbackCandidate(candidate)) break;
            }
        }
    }

    return result ? { result, selectionReason } : null;
}

async function runBackfillAfterWinner(params: {
    winner: UnifiedCandidate;
    trimmed: string;
    parsed: ParsedIngredient | null;
    filtered: UnifiedCandidate[];
    confidence: number;
    selectionReason: string;
    allCandidates: UnifiedCandidate[];
    normalizedName: string;
    aiNutritionBudget: AiNutritionBudget;
    rawLine: string;
    skippedLlmNormalize: boolean;
}): Promise<FatsecretMappedIngredient | null> {
    const {
        winner, trimmed, parsed, filtered, confidence, selectionReason,
        allCandidates, normalizedName, aiNutritionBudget, rawLine,
        skippedLlmNormalize,
    } = params;

    if (ENABLE_MAPPING_ANALYSIS) {
        logMappingAnalysis({
            rawIngredient: trimmed,
            parsed: {
                amount: parsed?.qty,
                unit: parsed?.unit,
                ingredient: parsed?.name,
            },
            topCandidates: filtered.slice(0, MAPPING_ANALYSIS_TOP_N).map((c, i) => ({
                rank: i + 1,
                foodId: c.id,
                foodName: c.name,
                brandName: c.brandName || null,
                score: c.score,
                source: c.source,
                semanticSimilarity: c.semanticSimilarity ?? null,
            })),
            selectedCandidate: {
                foodId: winner.id,
                foodName: winner.name,
                brandName: winner.brandName || '',
                confidence,
                selectionReason,
            },
            finalResult: 'failed',
            failureReason: 'no_suitable_serving_found',
        });
    }

    // Attempt AI Nutrition Backfill if all API pipeline candidates failed hydration
    if (AI_NUTRITION_BACKFILL_ENABLED) {
        logger.info('mapping.pipeline_failed_attempting_ai_backfill', { rawLine: trimmed });
        const baseFoodContext = extractBaseFoodContext(allCandidates);
        const aiResult = await requestAiNutrition(normalizedName, {
            rawLine: trimmed,
            baseFoodContext,
            budget: aiNutritionBudget,
        });
        logger.audit('mapping.recovery_path', {
            path: 'backfill_after_winner',
            from: winner.id,
            served: aiResult.status === 'success',
        });

        if (aiResult.status === 'success') {
            const parsedQty = parsed ? parsed.qty * parsed.multiplier : 1;
            const parsedUnit = parsed?.unit || 'serving';

            const servingResult = await getAiServingGrams(
                aiResult.foodId,
                parsedUnit,
                parsedQty,
            );

            const grams = servingResult?.grams ?? 100;
            const scale = grams / 100;

            const aiMapped: FatsecretMappedIngredient = {
                source: 'ai_generated',
                foodId: aiResult.foodId,
                foodName: aiResult.displayName,
                brandName: null,
                servingId: null,
                servingDescription: servingResult?.servingLabel ?? `${parsedQty} ${parsedUnit}`,
                grams,
                kcal: aiResult.caloriesPer100g * scale,
                protein: aiResult.proteinPer100g * scale,
                carbs: aiResult.carbsPer100g * scale,
                fat: aiResult.fatPer100g * scale,
                confidence: aiResult.confidence * 0.8,
                quality: aiResult.confidence >= 0.7 ? 'medium' : 'low',
                rawLine,
                servingTier: servingResult?.grams != null ? 'ai_generated_serving' : 'flat_100g_default',
            };

            if (ENABLE_MAPPING_ANALYSIS) {
                logMappingAnalysis({
                    rawIngredient: trimmed,
                    parsed: {
                        amount: parsed?.qty,
                        unit: parsed?.unit,
                        ingredient: parsed?.name,
                    },
                    topCandidates: [],
                    selectedCandidate: {
                        foodId: aiResult.foodId,
                        foodName: aiResult.displayName,
                        brandName: '',
                        confidence: aiMapped.confidence,
                        selectionReason: aiResult.cached ? 'ai_nutrition_cache_hit' : 'ai_nutrition_generated',
                    },
                    selectedNutrition: {
                        calories: aiMapped.kcal,
                        protein: aiMapped.protein,
                        carbs: aiMapped.carbs,
                        fat: aiMapped.fat,
                        perGrams: aiMapped.grams,
                    },
                    servingSelection: {
                        servingDescription: aiMapped.servingDescription || 'N/A',
                        grams: aiMapped.grams,
                        backfillUsed: true,
                        backfillType: 'weight',
                    },
                    finalResult: 'success',
                    source: 'full_pipeline',
                    aiCalls: {
                        normalize: {
                            called: !skippedLlmNormalize,
                            skipped: skippedLlmNormalize,
                        },
                        // 0.5(b). See the sibling site above.
                        serving: servingAiCallForTier(aiMapped.servingTier),
                        nutrition: { called: true, cached: aiResult.cached, success: true },
                    },
                });
            }

            logger.info('mapping.ai_nutrition_backfill_success_after_hydration_failure', {
                rawLine: trimmed,
                foodName: aiResult.displayName,
                confidence: aiMapped.confidence,
                cached: aiResult.cached,
            });

            return aiMapped;
        } else {
            logger.warn('mapping.ai_nutrition_backfill_failed_after_hydration_failure', {
                rawLine: trimmed,
                reason: aiResult.reason,
            });
        }
    }

    return null;
}

// ============================================================
// Post-selection: the Step 6 save gate, sub-threshold admission,
// analysis logging, synonym/produce fire-and-forget, and the final
// sanity caps. Reads the selected result and never writes back into
// selection. The caller invokes it as the LAST statement inside the
// in-flight-lock try, so the awaited save completes before the lock
// is released.
// ============================================================

async function finalizeAndSaveResult(params: {
    result: FatsecretMappedIngredient;
    confidence: number;
    selectionReason: string;
    normalizedName: string;
    brandDetection: BrandKeyInput;
    aiNutritionEstimate: { caloriesPer100g: number; proteinPer100g: number; carbsPer100g: number; fatPer100g: number; confidence: number } | undefined;
    aiCanonicalBase: string | undefined;
    aiCookingModifier: string | undefined;
    readEscapes: ReadEscapeRecord[];
    filtered: UnifiedCandidate[];
    skippedLlmNormalize: boolean;
    usedGenericFallback: boolean;
    trimmed: string;
    parsed: ParsedIngredient | null;
    rawLine: string;
    telemetry: MappingTelemetry | undefined;
    skipSave: boolean;
}): Promise<FatsecretMappedIngredient | null> {
    const {
        result, confidence, selectionReason, normalizedName, brandDetection,
        aiNutritionEstimate, aiCanonicalBase, aiCookingModifier, readEscapes,
        filtered, skippedLlmNormalize, usedGenericFallback, trimmed, parsed,
        rawLine, telemetry, skipSave,
    } = params;

    // Per-100g macros of the pick. Hoisted above the save decision because
    // conditional sub-threshold admission needs them too (funnel fix 4) —
    // they still feed the save-time plausibility gate inside
    // saveValidatedMapping (PR D), which serves corrupt picks but declines
    // to cache them.
    const savedNutrientsPer100g = result.grams > 0 ? {
        kcal: (result.kcal / result.grams) * 100,
        protein: (result.protein / result.grams) * 100,
        carbs: (result.carbs / result.grams) * 100,
        fat: (result.fat / result.grams) * 100,
    } : undefined;

    // Funnel fix 4: a pick just under the gate may still be offered to the
    // cache when the query decisively names a brand the record carries.
    // See sub-threshold-admission.ts — the brand requirement is also what
    // bounds the blast radius, since such a pick's cache key provably
    // contains a brand token and so can never be a bare generic key.
    const subThreshold = assessSubThresholdAdmission({
        rawLine: trimmed,
        confidence,
        brandDetection,
        foodName: result.foodName,
        brandName: result.brandName,
        nutrientsPer100g: savedNutrientsPer100g,
    });
    const admitToCache = confidence >= 0.85 || subThreshold.admit;

    // Step 6: Save to validated cache if high confidence
    if (admitToCache && selectionReason === 'normalized_cache_hit') {
        // PR D pt3 (B6): a cache hit must NOT re-save itself — the resave
        // is what let the escape→overwrite loop churn rows. Mirrors the
        // early-cache path, which returns before ever reaching Step 6.
        logger.debug('mapping.cache_hit_resave_skipped', {
            rawLine: trimmed,
            normalizedName,
            foodId: result.foodId,
        });
    } else if (admitToCache) {
        // Use normalizedName (preserves nutritional modifiers like "powdered", "reduced fat")
        // instead of canonicalBase (which collapses variants to a shared base).
        // This prevents cache poisoning where "powdered peanut butter" → "peanut butter" key
        // caused 73+ subsequent "peanut butter" queries to return powdered PB.
        // Key symmetry (Track 1c): the SAME function of (normalizedName,
        // parsed, brandDetection, rawLine) as both cache lookups —
        // identity discriminators AND the brand-prefix decision now live
        // inside deriveMappingCacheKey. The old site-local brand prepend
        // used a substring includes() that singularization defeated
        // ("oikos" vs canonical token "oiko" → dead "oiko oiko" rows);
        // the shared function gates the prefix on decisive brand context
        // (so false-positive lexicon hits like "bell" on "bell pepper"
        // never mutate the key), stem-matches tokens, and collapses
        // duplicate tokens.
        // Note: brandDetection (request-stable), NOT isBrandedQuery — the
        // AI-upgraded flag doesn't exist at early-lookup time, so a key
        // built from it could never be symmetric.
        const cacheKey = deriveMappingCacheKey(normalizedName, parsed, brandDetection, trimmed);

        const expectedNutrition = aiNutritionEstimate ? {
            caloriesPer100g: aiNutritionEstimate.caloriesPer100g,
            proteinPer100g: aiNutritionEstimate.proteinPer100g,
            confidence: aiNutritionEstimate.confidence,
        } : undefined;

        // Optimistic: a save gate inside saveValidatedMapping downgrades
        // this to 'save_rejected' (with its own class ID) if it blocks.
        markFunnel(telemetry, 'saved');
        // Logged, not funnel-tagged: markFunnel deliberately clears the
        // class on successful stages, so the next funnel read measures this
        // relaxation from this line rather than from a dropReason.
        if (subThreshold.admit) {
            logger.audit('mapping.sub_threshold_admitted', {
                rawLine: trimmed,
                normalizedName,
                confidence,
                foodId: result.foodId,
                foodName: result.foodName,
            });
        }

        // skipSave: a measurement must not rewrite what it measures. Placed
        // around the call rather than inside saveValidatedMapping() so the
        // save-gate telemetry classes keep meaning "a gate rejected this
        // write" — a suppressed write is not a rejected one, and folding the
        // two together would corrupt the save_rejected counters the funnel
        // reads.
        if (!skipSave) await saveValidatedMapping(rawLine, result, {
            approved: true,
            confidence,
            reason: selectionReason,
        }, {
            telemetry,               // save gates tag their own rejection class
            canonicalBase: cacheKey,  // Use normalizedName as cache key
            persistCanonicalBase: aiCanonicalBase,   // AI base identity → canonicalBase column (grouping only)
            persistCookingModifier: aiCookingModifier,
            nutrientsPer100g: savedNutrientsPer100g,
            expectedNutrition,
            insertOnly: subThreshold.admit,
            // The rows the read path refused this request (see readEscapes
            // above). If the incumbent at the save key is one of them it
            // forfeits its cross-source margin — it demonstrably cannot
            // serve, so re-blocking the replacement just re-arms the loop.
            readEscapes,
        });

        // Async cache validator (flag-gated, default off): review-flag the row
        // this save just wrote. Void + registration-only — NOTHING here is
        // awaited on the request path. The funnelStage test means "the
        // optimistic 'saved' survived every save gate", so rejected writes,
        // human-row skips, skipSave measurement runs and cache hits never
        // validate. Inputs are deliberately capped at experiment parity
        // (2026-08-10 audit §2) — do not widen them.
        if (shouldRunCacheValidator({ skipSave, selectionReason, funnelStage: telemetry?.funnelStage })) {
            kickCacheValidation({
                phrase: trimmed,
                foodName: result.foodName,
                brandName: result.brandName ?? null,
                source: result.source,
                recordId: result.foodId,
                billedGrams: result.grams,
                billedKcal: result.kcal,
                servingTier: result.servingTier ?? null,
            }, cacheKey);
        }

        // NO ALIAS SAVES HERE. Removed 2026-08-01 (campaign gate G1/F1).
        //
        // A loop used to re-run saveValidatedMapping once per AI synonym,
        // passing the SAME `canonicalBase: cacheKey` as the primary save.
        // canonicalBase is the highest-priority input to normalizedForm, so
        // every "alias" resolved to the byte-identical key and simply
        // UPDATEd the row the primary had just written — at
        // `confidence * 0.9`, and bumping usedCount once per synonym. It
        // never created a synonym key in any version of this file, and the
        // schema-level alias concept is retired (`createFoodAlias()` in
        // alias-manager.ts is an explicit no-op).
        //
        // Synonyms still work, at QUERY time, where a wrong one costs one
        // bad candidate that ranking can reject rather than a sticky
        // >=0.85 cache identity that bypasses ranking forever:
        //   - Step 0a `findCanonicalName()` rewrites the query;
        //   - Step 1b `getLearnedSynonyms()` feeds `allSynonyms` into
        //     `gatherCandidates()` as `aiSynonyms` (two call sites above).
        // Exactly ONE saveValidatedMapping per resolution, stamping the
        // confidence the >=0.85 gate actually tested. Do not re-add.
    } else if (selectionReason !== 'normalized_cache_hit') {
        // THE SILENT CLASS (sprint F1): 0.3 <= confidence < 0.85. This pick
        // serves the user but is never offered to the cache — historically
        // with no log line at all, so the population cache-warming exists to
        // convert was only reconstructable by after-the-fact SQL inference.
        // Tag it with the reason the selection cascade settled where it did.
        // Only the FIRST segment of selectionReason is kept as the class:
        // 'fallback_simplified: <AI rationale>' would otherwise make this an
        // unbounded-cardinality column.
        markFunnel(telemetry, 'under_gate', selectionReason.split(':')[0]);
        logger.debug('mapping.under_save_gate', {
            rawLine: trimmed,
            normalizedName,
            confidence,
            selectionReason,
            foodId: result.foodId,
            // Which conditional-admission condition declined it (fix 4).
            // Kept on the debug line rather than in the funnel class so the
            // existing selectionReason taxonomy stays comparable run to run.
            subThresholdReason: subThreshold.reason,
        });
    }

    // Log success
    if (ENABLE_MAPPING_ANALYSIS) {
        logMappingAnalysis({
            rawIngredient: trimmed,
            parsed: {
                amount: parsed?.qty,
                unit: parsed?.unit,
                ingredient: parsed?.name,
            },
            topCandidates: filtered.slice(0, MAPPING_ANALYSIS_TOP_N).map((c, i) => ({
                rank: i + 1,
                foodId: c.id,
                foodName: c.name,
                brandName: c.brandName || null,
                score: c.score,
                source: c.source,
                semanticSimilarity: c.semanticSimilarity ?? null,
                // Include nutrition if available (from FDC candidates)
                nutrition: c.nutrition ? {
                    calories: c.nutrition.kcal,
                    protein: c.nutrition.protein,
                    fat: c.nutrition.fat,
                    carbs: c.nutrition.carbs,
                } : undefined,
            })),
            selectedCandidate: {
                foodId: result.foodId,
                foodName: result.foodName,
                brandName: result.brandName || '',
                confidence,
                selectionReason,
            },
            // Add nutrition for easy false positive detection
            selectedNutrition: {
                calories: result.kcal,
                protein: result.protein,
                carbs: result.carbs,
                fat: result.fat,
                perGrams: result.grams,
            },
            servingSelection: {
                servingDescription: result.servingDescription || 'N/A',
                grams: result.grams,
                backfillUsed: false,
            },
            finalResult: 'success',
            source: selectionReason === 'normalized_cache_hit' ? 'normalized_cache' : 'full_pipeline',
            // Track AI calls made during this mapping
            aiCalls: {
                normalize: {
                    called: !skippedLlmNormalize && !usedGenericFallback,
                    skipped: skippedLlmNormalize,
                    reason: skippedLlmNormalize ? 'gate_skipped' : undefined,
                },
                // 0.5(b): derived from the tier that billed the grams — see
                // serving-ai-tiers.ts for why the tier NAMES cannot be trusted
                // and why this is a lower bound.
                serving: servingAiCallForTier(result.servingTier),
                // requestAiNutrition() is reached only on the backfill branch,
                // which returns at its own log sites above. Every path arriving
                // here left the nutrition model untouched.
                nutrition: { called: false, cached: false, success: false },
            },
        });
    }

    // Phase 3: Save known British/American synonyms (non-blocking, no AI call)
    // We use the known synonym mappings instead of calling AI again
    const knownSyns = getKnownSynonyms(result.foodName);
    if (knownSyns && knownSyns.length > 0) {
        saveSynonyms(result.foodName, knownSyns, 'known').catch(err => {
            logger.debug('mapping.synonym_save_failed', { error: (err as Error).message });
        });
    }

    // Phase 4: Proactive produce backfill (fire-and-forget)
    // For produce items, pre-populate small/medium/large servings so future
    // size-based queries (e.g., "1 large avocado") hit cached servings
    proactiveProduceBackfill(result.foodId, result.foodName);

    // ============================================================
    // FINAL SANITY CHECK: Reject wildly unreasonable computed values
    // ============================================================
    // This catches cases where:
    // 1. User genuinely entered an absurd quantity (e.g., "5000 cups flour")
    // 2. Upstream calculation errors produced unreasonable results
    // 3. Import/OCR artifacts created malformed inputs
    const MAX_REASONABLE_GRAMS = 10000;  // 10kg - more than any typical ingredient
    const MAX_REASONABLE_KCAL = 50000;   // ~20 days of calories - clearly an error

    if (result.grams > MAX_REASONABLE_GRAMS || result.kcal > MAX_REASONABLE_KCAL) {
        logger.warn('mapping.result_sanity_check_failed', {
            rawLine: trimmed,
            grams: result.grams,
            kcal: result.kcal,
            foodName: result.foodName,
            reason: result.grams > MAX_REASONABLE_GRAMS
                ? 'grams_exceeds_10kg'
                : 'kcal_exceeds_50000',
        });

        if (ENABLE_MAPPING_ANALYSIS) {
            logMappingAnalysis({
                rawIngredient: trimmed,
                parsed: {
                    amount: parsed?.qty,
                    unit: parsed?.unit,
                    ingredient: parsed?.name,
                },
                topCandidates: [],
                selectedCandidate: {
                    foodId: result.foodId,
                    foodName: result.foodName,
                    brandName: result.brandName || '',
                    confidence,
                    selectionReason,
                },
                selectedNutrition: {
                    calories: result.kcal,
                    protein: result.protein,
                    carbs: result.carbs,
                    fat: result.fat,
                    perGrams: result.grams,
                },
                finalResult: 'failed',
                failureReason: `sanity_check_failed: grams=${result.grams.toFixed(0)}, kcal=${result.kcal.toFixed(0)}`,
            });
        }

        return null;  // Reject the mapping - better to fail than return garbage
    }

    return result;
}

// Re-export types for backward compatibility
export type { MapIngredientOptions as MapIngredientWithFallbackOptions };

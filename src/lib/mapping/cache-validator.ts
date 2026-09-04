/**
 * cache-validator.ts — async post-save review flag for freshly written
 * FoodMapping rows (2026-08-11, Block C build decision).
 *
 * WHAT IT IS. After finalizeAndSaveResult() actually writes an AI cache row
 * (telemetry funnelStage === 'saved' — every save-gate rejection, including
 * both human-row branches, downgrades that stage), this module fires ONE
 * capable-tier LLM call off the request path and records the verdict in
 * MappingValidationVerdict. It is a REVIEW FLAG feeding a triage queue —
 * never an authority to overwrite: it writes no FoodMapping column and no
 * read path consults it.
 *
 * WHY CAPABLE TIER ONLY. Measured 2026-08-10 on the 229-row cache-head
 * census (mobile sync-docs/reports/2026-08-10_blocks-b-c-…md §2): a
 * Sonnet-class judge catches 70.3% of the MATERIAL failures the free
 * structural signals cannot see, at 6.1% false-flag on GOOD rows; the
 * gpt-4o-mini class retains only ~⅔ of those catches and fails the
 * pre-registered retention bar. VALIDATOR_AI_MODEL therefore has NO in-code
 * default — unset disables the validator (fail-closed) rather than silently
 * running it on the cheap tier.
 *
 * INPUT PARITY IS LOAD-BEARING. The measured rates were produced from
 * exactly: phrase, mapped record identity, billed grams/kcal (+ derived
 * kcal/100g), serving tier — and nothing else. Widening the inputs (pool,
 * confidence, selectionReason) would change the operating point in unmeasured
 * ways, so this module deliberately does not accept them.
 *
 * LATENCY. kickCacheValidation() is void and registration-only; nothing on
 * the request path awaits the LLM call (doc-check claim
 * cache-validator-never-awaited-on-the-request-path). Scripts that map
 * ingredients and then disconnect Prisma already await
 * drainPendingBackgroundTasks(), which covers these tasks too.
 *
 * RE-ISSUE SUPPRESSION (2026-09-02). The 04:30 nightly flywheel sweep re-saves
 * the same mined hot-head key set, so until this change the validator judged
 * the same unchanged bill every night — one capable-tier round trip each — and
 * every triage session spent a stamp rider re-adjudicating rows it had already
 * routed. Whole-table census on the box (2026-09-02 20:51Z): OK 391 rows over
 * 95 distinct billed tuples, SUSPECT 83 rows over 40; the largest series
 * (`core fairlife power` / off_0711620020636 / 250 g / 138.9999961853027 kcal /
 * bare_sibling_serving) is 18 byte-identical rows. Re-derive the census:
 *   SELECT verdict, count(*), count(DISTINCT ("normalizedForm","foodId",
 *     "billedGrams","billedKcal","servingTier"))
 *   FROM "MappingValidationVerdict" GROUP BY 1;
 * and the series (one row per tuple, largest first; "zero tuple variation"
 * means every (normalizedForm, foodId) pair in the top of this list has
 * count(DISTINCT tuple) = 1 when grouped by the pair alone):
 *   SELECT "normalizedForm","foodId","billedGrams","billedKcal","servingTier",
 *     count(*) FROM "MappingValidationVerdict" GROUP BY 1,2,3,4,5
 *   ORDER BY 6 DESC LIMIT 10;
 * Scale, so the trade is decided on the right axis [reasoning over those
 * numbers]: ~339 redundant rows over ~22 nights is ~15 verdicts a night, about
 * $0.10 at the triage header's ~$0.007 per verdict — the dollar saving is
 * trivial. What this buys is triage ergonomics: no stamp rider re-adjudicating
 * rows already routed, and a queue whose unreviewed count means something.
 *
 * runCacheValidation() now looks up a prior verdict on the BILLED TUPLE plus
 * the judging tier — (normalizedForm, foodId, billedGrams, billedKcal,
 * servingTier, model) — BEFORE the LLM call and returns when one exists
 * (findPriorVerdict()). The key is deliberately the whole bill and never
 * (normalizedForm, foodId): a changed bill is a different claim and MUST
 * re-issue, which is also what keeps genuine re-adjudication after a cascade
 * change alive; `model` is in it so a VALIDATOR_AI_MODEL upgrade re-judges each
 * tuple exactly once. Float equality on billedGrams/billedKcal is intended —
 * the series are byte-identical because the same computation produced them,
 * and a rounding change in the producer legitimately re-issues once per tuple.
 *
 * WHAT THIS CHANGES FOR THE TRIAGE LOOP, stated whole (the reader is
 * scripts/eval/validator-triage-queue.ts + stamp-validator-reviewed.ts; both
 * headers carry a matching note dated 2026-09-03). Every mechanism there that
 * counted on the sweep's repeats is now history-only for an UNCHANGED tuple:
 * the n >= 3 unanimity auto-bar, the majority view (majorityPair() needs
 * n >= TRIAGE_MIN_N), and the documented re-open of a stamped pair when a fresh
 * verdict lands (newSinceReview). A stamp on an unchanged tuple is therefore a
 * MUTE until the bill moves — with ONE carve-out: a newest prior stamped
 * `…:watch` ("re-review after more verdicts") does NOT suppress, so the one
 * disposition that asks for repeats still gets them (isWatchDisposition()).
 *
 * Three accepted limits. (1) An OK → SUSPECT flip on an UNCHANGED tuple under
 * the SAME model is suppressed; a prompt revision does not re-issue either
 * (there is no promptVersion to key on) — deliberate and cheap to add later.
 * (2) The lookup is best-effort, not a
 * uniqueness guarantee — two saves of one tuple in flight together can both
 * miss it and both write; the point-in-time table keeps no unique constraint
 * by design and this module adds none. (3) A lookup failure logs at debug and
 * FALLS THROUGH to the pre-existing behaviour: the validator must never fail,
 * slow or alter the request, and a broken DB read must not also silence the
 * judge.
 *
 * Observability: the suppression itself logs at debug (invisible on the box,
 * which runs at warn) — its receipt is the MappingValidationVerdict row count
 * and the keyed /api/ok `cache_validate.responses` counter across a sweep, not
 * a log line. The lookup FAILURE logs at warn, because a persistently failing
 * lookup silently restores the whole nightly spend.
 */

import { prisma } from '@/lib/db';
import { logger } from '../logger';
import { callStructuredLlm } from '@/lib/ai/structured-client';
import { CACHE_VALIDATOR_ENABLED, VALIDATOR_AI_MODEL } from './config';
import { canonicalizeCacheKey } from './normalization-rules';
import { registerBackgroundTask } from './deferred-hydration';

export interface CacheValidatorInput {
    /** The line as the user uttered it (trimmed). */
    phrase: string;
    foodName: string;
    brandName: string | null;
    /** Mapping source string, e.g. 'openfoodfacts' | 'fdc' | 'fatsecret'. */
    source: string;
    /** Prefixed record id, e.g. off_…/fdc_…/fs_…. */
    recordId: string;
    billedGrams: number;
    billedKcal: number;
    servingTier: string | null;
}

interface ShouldRunArgs {
    skipSave: boolean;
    selectionReason: string;
    funnelStage: string | undefined;
}

/**
 * Pure gate for the hook site. True iff the validator is enabled AND a
 * capable model is configured AND this resolution actually wrote an AI cache
 * row: not a measurement run (skipSave), not a cache hit re-serve, and the
 * optimistic 'saved' funnel stage survived every save gate (human-row
 * branches and all rejection classes downgrade it to 'save_rejected').
 */
export function shouldRunCacheValidator(args: ShouldRunArgs): boolean {
    return (
        CACHE_VALIDATOR_ENABLED &&
        VALIDATOR_AI_MODEL !== '' &&
        !args.skipSave &&
        args.selectionReason !== 'normalized_cache_hit' &&
        args.funnelStage === 'saved'
    );
}

export const VERDICT_SCHEMA = {
    name: 'cache_validation_verdict',
    strict: true,
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            verdict: { type: 'string', enum: ['OK', 'SUSPECT'] },
            axis: { type: 'string', enum: ['none', 'identity', 'serving', 'panel'] },
            reason: { type: 'string' },
        },
        required: ['verdict', 'axis', 'reason'],
    },
} as const;

/**
 * System prompt. The three §2 requirements from the audit (declared-state
 * matching, billed-kcal materiality, panel lane) plus the FN-adjudication
 * rule confirmed 2026-08-11: 9 of the 11 Sonnet misses were adjudicated
 * MISS_REAL and 9 carried a "label/convention alibi" — the judge excusing an
 * off portion because it matched the record's own label serving or a
 * category measure convention instead of the phrase as uttered. The rule as
 * first drafted caught 8/11; the symmetric under-bill clause covers two of
 * the rest (single-unit and garnish-sized defaults billing far below a
 * typical logged use).
 */
const SYSTEM_PROMPT = [
    'You are a post-save auditor for a nutrition-logging cache. One food line was just',
    'resolved and saved. You see exactly what the server knew at save time: the phrase as',
    'the user typed it, the mapped record identity, the billed grams and kcal (plus derived',
    'kcal/100g), and the serving tier. A SUSPECT verdict feeds a human triage queue; it',
    'never overwrites anything.',
    '',
    'Judge in this order:',
    '1. IDENTITY: is the mapped record plausibly the food the phrase means? Match the',
    "   record's declared state (raw/cooked/dry/prepared) before comparing densities — a",
    '   record that is self-consistent on its own declared state is not wrong merely',
    "   because the phrase's default state differs.",
    '2. SERVING: flag on billed-kcal materiality — is the billed kcal roughly >=25% off the',
    '   most plausible bill for the phrase AS UTTERED? The record\'s own label serving,',
    '   package size, or a category measure convention ("1 cup", "2 tortillas per serving",',
    '   a whole package or bunch) is NOT by itself a defense: a bare singular phrase means',
    '   one typical unit or one typical use, and a multi-unit label serving or',
    '   recipe-measure default that moves billed kcal materially versus that reading is',
    '   SUSPECT serving. The same rule applies downward: when a single-unit or',
    '   garnish-sized default bills far BELOW the typical logged use of the phrase (one',
    '   12 g berry against a typical ~150 g cup), judge against the typical use, not the',
    '   unit convention.',
    '3. PANEL: a nutrition panel that is impossible for the named food (density far outside',
    "   the food's real range, macros exceeding their own Atwater sum) is axis 'panel' even",
    '   when the billed kcal happens to land close — route data-quality defects to the',
    "   panel lane rather than dropping them.",
    '',
    'Output: verdict OK|SUSPECT, axis none|identity|serving|panel (the DOMINANT defect),',
    'reason of 1-2 sentences quoting the numbers that drove the call.',
].join('\n');

function userPrompt(input: CacheValidatorInput): string {
    const kcal100 = input.billedGrams > 0
        ? Math.round((input.billedKcal / input.billedGrams) * 1000) / 10
        : null;
    return [
        `Phrase: "${input.phrase}"`,
        `Mapped record: ${input.foodName}${input.brandName ? ` [${input.brandName}]` : ''}`,
        `Source: ${input.source} (${input.recordId})`,
        `Billed: ${input.billedGrams} g, ${input.billedKcal} kcal` +
        (kcal100 != null ? ` (${kcal100} kcal/100g)` : ''),
        `Serving tier: ${input.servingTier ?? 'unknown'}`,
    ].join('\n');
}

/**
 * Fire-and-forget entry point. Returns synchronously; the LLM call and the
 * verdict write run entirely off-promise behind the already-sent response.
 * Every failure path is swallowed into a log line — a validator failure must
 * never fail, slow, or alter the request that triggered it.
 */
export function kickCacheValidation(input: CacheValidatorInput, rawCacheKey: string): void {
    const task = runCacheValidation(input, rawCacheKey).catch((err) => {
        logger.debug('cache_validator.failed', {
            phrase: input.phrase,
            error: (err as Error).message,
        });
    });
    registerBackgroundTask(task);
}

/**
 * The prior-verdict lookup, keyed on the billed tuple (see the header). Returns
 * null both when no identical verdict exists AND when the read itself fails —
 * the caller cannot tell the two apart and must not: either way the
 * pre-existing path runs. Newest first, so the logged `priorVerdict` is the
 * latest opinion on that exact bill.
 */
async function findPriorVerdict(
    normalizedForm: string,
    input: CacheValidatorInput,
): Promise<{ id: string; verdict: string; reviewedBy: string | null } | null> {
    try {
        return await prisma.mappingValidationVerdict.findFirst({
            where: {
                normalizedForm,
                foodId: input.recordId,
                billedGrams: input.billedGrams,
                billedKcal: input.billedKcal,
                servingTier: input.servingTier,
                // The judging tier is part of the claim: a VALIDATOR_AI_MODEL
                // upgrade re-judges every tuple exactly once instead of never.
                model: VALIDATOR_AI_MODEL,
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, verdict: true, reviewedBy: true },
        });
    } catch (err) {
        logger.warn('cache_validator.prior_lookup_failed', {
            phrase: input.phrase,
            error: (err as Error).message,
        });
        return null;
    }
}

/**
 * The ONE stamp that asks for more verdicts on an unchanged bill. The triage
 * loop's `watch` disposition (scripts/eval/stamp-validator-reviewed.ts) means
 * "insufficient evidence; re-review after more verdicts", and the sweep's
 * repeats were what delivered them — so a tuple whose NEWEST prior is stamped
 * `…:watch` keeps re-issuing. Every other disposition, and an unstamped prior,
 * suppresses. Suffix-matched because stampers prefix their own lane/date
 * (`lane-a-2026-08-28:watch`).
 */
function isWatchDisposition(reviewedBy: string | null): boolean {
    return typeof reviewedBy === 'string' && reviewedBy.endsWith(':watch');
}

async function runCacheValidation(input: CacheValidatorInput, rawCacheKey: string): Promise<void> {
    const normalizedForm = canonicalizeCacheKey(rawCacheKey);

    // Re-issue suppression on the BILLED TUPLE, checked before the model is
    // paid for. A lookup failure falls through to the call below.
    const prior = await findPriorVerdict(normalizedForm, input);
    if (prior && !isWatchDisposition(prior.reviewedBy)) {
        logger.debug('cache_validator.tuple_already_judged', {
            phrase: input.phrase,
            foodId: input.recordId,
            priorVerdict: prior.verdict,
            priorId: prior.id,
        });
        return;
    }

    const result = await callStructuredLlm({
        schema: VERDICT_SCHEMA,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: userPrompt(input),
        purpose: 'cache_validate',
        // Measured at enable time (2026-08-11): 600 STARVED claude-sonnet-5 —
        // 2 of the first 3 live calls came back truncated mid-JSON or empty
        // (reasoning shares the output budget). The sibling screen's lesson
        // (200 truncated a reasoning model) under-scaled; 2000 is roomy and
        // still bounded — billing is by tokens used, not by the cap.
        maxTokens: 2000,
    });

    if (result.status !== 'success' || !result.content) {
        // No verdict row on failure: an error-verdict state would pollute the
        // triage queue's precision. Logs + /api/ok failure counters carry it.
        logger.warn('cache_validator.llm_error', {
            phrase: input.phrase,
            provider: result.provider,
            model: result.model,
            error: result.error,
        });
        return;
    }

    // Defense-in-depth behind the single-entry provider chain: never persist
    // a verdict a different model produced (forceProvider or a future chain
    // edit could reintroduce a fallback, and the measured operating point
    // belongs to the configured capable tier alone).
    if (result.model !== VALIDATOR_AI_MODEL) {
        logger.warn('cache_validator.wrong_tier_dropped', {
            phrase: input.phrase,
            model: result.model,
        });
        return;
    }

    const verdict = result.content.verdict;
    const axis = result.content.axis;
    const reason = result.content.reason;
    // Fail-closed enum re-check despite schema strict mode — a malformed
    // verdict is dropped, never coerced. Coherence per the experiment
    // vocabulary: OK carries axis 'none', SUSPECT names a defect axis;
    // incoherent pairs are dropped, not stored.
    if (
        (verdict !== 'OK' && verdict !== 'SUSPECT') ||
        (axis !== 'none' && axis !== 'identity' && axis !== 'serving' && axis !== 'panel') ||
        typeof reason !== 'string' ||
        (verdict === 'OK') !== (axis === 'none')
    ) {
        logger.warn('cache_validator.malformed_verdict', {
            phrase: input.phrase,
            content: result.content,
        });
        return;
    }

    try {
        await prisma.mappingValidationVerdict.create({
            data: {
                normalizedForm,
                foodId: input.recordId,
                phrase: input.phrase,
                verdict,
                axis,
                reason,
                model: result.model ?? 'unknown',
                billedGrams: input.billedGrams,
                billedKcal: input.billedKcal,
                servingTier: input.servingTier,
            },
        });
        logger.debug('cache_validator.verdict', {
            phrase: input.phrase,
            verdict,
            axis,
            model: result.model,
        });
    } catch (err) {
        logger.warn('cache_validator.write_failed', {
            phrase: input.phrase,
            error: (err as Error).message,
        });
    }
}

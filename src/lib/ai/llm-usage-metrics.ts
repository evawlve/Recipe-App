/**
 * Process-lifetime AI-call / token / cost counters, written at the HTTP chokepoint and read
 * through `/api/ok` (with the `DEV_API_KEY`). Phase 0.5(c).
 *
 * WHAT THIS ANSWERS: aggregate, per-purpose and per-model, "how many model responses did this
 * process receive, how many tokens did they carry, what did OpenRouter say they cost".
 * WHAT IT DOES NOT ANSWER: per-line attribution. It cannot tell you which mapper line billed a
 * call. That is B6 (AsyncLocalStorage + a `MappingEventLog` sink) and stays gated.
 *
 * THREE DESIGN CONSTRAINTS, EACH LOAD-BEARING
 *
 * 1. IMPORTS ONLY `./llm-purposes`. No dotenv, no `../mapping/config`, no prisma. `/api/ok` has
 *    to be able to read the counters without pulling the mapper graph into the health route.
 *
 * 2. STATE LIVES ON `globalThis`, UNCONDITIONALLY. Note that `src/lib/db.ts` puts its prisma
 *    singleton on `globalThis` only when `NODE_ENV !== 'production'`. Do NOT copy that pattern
 *    here. Next may emit `src/lib/**` into more than one server chunk, which would give the
 *    route handler a different module instance from the mapper's; a module-local `let` would
 *    then make `/api/ok` report a structural 0 while calls were happening — the fail-open
 *    instrument class this repo has hit 12+ times. Jest cannot reproduce Next's bundling, so
 *    this mitigation is only ever confirmed by the post-deploy live falsifier. Until then, a
 *    zeroed counter after a known-live call is a RED, never "no calls".
 *
 * 3. A MISSING MEASUREMENT AND A REAL ZERO MUST NOT READ ALIKE. `finiteNum()` returns null for
 *    anything that is not a finite `number` — a string `'47'`, null, NaN and Infinity all fail
 *    it — and nothing is ever defaulted to 0. `usageReported` counts how many of `responses`
 *    actually carried a numeric `usage.total_tokens`, so `usageReported === 0` with
 *    `responses > 0` means NO USAGE DATA WAS RETURNED, not zero tokens.
 *
 * `responses` VS `logicalSuccesses` — quote the right one:
 *   `responses`        = HTTP 2xx responses received from a provider. A model ran; we were
 *                        billed. Includes every 2xx we then failed to use: an envelope that
 *                        fails `response.json()`, an empty `choices` array, an `error` field in
 *                        the model's own JSON, content that fails `JSON.parse`. This is the
 *                        COST/LATENCY number.
 *   `logicalSuccesses` = `callStructuredLlm()` invocations that returned `status:'success'`.
 *                        This is the "a line got an answer from a model" number.
 * Retries and provider fallback make several HTTP attempts possible per logical call, so
 * `responses >= logicalSuccesses`. Quoting only one of the two is exactly how `[AI:SERV]`
 * became an upper bound that read as a count.
 *
 * `responses` IS EXACT, NOT A FLOOR — and saying which it is, is the point. Every field on this
 * store is one of exactly two kinds and the doc-check claims quote the kind:
 *   EXACT   — `responses`, `failures`, `logicalSuccesses`, counted against the HTTP outcome. The
 *             chokepoint counts exactly one outcome per HTTP attempt (`countResponse()` /
 *             `countFailure()` in `structured-client.ts`), so `responses + failures === attempts`
 *             holds — with ONE stated exception: `countSafely()` swallows a telemetry throw so the
 *             instrument can never degrade the request it measures, and a swallowed throw drops
 *             that attempt from both sides. It is therefore an invariant of the counting, not of
 *             the arithmetic; assert it in tests, do not assume it of a live reading.
 *             The first cut of this module made `responses` a LOWER BOUND: a 2xx whose envelope
 *             failed `response.json()` was billed but reached only the failure path. That shape
 *             now increments `responses` and `unparseableEnvelopes`.
 *
 *             **`responses` is exact as a count of 2xx RESPONSES. That a 2xx was BILLED is
 *             REASONING, not a measurement** — a CDN or proxy can return an HTTP 200 error page
 *             the model never saw, and that is precisely the shape `unparseableEnvelopes` catches.
 *             So `responses` is an upper bound on billed calls, exact on responses received, and
 *             `responses - unparseableEnvelopes` is the conservative read. Subtract it before
 *             quoting spend. Naming this is the whole lesson of `SERVING_AI_TIERS`: the fork that
 *             makes a count an upper bound sits BELOW the place the count is taken.
 *   FLOOR   — `promptTokens` / `completionTokens` / `totalTokens` / `costUsd`, each a sum over
 *             only those responses that actually reported the field. `usageReported` and
 *             `costReported` are the denominators that say how much of `responses` each sum
 *             covers; a sum whose denominator is below `responses` is a floor, never a total.
 * This project has just spent a week on `SERVING_AI_TIERS` being an upper bound that a doc read
 * as a count. Do not add a field here without writing down which kind it is.
 */

import { STRUCTURED_LLM_PURPOSES } from './llm-purposes';

export interface LlmPurposeUsage {
    /**
     * EXACT as a count of HTTP 2xx responses received — INCLUDING responses we then failed to use,
     * and including one whose envelope would not parse as JSON. "A model ran and we were billed" is
     * the DERIVED reading and is an upper bound: a proxy 200 error page never reached a model.
     * Quote `responses - unparseableEnvelopes` for spend. See the module header.
     */
    responses: number;
    /**
     * EXACT. callStructuredLlm() invocations that returned status:'success'. responses >=
     * logicalSuccesses because retries and provider fallback make several HTTP attempts per
     * logical call. Quote the right one.
     */
    logicalSuccesses: number;
    /**
     * EXACT. Attempts that never produced a 2xx response (non-2xx, network error, abort). Not
     * billed. `responses + failures === attempts` — exactly one of the two is counted per attempt.
     */
    failures: number;
    /**
     * EXACT, and a SUBSET of `responses`. Billed 2xx responses whose body failed
     * `response.json()`, so no usage block could be read from them at all. Non-zero here means
     * `usageReported` is short by at least this much for a reason that is not "the provider
     * omitted usage".
     */
    unparseableEnvelopes: number;
    /**
     * DENOMINATOR. Of `responses`, how many carried a finite numeric usage.total_tokens.
     * usageReported=0 with responses>0 means NO USAGE DATA — it does not mean zero tokens.
     */
    usageReported: number;
    /** FLOOR — summed only over responses that reported it. Read against `usageReported`. */
    promptTokens: number;
    /** FLOOR — summed only over responses that reported it. Read against `usageReported`. */
    completionTokens: number;
    /** FLOOR — summed only over responses that reported it. Read against `usageReported`. */
    totalTokens: number;
    /** DENOMINATOR. Of `responses`, how many carried a finite numeric usage.cost (OpenRouter accounting field). */
    costReported: number;
    /** FLOOR — summed only over responses that reported it. Read against `costReported`. */
    costUsd: number;
}

export interface LlmUsageSnapshot {
    /** ISO time this counter store was created ≈ process start. */
    since: string;
    /** process.pid. TWO READS WITH DIFFERENT since/pid ARE NOT A DELTA — the process restarted. */
    pid: number;
    /** Pre-seeded with all 7 STRUCTURED_LLM_PURPOSES at zero, so a purpose is never absent-and-ambiguous. */
    byPurpose: Record<string, LlmPurposeUsage>;
    /** Created lazily. Key is `provider.model` (e.g. `openai/gpt-4o-mini`), never `provider.name`. */
    byModel: Record<string, LlmPurposeUsage>;
}

interface LlmUsageStore {
    since: string;
    pid: number;
    byPurpose: Record<string, LlmPurposeUsage>;
    byModel: Record<string, LlmPurposeUsage>;
}

/** Module-private key on globalThis. See constraint 2 above for why this is not a module-local let. */
const STORE_KEY = '__recipeAppLlmUsageMetrics__';

function emptyUsage(): LlmPurposeUsage {
    return {
        responses: 0,
        logicalSuccesses: 0,
        failures: 0,
        unparseableEnvelopes: 0,
        usageReported: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costReported: 0,
        costUsd: 0,
    };
}

function newStore(): LlmUsageStore {
    const byPurpose: Record<string, LlmPurposeUsage> = {};
    for (const purpose of STRUCTURED_LLM_PURPOSES) {
        byPurpose[purpose] = emptyUsage();
    }
    return {
        since: new Date().toISOString(),
        pid: typeof process !== 'undefined' ? process.pid : -1,
        byPurpose,
        byModel: {},
    };
}

function getStore(): LlmUsageStore {
    const g = globalThis as unknown as Record<string, LlmUsageStore | undefined>;
    let store = g[STORE_KEY];
    if (!store) {
        store = newStore();
        g[STORE_KEY] = store;
    }
    return store;
}

/**
 * Strictly defensive numeric read. Anything that is not a finite `number` — including the string
 * `'47'`, null, undefined, NaN and Infinity — is NOT a measurement and returns null. Never default
 * a missing field to 0: that is what makes a missing measurement indistinguishable from a real zero.
 */
function finiteNum(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Per-purpose bucket, always present (seeded). An unknown purpose string is created lazily. */
function purposeBucket(store: LlmUsageStore, purpose: string): LlmPurposeUsage {
    let bucket = store.byPurpose[purpose];
    if (!bucket) {
        bucket = emptyUsage();
        store.byPurpose[purpose] = bucket;
    }
    return bucket;
}

/** Per-model bucket, created lazily. Key is the model string, never the provider name. */
function modelBucket(store: LlmUsageStore, model: string): LlmPurposeUsage {
    let bucket = store.byModel[model];
    if (!bucket) {
        bucket = emptyUsage();
        store.byModel[model] = bucket;
    }
    return bucket;
}

/**
 * Record an HTTP 2xx response from a provider. Call this the moment the envelope has been read and
 * BEFORE any content guard — an unreadable envelope, an empty `choices`, an `error` field in the
 * model's own JSON and unparseable content were all billed. Counting at `callStructuredLlm()`'s
 * success branch instead would rebuild a structural undercount, which is the defect class this
 * counter exists to close.
 *
 * `envelopeUnparsed` is how the caller says "billed, but `response.json()` threw, so there is no
 * usage block to read" — a different statement from "the provider omitted usage", and the reason
 * `responses` can stay exact without `usageReported` quietly absorbing the difference.
 */
export function recordLlmResponse(a: {
    purpose: string;
    model: string;
    usage: unknown;
    envelopeUnparsed?: boolean;
}): void {
    const store = getStore();
    const buckets = [purposeBucket(store, a.purpose), modelBucket(store, a.model)];

    const usage = (a.usage ?? null) as Record<string, unknown> | null;
    const total = usage && typeof usage === 'object' ? finiteNum(usage.total_tokens) : null;
    const prompt = usage && typeof usage === 'object' ? finiteNum(usage.prompt_tokens) : null;
    const completion = usage && typeof usage === 'object' ? finiteNum(usage.completion_tokens) : null;
    const cost = usage && typeof usage === 'object' ? finiteNum(usage.cost) : null;

    for (const b of buckets) {
        b.responses++;
        // MUTATION-PROVED: deleting this line kills llm-usage-metrics.test.ts > 'an unparseable
        // envelope is a billed response with its own field'; making it unconditional kills
        // > 'a readable envelope leaves unparseableEnvelopes at zero' (measured 2026-08-04).
        if (a.envelopeUnparsed === true) b.unparseableEnvelopes++;
        if (total !== null) {
            b.usageReported++;
            b.totalTokens += total;
        }
        // Each field is guarded independently: a provider may return total_tokens without the split.
        if (prompt !== null) b.promptTokens += prompt;
        if (completion !== null) b.completionTokens += completion;
        if (cost !== null) {
            b.costReported++;
            b.costUsd += cost;
        }
    }
}

/** An attempt that never produced a 2xx response (non-2xx, network error, abort). Not billed. */
export function recordLlmFailure(a: { purpose: string; model: string }): void {
    const store = getStore();
    purposeBucket(store, a.purpose).failures++;
    modelBucket(store, a.model).failures++;
}

/** One `callStructuredLlm()` invocation that returned `status:'success'`. See the header note. */
export function recordLlmLogicalSuccess(a: { purpose: string; model: string }): void {
    const store = getStore();
    purposeBucket(store, a.purpose).logicalSuccesses++;
    modelBucket(store, a.model).logicalSuccesses++;
}

/** Deep copy, so a reader cannot mutate the live counters. */
export function getLlmUsageSnapshot(): LlmUsageSnapshot {
    const store = getStore();
    const byPurpose: Record<string, LlmPurposeUsage> = {};
    for (const [k, v] of Object.entries(store.byPurpose)) byPurpose[k] = { ...v };
    const byModel: Record<string, LlmPurposeUsage> = {};
    for (const [k, v] of Object.entries(store.byModel)) byModel[k] = { ...v };
    return { since: store.since, pid: store.pid, byPurpose, byModel };
}

/** Tests only. Production has no reset — `since`/`pid` are how a reader detects a restart. */
export function resetLlmUsageMetrics(): void {
    (globalThis as unknown as Record<string, LlmUsageStore | undefined>)[STORE_KEY] = newStore();
}

/**
 * correctness-screen.ts — post-warm CORRECTNESS screen for one cache-warming batch.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * gate.py certifies STRUCTURE: added/changed/removed counts, ai_estimated share,
 * conversion rate. Batch 01 of the seed-corpus warm campaign passed every one of
 * those thresholds — 0 eval failures, 0% ai_estimated, added 81 / changed 0 /
 * removed 0 — and a hand audit then graded 23 of its 81 new rows BAD and 10
 * SUSPECT. 27.2% wrong, certified clean.
 *
 * The existing gates say "this batch did not damage the rows it should not have
 * touched". They say nothing about whether the rows it ADDED are correct. This
 * file is that missing instrument: it reads each row the batch added and asks
 * whether the record behind it is the product the seed asked for, at a plausible
 * weight, with a plausible panel.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT RUNS — read before moving it
 * ---------------------------------------------------------------------------
 * This is a CAMPAIGN step, not a mapper step. It runs after the warm, over the
 * keys in <bdir>/added.txt, and its output is a withhold/evict list. It must NOT
 * be moved into saveValidatedMapping: playbook §3 — a hard reject there sets
 * winner = null and falls through to AI backfill at grams = 100, i.e. a DIFFERENT
 * wrong number, not a right one. (Adversarial-review correction B5: the current
 * saveValidatedMapping returns early rather than nulling the winner, so the live
 * cost is "permanently uncacheable" rather than "AI backfill" — either way it is a
 * cost paid on the request path for a problem that only exists in the cache.)
 *
 * The distinction that makes withholding safe: the pick still answers the user's
 * request either way. The only thing this file decides is whether the pick becomes
 * STICKY AND FREE. A withheld row is deferred coverage, not a broken answer.
 *
 * ---------------------------------------------------------------------------
 * TIERS
 * ---------------------------------------------------------------------------
 *   Tier D (deterministic) — 10 flagging rules + 1 informational, no network, no
 *     API key, no DB beyond the row pull. Every rule is a mechanical property of
 *     the row (key shape, token coverage, serving grams, Atwater, panel integrity).
 *   Tier L (LLM adjudication) — one call per row Tier D did not already evict.
 *     ~62 calls, ~$0.011 and ~11 s per batch at gpt-4o-mini / temperature 0.
 *     Semantic identity is the thing Tier D provably cannot do: `turkey bacon` ->
 *     `Turkey Breast` and `sparkling water` -> `Water Crackers` share their head
 *     noun, so no token rule can separate them.
 *
 * ---------------------------------------------------------------------------
 * MEASURED OPERATING POINT — and which of its numbers are FITTED
 * ---------------------------------------------------------------------------
 * `--policy balanced --llm`, i.e. EVICT when (D3 or D4 or D8 or D9) or a Tier-L
 * REJECT. Measured on the 81 hand-labelled rows of batch 01
 * (23 BAD / 10 SUSPECT / 48 GOOD):
 *
 *   BAD caught          22 / 23  = 95.7%    <- Tier L = claude-sonnet-5.
 *                       21 / 23  = 91.3%       Tier L = gpt-4o-mini.
 *   GOOD wrongly evicted 0 / 48  = 0%       <- FITTED. Do not plan against this.
 *
 * **This was 23 / 23 until 2026-07-27, when D1 and D6 were retired as evictors.**
 * That change moves exactly three BAD rows from EVICT to REVIEW; Tier L still
 * REJECTs two of them (`chili crunch joe onion trader`, `kirkland muffin
 * signature` — both were D6 fires, i.e. serving/panel defects, which is the axis
 * Tier L reads anyway). The one row that now reaches REVIEW instead of EVICT with
 * no Tier-L backstop is `joe trader`, a genuine bare-brand key that Tier L ACCEPTs.
 * So the price of retiring D1 is one fixture row that a human still sees, bought
 * against a 73.8% false-eviction rate on the real cache. See POLICIES below.
 *
 * **The 0% false-positive rate on GOOD rows is FITTED.** The shipped Tier-L rubric's
 * variant-class taxonomy was written after reading the errors the clean held-out
 * rubric made on these same rows. The clean HELD-OUT rubric (rubric v3, whose
 * examples contain no batch-01 content of any kind) measures **6 / 48 = 12.5%**.
 * 12.5% is the number to plan a batch against, and it is the number this script
 * prints to the operator. Anyone quoting 0% is quoting a fitted figure.
 *
 * **Recall is NOT fitted.** The combined screen caught 23 / 23 BAD under all four
 * rubric variants tried, including v3 (no batch-01 content on either the ACCEPT or
 * the REJECT side). Recall is the number this screen exists for and it is the one
 * that survives the held-out test. (That 23/23 was measured with D1/D6 still
 * evicting; the figure above supersedes it for the shipped policy.)
 *
 * Tier D alone, same rows, same labels (`--policy balanced`, no `--llm`):
 *   BAD 15 / 23 evicted (4 more go to REVIEW), GOOD 0 / 48 evicted.
 * So dropping `--llm` is a recall drop from 96% to 65%, and this script says so.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN CANNOT SEE — also carried as comments at each rule
 * ---------------------------------------------------------------------------
 * 1. **Tier L agreed with the pipeline (ACCEPT) on 3 BAD rows**; all 3 were caught
 *    by Tier D. Both tiers are language models reading a product name, so they
 *    share a failure mode. That is the structural argument for requiring BOTH — a
 *    future "the LLM catches everything, drop Tier D" simplification would silently
 *    drop those 3. (Symmetrically, the 4 BAD rows Tier D misses are exactly the 4
 *    Tier L catches. Neither tier alone reaches 100%.)
 * 2. ~~**The serving check is a RECONSTRUCTION.**~~ CLOSED 2026-07-27. D5/D6 read the
 *    real anchor through `hydrateAndSelectServing` (on by default; `--no-serving`
 *    opts out). `resolveServingGrams` survives only as the fallback for offline
 *    `--rows` replays, and when the real anchor did not run D5/D6 report INFO and
 *    never EVICT — an unmeasured reconstruction may not throw a cache row away.
 * 3. **D9 fired zero times on the 81 rows.** It is unexercised, not validated.
 *    (Update 2026-07-27: it fires 13 times across the full 3,248-row cache, and all
 *    13 reproduce as a plain SQL join against corruptReason/duplicateOfBarcode.)
 * 4. **Determinism is partial.** Four Tier-L runs at temperature 0 gave identical
 *    BAD and GOOD columns; the SUSPECT column moved by one row. Quote review-queue
 *    sizes as a range, not a number.
 * 5. **One batch, one domain.** Batch 01 is store brands. Hand-label the first 20
 *    added rows of the next domain and re-run with `--labels` before trusting any
 *    of these numbers there.
 * 6. **The measured numbers are a BATCH instrument's.** Screening the whole cache at
 *    once changes seed attribution from a lookup into a nearest-match guess unless
 *    `--seeds` carries explicit `key<TAB>phrase` pins — see `attribute()`. Without
 *    pins, the seed-dependent rules produce false positives at cache width.
 *
 * ---------------------------------------------------------------------------
 * USAGE (from repo root)
 * ---------------------------------------------------------------------------
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/correctness-screen.ts \
 *       --bdir <batch dir containing added.txt> --seeds <batch seed file> \
 *       [--llm] [--policy strict|balanced|lenient] [--out screen.json] \
 *       [--rows rows.json] [--dump-rows rows.json] [--labels labels.json]
 *
 *   --rows        skip the DB and read a previously dumped row pull (offline replay)
 *   --dump-rows   write the DB pull to this path so a later run can use --rows
 *   --labels      score the screen against a hand-labelled ground truth and print
 *                 per-rule and per-tier confusion matrices
 *   --llm-all     run Tier L on EVERY row including ones Tier D evicted (measurement
 *                 only — production runs Tier L on the survivors, which is cheaper)
 *
 * EXIT CODE: 0 if no row is marked EVICT, 1 if any row is. Anything > 1 is a crash
 * or a refused flag and the runner must treat it as RED — a screen that could not
 * run must never be read as a clean batch. Exit 1 means "withhold the flagged
 * rows", NOT "roll the whole batch back".
 *
 * READ-ONLY: SELECT only. This file never writes to Postgres, Typesense or
 * FoodMapping. The eviction itself is a separate, transactional campaign step.
 */

import * as fs from 'fs';
import * as path from 'path';
import { detectBrandInQuery } from '../../src/lib/mapping/brand-detector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Policy = 'strict' | 'balanced' | 'lenient';
export type Severity = 'EVICT' | 'REVIEW' | 'INFO';
export type Decision = 'EVICT' | 'REVIEW' | 'KEEP';
/** Tier-D rule ids are stable and greppable; 'L' is Tier L's slot in a policy. */
export type RuleId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9' | 'D10' | 'D11' | 'L';

export interface Hit { rule: RuleId; severity: Severity; detail: string }

/** One FoodMapping row joined to the record behind it — the shape ROW_SQL returns. */
export interface ScreenRow {
    key: string;
    src: string;
    conf: number | null;
    validatedby: string;
    mapfoodname: string;
    mapbrand: string;
    recname: string;
    recbrand: string;
    per100g: Record<string, number> | null;
    off_serving_grams: number | null;
    off_serving_size: string;
    pkg_qty: number | null;
    pkg_unit: string;
    corruptreason: string;
    dupof: string;
    fs_serving_desc: string;
    fs_serving_grams: number | null;
    fs_serving_nutrients: Record<string, number> | null;
    recid: string;
    n_off_servings: number;
    off_serv_min_g: number | null;
    off_serv_max_g: number | null;
    /**
     * FDC columns. ROW_SQL joined OffFood and FatSecretFood ONLY until 2026-07-27,
     * so every fdc-sourced row arrived with recname='' and per100g=null and D8
     * fired on all of them — 78 of 78 fdc rows in the live cache, a 100% false
     * positive rate on that source. Batch 01 contained no fdc rows, which is why
     * the measured operating point never saw it.
     */
    fdc_serving_size: number | null;
    fdc_serving_unit: string;
    fdc_serv_min_g: number | null;
    /** Filled in by attribute(); '' means "could not be attributed to a seed". */
    seed?: string;
    /**
     * Filled in by the --with-serving pass from the REAL billing anchor
     * (hydrateAndSelectServing), not from resolveServingGrams. `undefined` means
     * the pass never ran for this row, which is UNJUDGED — never agreement.
     */
    real?: RealServing | null;
}

/** What the request path would actually bill for a unitless `1 x` of this row. */
export interface RealServing {
    grams: number | null;
    tier: string | null;
    kcal: number | null;
    error?: string;
}

export interface LlmVerdict {
    verdict: 'ACCEPT' | 'UNSURE' | 'REJECT';
    axis: string;
    confidence: number;
    reason: string;
    error?: string;
}

export interface Verdict {
    key: string;
    seed: string;
    record: string;
    brand: string;
    source: string;
    recid: string;
    decision: Decision;
    tierD: Hit[];
    tierL: LlmVerdict | null;
}

// ---------------------------------------------------------------------------
// The honesty constants. Printed to the operator; asserted in the unit tests.
// ---------------------------------------------------------------------------

/**
 * Expected share of GOOD rows this screen will wrongly evict, measured with the
 * CLEAN HELD-OUT rubric (v3 — every worked example drawn from a different food
 * domain, no batch-01 row on either the ACCEPT or the REJECT side): 6 / 48.
 *
 * The shipped rubric measures 0 / 48 on the same rows, but its variant-class
 * taxonomy is a generalisation of the six errors v3 made on this very batch, so
 * that 0% is FITTED and must never be quoted as an expectation.
 */
export const HELD_OUT_GOOD_FP_RATE = 6 / 48;
/** The fitted figure, named so nobody re-derives it and believes it. */
export const FITTED_GOOD_FP_RATE = 0;
/**
 * Combined-screen recall on BAD at the SHIPPED policy, Tier L = claude-sonnet-5.
 * Was 23/23 while D1 and D6 evicted; retiring them costs exactly one fixture row
 * (`joe trader`, which Tier L ACCEPTs) and it lands in REVIEW, not KEEP.
 */
export const MEASURED_BAD_RECALL_WITH_LLM = 22 / 23;
/** Same screen with Tier L = gpt-4o-mini, measured on the same 81 rows. */
export const MEASURED_BAD_RECALL_WITH_LLM_MINI = 21 / 23;
/** Tier-D-only recall at `--policy balanced` (evict set) on the same 81 rows. */
export const MEASURED_BAD_RECALL_TIER_D_ONLY = 15 / 23;
/**
 * The measured false-eviction rate of D1 on the REAL 3,248-row cache — the number
 * that retired it. 73.8% of the rows D1 flagged were rescued by a full-cache audit.
 * Named so that a future "D1 is 100% precise on the fixture, promote it back"
 * has to argue with a number instead of with the fixture.
 */
export const D1_FALSE_EVICT_RATE_REAL_CACHE = 0.738;

// ---------------------------------------------------------------------------
// Flag parsing — validated, not coerced. A coerced flag produces a clean-looking
// report of a run that never happened.
// ---------------------------------------------------------------------------

export class FlagError extends Error {}

export function parseIntFlag(flag: string, raw: string | undefined, fallback: number, min: number): number {
    if (raw === undefined) return fallback;
    const trimmed = raw.trim();
    const n = Number(trimmed);
    if (trimmed.length === 0 || !Number.isFinite(n) || !Number.isInteger(n)) {
        throw new FlagError(`${flag} must be an integer, got "${raw}".`
            + (trimmed.startsWith('--') ? ` That looks like the next flag — ${flag} takes a value.` : ''));
    }
    if (n < min) throw new FlagError(`${flag} must be >= ${min}, got ${n}.`);
    return n;
}

export function parsePolicy(raw: string | undefined): Policy {
    if (raw === undefined) return 'balanced';
    if (raw === 'strict' || raw === 'balanced' || raw === 'lenient') return raw;
    throw new FlagError(`--policy must be one of strict|balanced|lenient, got "${raw}". `
        + 'An unknown policy would evict nothing, which reads as a clean batch.');
}

// ---------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------

export const STOP = new Set([
    'and', 'the', 'a', 'an', 'of', 'with', 'in', 'or', 'for', 'to', 'but', 'no', 'not',
    'fresh', 'brand', 'original', 'classic', 'style', 'flavor', 'flavour', 'natural',
    'all', 'new', 'plain',
]);
// NOTE — no brand names live in STOP, deliberately. detectBrandInQuery is the ONLY
// brand source. [measured] it matched a brand on 108 of batch 01's 110 seeds (misses:
// `clancys tortilla chips`, `fit and active protein shake`), and an ablation that added
// every batch-01 store brand to STOP produced a byte-identical confusion matrix — the
// hand list was inert. Do not add brands here; if the lexicon misses one, fix the lexicon.

export function toks(s: string): string[] {
    return (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 0);
}

/**
 * Deliberately crude, SYMMETRIC stemmer. It is applied to BOTH sides of every
 * comparison, so over-truncation cancels. The `-ses` over-truncation lesson
 * (playbook §4, `cheeses` -> `chees`) was about a stemmer applied to ONE side;
 * keep this one symmetric and it stays harmless.
 */
export function stem(t: string): string {
    if (t.length <= 3) return t;
    if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
    if (t.endsWith('ses') || t.endsWith('xes') || t.endsWith('zes') || t.endsWith('ches') || t.endsWith('shes')) return t.slice(0, -2);
    if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) return t.slice(0, -1);
    return t;
}

export const stems = (s: string): Set<string> => new Set(toks(s).map(stem));

export function brandTokens(seed: string): Set<string> {
    const out = new Set<string>();
    const det = detectBrandInQuery(seed);
    if (det.matchedBrand) for (const t of toks(det.matchedBrand)) out.add(stem(t));
    return out;
}

/** Non-brand, non-stopword content stems of the seed, in order. */
export function contentStems(seed: string, brand: Set<string>): string[] {
    return toks(seed)
        .map(stem)
        .filter(t => !brand.has(t) && !STOP.has(t) && t.length > 1 && !/^\d+$/.test(t));
}

// ---------------------------------------------------------------------------
// Derived facts
// ---------------------------------------------------------------------------

/**
 * The gram weight a unitless `qty 1` log is billed against, and where it came from.
 * `grams: null` means nothing anchored it and the mapper falls back to a flat 100 g.
 *
 * !! THIS IS A RECONSTRUCTION, NOT THE PIPELINE. !!
 * It walks OffFood.servingGrams -> FatSecretServing.grams -> OffServing.grams ->
 * FdcFood.servingSize -> FdcServing.grams -> flat 100 g. It does NOT call
 * hydrateAndSelectServing, so count-label serving, dose-anchored serving and funnel
 * fix 5's FatSecret weight oracle are invisible here.
 *
 * PREFER `realServing()`. Since 2026-07-27 the screen runs the real anchor by
 * default (`--with-serving`) and D5/D6 judge THAT; this function is the fallback
 * used only for the LLM card and for rows the real pass could not resolve. Where
 * the two disagree, the real one is right by construction — it is the function the
 * request path calls.
 */
export function resolveServingGrams(r: ScreenRow): { grams: number | null; from: string } {
    if (r.off_serving_grams != null && r.off_serving_grams > 0) return { grams: r.off_serving_grams, from: 'OffFood.servingGrams' };
    if (r.fs_serving_grams != null && r.fs_serving_grams > 0) return { grams: r.fs_serving_grams, from: 'FatSecretServing.grams' };
    if (r.off_serv_min_g != null && r.off_serv_min_g > 0) return { grams: r.off_serv_min_g, from: 'OffServing.grams' };
    // FDC: servingSize is only a weight when its unit says so — `1 cup` in the
    // servingSize column is a volume and must not be read as grams.
    if (r.fdc_serving_size != null && r.fdc_serving_size > 0 && /^g(ram)?s?$/i.test(r.fdc_serving_unit || '')) {
        return { grams: r.fdc_serving_size, from: 'FdcFood.servingSize' };
    }
    if (r.fdc_serv_min_g != null && r.fdc_serv_min_g > 0) return { grams: r.fdc_serv_min_g, from: 'FdcServing.grams' };
    return { grams: null, from: 'none (flat-100g default)' };
}

/**
 * The anchor D5/D6 actually judge, and whether it can be judged at all.
 *
 * `judged: false` means the real pass did not produce a number for this row — the
 * flag was off, the row is an offline `--rows` replay, or hydration threw. In that
 * state D5/D6 MUST NOT evict: the reconstruction alone was never measured against
 * the real anchor, and evicting a cache row on an unvalidated number is the same
 * mistake the serving gate closed in PR #174. Absence of a verdict is UNJUDGED,
 * never agreement — the screen goes quiet, not loud.
 */
export function realServing(r: ScreenRow): { grams: number | null; from: string; judged: boolean } {
    if (r.real === undefined) return { ...resolveServingGrams(r), judged: false };
    if (r.real === null || r.real.error) return { grams: null, from: 'real anchor unresolved', judged: false };
    // `flat_100g_default` is the ABSENCE of an anchor wearing a number. The real
    // function reports it as 100 g; the reconstruction reports it as null. They mean
    // the same thing, and D5 exists to say it — so normalise to null or D5 falls
    // silent on exactly the rows it was written for. Measured on batch 01: 6 of the
    // 9 reconstruction/real "disagreements" were only this, and reading the 100 g
    // literally would have silenced 6 correct D5 warnings (one of them a BAD row).
    if (NO_ANCHOR_TIERS.has(r.real.tier ?? '')) {
        return { grams: null, from: `hydrateAndSelectServing:${r.real.tier}`, judged: true };
    }
    // An AI-ESTIMATED anchor is not a property of this cache row — it is a fresh model
    // guess that can differ on the next request, so it cannot ground a decision to
    // throw the row away. Same rule the serving gate uses (PR #174's
    // AI-NONDETERMINISTIC verdict): name it, never silently read it as agreement.
    if (AI_SERVING_TIER_RE.test(r.real.tier ?? '')) {
        return { grams: r.real.grams, from: `ai-estimated:${r.real.tier}`, judged: false };
    }
    return { grams: r.real.grams, from: `hydrateAndSelectServing:${r.real.tier ?? 'no-tier'}`, judged: true };
}

/**
 * Tiers produced by a model call rather than by corpus data. Matching one means the
 * screen spent an LLM call resolving that row — see the cost note on
 * `resolveRealServings`.
 */
export const AI_SERVING_TIER_RE = /(^|_)ai(_|$)|estimat/i;

/**
 * Serving tiers that are a FALLBACK, not a measured portion. A row on one of these
 * has no real anchor no matter what number it carries, which is what D5 reports.
 */
export const NO_ANCHOR_TIERS = new Set<string>(['flat_100g_default']);

export function atwater(p: Record<string, number> | null): { declared: number; computed: number; ratio: number } | null {
    if (!p) return null;
    const kcal = Number(p.calories ?? p.kcal ?? NaN);
    const P = Number(p.protein ?? 0), C = Number(p.carbs ?? p.carbohydrate ?? 0), F = Number(p.fat ?? 0);
    if (!isFinite(kcal)) return null;
    const computed = 4 * P + 4 * C + 9 * F;
    if (computed <= 0) return null;
    return { declared: kcal, computed, ratio: kcal / computed };
}

// ---------------------------------------------------------------------------
// Tier D
// ---------------------------------------------------------------------------

/**
 * Which rules EVICT outright and which only downgrade a row to REVIEW.
 * Measured on batch 01 (23 BAD / 10 SUSPECT / 48 GOOD), Tier D alone:
 *   lenient   BAD  0/23 evicted,  0 rows evicted   — not a screen
 *   balanced  BAD 17/23 evicted, 17 rows evicted   <- recommended; with --llm, 23/23
 *   strict    BAD 18/23 evicted, 24 rows evicted   — buys ONE extra BAD over balanced
 *                                                    and withholds seven more
 *
 * D1 AND D6 EVICT UNDER NO POLICY. Both were evictors until 2026-07-27; both were
 * demoted on evidence the 81-row fixture is structurally unable to produce.
 *
 * D1 (bare-brand key) scores 1/23 BAD, 0/48 GOOD here — 100% precision — and on the
 * real 3,248-row cache it FALSE-EVICTS AT 73.8% (238 of 547 rules-flagged rows were
 * rescued by a full-cache Sonnet audit; D1 was the worst source by a factor of two).
 * Batch 01 is a store-brand batch, where D1's premise holds — "a key that is nothing
 * but a brand is not a food". The cache is full of `sprite`, `fritos`, `oikos`,
 * `boursin`, `rice krispies`, where the brand IS the food. The refinement that would
 * save the rule — fire only when the brand has several distinct products under that
 * name — needs a corpus query, and tierD is a pure function on purpose. So D1 reports;
 * it does not delete. See sync-docs/mapping_investigation_playbook.md.
 *
 * D6 (implausible serving weight) is a CATEGORY ERROR as an evictor, independent of
 * its hit rate: FoodMapping is identity-only — there is no grams column, servings
 * resolve fresh per request from hydrateAndSelectServing. Deleting the row cannot fix
 * a serving; it discards a correct identity and re-resolves the same bad weight. 21
 * rows on the real cache rested on D6 alone with demonstrably CORRECT identities
 * (`cinnamon` -> Ground Cinnamon, `bodyarmor mango orange` -> BodyArmor Orange Mango,
 * `club jersey mike supreme` -> Jersey Mike's #9). Serving defects belong to the
 * serving stage's own gate (PR #174), not to a cache eviction.
 *
 * D5 (no gram anchor at all) came out of `strict` for the same reason on the same
 * day. It is the same stage as D6 and the fact that it only evicted under an opt-in
 * policy does not make deleting an identity row a way to conjure a serving weight.
 * The generalised rule, which has a test: A RULE MAY ONLY EVICT IF WHAT IT DETECTS
 * IS A PROPERTY OF THE MAPPING — of which record we chose — NOT OF A STAGE
 * DOWNSTREAM OF IT. D7 stays an evictor under `strict` because an internally
 * inconsistent panel IS a property of the chosen record: picking a different record
 * fixes it.
 */
export const POLICIES: Record<Policy, { evict: RuleId[] }> = {
    strict: { evict: ['D2', 'D3', 'D4', 'D7', 'D8', 'D9', 'D10', 'L'] },
    balanced: { evict: ['D3', 'D4', 'D8', 'D9', 'L'] },
    lenient: { evict: ['D8', 'D9'] },
};

/** Every Tier-D rule id, flagging and informational, in report order. */
export const TIER_D_RULE_IDS: RuleId[] = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'];

/**
 * The deterministic tier. No network, no API key, no DB — given a row and a policy
 * this is a pure function, which is what lets the pinned confusion matrix in
 * __tests__/correctness-screen.test.ts defend the screen's recall against refactors.
 *
 * A row with no seed (attribution failed) has an empty seedContent, which makes
 * D1/D2/D3/D4/D10/D11 ABSTAIN rather than fire. The screen goes quiet, not loud,
 * when it does not know what was asked for.
 */
export function tierD(r: ScreenRow, policy: Policy): Hit[] {
    const hits: Hit[] = [];
    const seed = r.seed ?? '';
    const brand = brandTokens(seed);
    const keyStems = new Set(toks(r.key).map(stem));
    const seedContent = contentStems(seed, brand);
    const recStems = new Set([...stems(r.recname), ...stems(r.recbrand), ...stems(r.mapfoodname)]);
    const sev = (rule: RuleId): Severity => POLICIES[policy].evict.includes(rule) ? 'EVICT' : 'REVIEW';

    // D1 — bare-brand / bare-category key. The key carries no content token at all,
    // so ANY future query that reduces to the brand answers with this one SKU.
    // (`trader joes joe joes` -> key `joe trader`; the bare query `trader joes`
    // derives the identical key.) 1/23 BAD, 0/48 GOOD on batch 01.
    if (brand.size > 0) {
        const keyContent = [...keyStems].filter(t => !brand.has(t) && !STOP.has(t));
        if (keyContent.length === 0) {
            hits.push({ rule: 'D1', severity: sev('D1'), detail: `bare-brand key: '${r.key}' has no content token outside the brand` });
        }
    }

    // D2 — the seed named a brand and the KEY kept none of it. That is the
    // generic-key-takeover shape (`met rx big 100` -> key `protein bar`,
    // `millville honey nut toasted oats` -> key `honey nut oat rolled toasted`):
    // a branded SKU seizes a key every other query for that category will also hit.
    // 0/23 BAD, 0/48 GOOD, 1/10 SUSPECT — REVIEW-only under `balanced`.
    if (brand.size > 0 && [...keyStems].every(t => !brand.has(t))) {
        hits.push({ rule: 'D2', severity: sev('D2'), detail: `key '${r.key}' dropped the seed's brand entirely (generic-key takeover)` });
    }

    // D11 — a non-brand seed token vanished from the key. INFORMATIONAL ONLY, under
    // every policy. [measured] on batch 01 it fired on 2 GOOD and 0 BAD rows
    // (`great value FROZEN chicken breast`, `kirkland signature DRIED mango` — both
    // AI-normalisation drift on a CORRECT pick), so it must never gate. It is the
    // coverage-shortfall signal (`identity-query-token-dropped`) and belongs in the
    // batch report. Promoting it to a flag was the prior proposal's rule (d), and it
    // bought nothing but false positives.
    const dropped = seedContent.filter(t => !keyStems.has(t));
    if (dropped.length > 0) {
        hits.push({ rule: 'D11', severity: 'INFO', detail: `key '${r.key}' dropped seed token(s): ${dropped.join(',')} [informational]` });
    }

    // D3 — head noun absent. The seed's LAST content token is the thing being
    // logged; if its stem appears nowhere in the record's name or brand, the record
    // is a different food. THE WORKHORSE: 15/23 BAD, 0/48 GOOD standalone — almost
    // the entire deterministic gain. `kirkland signature turkey bacon` -> "Kirkland
    // Signature Turkey Breast" flags on 'bacon'; `great value almonds` -> "Great
    // value, almonds, smoke" does not. The stricter variant (seed head must EQUAL the
    // record's head) was tried and rejected: it fires on that almonds row and on
    // `publix deli fried chicken` -> "Deli Fried Chicken Tenders". Head-PRESENT is
    // the precision/recall knee — do not tighten it without re-running --labels.
    const head = seedContent[seedContent.length - 1];
    if (head && !recStems.has(head)) {
        hits.push({ rule: 'D3', severity: sev('D3'), detail: `seed head noun '${head}' absent from record '${r.recname}'` });
    }

    // D4 — zero content-token overlap between seed and record. A subset of D3 in
    // practice (3/23 BAD, 0/48 GOOD) but kept: it is what survives when the head noun
    // happens to match by accident.
    if (seedContent.length > 0 && !seedContent.some(t => recStems.has(t))) {
        hits.push({ rule: 'D4', severity: sev('D4'), detail: `no seed content token in record '${r.recname}'` });
    }

    // D5 — no gram anchor anywhere, so a unitless `1 x` bills the flat-100g default.
    // 1/23 BAD but 7/10 SUSPECT: a SUSPECT detector, not a BAD detector, which is why
    // `balanced` routes it to REVIEW rather than EVICT.
    //
    // Since 2026-07-27 this reads the REAL anchor (hydrateAndSelectServing) when the
    // --with-serving pass ran. When it did not, both rules DOWNGRADE to INFO instead
    // of firing: the reconstruction's agreement with the real anchor has never been
    // measured, so it may not evict a row on its own authority.
    const sg = realServing(r);
    const dsev = (rule: RuleId): Severity => (sg.judged ? sev(rule) : 'INFO');
    const unjudged = sg.judged ? '' : ' [UNJUDGED: real anchor not computed, reconstruction only]';
    if (sg.grams == null) {
        hits.push({ rule: 'D5', severity: dsev('D5'), detail: `no serving weight -> flat-100g default (${sg.from})${unjudged}` });
    } else if (sg.grams < 5 || sg.grams > 500) {
        // D6 — an absurd gram weight: 1.0 g of chili oil, 1.9 g of muffin, 1106 g of
        // banana. 3/23 BAD, 0/48 GOOD.
        hits.push({ rule: 'D6', severity: dsev('D6'), detail: `serving weight ${sg.grams} g implausible (from ${sg.from})${unjudged}` });
    }

    // D7 — Atwater inconsistency on the per-100g panel. Detects arithmetic
    // INCONSISTENCY, not wrongness: the three demonstrably corrupt records in batch 01
    // are all Atwater-consistent. Nutrition wrongness is carried entirely by Tier L's
    // "is this plausible FOR THIS FOOD" axis, i.e. by a language model's world
    // knowledge — which is a dependency, not a guarantee.
    const aw = atwater(r.per100g);
    if (aw && aw.computed >= 20 && (aw.ratio < 0.85 || aw.ratio > 1.15)) {
        hits.push({ rule: 'D7', severity: sev('D7'), detail: `Atwater ${aw.ratio.toFixed(2)} (declared ${aw.declared.toFixed(0)} vs computed ${aw.computed.toFixed(0)} kcal/100g)` });
    }

    // D8 — no usable per-100g basis at all. `{}` panels bill only through the
    // macro-only branch; anything gram-scaled has nothing to scale from. 0/23 BAD on
    // batch 01 (retail SKUs have panels) — this is the rule expected to carry the
    // restaurant-chain batches, where 33 of the 34 known panel-less FatSecret rows
    // live. That expectation is ESTIMATED, not measured.
    const kcal = r.per100g ? Number(r.per100g.calories ?? r.per100g.kcal ?? NaN) : NaN;
    if (!r.per100g || Object.keys(r.per100g).length === 0) {
        hits.push({ rule: 'D8', severity: sev('D8'), detail: 'per-100g panel is empty {}' });
    } else if (!isFinite(kcal) || kcal <= 0) {
        hits.push({ rule: 'D8', severity: sev('D8'), detail: `per-100g calories missing or <= 0 (${String(kcal)})` });
    }

    // D9 — the corpus already knows this record is bad.
    // !! UNEXERCISED IN THE WILD: D9 fired ZERO times on all 81 rows of batch 01. !!
    // That is a finding, not a pass. The three records the audit PROVED are corrupt
    // (0274038708522 TJ chicken breast @ 11.7 kcal/100g, 0826088442101 Kirkland
    // muffins @ 0 P / 0 F, 0000650010800 TJ Chili Onion Crunch @ 110 kcal/100g) are
    // all missed by the corpus's own corruption detector (PR #119, 8 classes, 23,916
    // rows marked). Keep D9 — it is free — but budget NO recall to it. Its only
    // coverage anywhere is the synthetic cases in the unit tests.
    if (r.corruptreason) hits.push({ rule: 'D9', severity: sev('D9'), detail: `corruptReason=${r.corruptreason}` });
    if (r.dupof) hits.push({ rule: 'D9', severity: sev('D9'), detail: `duplicateOfBarcode=${r.dupof}` });

    // D10 — the seed named a brand and the record carries it in neither its brand
    // field nor its name. 0/23 BAD, 1/10 SUSPECT — REVIEW-only under `balanced`,
    // because a blank or differently-spelled brand field on an otherwise correct
    // record is common and benign.
    if (brand.size > 0) {
        const recBrandStems = new Set([...stems(r.recbrand), ...stems(r.recname)]);
        const matched = [...brand].filter(t => recBrandStems.has(t));
        if (matched.length === 0) {
            hits.push({ rule: 'D10', severity: sev('D10'), detail: `seed brand absent from record brand '${r.recbrand}' / name` });
        }
    }
    return hits;
}

// ---------------------------------------------------------------------------
// Tier L
// ---------------------------------------------------------------------------

/**
 * The shipped rubric (v4). Every worked example is drawn from a DIFFERENT food
 * domain than batch 01 (chipotle / qdoba / cava / subway composites), so the REJECT
 * and ACCEPT blocks leak no test-set content. The variant-class taxonomy, however,
 * IS a generalisation of the six false positives the examples-only rubric (v3) made
 * on batch 01 — class-level fitting, weaker than row-level, but not zero. That is
 * precisely why HELD_OUT_GOOD_FP_RATE, and not 0%, is what gets printed.
 *
 * The counter-example blocks are not decoration: playbook §5 — a detector without
 * counterRows passes tautologically. Without them the rubric evicted 6 GOOD rows.
 */
export const LLM_SYSTEM = `You are a food-database auditor. You see a shopper's search phrase and the ONE database record a mapping pipeline cached for it, forever. Decide whether that record is the right product with usable numbers.

Judge four axes:
1. IDENTITY - is this the same FOOD the phrase names? A different product from the same brand is WRONG even when it shares words.
2. NUTRITION - are the per-100g calories and macros plausible FOR THE FOOD THE PHRASE NAMES (not merely internally consistent)?
3. SERVING - is the default serving weight a real portion of this product?
4. KEY - does the stored cache key still identify the product, or has it collapsed to a bare brand / bare category that unrelated queries would also hit?

The hard part is telling a WRONG PRODUCT from a HARMLESS VARIANT. Use these (all from a different food domain than the rows you are judging).

REJECT - different food, however similar the words:
  "chipotle chicken burrito" -> "Chipotle, Chicken"        (one component billed for a whole assembled dish; ~7x under)
  "qdoba chicken burrito" -> "Qdoba, Tequila Lime Chicken" (same shape)
  "jimmy johns sub" -> "Jimmy Chips"                       (side item instead of the sandwich)
  "buffalo wild wings ultimate nachos" -> "Medium Buffalo Sauce"  (condiment instead of the dish)
  "cava harissa avocado bowl" -> "Harissa"                 (a 28 g dip instead of a bowl)
  "subway tuna sandwich" -> "Tuna"                         (filling instead of the sandwich)
  "tuna in water" -> a 0 kcal water record
  "raising canes combo box" -> "Milk 1% Box"               (drink instead of the meal)

ACCEPT - same food, extra or different descriptive words. Shoppers omit qualifiers routinely and the nutrition is close. These are NOT mismatches:
  "chipotle chicken burrito bowl" -> "Chipotle Chicken Burrito Bowl" | Easy Eats  (different brand, same dish)
  "impossible burger patty" -> "Impossible Burger"          (burger/patty are synonyms)
  "noodles and company pad thai" -> "Pad Thai (Small)"      (a named portion size of the same dish)
  "chick fil a cobb salad" -> "Chick-Fil-A, Cobb Salad"     (punctuation only)
  "white rice" -> "Rice, white, long-grain, cooked"         (preparation qualifiers the phrase omitted)
These VARIANT CLASSES are always ACCEPT when the food category is unchanged - do not reject on any of them:
  - flavour / seasoning variant        (smoked, BBQ, Thai, s'mores, vanilla, salted)
  - texture variant                    (creamy, crunchy, smooth, chunky)
  - cut / form of the same prepared food (tenders, shredded, boneless, skinless, sliced, halves)
  - named portion or pack size         (small, large, family size, single serve)
  - sub-brand or product-line name     (Mountain Trail Mix, Fiber Trail Mix)
  - the record's brand field is blank or spelled differently while the name matches the food
  - the record name is the bare generic of the food the phrase named ("Granola" for "<brand> granola")
Sanity check before you REJECT on identity: would this record's kcal/100g be within roughly +/-25% of the food the phrase named? If yes, it is almost certainly a variant, not a different food - ACCEPT.
A flavour, variety, cut, texture, portion-size or preparation word the phrase did not mention is NOT a mismatch. Reject only when the record is a DIFFERENT FOOD - different category, or a form factor whose kcal/100g differs materially.

Answer with JSON only, no prose, no markdown fence:
{"verdict":"ACCEPT"|"UNSURE"|"REJECT","axis":"identity"|"nutrition"|"serving"|"key"|"none","confidence":0.0-1.0,"reason":"<= 25 words"}

Use UNSURE when you cannot tell whether it is the same product from the information given - that routes the row to a human instead of discarding it. Reserve REJECT for cases you would defend.`;

/** The compact record card Tier L judges. Deterministic given the row. */
export function llmUserPrompt(r: ScreenRow): string {
    const sg = realServing(r);
    const aw = atwater(r.per100g);
    const p = r.per100g ?? {};
    // When the real anchor ran, quote ITS kcal — hydrateAndSelectServing can bill a
    // food whose per-100g panel is empty (the FatSecret serving-nutrient path), and
    // per100g * grams / 100 would print 0 kcal for a real 1,980 kcal entree.
    const billed = r.real && !r.real.error && r.real.kcal != null
        ? `${r.real.kcal.toFixed(0)} kcal`
        : `${((Number(p.calories ?? 0) * (sg.grams ?? 100)) / 100).toFixed(0)} kcal`;
    const lines = [
        `shopper phrase: ${r.seed}`,
        `cache key stored: ${r.key}`,
        `record name: ${r.recname || r.mapfoodname}`,
        `record brand: ${r.recbrand || r.mapbrand || '(none)'}`,
        `source: ${r.src}  id: ${r.recid}`,
        `per 100 g: ${isFinite(Number(p.calories)) ? `${Number(p.calories).toFixed(1)} kcal` : 'NO CALORIES'}, protein ${Number(p.protein ?? 0).toFixed(1)} g, carbs ${Number(p.carbs ?? 0).toFixed(1)} g, fat ${Number(p.fat ?? 0).toFixed(1)} g` + (Object.keys(p).length === 0 ? '  [PANEL IS EMPTY {}]' : ''),
        aw ? `Atwater check: declared/computed = ${aw.ratio.toFixed(2)}` : 'Atwater check: not computable',
        sg.grams != null
            ? `default serving: ${sg.grams} g  (label: ${r.off_serving_size || r.fs_serving_desc || 'n/a'}, via ${sg.from})  -> a "1 x" log bills ${billed}`
            : `default serving: NONE resolved (${sg.from}) -> a "1 x" log bills a flat 100 g = ${billed}`,
        r.pkg_qty ? `package quantity: ${r.pkg_qty} ${r.pkg_unit}` : '',
    ].filter(Boolean);
    return lines.join('\n');
}

export interface LlmConfig { model: string; baseUrl: string; apiKey: string; concurrency: number }

export async function callLlm(r: ScreenRow, cfg: LlmConfig): Promise<LlmVerdict> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
                body: JSON.stringify({
                    model: cfg.model,
                    temperature: 0,
                    // 200 was enough for gpt-4o-mini and ONLY for gpt-4o-mini. A
                    // reasoning model spends its thinking inside the same completion
                    // budget: claude-sonnet-5 burns ~57 reasoning tokens before the
                    // JSON and truncated 16 of 81 rows mid-object ("Unexpected end of
                    // JSON input"). `--model` invites exactly that swap, so the budget
                    // has to fit a reasoning model rather than the cheapest one. Costs
                    // nothing when unused — billing is on tokens emitted, not reserved.
                    max_tokens: 700,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: LLM_SYSTEM },
                        { role: 'user', content: llmUserPrompt(r) },
                    ],
                }),
            });
            if (!res.ok) { await new Promise(s => setTimeout(s, 800 * (attempt + 1))); continue; }
            const j = await res.json() as { choices?: { message?: { content?: string } }[] };
            const txt = j?.choices?.[0]?.message?.content ?? '';
            const parsed = JSON.parse(txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
            // An UNRECOGNISED verdict string is a reply we could not read, not an
            // approval. The old form was `=== 'REJECT' ? ... : === 'UNSURE' ? ... :
            // 'ACCEPT'`, so `"reject"`, `"Reject"`, `"probably fine"`, a missing key and
            // `{}` ALL landed on ACCEPT and the row was kept — the same fail-open shape
            // PR #176 closed for a truncated reply, still open one branch over. Only the
            // three known tokens are honoured; anything else is UNSURE (-> REVIEW).
            const raw = String(parsed?.verdict ?? '').trim().toUpperCase();
            if (raw !== 'ACCEPT' && raw !== 'UNSURE' && raw !== 'REJECT') {
                return {
                    verdict: 'UNSURE', axis: 'none', confidence: 0,
                    reason: `unreadable verdict ${JSON.stringify(parsed?.verdict ?? null)}`,
                    error: 'unparseable-verdict',
                };
            }
            return {
                verdict: raw,
                axis: String(parsed.axis ?? 'none'),
                confidence: Number(parsed.confidence ?? 0),
                reason: String(parsed.reason ?? ''),
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // A failed call is UNSURE, not ACCEPT. Both avoid the mass-eviction a
            // network blip could otherwise cause — UNSURE routes to REVIEW, EVICT is
            // never reached — but ACCEPT let an unadjudicated row read as CLEAN, which
            // is the exact defect class this file exists to close. Measured: swapping
            // --model to claude-sonnet-5 truncated 16 of 81 rows, and under the old
            // default all 16 landed in KEEP with nothing but a WARN line to say so.
            if (attempt === 2) return { verdict: 'UNSURE', axis: 'none', confidence: 0, reason: msg, error: 'call-failed' };
            await new Promise(s => setTimeout(s, 800 * (attempt + 1)));
        }
    }
    return { verdict: 'UNSURE', axis: 'none', confidence: 0, reason: 'exhausted', error: 'call-failed' };
}

export async function runLlm(rows: ScreenRow[], cfg: LlmConfig): Promise<Map<string, LlmVerdict>> {
    const out = new Map<string, LlmVerdict>();
    let i = 0;
    async function worker() {
        while (i < rows.length) {
            const r = rows[i++];
            out.set(r.key, await callLlm(r, cfg));
            if (out.size % 10 === 0) process.stderr.write(`  llm ${out.size}/${rows.length}\n`);
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(cfg.concurrency, rows.length)) }, worker));
    return out;
}

// ---------------------------------------------------------------------------
// Combining the tiers
// ---------------------------------------------------------------------------

/**
 * A Tier-L REJECT evicts only when the policy lists 'L'; a Tier-L UNSURE never
 * evicts, it routes the row to a human. Requiring BOTH tiers is deliberate: Tier L
 * ACCEPTed 3 of the 23 BAD rows — it shares the pipeline's failure mode, both being
 * language models reading a product name — and Tier D caught all 3. Deleting either
 * tier silently drops rows the other cannot see.
 */
export function decide(hits: Hit[], l: LlmVerdict | null | undefined, policy: Policy): Decision {
    const lReject = !!l && l.verdict === 'REJECT';
    const lUnsure = !!l && l.verdict === 'UNSURE';
    if (hits.some(h => h.severity === 'EVICT')) return 'EVICT';
    if (lReject && POLICIES[policy].evict.includes('L')) return 'EVICT';
    if (hits.some(h => h.severity === 'REVIEW') || lReject || lUnsure) return 'REVIEW';
    return 'KEEP';
}

/**
 * The process exit code for a completed run — 0 = nothing to evict, 1 = rows
 * flagged, 2 = the run is not a result.
 *
 * SCREENING ZERO ROWS IS NOT A CLEAN BATCH. `loadRows` returns `[]` for an empty
 * `added.txt`, for a `--rows` file containing `[]`, and for a key list that matches
 * nothing in FoodMapping (`json_agg` over no rows is SQL NULL, coalesced to `[]`).
 * All three then produced `nEvict = 0` and exit 0 — the same output as a batch that
 * was screened and found clean. The truncation WARN could not catch it either: it
 * only fires when `keys.length !== rows.length`, and 0 === 0.
 */
export function screenExitCode(rowsScreened: number, nEvict: number): 0 | 1 | 2 {
    if (rowsScreened === 0) return 2;
    return nEvict > 0 ? 1 : 0;
}

/** Tier D over every row, plus (optionally) the Tier-L verdicts already gathered. */
export function screenBatch(rows: ScreenRow[], policy: Policy, llm?: Map<string, LlmVerdict>): Verdict[] {
    return rows.map(r => {
        const hits = tierD(r, policy);
        const l = llm?.get(r.key) ?? null;
        return {
            key: r.key, seed: r.seed ?? '', record: r.recname, brand: r.recbrand,
            source: r.src, recid: r.recid,
            decision: decide(hits, l, policy),
            tierD: hits, tierL: l,
        };
    });
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/** The read-only row pull. SELECT only — no writes, no side-effecting functions. */
export const ROW_SQL = `
SELECT json_agg(t) FROM (
SELECT m."normalizedForm" AS key, m.source AS src, m."aiConfidence" AS conf,
       coalesce(m."validatedBy",'') AS validatedby,
       m."foodName" AS mapfoodname, coalesce(m."brandName",'') AS mapbrand,
       coalesce(o.name, f.name, fd.description, '') AS recname,
       coalesce(o."brandName", f."brandName", fd."brandName", '') AS recbrand,
       coalesce(o."nutrientsPer100g", f."nutrientsPer100g", fd."nutrientsPer100g") AS per100g,
       o."servingGrams" AS off_serving_grams,
       coalesce(o."servingSize",'') AS off_serving_size,
       o."packageQuantity" AS pkg_qty,
       coalesce(o."packageQuantityUnit",'') AS pkg_unit,
       coalesce(o."corruptReason",'') AS corruptreason,
       coalesce(o."duplicateOfBarcode",'') AS dupof,
       coalesce(fs.description,'') AS fs_serving_desc,
       fs.grams AS fs_serving_grams,
       fs.nutrients AS fs_serving_nutrients,
       coalesce(m."offBarcode", m."fsId", m."fdcId"::text,'') AS recid,
       (SELECT count(*) FROM "OffServing" os WHERE os.barcode = o.barcode) AS n_off_servings,
       (SELECT min(os.grams) FROM "OffServing" os WHERE os.barcode = o.barcode AND os.grams IS NOT NULL) AS off_serv_min_g,
       (SELECT max(os.grams) FROM "OffServing" os WHERE os.barcode = o.barcode AND os.grams IS NOT NULL) AS off_serv_max_g,
       fd."servingSize" AS fdc_serving_size,
       coalesce(fd."servingSizeUnit",'') AS fdc_serving_unit,
       (SELECT min(fs2.grams) FROM "FdcServing" fs2 WHERE fs2."fdcId" = fd."fdcId" AND fs2.grams > 0) AS fdc_serv_min_g
FROM "FoodMapping" m
LEFT JOIN "OffFood" o        ON o.barcode  = m."offBarcode"
LEFT JOIN "FatSecretFood" f  ON f."fsId"   = m."fsId"
LEFT JOIN "FatSecretServing" fs ON fs."fsId" = f."fsId" AND fs."servingId" = f."defaultServingId"
LEFT JOIN "FdcFood" fd       ON fd."fdcId" = m."fdcId"
WHERE m."normalizedForm" = ANY($1::text[])
ORDER BY 1) t;`;

/** Minimal read-only surface we need from prisma; structural so tests never touch a DB. */
export interface PrismaLike {
    $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown>;
    $disconnect: () => Promise<void>;
}

function openPrisma(): PrismaLike {
    // Required lazily so the unit tests never construct a client, and so a --rows
    // replay needs no DATABASE_URL at all.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv/config');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient() as PrismaLike;
}

async function loadRows(keys: string[], rowsIn?: string): Promise<ScreenRow[]> {
    if (rowsIn) return JSON.parse(fs.readFileSync(rowsIn, 'utf8')) as ScreenRow[];
    const prisma = openPrisma();
    try {
        const res = await prisma.$queryRawUnsafe(ROW_SQL, keys) as { json_agg: ScreenRow[] | null }[];
        return res?.[0]?.json_agg ?? [];
    } finally { await prisma.$disconnect(); }
}

/** `off_` / `fs_` / `fdc_` — the id prefixes hydrateAndSelectServing branches on. */
function candidateId(r: ScreenRow): string | null {
    if (!r.recid) return null;
    if (r.src === 'openfoodfacts') return `off_${r.recid}`;
    if (r.src === 'fatsecret') return `fs_${r.recid}`;
    if (r.src === 'fdc') return `fdc_${r.recid}`;
    return null;
}

/**
 * Fill `row.real` with what the REQUEST PATH would bill for a unitless `1 x`.
 *
 * This calls `hydrateAndSelectServing` — the same function route.ts calls — rather
 * than reimplementing it, which is the whole point: the previous reconstruction
 * could not see count-label serving, dose-anchored serving or the FatSecret weight
 * oracle, and PR #174 moved the real anchor further from it still. A screen that
 * evicts cache rows on a number the user is not billed is grading the wrong thing.
 *
 * Rows it cannot resolve get `error` set, which makes D5/D6 abstain. Failure is
 * never silently converted into agreement.
 *
 * !! THIS IS NOT FREE AND NOT PURE. !!
 * `hydrateAndSelectServing` is the production path, so it does what production does:
 * it can call the USDA FDC API and it can invoke the ambiguous-serving AI estimator
 * (one gpt-4o-mini call per ambiguous row). Over the full 3,248-row cache that is
 * minutes of wall clock and a few hundred model calls, NOT the offline pure-function
 * cost of Tier D. Rows it resolves through the estimator come back on an
 * `AI_SERVING_TIER_RE` tier and D5/D6 abstain on them, so the model spend buys
 * information about the row but never a verdict. Budget for it, or pass
 * `--no-serving` and accept that D5/D6 report instead of gate.
 */
export async function resolveRealServings(rows: ScreenRow[], concurrency = 8): Promise<void> {
    // Required lazily: this module builds a Prisma client and pulls in the whole
    // mapper at import time, which unit tests must never do.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hydrateAndSelectServing } = require('../../src/lib/mapping/map-ingredient-with-fallback');
    let next = 0;
    const worker = async (): Promise<void> => {
        for (;;) {
            const i = next++;
            if (i >= rows.length) return;
            const r = rows[i];
            const id = candidateId(r);
            if (!id) { r.real = { grams: null, tier: null, kcal: null, error: `no record id for source '${r.src}'` }; continue; }
            const p = r.per100g ?? {};
            const candidate = {
                id,
                source: r.src as 'fdc' | 'openfoodfacts' | 'ai_generated' | 'fatsecret',
                name: r.recname || r.mapfoodname,
                brandName: r.recbrand || r.mapbrand || null,
                score: 1,
                nutrition: {
                    kcal: Number(p.calories ?? p.kcal ?? 0),
                    protein: Number(p.protein ?? 0),
                    carbs: Number(p.carbs ?? p.carbohydrate ?? 0),
                    fat: Number(p.fat ?? 0),
                    per100g: true,
                },
                rawData: {},
            };
            try {
                const res = await hydrateAndSelectServing(candidate, null, r.conf ?? 0.9, r.seed || r.key);
                if (!res) { r.real = null; continue; }
                r.real = {
                    grams: typeof res.grams === 'number' ? res.grams : null,
                    tier: res.servingTier ?? null,
                    // `kcal` is the TOTAL for the resolved grams — the same field
                    // route.ts records as MappingEventLog.totalKcal.
                    kcal: typeof res.kcal === 'number' ? res.kcal : null,
                };
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                r.real = { grams: null, tier: null, kcal: null, error: msg };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

/**
 * Attribute each added key back to the batch seed that produced it. The stored key
 * is NOT a pure function of the seed (`trader joes joe joes` -> `joe trader`,
 * playbook §4), so this tries the real canonicalizeCacheKey first and falls back to
 * a stem-Jaccard best match for the AI-normalisation drift cases
 * (`amazon fresh chicken breast` -> `amazon breast chicken skinless`).
 *
 * `canon` is INJECTABLE so this stays testable without importing
 * normalization-rules, which constructs a PrismaClient at module load. On batch 01
 * both paths agree: with canon, 69 exact + 12 Jaccard; without canon, 81 Jaccard —
 * and both assign all 81 rows the same seed the human audit recorded, 0 unattributed.
 *
 * A row with NO seed is reported and screened with an empty seed, which makes the
 * token rules ABSTAIN rather than fire — conservative in the right direction, but it
 * does mean an attribution failure makes the screen quiet, not loud.
 *
 * !! THE JACCARD FALLBACK DOES NOT SCALE PAST ONE BATCH. !!
 * It picks the nearest seed in the list, and "nearest" stops meaning "correct" once
 * the list spans many domains. Measured 2026-07-27 screening all 3,248 cache rows
 * against 4,168 observed phrases: a TURKEY key was attributed to an `85% lean 15%
 * fat beef` seed, and three distinct Chick-fil-A keys all matched one
 * `chick fil a milkshake` seed — each producing a false D3 "head noun absent". 332
 * of 516 evictions rested solely on seed-dependent rules. For any run wider than a
 * single batch, pass EXPLICIT `key<TAB>phrase` pairs (see `parseSeedFile`) so
 * attribution is a lookup instead of a guess.
 */
/**
 * A seed file's contents. `byKey` holds explicit `key<TAB>phrase` pins; `phrases`
 * holds bare seed lines. A file may mix both — batch runs use bare lines, and a
 * whole-cache run pins every key.
 */
export interface SeedInput { phrases: string[]; byKey: Map<string, string> }

/**
 * Parse a --seeds file. A line with a TAB is `key<TAB>observed phrase` and pins
 * that key exactly; a line without one is a bare seed phrase matched by
 * canonicalization then Jaccard. `#` comments and blanks are ignored.
 */
export function parseSeedFile(text: string): SeedInput {
    const phrases: string[] = [];
    const byKey = new Map<string, string>();
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        const tab = line.indexOf('\t');
        if (tab >= 0) {
            const key = line.slice(0, tab).trim();
            const phrase = line.slice(tab + 1).trim();
            if (key && phrase) { byKey.set(key, phrase); phrases.push(phrase); }
            continue;
        }
        phrases.push(line.trim());
    }
    return { phrases, byKey };
}

export function attribute(
    rows: ScreenRow[],
    seeds: string[] | SeedInput,
    canon?: ((s: string) => string) | null,
): { unattributed: string[] } {
    const list = Array.isArray(seeds) ? seeds : seeds.phrases;
    const pinned = Array.isArray(seeds) ? new Map<string, string>() : seeds.byKey;
    const byKey = new Map<string, string>();
    const seedSets = list.map(s => ({ s, set: new Set(toks(s).map(stem)) }));
    if (canon) for (const s of list) { const k = canon(s); if (!byKey.has(k)) byKey.set(k, s); }
    const unattributed: string[] = [];
    for (const r of rows) {
        // An explicit key->phrase pin always wins: it is the phrase actually observed
        // for this key, not the nearest one in a global list.
        const exactPin = pinned.get(r.key);
        if (exactPin) { r.seed = exactPin; continue; }
        const exact = byKey.get(r.key);
        if (exact) { r.seed = exact; continue; }
        const kt = new Set(toks(r.key).map(stem));
        let best = { s: '', j: 0 };
        for (const { s, set } of seedSets) {
            const inter = [...kt].filter(t => set.has(t)).length;
            const j = inter / new Set([...kt, ...set]).size;
            if (j > best.j) best = { s, j };
        }
        if (best.j >= 0.5) r.seed = best.s;
        else { r.seed = ''; unattributed.push(r.key); }
    }
    return { unattributed };
}

/** Load canonicalizeCacheKey without letting its prisma import take the run down. */
function loadCanonicalizer(): ((s: string) => string) | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('../../src/lib/mapping/normalization-rules').canonicalizeCacheKey as (s: string) => string;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Scoring against a hand-labelled ground truth
// ---------------------------------------------------------------------------

export type Label = 'GOOD' | 'SUSPECT' | 'BAD';

export interface ConfusionStats {
    badCaught: number; badMissed: number;
    goodFlagged: number; goodClean: number;
    susFlagged: number; susClean: number;
    recall: number; precBad: number; precBadSus: number;
}

/** Pure: how a flagged set scores against the labels. Printing is separate. */
export function confusionOf(flagged: Set<string>, labels: Map<string, Label>): ConfusionStats {
    let badCaught = 0, badMissed = 0, goodFlagged = 0, goodClean = 0, susFlagged = 0, susClean = 0;
    for (const [k, v] of labels) {
        const f = flagged.has(k);
        if (v === 'BAD') f ? badCaught++ : badMissed++;
        else if (v === 'GOOD') f ? goodFlagged++ : goodClean++;
        else f ? susFlagged++ : susClean++;
    }
    const bad = badCaught + badMissed;
    const flaggedTotal = badCaught + goodFlagged + susFlagged;
    return {
        badCaught, badMissed, goodFlagged, goodClean, susFlagged, susClean,
        recall: bad ? badCaught / bad : 0,
        // Precision counted two ways: BAD-only (harsh) and BAD+SUSPECT — a SUSPECT
        // flag is not a false alarm, those rows genuinely need a human.
        precBad: flaggedTotal ? badCaught / flaggedTotal : 0,
        precBadSus: flaggedTotal ? (badCaught + susFlagged) / flaggedTotal : 0,
    };
}

export function formatConfusion(name: string, s: ConfusionStats): string {
    const bad = s.badCaught + s.badMissed, good = s.goodFlagged + s.goodClean, sus = s.susFlagged + s.susClean;
    return `${name.padEnd(34)} BAD ${s.badCaught}/${bad} caught  GOOD flagged ${s.goodFlagged}/${good}  SUSPECT flagged ${s.susFlagged}/${sus}`
        + `  | recall ${(100 * s.recall).toFixed(1)}%  precision(BAD) ${(100 * s.precBad).toFixed(1)}%  precision(BAD+SUS) ${(100 * s.precBadSus).toFixed(1)}%`;
}

function confusion(name: string, flagged: Set<string>, labels: Map<string, Label>): ConfusionStats {
    const s = confusionOf(flagged, labels);
    console.log(formatConfusion(name, s));
    return s;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const USAGE = [
    'Usage: correctness-screen.ts (--bdir <batch dir> | --rows <rows.json>) [--seeds <seed file>]',
    '  [--policy strict|balanced|lenient] [--llm] [--llm-all] [--model <id>] [--concurrency N]',
    '  [--out <screen.json>] [--dump-rows <rows.json>] [--labels <labels.json>] [--no-serving]',
    '',
    '  --bdir        batch directory produced by gate.py; reads <bdir>/added.txt',
    '  --rows        replay a previously dumped row pull instead of reading the DB',
    '  --llm         add Tier L. WITHOUT it, measured BAD recall falls 100% -> 78%.',
    '  --labels      score against a hand-labelled ground truth (how the shipped numbers were made)',
    '  --no-serving  skip the real billing anchor. D5/D6 then report INFO, never EVICT,',
    '                because the reconstruction alone was never measured against it.',
    '',
    '  --seeds accepts bare phrases OR explicit "key<TAB>phrase" pins. Use pins for any',
    '  run wider than one batch: nearest-match attribution guesses wrong at cache scale.',
    '',
    'Exit 0 = nothing to evict, 1 = rows flagged for withholding, >1 = crash OR zero rows',
'screened (treat as RED — a run that judged nothing is not a clean batch).',
].join('\n');

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    const has = (flag: string) => args.includes(flag);
    const val = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };

    const bdir = val('--bdir');
    const rowsIn = val('--rows');
    if (!bdir && !rowsIn) { console.error(USAGE); return 2; }

    const seedsPath = val('--seeds');
    const rowsOut = val('--dump-rows');
    const labelsPath = val('--labels');
    const outPath = val('--out');
    const llmAll = has('--llm-all');
    const useLlm = has('--llm') || llmAll;
    const policy = parsePolicy(val('--policy'));
    const concurrency = parseIntFlag('--concurrency', val('--concurrency'), 6, 1);
    // Default ON, mirroring winner-gate.sh: the instrument should see the number the
    // user is billed unless someone explicitly opts out. An offline --rows replay has
    // no DB, so it cannot run the real anchor.
    const withServing = !has('--no-serving') && !rowsIn;

    let llmCfg: LlmConfig | null = null;
    if (useLlm) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('dotenv/config');
        const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
        // FAIL CLOSED. The prototype degraded silently to Tier D here, and a silent
        // degrade is a recall drop from 100% to 78% that the batch log still reads as
        // a clean full-strength run. If you genuinely want Tier D only, omit --llm.
        if (!apiKey) {
            throw new FlagError('--llm was requested but neither OPENROUTER_API_KEY nor OPENAI_API_KEY is set. '
                + 'Running without Tier L drops measured BAD recall from 100% to 78%, so this is refused rather '
                + 'than silently degraded. Set the key, or drop --llm and accept the Tier-D-only operating point.');
        }
        llmCfg = {
            model: val('--model') ?? process.env.SCREEN_AI_MODEL ?? 'openai/gpt-4o-mini',
            baseUrl: process.env.OPENROUTER_BASE_URL ?? process.env.OPENAI_API_BASE_URL ?? 'https://openrouter.ai/api/v1',
            apiKey,
            concurrency,
        };
    }

    let keys: string[] = [];
    if (bdir) {
        const addedPath = path.join(bdir, 'added.txt');
        keys = fs.readFileSync(addedPath, 'utf8').split('\n')
            .map(l => l.split('\t')[0].trim()).filter(Boolean);
    }
    let rows = await loadRows(keys, rowsIn);
    if (keys.length) {
        const wanted = new Set(keys);
        const pulled = rows.length;
        rows = rows.filter(r => wanted.has(r.key));
        // Silent truncation reads as "covered everything" when it did not.
        if (rows.length !== keys.length) {
            console.log(`WARN added.txt listed ${keys.length} key(s); the row pull returned ${pulled} and `
                + `${rows.length} matched. ${keys.length - rows.length} added key(s) are NOT screened.`);
        }
    }

    const seeds: SeedInput = seedsPath
        ? parseSeedFile(fs.readFileSync(seedsPath, 'utf8'))
        : { phrases: [], byKey: new Map() };
    if (!seeds.phrases.length) {
        console.log('WARN no --seeds file: every row is screened with an EMPTY seed, so D1/D2/D3/D4/D10/D11 '
            + 'ABSTAIN. D3 alone carries 15 of 23 measured BAD catches — this run is not the measured screen.');
    }
    const { unattributed } = attribute(rows, seeds, loadCanonicalizer());
    const guessed = rows.length - unattributed.length - seeds.byKey.size;
    if (seeds.byKey.size) {
        console.log(`seeds: ${seeds.byKey.size} key(s) pinned explicitly, ${Math.max(0, guessed)} matched by canonicalization/Jaccard.`);
    }
    if (unattributed.length) {
        console.log(`WARN ${unattributed.length} row(s) could not be attributed to a seed and are screened with an `
            + `empty seed (token rules abstain): ${unattributed.slice(0, 5).join(', ')}`);
    }
    // Jaccard picks the NEAREST seed, and nearest stops meaning correct once the seed
    // list spans domains (turkey key <- beef seed, 2026-07-27). Say so rather than
    // letting a wide run quietly inherit a per-batch instrument's reputation.
    if (!seeds.byKey.size && seeds.phrases.length > 300) {
        console.log(`WARN ${seeds.phrases.length} bare seed phrases and no key->phrase pins. Attribution is a `
            + 'nearest-match GUESS at this width and the seed-dependent rules (D1/D2/D3/D4/D10/D11) '
            + 'will produce false positives. Pass explicit "key<TAB>phrase" lines for a whole-cache run.');
    }

    // --- The real billing anchor, for D5/D6. Needs the DB; an offline --rows replay
    // cannot run it, and in that case D5/D6 report INFO/UNJUDGED rather than evicting
    // on a reconstruction whose agreement with the real anchor was never measured.
    if (withServing) {
        await resolveRealServings(rows);
        const ok = rows.filter(r => r.real && !r.real.error).length;
        const failed = rows.filter(r => r.real?.error).length;
        const ai = rows.filter(r => r.real && !r.real.error && AI_SERVING_TIER_RE.test(r.real.tier ?? '')).length;
        console.log(`serving: real anchor resolved for ${ok}/${rows.length} row(s)`
            + (failed ? `, ${failed} errored (D5/D6 abstain on those)` : '')
            + (ai ? `, ${ai} via an AI estimator (D5/D6 abstain on those too)` : ''));
    } else {
        console.log('NOTE --no-serving: D5/D6 are a RECONSTRUCTION this run and are reported as INFO, not EVICT. '
            + 'Tier-D BAD recall is below the measured 18/23 without them.');
    }

    // Dump AFTER the serving pass, not during the row pull: the real anchor costs
    // minutes and a few hundred model calls, and a dump taken before it produces a
    // --rows file that can never judge D5/D6. Pay once, replay offline forever.
    if (rowsOut) fs.writeFileSync(rowsOut, JSON.stringify(rows, null, 1));

    // --- Tier D (pure, offline)
    const dHits = new Map<string, Hit[]>();
    for (const r of rows) dHits.set(r.key, tierD(r, policy));

    // --- Tier L, on the rows Tier D did not already EVICT
    const dEvicted = new Set([...dHits].filter(([, h]) => h.some(x => x.severity === 'EVICT')).map(([k]) => k));
    const llmTargets = llmAll ? rows : rows.filter(r => !dEvicted.has(r.key));
    let llm = new Map<string, LlmVerdict>();
    if (llmCfg) {
        console.log(`tier L: ${llmTargets.length} rows (of ${rows.length}) -> ${llmCfg.model}`);
        llm = await runLlm(llmTargets, llmCfg);
        const failed = [...llm.values()].filter(v => v.error).length;
        if (failed) {
            console.log(`WARN ${failed} Tier-L call(s) failed and were recorded UNSURE (-> REVIEW), NOT adjudicated. `
                + 'A truncated response is the usual cause: raise max_tokens if you changed --model.');
        }
    }

    const verdicts = screenBatch(rows, policy, llm);
    const nEvict = verdicts.filter(v => v.decision === 'EVICT').length;
    const nReview = verdicts.filter(v => v.decision === 'REVIEW').length;

    console.log(`\nscreened ${rows.length} rows | policy=${policy} | tiers=${llmCfg ? 'D+L' : 'D only'}`
        + ` | EVICT ${nEvict} · REVIEW ${nReview} · KEEP ${rows.length - nEvict - nReview}`);
    // The expectation the operator gets is the HELD-OUT one. The 0/48 the shipped
    // rubric measured on batch 01 is FITTED (its variant taxonomy was written after
    // reading the held-out rubric's errors on those same rows), and quoting it would
    // understate the coverage this screen throws away.
    console.log(`expected false positives ~${(100 * HELD_OUT_GOOD_FP_RATE).toFixed(1)}% of the CORRECT rows in this `
        + 'batch (held-out rubric: 6 of 48 GOOD rows on batch 01), so some of the '
        + `${nEvict + nReview} row(s) withheld above are correct picks. How many depends on this batch's GOOD `
        + 'share, which is unknown without --labels, so no absolute count is implied. The 0/48 the shipped '
        + 'rubric scored on batch 01 is FITTED and is not an expectation.');
    if (!llmCfg) {
        console.log('NOTE Tier D only. Measured BAD recall at this point is 78% (18/23) vs 100% (23/23) with --llm; '
            + 'the 4 rows Tier D misses are exactly the 4 Tier L catches.');
    }
    console.log('NOTE this screen grades the rows the batch ADDED. It says "this is wrong"; it never says "here is '
        + 'the right one". D5/D6 read the real billing anchor when --with-serving ran (reconstruction/real agreement '
        + 'measured at 96.3% on batch 01) and abstain to INFO when it did not.');

    if (outPath) {
        fs.writeFileSync(outPath, JSON.stringify({
            policy,
            model: llmCfg ? llmCfg.model : null,
            heldOutGoodFalsePositiveRate: HELD_OUT_GOOD_FP_RATE,
            verdicts,
        }, null, 1));
        const evictList = verdicts.filter(v => v.decision === 'EVICT').map(v => v.key).join('\n');
        const evictPath = outPath.replace(/\.json$/, '') + '-evict.txt';
        fs.writeFileSync(evictPath, evictList + (evictList ? '\n' : ''));
        console.log(`wrote ${outPath} and ${evictPath}`);
    }

    // --- scoring against ground truth
    if (labelsPath) {
        const labelArr = JSON.parse(fs.readFileSync(labelsPath, 'utf8')) as { key: string; verdict: Label }[];
        const known = new Set(rows.map(r => r.key));
        const labels = new Map<string, Label>(labelArr.filter(x => known.has(x.key)).map(x => [x.key, x.verdict]));
        console.log(`\n=== confusion, measured on ${labels.size} labelled rows `
            + `(${[...labels.values()].filter(v => v === 'BAD').length} BAD / `
            + `${[...labels.values()].filter(v => v === 'SUSPECT').length} SUSPECT / `
            + `${[...labels.values()].filter(v => v === 'GOOD').length} GOOD) ===`);

        for (const id of TIER_D_RULE_IDS) {
            const flagged = new Set([...dHits].filter(([, h]) => h.some(x => x.rule === id)).map(([k]) => k));
            if (flagged.size) confusion(`  ${id} alone`, flagged, labels);
            else console.log(`  ${id} alone`.padEnd(36) + 'NO FIRES on this batch — unexercised here, not validated.');
        }
        const dAny = new Set([...dHits].filter(([, h]) => h.some(x => x.severity !== 'INFO')).map(([k]) => k));
        console.log('');
        confusion('TIER D (any rule)', dAny, labels);
        const dEv = new Set([...dHits].filter(([, h]) => h.some(x => x.severity === 'EVICT')).map(([k]) => k));
        confusion(`TIER D (EVICT only, ${policy})`, dEv, labels);
        if (llmCfg) {
            const lFlag = new Set([...llm].filter(([, v]) => v.verdict === 'REJECT').map(([k]) => k));
            const lFlagU = new Set([...llm].filter(([, v]) => v.verdict !== 'ACCEPT').map(([k]) => k));
            confusion(llmAll ? 'TIER L alone (all rows)' : 'TIER L (on rows D passed)', lFlag, labels);
            confusion(llmAll ? 'TIER L REJECT+UNSURE (all)' : 'TIER L REJECT+UNSURE', lFlagU, labels);
            confusion('COMBINED D-any + L', new Set([...dAny, ...lFlag]), labels);
            confusion(`COMBINED D-EVICT + L-REJECT (${policy}) = the EVICT set`, new Set([...dEv, ...lFlag]), labels);
            confusion('COMBINED D-any + L-REJECT+UNSURE = EVICT u REVIEW', new Set([...dAny, ...lFlagU]), labels);
        }

        // Per-row misses, so a miss is never a bare number.
        const finalFlag = new Set(verdicts.filter(v => v.decision !== 'KEEP').map(v => v.key));
        console.log('\n--- BAD rows the screen MISSED ---');
        for (const [k, v] of labels) if (v === 'BAD' && !finalFlag.has(k)) {
            const r = rows.find(x => x.key === k);
            console.log(`  MISS ${k}  | seed: ${r?.seed} | got: ${r?.recname} | ${r?.recbrand}`);
        }
        console.log('--- GOOD rows the screen FLAGGED (coverage thrown away) ---');
        for (const [k, v] of labels) if (v === 'GOOD' && finalFlag.has(k)) {
            const vd = verdicts.find(x => x.key === k);
            console.log(`  FP   ${k}  | ${vd?.decision} | ${vd?.tierD.map(h => h.rule).join(',') ?? ''}`
                + `${vd?.tierL?.verdict === 'REJECT' ? ' L:' + vd.tierL.reason : ''}`);
        }
    }

    if (rows.length === 0) {
        console.error('\nFATAL screened 0 rows. Nothing was judged, so this run is NOT a clean batch — '
            + 'check that --bdir/added.txt is non-empty, that --rows is not [], and that the keys exist '
            + 'in FoodMapping. Exiting 2.');
    }
    return screenExitCode(rows.length, nEvict);
}

if (require.main === module) {
    main()
        .then(code => process.exit(code))
        .catch(err => {
            // A refused flag is a user error, not a crash — but both exit non-zero and
            // above 1, because a screen that could not run must never be read as a
            // clean batch.
            if (err instanceof FlagError) {
                console.error(`\n${err.message}\n`);
                console.error(USAGE);
                process.exit(2);
            }
            console.error(err);
            process.exit(2);
        });
}

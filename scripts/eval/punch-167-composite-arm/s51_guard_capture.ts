/**
 * s51_guard_capture.ts — Lane A S51, punch #167 fix-forward (ROW 0(c)), STEP 1.
 *
 * CAPTURES the exact arguments the SHIPPED mapper hands guard 1, `preserveDroppedBrand()`, for
 * every distinct `SegmentationCache` segment tuple in the CSV, plus the SHIPPED outcome.
 *
 * For each tuple it calls `mapIngredientWithFallback(rawText, { brand, normalizedForm, skipCache,
 * skipSave, telemetry, aiNutritionBudget, aiHydrationBudget })` — the option shape
 * `buildParsedItem()` in `src/app/api/nlp/parse/route.ts` passes, with `skipCache`/`skipSave`
 * forced true — and stops the mapper at the first of these, by a sentinel throw:
 *   GUARD       the wrapped shipped `preserveDroppedBrand()` returned (args + outcome recorded);
 *   POST_GUARD  `aiParseIngredient()` or `restoreNutritionModifiers()` was called — both sit in
 *               `preflightIngredientLine()` AFTER the guard's block, so the guard was not reached;
 *   RETURNED    preflight returned early (no food name / zero-calorie) — nothing after it runs;
 *   LEAK        `gatherCandidates()` or `aiNormalizeIngredient()` was called — must never happen,
 *               aborts the whole run.
 * Nothing between the top of `mapIngredientWithFallback()` and the guard calls an LLM or
 * retrieval: `findCanonicalName()` (a `LearnedSynonym` read whose `update` the write guard
 * suppresses), `parseIngredientLine()`, `stripPartitiveOfResidue()`, `detectBrandInQuery()`.
 * The LLM usage store is compared before/after EVERY tuple; any movement aborts the run.
 *
 * WRITE SAFETY: the Prisma write guard from `scripts/eval/winner-diff-write-guard.ts` on the
 * `@/lib/db` singleton, plus `skipSave: true`. The abort precedes every save, the normalize
 * cache and MappingEventLog (written by the route, not the mapper), so an EMPTY tally is the
 * expected reading here — unless a rawText hits a `LearnedSynonym` row, whose `update` is
 * suppressed and tallied.
 *
 * Run from a scratchpad worktree, env from the shell (set -a; . ./.env; set +a):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/punch-167-composite-arm/s51_guard_capture.ts [tuples.csv] [out.jsonl]
 */
import * as fs from 'fs';
import * as path from 'path';
import { installWriteGuard } from '../winner-diff-write-guard';
import { readTuples, TUPLES_CSV } from './s51_clauses';

const CSV = process.argv[2] ?? TUPLES_CSV;
const OUT = process.argv[3] ?? path.join(__dirname, 's51_guard_capture.jsonl');

class Sentinel extends Error {
    constructor(public kind: 'GUARD' | 'POST_GUARD' | 'LEAK', public detail: string) {
        super(`S51_SENTINEL_${kind}:${detail}`);
    }
}

const say = (s: string) => console.log(`S51| ${s}`);

async function main() {
    const suppressed: Record<string, number> = {};
    const { prisma } = require('@/lib/db');
    installWriteGuard(prisma, (k: string) => { suppressed[k] = (suppressed[k] ?? 0) + 1; });

    const metrics = require('@/lib/ai/llm-usage-metrics');
    const mapper = require('@/lib/mapping/map-ingredient-with-fallback');
    const qwb = require('@/lib/mapping/quantity-word-brand');
    const guards = require('@/lib/mapping/llm-output-guards');
    const aiParse = require('@/lib/mapping/ai-parse');
    const gather = require('@/lib/mapping/gather-candidates');
    const aiNorm = require('@/lib/mapping/ai-normalize');
    const { detectBrandInQuery } = require('@/lib/mapping/brand-detector');
    const { createAiNutritionBudget } = require('@/lib/mapping/ai-nutrition-backfill');
    const { AI_NUTRITION_MAX_PER_REQUEST, AI_NUTRITION_HYDRATION_MAX_PER_REQUEST } = require('@/lib/mapping/config');

    let sink: { args: any; shipped: any } | null = null;
    const realPreserve = qwb.preserveDroppedBrand;
    const wrapPreserve = function (a: any) {
        const r = realPreserve(a);
        sink = {
            args: {
                rawLine: a.rawLine, baseName: a.baseName, targetBrand: a.targetBrand,
                rederived: a.rederived, parsed: a.parsed == null ? null : JSON.parse(JSON.stringify(a.parsed)),
            },
            shipped: { baseName: r.baseName, applied: r.applied, declined: r.declined ?? null },
        };
        throw new Sentinel('GUARD', 'preserveDroppedBrand');
    };
    const wrapRestore = function () { throw new Sentinel('POST_GUARD', 'restoreNutritionModifiers'); };
    const wrapAiParse = async function () { throw new Sentinel('POST_GUARD', 'aiParseIngredient'); };
    const wrapGather = async function () { throw new Sentinel('LEAK', 'gatherCandidates'); };
    const wrapAiNorm = async function () { throw new Sentinel('LEAK', 'aiNormalizeIngredient'); };
    qwb.preserveDroppedBrand = wrapPreserve;
    guards.restoreNutritionModifiers = wrapRestore;
    aiParse.aiParseIngredient = wrapAiParse;
    gather.gatherCandidates = wrapGather;
    aiNorm.aiNormalizeIngredient = wrapAiNorm;
    const bound = {
        preserveDroppedBrand: qwb.preserveDroppedBrand === wrapPreserve,
        restoreNutritionModifiers: guards.restoreNutritionModifiers === wrapRestore,
        aiParseIngredient: aiParse.aiParseIngredient === wrapAiParse,
        gatherCandidates: gather.gatherCandidates === wrapGather,
        aiNormalizeIngredient: aiNorm.aiNormalizeIngredient === wrapAiNorm,
    };
    say(`wrappers bound: ${JSON.stringify(bound)}`);
    if (Object.values(bound).some(v => !v)) { say('ABORT: a wrapper did not bind'); process.exit(3); }

    const tuples = readTuples(CSV);
    const distinct = new Set(tuples.map(t => JSON.stringify([t.rawText, t.normalizedForm, t.brand]))).size;
    say(`tuples read: ${tuples.length} (distinct ${distinct}) from ${CSV}`);

    const snap0 = metrics.getLlmUsageSnapshot();
    say(`LLM usage snapshot at start: ${JSON.stringify(snap0)}`);
    const usageKey = () => JSON.stringify(metrics.getLlmUsageSnapshot().byPurpose);

    const rows: any[] = [];
    const stops: Record<string, number> = {};
    let agree = 0, disagree = 0;
    const t0 = Date.now();
    for (const t of tuples) {
        sink = null;
        const before = usageKey();
        let stop = '', detail = '';
        try {
            const r = await mapper.mapIngredientWithFallback(t.rawText, {
                brand: t.brand || undefined,
                normalizedForm: t.normalizedForm || undefined,
                skipCache: true,
                skipSave: true,
                telemetry: {},
                aiNutritionBudget: createAiNutritionBudget(AI_NUTRITION_MAX_PER_REQUEST),
                aiHydrationBudget: createAiNutritionBudget(AI_NUTRITION_HYDRATION_MAX_PER_REQUEST),
            });
            stop = 'RETURNED';
            detail = r === null ? 'null' : String((r as any).foodId ?? (r as any).status ?? 'object');
        } catch (e: any) {
            if (e instanceof Sentinel) { stop = e.kind; detail = e.detail; }
            else { stop = 'ERROR'; detail = e?.message ?? String(e); }
        }
        if (stop === 'LEAK') { say(`ABORT: LEAK ${detail} on tuple ${t.idx} ${JSON.stringify(t)}`); process.exit(4); }
        if (usageKey() !== before) { say(`ABORT: LLM usage moved on tuple ${t.idx} ${JSON.stringify(t)}`); process.exit(5); }
        // Reach predicted from the mapper's own gate (shipped detector), to cross-check the measurement.
        const predicted = !!(t.normalizedForm?.trim()
            && ((t.brand || undefined)?.trim() || detectBrandInQuery(t.rawText).matchedBrand));
        const reached = stop === 'GUARD';
        if (predicted === reached) agree++; else disagree++;
        const stopKey = `${stop}:${stop === 'ERROR' ? 'error' : detail}`;
        stops[stopKey] = (stops[stopKey] ?? 0) + 1;
        const s = sink as { args: any; shipped: any } | null;
        rows.push({
            idx: t.idx, rawText: t.rawText, normalizedForm: t.normalizedForm, brand: t.brand,
            reached, stop, stopDetail: detail, predictedReach: predicted,
            args: s?.args ?? null, shipped: s?.shipped ?? null,
        });
    }
    const ms = Date.now() - t0;
    fs.writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n') + '\n');

    const reachedRows = rows.filter(r => r.reached);
    const byOutcome = { applied: 0, notApplied: 0, declined: 0 };
    for (const r of reachedRows) {
        if (r.shipped.declined) byOutcome.declined++;
        else if (r.shipped.applied) byOutcome.applied++;
        else byOutcome.notApplied++;
    }
    const segBrand = reachedRows.filter(r => r.brand).length;
    say(`elapsed ms: ${ms}`);
    say(`wrote ${rows.length} rows -> ${OUT}`);
    say(`REACHED guard 1: ${reachedRows.length} of ${rows.length}  (segmenter brand ${segBrand}, detector brand ${reachedRows.length - segBrand})`);
    say(`stops: ${JSON.stringify(stops)}`);
    say(`predicted-vs-measured reach: agree ${agree}, disagree ${disagree}`);
    say(`shipped outcome over reached: applied ${byOutcome.applied} · not applied ${byOutcome.notApplied} · declined ${byOutcome.declined}`);
    say(`SUPPRESSED WRITES: ${JSON.stringify(suppressed)}`);
    say(`LLM usage snapshot at end: ${JSON.stringify(metrics.getLlmUsageSnapshot())}`);
    const errs = rows.filter(r => r.stop === 'ERROR');
    for (const e of errs.slice(0, 10)) say(`ERROR row ${e.idx} ${JSON.stringify(e.rawText)}: ${e.stopDetail}`);
    await prisma.$disconnect().catch(() => undefined);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

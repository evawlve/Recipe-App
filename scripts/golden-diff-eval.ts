/**
 * golden-diff-eval.ts — run every golden nlp case through mapIngredientWithFallback
 * directly (current source, no HTTP) and emit a compact result line per case.
 *
 * Run once with a patch applied and once without, then diff the two outputs: any
 * case whose (foodName|grams|source) changed is the blast radius of the change.
 * This is the cheap pre-flight for a filter/rerank edit — `run-eval.ts` is the
 * authoritative gate, this just shows what MOVED.
 *
 * ===========================================================================
 * !! WRITES + COSTS LLM TOKENS. Same surface as full-pipeline-probe:          !!
 * !! allowLiveFallback:true -> saveValidatedMapping upserts FoodMapping and    !!
 * !! MappingEventLog rows, and the AI normalize/rerank/validate calls are paid.!!
 * ===========================================================================
 * Run it against a scratch DATABASE_URL, or accept that it warms the shared cache.
 * `triage-drops.ts` never calls it.
 *
 * Usage (unchanged):
 *   ts-node ... scripts/golden-diff-eval.ts            # all nlp cases
 *   ts-node ... scripts/golden-diff-eval.ts --limit 20 # first N
 */
import * as fs from 'fs';
import * as path from 'path';
import { mapIngredientWithFallback } from '../src/lib/mapping/map-ingredient-with-fallback';
import { createAiNutritionBudget } from '../src/lib/mapping/ai-nutrition-backfill';
import { AI_NUTRITION_MAX_PER_BATCH, AI_NUTRITION_HYDRATION_MAX_PER_BATCH } from '../src/lib/mapping/config';

export interface GoldenDiffRecord {
    id: string;
    cat?: string;
    query: string;
    status: 'mapped' | 'null' | 'pending' | 'error';
    foodName?: string;
    source?: string;
    grams?: number;
    conf?: number;
    error?: string;
}

interface GoldenCase {
    id: string;
    category?: string;
    item?: { rawText?: string; name?: string };
    text?: string;
}

export function readGoldenNlpCases(goldenPath?: string): GoldenCase[] {
    const p = goldenPath ?? path.join(__dirname, 'eval', 'golden-set.json');
    const golden = JSON.parse(fs.readFileSync(p, 'utf8')) as { nlp: GoldenCase[] };
    return golden.nlp;
}

export function goldenCaseQuery(c: GoldenCase): string {
    return c.item?.rawText ?? c.item?.name ?? c.text ?? '';
}

export interface GoldenDiffOptions {
    goldenPath?: string;
    limit?: number;
    /** Explicit acknowledgement of the write + token cost (see the header). */
    iUnderstandThisWrites: boolean;
    onRecord?: (rec: GoldenDiffRecord) => void;
}

export async function runGoldenDiffEval(opts: GoldenDiffOptions): Promise<GoldenDiffRecord[]> {
    if (!opts?.iUnderstandThisWrites) {
        throw new Error(
            'runGoldenDiffEval WRITES FoodMapping/MappingEventLog and spends LLM tokens; '
            + 'pass { iUnderstandThisWrites: true } to proceed.',
        );
    }
    let cases = readGoldenNlpCases(opts.goldenPath);
    if (opts.limit) cases = cases.slice(0, opts.limit);

    const out: GoldenDiffRecord[] = [];
    // ONE budget for the whole run, shared by every case (see warm-names.ts).
    const nutritionBudget = createAiNutritionBudget(AI_NUTRITION_MAX_PER_BATCH);
    // The SECOND, separate allowance: hydration/enrichment inside
    // buildOffResult. Exhausting it DELETES an already-won OFF candidate,
    // so it must not share the last-resort pool (see warm-names.ts).
    const hydrationBudget = createAiNutritionBudget(AI_NUTRITION_HYDRATION_MAX_PER_BATCH);
    for (const c of cases) {
        const query = goldenCaseQuery(c);
        const rec: GoldenDiffRecord = { id: c.id, cat: c.category, query, status: 'null' };
        try {
            const telemetry: Record<string, unknown> = {};
            const r = await mapIngredientWithFallback(query, {
                allowLiveFallback: true,
                skipOnLock: true,
                telemetry: telemetry as never,
                aiNutritionBudget: nutritionBudget,
                aiHydrationBudget: hydrationBudget,
            });
            if (r === null) {
                rec.status = 'null';
            } else if (r && typeof r === 'object' && (r as { status?: string }).status === 'pending') {
                rec.status = 'pending';
            } else if (r) {
                const m = r as { foodName?: string; source?: string; grams?: number; confidence?: number };
                rec.status = 'mapped';
                rec.foodName = m.foodName;
                rec.source = m.source;
                rec.grams = m.grams;
                rec.conf = typeof m.confidence === 'number' ? +m.confidence.toFixed(3) : m.confidence;
            }
        } catch (e) {
            rec.status = 'error';
            rec.error = (e as Error)?.message ?? String(e);
        }
        out.push(rec);
        opts.onRecord?.(rec);
    }
    return out;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const i = args.indexOf('--limit');
    const limit = i >= 0 && args[i + 1] ? Number(args[i + 1]) : undefined;
    await runGoldenDiffEval({
        limit,
        iUnderstandThisWrites: true,
        onRecord: rec => console.log('GD ' + JSON.stringify(rec)),
    });
    process.exit(0);
}

if (require.main === module) {
    main().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

/**
 * full-pipeline-probe.ts — run mapIngredientWithFallback exactly like warm-names
 * and dump the ENTIRE telemetry object + result, so you can see WHY it returned
 * null (or a bad pick) even when retrieval had good candidates.
 *
 * ===========================================================================
 * !! THIS PROBE MUTATES THE DATABASE AND COSTS LLM TOKENS. NOT READ-ONLY. !!
 * ===========================================================================
 * `mapIngredientWithFallback(..., { allowLiveFallback: true })`:
 *   - calls `saveValidatedMapping` (map-ingredient-with-fallback.ts:2685, :2723),
 *     which UPSERTS FoodMapping rows — i.e. it warms/overwrites the shared cache;
 *   - upserts FdcServing rows (:1830) and can create AiGeneratedFood rows;
 *   - writes MappingEventLog rows (the funnel), so it pollutes the very telemetry
 *     a later `--from-db` read screens;
 *   - makes PAID LLM calls: AI normalize/segment, rerank, AI validation and
 *     serving estimation (OpenRouter gpt-4o-mini per the routing memory).
 *
 * Consequence for F3: `triage-drops.ts` NEVER runs this by default. It is exposed
 * so that a human, or a deliberate `--allow-write-probes` run against a scratch
 * DATABASE_URL, can use it — and so the write surface is documented in git rather
 * than in an uncommitted scratch file.
 *
 * Usage (unchanged):
 *   ts-node ... scripts/full-pipeline-probe.ts '<query>' ...
 *   ts-node ... scripts/full-pipeline-probe.ts --file <queries.txt>
 *   PROBE_DEBUG=1 ... (verbose mapper logging)
 */
import * as nodeFs from 'fs';
import { mapIngredientWithFallback } from '../src/lib/mapping/map-ingredient-with-fallback';

export interface FullPipelineProbe {
    query: string;
    error?: string;
    status?: string;
    source?: string;
    foodName?: string;
    brandName?: string | null;
    confidence?: number;
    grams?: number;
    aiValidation?: unknown;
    reason?: string;
    per100g?: unknown;
    /** MappingTelemetry as the mapper filled it — normalizedForm, gate decisions, funnelStage. */
    telemetry: Record<string, unknown>;
}

export interface FullPipelineProbeOptions {
    debug?: boolean;
    /**
     * Explicit acknowledgement that this call WRITES to the database and spends
     * LLM tokens. Omit it and the call throws instead of silently mutating.
     */
    iUnderstandThisWrites: boolean;
}

export async function probeFullPipeline(
    query: string,
    opts: FullPipelineProbeOptions,
): Promise<FullPipelineProbe> {
    if (!opts?.iUnderstandThisWrites) {
        throw new Error(
            'probeFullPipeline WRITES FoodMapping/MappingEventLog and spends LLM tokens; '
            + 'pass { iUnderstandThisWrites: true } to proceed.',
        );
    }
    const telemetry: Record<string, unknown> = {};
    const summary: FullPipelineProbe = { query, telemetry };
    let result: unknown;
    try {
        result = await mapIngredientWithFallback(query, {
            allowLiveFallback: true,
            skipOnLock: true,
            debug: opts.debug ?? process.env.PROBE_DEBUG === '1',
            telemetry: telemetry as never,
        } as never);
    } catch (e) {
        summary.error = (e as Error)?.message ?? String(e);
        return summary;
    }

    if (result === null) {
        summary.status = 'no_match(null)';
    } else if (result && typeof result === 'object') {
        const r = result as Record<string, unknown> & { aiValidation?: { reason?: string } };
        summary.status = (r.status as string) ?? 'mapped';
        summary.source = r.source as string;
        summary.foodName = r.foodName as string;
        summary.brandName = r.brandName as string | null;
        summary.confidence = r.confidence as number;
        summary.grams = r.grams as number;
        summary.aiValidation = r.aiValidation;
        summary.reason = (r.reason as string) ?? r.aiValidation?.reason;
        summary.per100g = r.nutritionPer100g ?? r.per100g
            ?? (r.nutrition as { per100g?: unknown } | undefined)?.per100g ?? null;
    }
    return summary;
}

function readQueriesFromArgv(argv: string[]): string[] {
    const fileIdx = argv.indexOf('--file');
    if (fileIdx >= 0) {
        return nodeFs.readFileSync(argv[fileIdx + 1], 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    }
    return argv.filter(a => !a.startsWith('--'));
}

async function main(): Promise<void> {
    for (const query of readQueriesFromArgv(process.argv.slice(2))) {
        const summary = await probeFullPipeline(query, { iUnderstandThisWrites: true });
        console.log('PROBE ' + JSON.stringify(summary));
    }
    process.exit(0);
}

if (require.main === module) {
    main().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

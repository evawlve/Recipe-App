#!/usr/bin/env ts-node
/**
 * warm-names.ts — Warm the FoodMapping cache from a flat list of query strings.
 *
 * Unlike pilot-batch-import (recipe-ingredient driven) this takes an arbitrary
 * seed list — e.g. the output of the fs-strong seed-gen grow workflow — and runs
 * each query through the SAME gated save path (mapIngredientWithFallback →
 * saveValidatedMapping: deterministic gates + gpt-4o-mini AI-validation). No new
 * trust surface; it just feeds names in.
 *
 * ===========================================================================
 * !! WRITER. NOT A PROBE. Every query mutates the shared cache and costs LLM  !!
 * ===========================================================================
 * It exists in F3's file set because it is the tool that PRODUCES the warm JSONL
 * that `triage-drops.ts --in` reads. The driver never calls it; a human runs it,
 * then points the driver at its `--out` file.
 *
 * Usage (unchanged):
 *   ts-node scripts/warm-names.ts --file data/seeds/fs-strong.json \
 *       [--out logs/warm-fs-strong.jsonl] [--concurrency 4] [--limit N]
 *
 * Input file: JSON array of strings, or { "queries": [...] }.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { mapIngredientWithFallback } from '../src/lib/mapping/map-ingredient-with-fallback';
import { refreshNormalizationRules } from '../src/lib/mapping/normalization-rules';

export type WarmResult = {
    query: string;
    status: 'mapped' | 'pending' | 'no_match' | 'rejected' | 'error' | 'skipped';
    source?: string;
    foodName?: string;
    brandName?: string | null;
    confidence?: number;
    normalizedForm?: string;
    approved?: boolean;
    reason?: string;
    error?: string;
    /** Funnel stage the mapper recorded, when telemetry carried one (F1, PR #139). */
    funnelStage?: string;
    dropReason?: string;
};

export type WarmStats = Record<'mapped' | 'pending' | 'no_match' | 'rejected' | 'error' | 'skipped', number>;

// Backstop against generic-key-takeover: seed-gen is instructed to emit specific
// branded queries, but reject bare category words if any slip through so they
// can't clobber a generic cache key. (See flywheel memory: 'met rx big 100' →
// key 'protein bar' takeover class.)
const BARE_CATEGORY_BLOCKLIST = new Set([
    'protein bar', 'protein bars', 'protein shake', 'protein powder', 'protein drink',
    'energy drink', 'energy bar', 'granola bar', 'candy bar', 'cereal', 'chips',
    'crackers', 'cookies', 'soda', 'yogurt', 'ice cream', 'pizza', 'burger',
    'sandwich', 'salad', 'smoothie', 'coffee', 'tea', 'water', 'juice', 'snack',
    'supplement', 'pre workout', 'preworkout', 'creatine', 'bcaa',
]);

export function isTooGeneric(q: string): boolean {
    const norm = q.toLowerCase().trim().replace(/\s+/g, ' ');
    if (BARE_CATEGORY_BLOCKLIST.has(norm)) return true;
    // single-token generic (no brand/specificity) — one word only
    if (!norm.includes(' ') && norm.length <= 12) return true;
    return false;
}

/** Load + de-dupe a seed list from a JSON array or { queries: [...] } file. */
export function readSeedFile(file: string, limit?: number): string[] {
    const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    let queries: string[] = Array.isArray(raw) ? raw : raw.queries;
    queries = queries.map(q => String(q).trim()).filter(Boolean);
    const seen = new Set<string>();
    queries = queries.filter(q => {
        const k = q.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    return limit ? queries.slice(0, limit) : queries;
}

export interface WarmNamesOptions {
    /** Seed list. Either `queries` directly or `file` to read one. */
    queries?: string[];
    file?: string;
    /** JSONL sink, appended. This is the file `triage-drops.ts --in` consumes. */
    out?: string;
    concurrency?: number;
    limit?: number;
    /** Progress callback; the CLI prints a line every 25 completions. */
    onProgress?: (done: number, total: number, stats: WarmStats) => void;
}

/**
 * Warm every query through the gated save path. WRITES. Returns the per-query
 * results alongside the stats histogram.
 */
export async function warmNames(opts: WarmNamesOptions): Promise<{ results: WarmResult[]; stats: WarmStats }> {
    let queries = opts.queries ? [...opts.queries] : opts.file ? readSeedFile(opts.file) : [];
    if (!opts.file && opts.queries) {
        const seen = new Set<string>();
        queries = queries.map(q => String(q).trim()).filter(Boolean).filter(q => {
            const k = q.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }
    if (opts.limit) queries = queries.slice(0, opts.limit);

    await refreshNormalizationRules();

    const outStream = opts.out ? fs.createWriteStream(path.resolve(opts.out), { flags: 'a' }) : null;
    const results: WarmResult[] = [];
    const record = (r: WarmResult) => {
        results.push(r);
        outStream?.write(JSON.stringify(r) + '\n');
    };

    const stats: WarmStats = { mapped: 0, pending: 0, no_match: 0, rejected: 0, error: 0, skipped: 0 };
    let done = 0;

    async function warmOne(query: string): Promise<void> {
        if (isTooGeneric(query)) {
            stats.skipped++;
            record({ query, status: 'skipped', reason: 'too_generic' });
            return;
        }
        const telemetry: Record<string, unknown> = {};
        try {
            const result = await mapIngredientWithFallback(query, {
                allowLiveFallback: true,
                skipOnLock: true,
                telemetry: telemetry as never,
            });
            const funnel = {
                funnelStage: telemetry.funnelStage as string | undefined,
                dropReason: telemetry.dropReason as string | undefined,
            };
            if (result === null) {
                stats.no_match++;
                record({ query, status: 'no_match', normalizedForm: telemetry.normalizedForm as string, ...funnel });
                return;
            }
            if ('status' in result && (result as { status?: string }).status === 'pending') {
                stats.pending++;
                record({ query, status: 'pending', ...funnel });
                return;
            }
            const r = result as {
                source: string; foodName: string; brandName?: string | null;
                confidence: number; aiValidation?: { approved: boolean; reason: string };
            };
            const approved = r.aiValidation?.approved ?? true;
            stats.mapped++;
            record({
                query,
                status: approved ? 'mapped' : 'rejected',
                source: r.source,
                foodName: r.foodName,
                brandName: r.brandName,
                confidence: r.confidence,
                normalizedForm: telemetry.normalizedForm as string,
                approved,
                reason: r.aiValidation?.reason,
                ...funnel,
            });
        } catch (e) {
            stats.error++;
            record({ query, status: 'error', error: (e as Error).message });
        } finally {
            done++;
            opts.onProgress?.(done, queries.length, stats);
        }
    }

    // simple fixed-size worker pool
    let idx = 0;
    const workers = Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, async () => {
        while (idx < queries.length) {
            const my = idx++;
            await warmOne(queries[my]);
            await new Promise(res => setTimeout(res, 80)); // gentle rate limit
        }
    });
    await Promise.all(workers);

    await new Promise<void>(res => {
        if (!outStream) return res();
        outStream.end(() => res());
    });
    return { results, stats };
}

function parseArgs() {
    const args = process.argv.slice(2);
    const get = (flag: string, dflt?: string) => {
        const i = args.indexOf(flag);
        return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
    };
    return {
        file: get('--file'),
        out: get('--out'),
        concurrency: parseInt(get('--concurrency', '4')!, 10),
        limit: get('--limit') ? parseInt(get('--limit')!, 10) : undefined,
    };
}

async function main(): Promise<void> {
    const { file, out, concurrency, limit } = parseArgs();
    if (!file) {
        console.error('ERROR: --file <path> is required');
        process.exit(1);
    }
    const seeds = readSeedFile(file, limit);
    console.log(`🌱 warm-names: ${seeds.length} unique queries, concurrency=${concurrency}`);
    const { stats } = await warmNames({
        queries: seeds,
        out,
        concurrency,
        onProgress: (done, total, s) => {
            if (done % 25 === 0 || done === total) {
                console.log(`  [${done}/${total}] mapped=${s.mapped} skip=${s.skipped} `
                    + `nomatch=${s.no_match} err=${s.error}`);
            }
        },
    });
    console.log('\n📈 warm-names done:', JSON.stringify(stats));
    process.exit(0);
}

if (require.main === module) {
    main().catch(e => {
        console.error('warm-names fatal:', e);
        process.exit(1);
    });
}

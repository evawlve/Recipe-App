/**
 * seg-replay-diff.ts — drift defense for the SegmentationCache.
 *
 * A cached segmentation is served verbatim forever (within SEG_PARSER_VERSION
 * and the 30d TTL), so silent drift between cached splits and what the LLM
 * would say TODAY is invisible in production. This script takes the top-N
 * cached lines by hitCount (the rows doing the most serving), re-runs AI
 * segmentation for each while BYPASSING the cache (direct segmentTextWithAi
 * call — no route, no lookup, no write-back), and diffs the outputs on item
 * count + normalized item names (src/lib/nlp/segmentation-diff.ts; multiset
 * compare, order-insensitive).
 *
 * Statuses per line:
 *   - match:    fresh split agrees with the cached one
 *   - drift:    count or name multiset changed — model/prompt behavior moved;
 *               investigate, and if real, bump SEG_PARSER_VERSION
 *   - ai_error: the fresh LLM call failed/timed out — NOT drift, retry later
 *
 * The script never mutates SegmentationCache. It is read-only on the DB and
 * paid on the LLM (~$0.0003/line) — keep --top modest.
 *
 * Wiring into the nightly flywheel sweep (scripts/eval/flywheel-sweep.ts) is a
 * follow-up PR; runReplayDiff() is importable and pure of CLI state for that.
 *
 * Run (from repo root; needs DATABASE_URL + OPENROUTER_API_KEY):
 *   npm run seg:replay-diff -- [--top 50] [--out <file>]
 * or:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/seg-replay-diff.ts --top 50
 *
 * Writes scripts/eval/results/seg-replay-diff-<timestamp>.json:
 *   { generatedAt, parserVersion, topN, replayed, matches, drifts, aiErrors,
 *     driftRate, entries: [{ lineKey, hitCount, status, cachedCount,
 *     freshCount, onlyCached, onlyFresh, cachedNames, freshNames }] }
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
    SEG_PARSER_VERSION,
    SegmentedItem,
    isSegmentedItemArray,
    segmentTextWithAi,
} from '../src/lib/nlp/ai-segmenter';
import { diffSegments, segmentNames } from '../src/lib/nlp/segmentation-diff';

export interface ReplayDiffEntry {
    lineKey: string;
    hitCount: number;
    status: 'match' | 'drift' | 'ai_error';
    cachedCount: number;
    freshCount: number | null;
    onlyCached: string[];
    onlyFresh: string[];
    cachedNames: string[];
    freshNames: string[] | null;
}

export interface ReplayDiffReport {
    generatedAt: string;
    parserVersion: string;
    topN: number;
    replayed: number;
    skippedMalformed: number;
    matches: number;
    drifts: number;
    aiErrors: number;
    /** drifts / (matches + drifts) — ai_error rows are excluded. */
    driftRate: number;
    entries: ReplayDiffEntry[];
}

/**
 * Replay the top-N cached lines through fresh AI segmentation and diff.
 * Sequential on purpose: N is small (nightly top-50) and the 'parse' purpose
 * shares a concurrency semaphore with live traffic.
 */
export async function runReplayDiff(prisma: PrismaClient, topN: number): Promise<ReplayDiffReport> {
    const rows = await prisma.segmentationCache.findMany({
        where: { parserVersion: SEG_PARSER_VERSION },
        orderBy: { hitCount: 'desc' },
        take: topN,
    });
    console.log(`[seg-replay] ${rows.length} cached lines (parserVersion=${SEG_PARSER_VERSION}, top ${topN} by hitCount)`);

    const entries: ReplayDiffEntry[] = [];
    let skippedMalformed = 0;

    for (const [i, row] of rows.entries()) {
        const cached: unknown = row.segmentsJson;
        if (!isSegmentedItemArray(cached)) {
            // Route-side validation already treats these as misses; just report.
            console.warn(`[seg-replay] malformed segmentsJson for "${row.lineKey}" — skipping`);
            skippedMalformed += 1;
            continue;
        }

        const fresh = await segmentTextWithAi(row.lineKey);
        if (fresh === null) {
            entries.push({
                lineKey: row.lineKey,
                hitCount: row.hitCount,
                status: 'ai_error',
                cachedCount: cached.length,
                freshCount: null,
                onlyCached: [],
                onlyFresh: [],
                cachedNames: segmentNames(cached),
                freshNames: null,
            });
        } else {
            const diff = diffSegments(cached, fresh as SegmentedItem[]);
            entries.push({
                lineKey: row.lineKey,
                hitCount: row.hitCount,
                status: diff.same ? 'match' : 'drift',
                cachedCount: diff.cachedCount,
                freshCount: diff.freshCount,
                onlyCached: diff.onlyCached,
                onlyFresh: diff.onlyFresh,
                cachedNames: segmentNames(cached),
                freshNames: segmentNames(fresh as SegmentedItem[]),
            });
        }
        if ((i + 1) % 10 === 0) console.log(`[seg-replay]   ${i + 1}/${rows.length}`);
    }

    const matches = entries.filter((e) => e.status === 'match').length;
    const drifts = entries.filter((e) => e.status === 'drift').length;
    const aiErrors = entries.filter((e) => e.status === 'ai_error').length;
    const compared = matches + drifts;

    return {
        generatedAt: new Date().toISOString(),
        parserVersion: SEG_PARSER_VERSION,
        topN,
        replayed: entries.length,
        skippedMalformed,
        matches,
        drifts,
        aiErrors,
        driftRate: compared > 0 ? Number((drifts / compared).toFixed(4)) : 0,
        entries,
    };
}

function argValue(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const topN = Number.parseInt(argValue(args, '--top') ?? '50', 10);
    if (!Number.isFinite(topN) || topN <= 0) {
        console.error('--top must be a positive integer');
        process.exit(2);
    }

    const prisma = new PrismaClient();
    try {
        const report = await runReplayDiff(prisma, topN);

        const outDir = path.join(__dirname, 'eval', 'results');
        fs.mkdirSync(outDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const outPath = argValue(args, '--out') ?? path.join(outDir, `seg-replay-diff-${ts}.json`);
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

        console.log(`[seg-replay] replayed ${report.replayed}: ${report.matches} match / ${report.drifts} drift / ${report.aiErrors} ai_error (driftRate ${(report.driftRate * 100).toFixed(1)}%)`);
        for (const e of report.entries.filter((x) => x.status === 'drift')) {
            console.log(`[seg-replay]   DRIFT "${e.lineKey}" (hits ${e.hitCount}): ${e.cachedCount}→${e.freshCount} items; -[${e.onlyCached.join(', ')}] +[${e.onlyFresh.join(', ')}]`);
        }
        console.log(`[seg-replay] report: ${outPath}`);
        if (report.drifts > 0) {
            console.log('[seg-replay] drift detected — review; if the new splits are correct/intended, bump SEG_PARSER_VERSION');
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error('[seg-replay] fatal:', err);
        process.exit(1);
    });
}

/**
 * seg-replay-diff.ts — standalone CLI for the SegmentationCache drift defense.
 *
 * Thin wrapper over src/lib/ops/seg-replay.ts (collectSegReplay + trend +
 * markdown section) — the SAME logic the nightly flywheel sweep runs as its
 * report-only "seg replay-diff" step (scripts/eval/flywheel-sweep.ts, step 4b;
 * `npm run flywheel:sweep -- --seg-replay-only` is the sweep-flavored twin of
 * this script). See the lib header for semantics: top-N cached lines by
 * hitCount, fresh AI segmentation with the cache BYPASSED (no read, no write —
 * the replay never overwrites the cached split), diff on item count +
 * normalized names (match / drift / ai_error).
 *
 * Read-only on the DB, paid on the LLM (~$0.0003/line) — keep --top modest.
 * On drift: investigate; if the fresh splits are correct/intended, bump
 * SEG_PARSER_VERSION (src/lib/nlp/ai-segmenter.ts).
 *
 * Run (from repo root; .env supplies DATABASE_URL + OPENROUTER_API_KEY):
 *   npm run seg:replay-diff -- [--top 50] [--out <file>]
 * or:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/seg-replay-diff.ts --top 50
 *
 * Writes scripts/eval/results/seg-replay-<timestamp>.json (same artifact
 * family the sweep writes and trends against):
 *   { ranAt, parserVersion, topN, cachedLines, replayed, skippedMalformed,
 *     matches, drifts, aiErrors, driftRate, entries, trend }
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { segmentTextWithAi } from '../src/lib/nlp/ai-segmenter';
import {
    collectSegReplay,
    computeSegReplayTrend,
    findPreviousSegReplayReport,
    formatSegReplaySection,
} from '../src/lib/ops/seg-replay';

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
    let report;
    try {
        report = await collectSegReplay(prisma, segmentTextWithAi, { topN });
    } finally {
        await prisma.$disconnect();
    }
    if (!report.ok) {
        console.error(`[seg-replay] failed: ${report.error}`);
        process.exit(1);
    }

    const outDir = path.join(__dirname, 'eval', 'results');
    // Locate the previous artifact BEFORE writing this run's file (trend input).
    const prev = findPreviousSegReplayReport(outDir);
    const trend = computeSegReplayTrend(report.drifts, prev);

    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = argValue(args, '--out') ?? path.join(outDir, `seg-replay-${ts}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), ...report, trend }, null, 1));

    console.log(formatSegReplaySection(report, trend).join('\n'));
    console.log(`\n[seg-replay] report: ${outPath}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('[seg-replay] fatal:', err);
        process.exit(1);
    });
}

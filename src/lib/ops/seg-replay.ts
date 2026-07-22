/**
 * seg-replay.ts — segmentation replay-diff drift check for the nightly
 * flywheel sweep (scripts/eval/flywheel-sweep.ts) and the standalone
 * scripts/seg-replay-diff.ts wrapper.
 *
 * A cached segmentation (SegmentationCache) is served verbatim forever within
 * SEG_PARSER_VERSION and the 30d TTL, so drift between cached splits and what
 * the LLM would say TODAY is invisible in production. This module takes the
 * top-N cached lines by hitCount (the rows doing the most serving), re-runs AI
 * segmentation for each with the cache BYPASSED (direct segmenter call — no
 * cache read, and never a cache write: the replay must not overwrite the
 * cached split), and diffs the outputs on item count + normalized item names
 * (src/lib/nlp/segmentation-diff.ts; multiset compare, order-insensitive).
 *
 * Statuses per line:
 *   - match:    fresh split agrees with the cached one
 *   - drift:    count or name multiset changed — model/prompt behavior moved;
 *               investigate, and if the fresh splits are correct/intended,
 *               bump SEG_PARSER_VERSION
 *   - ai_error: the fresh LLM call failed/threw/timed out — NOT drift
 *
 * REPORT-ONLY + fail-soft by contract: collectSegReplay never throws (a DB
 * failure comes back as an ok:false report the sweep can render), and nothing
 * here may influence the sweep's gating or exit code. Read-only on the DB,
 * paid on the LLM (~$0.0003/line) — keep topN modest (nightly default 20).
 *
 * Lives in src/lib (not scripts/) so the logic is jest-coverable — the jest
 * projects only match tests under src/**. Structural model: stuck-keys.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SEG_PARSER_VERSION, SegmentedItem, isSegmentedItemArray } from '../nlp/ai-segmenter';
import { diffSegments, segmentNames } from '../nlp/segmentation-diff';

/** Nightly default: ~20 LLM calls/night is the accepted budget. */
export const SEG_REPLAY_DEFAULT_TOP_N = 20;

/**
 * Structural slice of PrismaClient we need — read-only by construction (the
 * interface exposes no write method), which is the module-level enforcement of
 * the "replay never overwrites the cached split" guarantee.
 */
export interface SegCacheReadClient {
    segmentationCache: {
        findMany(args: {
            where: { parserVersion: string };
            orderBy: { hitCount: 'desc' };
            take: number;
            select: { lineKey: true; hitCount: true; segmentsJson: true };
        }): Promise<{ lineKey: string; hitCount: number; segmentsJson: unknown }[]>;
    };
}

/** Fresh-segmentation function: SegmentedItem[] on success, null on LLM failure (ai-segmenter contract). */
export type SegmentFn = (text: string) => Promise<SegmentedItem[] | null>;

export type SegReplayStatus = 'match' | 'drift' | 'ai_error';

export interface SegReplayEntry {
    lineKey: string;
    hitCount: number;
    status: SegReplayStatus;
    cachedCount: number;
    freshCount: number | null;
    /** Names in the cached split but missing from the fresh one (drift only). */
    onlyCached: string[];
    /** Names in the fresh split but missing from the cached one (drift only). */
    onlyFresh: string[];
    cachedNames: string[];
    freshNames: string[] | null;
    /** Set only when the segmenter THREW (vs returning null) — always status ai_error. */
    error?: string;
}

export interface SegReplayReport {
    ok: boolean;
    error?: string;
    parserVersion: string;
    topN: number;
    /** Rows fetched from SegmentationCache (0 is a valid, clean result). */
    cachedLines: number;
    replayed: number;
    skippedMalformed: number;
    matches: number;
    drifts: number;
    aiErrors: number;
    /** drifts / (matches + drifts) — ai_error rows are excluded. */
    driftRate: number;
    entries: SegReplayEntry[];
}

export interface SegReplayTrend {
    /** Basename of the previous seg-replay-*.json compared against; null = first run. */
    previous: string | null;
    previousDrifts: number | null;
    /** current drifts − previous drifts; null on first run. */
    delta: number | null;
}

/** ok:false report shell — used internally and by callers wrapping unexpected step failures. */
export function failedSegReplayReport(topN: number, error: string): SegReplayReport {
    return {
        ok: false, error, parserVersion: SEG_PARSER_VERSION, topN,
        cachedLines: 0, replayed: 0, skippedMalformed: 0,
        matches: 0, drifts: 0, aiErrors: 0, driftRate: 0, entries: [],
    };
}

/**
 * Replay the top-N cached lines through fresh AI segmentation and diff.
 * Sequential on purpose: N is small and the 'parse' purpose shares a
 * concurrency semaphore with live traffic. Never throws: a DB failure returns
 * ok:false; a per-line segmenter throw becomes that line's ai_error entry and
 * the remaining lines still run.
 */
export async function collectSegReplay(
    db: SegCacheReadClient,
    segment: SegmentFn,
    opts?: { topN?: number },
): Promise<SegReplayReport> {
    const topN = opts?.topN ?? SEG_REPLAY_DEFAULT_TOP_N;

    let rows: { lineKey: string; hitCount: number; segmentsJson: unknown }[];
    try {
        rows = await db.segmentationCache.findMany({
            where: { parserVersion: SEG_PARSER_VERSION },
            orderBy: { hitCount: 'desc' },
            take: topN,
            select: { lineKey: true, hitCount: true, segmentsJson: true },
        });
    } catch (err) {
        return failedSegReplayReport(topN, (err as Error).message);
    }

    const entries: SegReplayEntry[] = [];
    let skippedMalformed = 0;

    for (const row of rows) {
        const cached: unknown = row.segmentsJson;
        if (!isSegmentedItemArray(cached)) {
            // Route-side validation already treats these as misses; just count them.
            skippedMalformed += 1;
            continue;
        }

        let fresh: SegmentedItem[] | null = null;
        let thrown: string | undefined;
        try {
            fresh = await segment(row.lineKey);
        } catch (err) {
            thrown = (err as Error).message;
        }

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
                ...(thrown !== undefined ? { error: thrown } : {}),
            });
        } else {
            const diff = diffSegments(cached, fresh);
            entries.push({
                lineKey: row.lineKey,
                hitCount: row.hitCount,
                status: diff.same ? 'match' : 'drift',
                cachedCount: diff.cachedCount,
                freshCount: diff.freshCount,
                onlyCached: diff.onlyCached,
                onlyFresh: diff.onlyFresh,
                cachedNames: segmentNames(cached),
                freshNames: segmentNames(fresh),
            });
        }
    }

    const matches = entries.filter((e) => e.status === 'match').length;
    const drifts = entries.filter((e) => e.status === 'drift').length;
    const aiErrors = entries.filter((e) => e.status === 'ai_error').length;
    const compared = matches + drifts;

    return {
        ok: true,
        parserVersion: SEG_PARSER_VERSION,
        topN,
        cachedLines: rows.length,
        replayed: entries.length,
        skippedMalformed,
        matches,
        drifts,
        aiErrors,
        driftRate: compared > 0 ? Number((drifts / compared).toFixed(4)) : 0,
        entries,
    };
}

/**
 * Most recent previous seg-replay-*.json in resultsDir (by mtime), skipping
 * excludePath and unparseable files. Returns its drift count for the trend
 * line, or null when this is the first run. Same pattern as
 * findPreviousStuckReport (stuck-keys.ts).
 */
export function findPreviousSegReplayReport(
    resultsDir: string,
    excludePath?: string,
): { path: string; drifts: number } | null {
    if (!fs.existsSync(resultsDir)) return null;
    const files = fs.readdirSync(resultsDir)
        .filter(f => f.startsWith('seg-replay-') && f.endsWith('.json'))
        .map(f => path.join(resultsDir, f))
        .filter(f => f !== excludePath)
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            const drifts = typeof data?.drifts === 'number' ? data.drifts
                : Array.isArray(data?.entries)
                    ? data.entries.filter((e: { status?: string }) => e?.status === 'drift').length
                    : null;
            if (drifts !== null) return { path: file, drifts };
        } catch {
            // unparseable previous report — skip it, keep looking
        }
    }
    return null;
}

export function computeSegReplayTrend(
    currentDrifts: number,
    prev: { path: string; drifts: number } | null,
): SegReplayTrend {
    if (!prev) return { previous: null, previousDrifts: null, delta: null };
    return {
        previous: path.basename(prev.path),
        previousDrifts: prev.drifts,
        delta: currentDrifts - prev.drifts,
    };
}

// ---------------------------------------------------------------------------
// Markdown formatting (mirrors stuck-keys.ts / flywheel-sweep conventions)
// ---------------------------------------------------------------------------

/** Markdown-table cell safety: collapse newlines, escape pipes. */
function cell(s: string): string {
    return s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
}

function mdTable(rows: string[][], header: string[]): string {
    if (rows.length === 0) return '_none_';
    return [
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...rows.map(r => `| ${r.join(' | ')} |`),
    ].join('\n');
}

function fmtDelta(delta: number): string {
    if (delta > 0) return `+${delta}`;
    if (delta < 0) return `${delta}`;
    return '±0';
}

/**
 * The "## Seg replay-diff (report-only)" section, as markdown lines ready for
 * flywheel-sweep's buildMarkdown (or console output).
 */
export function formatSegReplaySection(
    report: SegReplayReport,
    trend: SegReplayTrend,
    maxRows = 20,
): string[] {
    const lines: string[] = [];
    lines.push('## Seg replay-diff (report-only)');
    if (!report.ok) {
        lines.push(`⚠️ _unavailable: ${report.error ?? 'unknown'}_ — report-only, never affects the sweep's gating or exit code.`);
        return lines;
    }

    lines.push(`Top ${report.topN} cached segmentations (parserVersion \`${report.parserVersion}\`, by hitCount) `
        + 're-run through a fresh AI split with the cache bypassed — no cache read, no cache write. '
        + 'Report-only: drift here never fails the sweep.');

    const trendLine = trend.previous === null
        ? 'Trend: first run (no previous seg-replay report).'
        : `Trend: drifts ${trend.previousDrifts} → ${report.drifts} (${fmtDelta(trend.delta ?? 0)}) vs \`${trend.previous}\`.`;

    if (report.cachedLines === 0) {
        lines.push('No cached lines to replay yet (SegmentationCache is empty for this parser version) — clean zero.');
        lines.push(trendLine);
        return lines;
    }

    const malformedNote = report.skippedMalformed > 0
        ? ` · ${report.skippedMalformed} malformed cached row(s) skipped`
        : '';
    lines.push(`${report.replayed} lines checked · ${report.matches} match · ${report.drifts} drift · `
        + `${report.aiErrors} ai_error · drift rate ${(report.driftRate * 100).toFixed(1)}%${malformedNote}`);
    lines.push(trendLine);

    const driftEntries = report.entries.filter(e => e.status === 'drift');
    if (driftEntries.length > 0) {
        const shown = driftEntries.slice(0, maxRows);
        lines.push('');
        lines.push(`### Drifts (${shown.length} of ${driftEntries.length} shown, by hitCount)`);
        lines.push(mdTable(shown.map(e => [
            cell(e.lineKey),
            String(e.hitCount),
            `${e.cachedCount} → ${e.freshCount ?? '?'}`,
            cell(e.cachedNames.join(', ')),
            cell((e.freshNames ?? []).join(', ')),
        ]), ['line', 'hits', 'items (cached → fresh)', 'cached names', 'fresh names']));
        lines.push('');
        lines.push('Drift = the model would split these lines differently today. Investigate; '
            + 'if the fresh splits are correct/intended, bump SEG_PARSER_VERSION.');
    }

    const errorEntries = report.entries.filter(e => e.status === 'ai_error');
    if (errorEntries.length > 0) {
        lines.push('');
        lines.push(`AI errors (fresh split failed — not drift, retry next sweep): `
            + errorEntries.slice(0, maxRows).map(e => `"${e.lineKey}"`).join(', '));
    }
    return lines;
}

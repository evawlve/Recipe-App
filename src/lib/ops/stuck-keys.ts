/**
 * stuck-keys.ts — "stuck key" detection + report formatting for the nightly
 * flywheel sweep (scripts/eval/flywheel-sweep.ts).
 *
 * The FoodMapping cache only saves results with confidence >= 0.85 (the
 * cache-save gate in map-ingredient-with-fallback.ts). Sub-gate results are
 * served to users but never cached and never reviewed — those keys re-run the
 * full mapping pipeline on every request, forever, invisibly. This module
 * makes that population visible so triage batches can clear it.
 *
 * A key (normalizedForm) is STUCK when, over the telemetry window:
 *   - events with noCache = true are excluded (eval cold-run traffic), and
 *   - events with cacheEscape set are excluded (escapes are deliberate), and
 *   - NO remaining event has cacheHit set (all-miss, computed per key), and
 *   - MAX(confidence) < 0.85 (a key with only NULL confidence is stuck too —
 *     it certainly never passed the save gate), and
 *   - the key was demanded at least twice.
 *
 * Lives in src/lib (not scripts/) so the aggregation/formatting logic is
 * jest-coverable — the jest projects only match tests under src/**.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Mirrors the FoodMapping cache-save gate (map-ingredient-with-fallback.ts, `confidence >= 0.85`). */
export const STUCK_KEY_CONFIDENCE_GATE = 0.85;

/** Minimum events in the window for a key to count as stuck (1-offs are noise). */
export const STUCK_KEY_MIN_EVENTS = 2;

/** Safety cap on rows returned (the sub-gate population is small; this only guards runaway telemetry). */
export const STUCK_KEY_ROW_LIMIT = 500;

/** Distinct resolved records reported per key, by frequency. */
export const STUCK_KEY_FOODS_PER_KEY = 3;

/** Structural slice of PrismaClient we need — keeps the module trivially mockable. */
export interface RawQueryClient {
    $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface StuckKeyFood {
    foodId: string;
    foodName: string | null;
    n: number;
}

export interface StuckKeyRow {
    key: string;
    events: number;
    maxConfidence: number | null;
    avgLatencyMs: number | null;
    sampleRawLine: string | null;
    foods: StuckKeyFood[];
}

export interface StuckKeysReport {
    ok: boolean;
    error?: string;
    windowDays: number;
    confidenceGate: number;
    count: number;
    rows: StuckKeyRow[];
}

export interface StuckTrend {
    /** Basename of the previous stuck-keys-*.json compared against; null = first run. */
    previous: string | null;
    previousCount: number | null;
    /** current count − previous count; null on first run. */
    delta: number | null;
}

/**
 * Single-query aggregation over MappingEventLog. Never throws — a failure (or
 * zero rows) comes back as a report the sweep can render without dying,
 * mirroring collectTelemetry() in flywheel-sweep.ts.
 */
export async function collectStuckKeys(
    db: RawQueryClient,
    opts: { since: Date; windowDays: number; limit?: number },
): Promise<StuckKeysReport> {
    const limit = opts.limit ?? STUCK_KEY_ROW_LIMIT;
    const base: StuckKeysReport = {
        ok: false, windowDays: opts.windowDays,
        confidenceGate: STUCK_KEY_CONFIDENCE_GATE, count: 0, rows: [],
    };
    try {
        const rows = await db.$queryRaw<StuckKeyRow[]>`
            WITH sub_gate_events AS (
                SELECT "normalizedForm", "rawLine", "cacheHit", "confidence", "latencyMs", "foodId", "foodName"
                FROM "MappingEventLog"
                WHERE "createdAt" >= ${opts.since}
                  AND "noCache" = false
                  AND "cacheEscape" IS NULL
                  AND "normalizedForm" IS NOT NULL
            ),
            stuck AS (
                SELECT "normalizedForm" AS key,
                       count(*)::int AS events,
                       max("confidence")::float AS "maxConfidence",
                       avg("latencyMs")::float AS "avgLatencyMs",
                       min("rawLine") AS "sampleRawLine"
                FROM sub_gate_events
                GROUP BY 1
                HAVING count(*) FILTER (WHERE "cacheHit" IS NOT NULL) = 0
                   AND count(*) >= ${STUCK_KEY_MIN_EVENTS}
                   AND coalesce(max("confidence"), 0) < ${STUCK_KEY_CONFIDENCE_GATE}
            )
            SELECT s.key, s.events, s."maxConfidence", s."avgLatencyMs", s."sampleRawLine",
                   coalesce(f.foods, '[]'::jsonb) AS foods
            FROM stuck s
            LEFT JOIN LATERAL (
                SELECT jsonb_agg(jsonb_build_object('foodId', t."foodId", 'foodName', t."foodName", 'n', t.n)
                                 ORDER BY t.n DESC) AS foods
                FROM (
                    SELECT e."foodId", min(e."foodName") AS "foodName", count(*)::int AS n
                    FROM sub_gate_events e
                    WHERE e."normalizedForm" = s.key AND e."foodId" IS NOT NULL
                    GROUP BY e."foodId"
                    ORDER BY n DESC
                    LIMIT ${STUCK_KEY_FOODS_PER_KEY}
                ) t
            ) f ON true
            ORDER BY s.events DESC, s.key ASC
            LIMIT ${limit}`;
        return { ...base, ok: true, count: rows.length, rows };
    } catch (err) {
        return { ...base, error: (err as Error).message };
    }
}

/**
 * Most recent previous stuck-keys-*.json in resultsDir (by mtime), skipping
 * excludePath and unparseable files. Returns its stuck-key count for the trend
 * line, or null when this is the first run.
 */
export function findPreviousStuckReport(
    resultsDir: string,
    excludePath?: string,
): { path: string; count: number } | null {
    if (!fs.existsSync(resultsDir)) return null;
    const files = fs.readdirSync(resultsDir)
        .filter(f => f.startsWith('stuck-keys-') && f.endsWith('.json'))
        .map(f => path.join(resultsDir, f))
        .filter(f => f !== excludePath)
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            const count = typeof data?.count === 'number' ? data.count
                : Array.isArray(data?.rows) ? data.rows.length : null;
            if (count !== null) return { path: file, count };
        } catch {
            // unparseable previous report — skip it, keep looking
        }
    }
    return null;
}

export function computeStuckTrend(
    currentCount: number,
    prev: { path: string; count: number } | null,
): StuckTrend {
    if (!prev) return { previous: null, previousCount: null, delta: null };
    return { previous: path.basename(prev.path), previousCount: prev.count, delta: currentCount - prev.count };
}

// ---------------------------------------------------------------------------
// Markdown formatting (mirrors flywheel-sweep's fmtTable conventions)
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

function fmtFoods(foods: StuckKeyFood[]): string {
    if (!foods.length) return '(never resolved)';
    return foods.map(f => `${f.foodId} "${f.foodName ?? '?'}" ×${f.n}`).join('; ');
}

/**
 * The "## Stuck keys (sub-gate, never cached)" report section, as markdown
 * lines ready for flywheel-sweep's buildMarkdown (or console output).
 */
export function formatStuckKeysSection(
    report: StuckKeysReport,
    trend: StuckTrend,
    maxRows = 30,
): string[] {
    const lines: string[] = [];
    lines.push('## Stuck keys (sub-gate, never cached)');
    if (!report.ok) {
        lines.push(`_unavailable: ${report.error ?? 'unknown'}_`);
        return lines;
    }
    lines.push(`${report.count} stuck keys in the ${report.windowDays}d window — all-miss demand whose max `
        + `confidence stayed under the ${report.confidenceGate} cache-save gate (≥${STUCK_KEY_MIN_EVENTS} events; `
        + 'noCache + cacheEscape events excluded). These re-run the full pipeline on every request.');
    lines.push(trend.previous === null
        ? 'Trend: first run (no previous stuck-keys report).'
        : `Trend: ${trend.previousCount} → ${report.count} (${fmtDelta(trend.delta ?? 0)}) vs \`${trend.previous}\`.`);
    lines.push('');
    const shown = report.rows.slice(0, maxRows);
    lines.push(`### Keys (${shown.length} of ${report.count} shown, by events)`);
    lines.push(mdTable(shown.map(r => [
        cell(r.key),
        String(r.events),
        // 3 decimals: at 2, 0.8473 renders as "0.85" and looks like it beat the gate
        r.maxConfidence == null ? '—' : r.maxConfidence.toFixed(3),
        r.avgLatencyMs == null ? '—' : `${Math.round(r.avgLatencyMs)}ms`,
        cell(r.sampleRawLine ?? ''),
        cell(fmtFoods(r.foods)),
    ]), ['key', 'events', 'max conf', 'avg latency', 'sample raw line', 'records seen (top)']));
    return lines;
}

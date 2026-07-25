/**
 * cache-coverage.ts — what share of a realistic query distribution the cache
 * can already answer.
 *
 * Row count is not progress. A cache can grow for weeks and still miss what
 * people actually type, which is exactly what the 2026-07-24 corpus read found:
 * produce was 69.9% covered while store-brands sat at 2.4% and sit-down chains
 * at 8.4%, because every prior warm wave had been produce-and-pantry shaped.
 * This step turns that one-off finding into a tracked number.
 *
 * Method: canonicalize each corpus seed with the SAME `canonicalizeCacheKey`
 * the mapper writes keys with, then intersect against the live `FoodMapping`
 * key set. Raw-string matching would silently under-count — stored keys are
 * token-SORTED ("0 fage greek plain total yogurt").
 *
 * TWO NUMBERS, deliberately distinct, because conflating them is the trap:
 *
 *   coverage  — cached share of the WHOLE corpus. The honest read. Baseline
 *               28.8% (951/3,307) on 2026-07-24; stop signal is >70-80%.
 *   growth    — cached share of just the seeds that were UNCACHED when the
 *               corpus was cut. Starts at 0% by construction and rises only as
 *               warming closes the known gap, so it measures the work, per
 *               domain, without produce's existing saturation drowning it out.
 *
 * Neither is the nightly telemetry replay's cache_hit, which re-warms keys that
 * are already cached and so reports near-100% by construction. It answers "did
 * the cache hold?", not "is the cache big enough yet?".
 *
 * The corpus is COMMITTED (scripts/eval/coverage-corpus.tsv) so the denominator
 * is fixed. Changing it breaks comparability with every earlier reading — cut a
 * new file under a new name instead, and restate the baseline.
 */

import * as fs from 'fs';
import * as path from 'path';
import { canonicalizeCacheKey } from '../mapping/normalization-rules';

/** Coverage on a fresh representative batch at which warming can stop. */
export const COVERAGE_STOP_SIGNAL_PCT = 70;

/** Minimal shape of the client this step needs — keeps it unit-testable. */
export interface CoverageDbClient {
    foodMapping: {
        findMany(args: { select: { normalizedForm: true } }): Promise<{ normalizedForm: string }[]>;
    };
}

export interface CoverageSeed {
    domain: string;
    /** 'new' = uncached when the corpus was cut; 'cached' = already covered then. */
    baseline: 'new' | 'cached';
    seed: string;
    key: string;
}

export interface CoverageDomainRow {
    domain: string;
    total: number;
    cached: number;
    pct: number;
}

export interface CacheCoverageReport {
    ok: boolean;
    error?: string;
    ranAt: string;
    corpus: string;
    liveKeys: number;
    /** Whole-corpus coverage — the headline. */
    total: number;
    cached: number;
    pct: number;
    /** Restricted to seeds that were uncached at corpus cut — measures the work. */
    growthTotal: number;
    growthCached: number;
    growthPct: number;
    /** Per-domain, over the 'new' seeds only (the labelled ones), worst first. */
    perDomain: CoverageDomainRow[];
}

export interface CoverageTrend {
    previousFile: string;
    previousPct: number;
    deltaPct: number;
}

function pct(n: number, d: number): number {
    return d > 0 ? Math.round((1000 * n) / d) / 10 : 0;
}

/** Parse the committed corpus TSV: `domain \t baseline \t seed`. */
export function loadCoverageCorpus(corpusPath: string): CoverageSeed[] {
    const raw = fs.readFileSync(corpusPath, 'utf8');
    const out: CoverageSeed[] = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('domain\t')) continue;
        const [domain, baseline, ...rest] = trimmed.split('\t');
        const seed = rest.join('\t').trim();
        if (!seed) continue;
        out.push({
            domain: domain || 'unlabeled',
            baseline: baseline === 'cached' ? 'cached' : 'new',
            seed,
            key: canonicalizeCacheKey(seed),
        });
    }
    return out;
}

export async function collectCacheCoverage(
    prisma: CoverageDbClient,
    corpusPath: string,
    ranAt: string,
): Promise<CacheCoverageReport> {
    const empty: CacheCoverageReport = {
        ok: false, ranAt, corpus: path.basename(corpusPath), liveKeys: 0,
        total: 0, cached: 0, pct: 0,
        growthTotal: 0, growthCached: 0, growthPct: 0, perDomain: [],
    };
    try {
        const seeds = loadCoverageCorpus(corpusPath);
        if (seeds.length === 0) return { ...empty, error: `corpus ${corpusPath} is empty` };

        const rows = await prisma.foodMapping.findMany({ select: { normalizedForm: true } });
        // Canonicalize the stored keys too. They are already written in this
        // form, so this is a no-op for well-formed rows — but it is exactly the
        // idempotency the corpus port was validated on, and it keeps a
        // malformed legacy row from reading as a permanent miss.
        const live = new Set(rows.map(r => canonicalizeCacheKey(r.normalizedForm)));

        const byDomain = new Map<string, { total: number; cached: number }>();
        let cached = 0, growthTotal = 0, growthCached = 0;
        for (const s of seeds) {
            const hit = live.has(s.key);
            if (hit) cached++;
            if (s.baseline === 'new') {
                growthTotal++;
                if (hit) growthCached++;
                const d = byDomain.get(s.domain) ?? { total: 0, cached: 0 };
                d.total++;
                if (hit) d.cached++;
                byDomain.set(s.domain, d);
            }
        }

        const perDomain = [...byDomain.entries()]
            .map(([domain, d]) => ({ domain, total: d.total, cached: d.cached, pct: pct(d.cached, d.total) }))
            .sort((a, b) => a.pct - b.pct || b.total - a.total);

        return {
            ok: true, ranAt, corpus: path.basename(corpusPath), liveKeys: live.size,
            total: seeds.length, cached, pct: pct(cached, seeds.length),
            growthTotal, growthCached, growthPct: pct(growthCached, growthTotal),
            perDomain,
        };
    } catch (e) {
        return { ...empty, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Previous coverage reading, taken from the last flywheel report that carried
 * one. No separate artifact: the sweep's own JSON is the history.
 */
export function findPreviousCoverage(
    resultsDir: string,
    excludeFile?: string,
): { file: string; pct: number } | null {
    let names: string[];
    try {
        names = fs.readdirSync(resultsDir);
    } catch {
        return null;
    }
    const candidates = names
        .filter(n => n.startsWith('flywheel-') && n.endsWith('.json'))
        .filter(n => !excludeFile || n !== path.basename(excludeFile))
        .sort()
        .reverse();
    for (const name of candidates) {
        try {
            const parsed = JSON.parse(fs.readFileSync(path.join(resultsDir, name), 'utf8'));
            const prev = parsed?.coverage;
            if (prev && prev.ok === true && typeof prev.pct === 'number') {
                return { file: name, pct: prev.pct };
            }
        } catch {
            // Unreadable or partial report — keep looking further back.
        }
    }
    return null;
}

export function computeCoverageTrend(
    report: CacheCoverageReport,
    previous: { file: string; pct: number } | null,
): CoverageTrend | null {
    if (!report.ok || !previous) return null;
    return {
        previousFile: previous.file,
        previousPct: previous.pct,
        deltaPct: Math.round((report.pct - previous.pct) * 10) / 10,
    };
}

export function formatCoverageSection(
    report: CacheCoverageReport,
    trend: CoverageTrend | null,
    worstN = 12,
): string[] {
    const lines: string[] = [];
    if (!report.ok) {
        lines.push(`⚠️ coverage step failed: ${report.error ?? 'unknown error'}`);
        return lines;
    }

    const delta = trend
        ? ` (${trend.deltaPct >= 0 ? '+' : ''}${trend.deltaPct}pt vs ${trend.previousFile})`
        : '';
    const reached = report.pct >= COVERAGE_STOP_SIGNAL_PCT;
    lines.push(
        `${reached ? '✅' : '📈'} **${report.pct}%** of \`${report.corpus}\` is cached ` +
        `(${report.cached}/${report.total})${delta} · stop signal >${COVERAGE_STOP_SIGNAL_PCT}%`,
    );
    lines.push('');
    lines.push(
        `Growth since the corpus was cut: **${report.growthPct}%** ` +
        `(${report.growthCached}/${report.growthTotal} of the then-uncached seeds) · ` +
        `live keys ${report.liveKeys}`,
    );
    lines.push('');
    lines.push('_Key overlap on a fixed representative corpus — NOT the warm run\'s ' +
        'funnel `cache_hit`, which measures whether a pick survived the gates._');

    if (report.perDomain.length) {
        lines.push('');
        lines.push(`### Least-covered domains (of the ${report.growthTotal} then-uncached seeds)`);
        lines.push('');
        lines.push('| domain | cached | of | % |');
        lines.push('|---|---:|---:|---:|');
        for (const d of report.perDomain.slice(0, worstN)) {
            lines.push(`| ${d.domain} | ${d.cached} | ${d.total} | ${d.pct}% |`);
        }
    }
    return lines;
}

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
 * Method: key each corpus seed with `deriveStaticCoverageKey()` — the mapper's
 * own normalizer (`normalizeIngredientName().cleaned`), then the SAME
 * `canonicalizeCacheKey` + `collapseAdjacentDuplicateTokens` the mapper writes
 * keys with — and intersect against the live `FoodMapping` key set. Raw-string
 * matching would silently under-count — stored keys are token-SORTED
 * ("0 fage greek plain total yogurt").
 *
 * PREDICATE CHANGED 2026-08-24 (the decision of 2026-08-08, Diego: "grade by
 * mapper key, executed at the >70% re-scope point together with the sweep
 * repoint to the 08-08 corpus — one metric change, once"). Until then the seed
 * was keyed by `canonicalizeCacheKey(seed)` on the RAW string, which read a
 * cached seed as uncached whenever the mapper's normalizer rewrites it before
 * the key is built (`instant oatmeal` → `instant oat rolled`; `chopped onions`
 * → `onion`). Measured 2026-08-24 on one FoodMapping dump of 4,741 keys: the
 * raw predicate read 2548/3754 = 67.9% on the 08-02 corpus and 2806/4102 =
 * 68.4% on the 08-08 corpus; this predicate reads 2666 = 71.0% and 2931 =
 * 71.5% (+3.1 / +3.0 pt; the live `--coverage-only` run the same hour read the
 * identical 2931/4102). The move is two-directional: 147 seeds flip to cached
 * and 29 flip to uncached on 08-02 (157 / 32 on 08-08). The reverse flips are
 * rows written under a form the normalizer no longer produces — `vanilla latte`
 * → `extract latte vanilla`, `hamburger buns` → `15% 85% beef bun fat lean`,
 * `steel cut oats` → `cut oat rolled steel` — which the mapper's own early
 * lookup misses today (0 of 28 served `early` in MappingEventLog), so reading
 * them as uncached is the honest read; each is also a live normalizer defect on
 * the identity axis, owned by the flavour-word / normalization reports, not here.
 * `collapseAdjacentDuplicateTokens` is load-bearing: repeated tokens come from
 * the seeds themselves (`half and half`, `taco bell crunchy taco`) and from the
 * normalizer (`rolled oats` → `rolled rolled oats`), and the mapper collapses
 * them after sorting; without it 45 seeds of the 08-08 corpus mis-key (`and half
 * half`, `bell crunchy taco taco`). STILL A FLOOR, in both directions: this key omits the decisive-brand
 * prefix, the parser's quantity/unit strip, LearnedSynonym and the AI-normalize
 * fallback (the live mapper's `deriveMappingCacheKey()` in
 * `mapping/cache-key.ts` cannot be imported by read-only tooling — its import
 * chain reaches `gather-candidates`' module-scope `warmupEmbedder()` and the
 * db client). A leaf replica of the full early-lookup chain (parser, partitive
 * strip, identity restoration) read 3028/4102 = 73.8% on the 08-08 corpus the
 * same day, so the true served share sits above this number.
 * Owner of the measurement: the mobile repo's
 * `sync-docs/reports/2026-08-24_coverage-by-mapper-key-and-the-warm-line-closes.md`.
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
 * The corpus is COMMITTED so the denominator is fixed. Changing it breaks
 * comparability with every earlier reading — cut a new file under a new name
 * instead, and restate the baseline. `scripts/eval/_cut_coverage_corpus.ts` does
 * exactly that and refuses to overwrite an existing cut.
 *
 * Cuts so far: `coverage-corpus.tsv` (2026-07-24, 3,307 seeds, baseline 28.8%),
 * `coverage-corpus-2026-08-02.tsv` (3,754 seeds, restated baseline 52.1%; the
 * sweep's default 2026-08-02 → 2026-08-24, last raw-key read 67.9%) and
 * `coverage-corpus-2026-08-08.tsv` (4,102 seeds, baseline 56.7% at cut by the
 * raw key), which is what the sweep reads by default since 2026-08-24. All
 * stay committed. The 08-08 file's `baseline` column was graded by the RAW key
 * at cut, so under this predicate `growth` does NOT restart at 0: the first
 * read is 645/1778 = 36.3% (measured 2026-08-24, static and live). Note that
 * `computeCoverageTrend()` returns null across different corpora — subtracting
 * two fractions with different denominators is not a trend — so the first
 * nightly on the new default prints no delta, by design.
 */

import * as fs from 'fs';
import * as path from 'path';
import { collapseAdjacentDuplicateTokens } from '../mapping/cache-key-core';
import { canonicalizeCacheKey, normalizeIngredientName } from '../mapping/normalization-rules';

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

/**
 * The coverage key for one corpus seed: the mapper's normalizer, then the same
 * canonicalize + adjacent-duplicate collapse `deriveMappingCacheKey()` ends in.
 * Falls back to the raw seed if the normalizer returns an empty string (it did
 * not on any seed of either committed corpus, measured 2026-08-24). Static — no
 * DB, no LLM, no parser — see the header for what that omits.
 */
export function deriveStaticCoverageKey(seed: string): string {
    const cleaned = normalizeIngredientName(seed).cleaned;
    return collapseAdjacentDuplicateTokens(canonicalizeCacheKey(cleaned || seed));
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
            key: deriveStaticCoverageKey(seed),
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
): { file: string; pct: number; corpus?: string } | null {
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
                return { file: name, pct: prev.pct, corpus: prev.corpus };
            }
        } catch {
            // Unreadable or partial report — keep looking further back.
        }
    }
    return null;
}

export function computeCoverageTrend(
    report: CacheCoverageReport,
    previous: { file: string; pct: number; corpus?: string } | null,
): CoverageTrend | null {
    if (!report.ok || !previous) return null;
    // A delta across two DIFFERENT corpora is not a trend, it is two unrelated
    // fractions subtracted. Cutting coverage-corpus-2026-08-02.tsv made the very
    // first read of the new file print "+2.8pt vs <a report on the old one>",
    // which is exactly the comparability break this module's header tells you to
    // avoid by cutting a new file — and then reintroduced it in the trend line.
    // A previous report from before `corpus` was recorded is also not comparable:
    // absent is not "same".
    if (!previous.corpus || previous.corpus !== report.corpus) return null;
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

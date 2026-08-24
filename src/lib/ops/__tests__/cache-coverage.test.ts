/**
 * cache-coverage — corpus coverage read.
 *
 * The load-bearing behaviour is key canonicalization: stored FoodMapping keys
 * are token-SORTED, so raw-string matching would under-report coverage and the
 * trend would look flat while the cache was actually filling up.
 */

// normalization-rules imports the shared db module, which constructs a
// PrismaClient at import time and needs DATABASE_URL. This step never touches
// that client — it takes its own — so stub it out and keep the suite runnable
// without an env.
jest.mock('../../db', () => ({ prisma: {} }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    collectCacheCoverage, computeCoverageTrend, deriveStaticCoverageKey, findPreviousCoverage,
    formatCoverageSection, loadCoverageCorpus, CoverageDbClient,
} from '../cache-coverage';

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-test-'));
}

function writeCorpus(dir: string, rows: string[]): string {
    const p = path.join(dir, 'corpus.tsv');
    fs.writeFileSync(p, ['domain\tbaseline\tseed', ...rows].join('\n') + '\n');
    return p;
}

function db(keys: string[]): CoverageDbClient {
    return { foodMapping: { findMany: async () => keys.map(normalizedForm => ({ normalizedForm })) } };
}

const RAN_AT = '2026-07-25T00:00:00.000Z';

/**
 * THE PREDICATE (changed 2026-08-24). Before, the seed was keyed by
 * `canonicalizeCacheKey(seed)` on the raw string, so any seed the mapper's
 * normalizer rewrites before writing its key read as a permanent miss. These
 * cases pin the three halves of the new key and the one thing that must NOT
 * have moved. `instant oatmeal` rides the tracked
 * data/fatsecret/normalization-rules.json (its `oatmeal` rewrite); if that rule
 * changes, this case changes with it — that is the point, not a flake.
 */
describe('deriveStaticCoverageKey', () => {
    it('runs the seed through the normalizer before keying it (the 2026-08-08 decision)', () => {
        expect(deriveStaticCoverageKey('chopped onions')).toBe('onion');   // prep phrase stripped
        expect(deriveStaticCoverageKey('instant oatmeal')).toBe('instant oat rolled');
    });

    it('collapses the repeated tokens the normalizer can emit, as the mapper key does', () => {
        // Without collapseAdjacentDuplicateTokens 45 seeds of the 08-08 corpus mis-keyed
        // (`half and half` → "and half half", `canned kidney beans` → "bean canned canned
        // canned kidney"; measured 2026-08-24) — the duplicates come from the seeds
        // themselves as well as from the normalizer, and the mapper collapses both.
        expect(deriveStaticCoverageKey('beans beans')).toBe('bean');
        expect(deriveStaticCoverageKey('canned kidney beans')).toBe('bean canned kidney');
    });

    it('is the old key on a seed the normalizer leaves alone — lowercased, singularized, sorted', () => {
        expect(deriveStaticCoverageKey('Red Bell Peppers')).toBe('bell pepper red');
        expect(deriveStaticCoverageKey('plain greek yogurt')).toBe('greek plain yogurt');
    });
});

describe('loadCoverageCorpus', () => {
    it('parses rows and keys them with deriveStaticCoverageKey, skipping the header', () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, ['produce\tnew\tred bell peppers', 'chains\tcached\tbig mac', 'produce\tnew\tchopped onions']);
        const seeds = loadCoverageCorpus(p);
        expect(seeds).toHaveLength(3);
        expect(seeds[0]).toMatchObject({ domain: 'produce', baseline: 'new', seed: 'red bell peppers' });
        // lowercased, singularized, token-sorted
        expect(seeds[0].key).toBe('bell pepper red');
        expect(seeds[1].baseline).toBe('cached');
        // normalized before keying — the raw key would have been 'chopped onion'
        expect(seeds[2].key).toBe('onion');
    });
});

describe('collectCacheCoverage', () => {
    it('matches a stored key whose tokens are in a different order', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, ['dairy\tnew\tplain greek yogurt']);
        // How the mapper actually stores it: sorted.
        const report = await collectCacheCoverage(db(['greek plain yogurt']), p, RAN_AT);
        expect(report.ok).toBe(true);
        expect(report.cached).toBe(1);
        expect(report.pct).toBe(100);
    });

    it('counts a seed cached when its NORMALIZED key is stored — the raw-key predicate missed these', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, ['breakfast\tnew\tinstant oatmeal', 'produce\tnew\tchopped onions']);
        // The mapper wrote both under the normalizer's form; the 2026-08-02 → 08-24
        // sweep read both as uncached ("instant oatmeal" / "chopped onion").
        const report = await collectCacheCoverage(db(['instant oat rolled', 'onion']), p, RAN_AT);
        expect(report.cached).toBe(2);
        expect(report.pct).toBe(100);
    });

    it('separates whole-corpus coverage from growth on the then-uncached seeds', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, [
            'unlabeled\tcached\tbanana',
            'unlabeled\tcached\tegg',
            'chains\tnew\tbig mac',
            'frozen\tnew\tdigiorno pepperoni pizza',
        ]);
        // Both baseline rows plus one of the two new ones are now cached.
        const report = await collectCacheCoverage(db(['banana', 'egg', 'big mac']), p, RAN_AT);
        expect(report.total).toBe(4);
        expect(report.cached).toBe(3);
        expect(report.pct).toBe(75);
        // Growth ignores the seeds that were already covered at corpus cut.
        expect(report.growthTotal).toBe(2);
        expect(report.growthCached).toBe(1);
        expect(report.growthPct).toBe(50);
    });

    it('reports per-domain over the new seeds only, least-covered first', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, [
            'chains\tnew\tbig mac',
            'chains\tnew\twhopper',
            'frozen\tnew\thot pocket',
            'unlabeled\tcached\tbanana',
        ]);
        const report = await collectCacheCoverage(db(['big mac', 'whopper', 'banana']), p, RAN_AT);
        expect(report.perDomain.map(d => d.domain)).toEqual(['frozen', 'chains']);
        expect(report.perDomain[0]).toMatchObject({ domain: 'frozen', cached: 0, total: 1, pct: 0 });
        expect(report.perDomain[1]).toMatchObject({ domain: 'chains', cached: 2, total: 2, pct: 100 });
        // 'unlabeled' is baseline-cached, so it never enters the domain table.
        expect(report.perDomain.find(d => d.domain === 'unlabeled')).toBeUndefined();
    });

    it('fails soft when the corpus is missing rather than throwing', async () => {
        const report = await collectCacheCoverage(db([]), '/nonexistent/corpus.tsv', RAN_AT);
        expect(report.ok).toBe(false);
        expect(report.error).toBeTruthy();
        expect(formatCoverageSection(report, null)[0]).toContain('coverage step failed');
    });
});

describe('trend', () => {
    it('reads the previous reading out of the last sweep JSON that carried one', () => {
        const dir = tmpdir();
        // Newest first by sort order, but this one predates the coverage step.
        fs.writeFileSync(path.join(dir, 'flywheel-2026-07-24.json'), JSON.stringify({ coverage: { ok: true, pct: 28.8 } }));
        fs.writeFileSync(path.join(dir, 'flywheel-2026-07-25.json'), JSON.stringify({ gate: {} }));
        const prev = findPreviousCoverage(dir);
        expect(prev).toEqual({ file: 'flywheel-2026-07-24.json', pct: 28.8 });
    });

    it('skips a report whose coverage step errored', () => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'flywheel-2026-07-23.json'), JSON.stringify({ coverage: { ok: true, pct: 20 } }));
        fs.writeFileSync(path.join(dir, 'flywheel-2026-07-24.json'), JSON.stringify({ coverage: { ok: false, pct: 0 } }));
        expect(findPreviousCoverage(dir)?.pct).toBe(20);
    });

    it('excludes this run\'s own file so a sweep cannot trend against itself', () => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'flywheel-2026-07-25.json'), JSON.stringify({ coverage: { ok: true, pct: 40 } }));
        expect(findPreviousCoverage(dir, 'flywheel-2026-07-25.json')).toBeNull();
    });

    it('computes the delta in points when both reads used the SAME corpus', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, ['a\tnew\tbanana', 'a\tnew\tegg']);
        const report = await collectCacheCoverage(db(['banana']), p, RAN_AT);
        const trend = computeCoverageTrend(report, { file: 'prev.json', pct: 28.8, corpus: report.corpus });
        expect(report.pct).toBe(50);
        expect(trend?.deltaPct).toBe(21.2);
    });

    // Cutting a new corpus is the documented way to extend the denominator, so the
    // very first read of a new file WILL find a previous report on the old one.
    // Subtracting those two fractions is not a trend.
    it('refuses to trend across two different corpora', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, ['a\tnew\tbanana', 'a\tnew\tegg']);
        const report = await collectCacheCoverage(db(['banana']), p, RAN_AT);
        expect(computeCoverageTrend(report, {
            file: 'prev.json', pct: 28.8, corpus: 'coverage-corpus-OLD.tsv',
        })).toBeNull();
    });

    it('refuses to trend against a report that predates corpus recording', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, ['a\tnew\tbanana']);
        const report = await collectCacheCoverage(db([]), p, RAN_AT);
        // absent is not "same corpus" — an old report simply cannot say.
        expect(computeCoverageTrend(report, { file: 'prev.json', pct: 10 })).toBeNull();
    });

    it('carries the previous report\'s corpus through so the trend can check it', () => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'flywheel-2026-08-01.json'),
            JSON.stringify({ coverage: { ok: true, pct: 44, corpus: 'coverage-corpus.tsv' } }));
        expect(findPreviousCoverage(dir)?.corpus).toBe('coverage-corpus.tsv');
    });

    it('has no trend on the first run', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, ['a\tnew\tbanana']);
        const report = await collectCacheCoverage(db([]), p, RAN_AT);
        expect(computeCoverageTrend(report, null)).toBeNull();
    });
});

describe('formatCoverageSection', () => {
    it('marks the stop signal only once coverage clears it', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, ['a\tnew\tbanana', 'a\tnew\tegg', 'a\tnew\tmilk', 'a\tnew\trice']);
        const low = await collectCacheCoverage(db(['banana']), p, RAN_AT);
        expect(formatCoverageSection(low, null)[0]).toContain('📈');

        const high = await collectCacheCoverage(db(['banana', 'egg', 'milk', 'rice']), p, RAN_AT);
        expect(formatCoverageSection(high, null)[0]).toContain('✅');
    });

    it('states which quantity it is, so it cannot be read as funnel cache_hit', async () => {
        const dir = tmpdir();
        const p = writeCorpus(dir, ['a\tnew\tbanana']);
        const report = await collectCacheCoverage(db(['banana']), p, RAN_AT);
        expect(formatCoverageSection(report, null).join('\n')).toContain('NOT the warm run');
    });
});

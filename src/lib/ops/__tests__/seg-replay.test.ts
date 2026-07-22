import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SEG_PARSER_VERSION, SegmentedItem } from '../../nlp/ai-segmenter';
import {
    collectSegReplay,
    computeSegReplayTrend,
    failedSegReplayReport,
    findPreviousSegReplayReport,
    formatSegReplaySection,
    SegCacheReadClient,
    SegReplayReport,
    SegReplayTrend,
    SEG_REPLAY_DEFAULT_TOP_N,
} from '../seg-replay';

/**
 * Tests for the nightly sweep's seg replay-diff step (report-only drift check
 * over SegmentationCache). Prisma and the AI segmenter are both mocked — the
 * step's contract is: top-N by hitCount, NEVER writes to the cache, aggregates
 * diffs, trends vs the previous artifact, and fails soft on every error.
 */

function item(normalizedForm: string, rawText = normalizedForm): SegmentedItem {
    return { rawText, mealType: 'snacks', brand: '', normalizedForm };
}

interface CacheRow { lineKey: string; hitCount: number; segmentsJson: unknown }

/** Full prisma-delegate mock incl. write methods, to prove none is ever called. */
function mockDb(result: CacheRow[] | Error) {
    const findMany = result instanceof Error
        ? jest.fn().mockRejectedValue(result)
        : jest.fn().mockResolvedValue(result);
    const writes = {
        create: jest.fn(), createMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
        upsert: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(),
    };
    const db = { segmentationCache: { findMany, ...writes } } as unknown as SegCacheReadClient;
    return { db, findMany, writes };
}

const ROWS: CacheRow[] = [
    {
        lineKey: '2 eggs and toast for breakfast', hitCount: 41,
        segmentsJson: [item('eggs', '2 eggs'), item('toast')],
    },
    {
        lineKey: 'chicken and rice', hitCount: 17,
        segmentsJson: [item('chicken'), item('rice')],
    },
    {
        lineKey: 'protein shake', hitCount: 5,
        segmentsJson: [item('protein shake')],
    },
];

describe('collectSegReplay', () => {
    it('selects top-N by hitCount for the current parser version, read-only', async () => {
        const { db, findMany, writes } = mockDb(ROWS);
        const segment = jest.fn(async (text: string) =>
            (ROWS.find(r => r.lineKey === text)!.segmentsJson as SegmentedItem[]));

        const report = await collectSegReplay(db, segment, { topN: 3 });

        expect(findMany).toHaveBeenCalledTimes(1);
        expect(findMany).toHaveBeenCalledWith({
            where: { parserVersion: SEG_PARSER_VERSION },
            orderBy: { hitCount: 'desc' },
            take: 3,
            select: { lineKey: true, hitCount: true, segmentsJson: true },
        });
        // No-write guarantee: the replay must never overwrite the cached split.
        for (const spy of Object.values(writes)) expect(spy).not.toHaveBeenCalled();
        // Segmenter got each cached line exactly once (cache bypassed, direct call).
        expect(segment.mock.calls.map(c => c[0])).toEqual(ROWS.map(r => r.lineKey));

        expect(report.ok).toBe(true);
        expect(report.parserVersion).toBe(SEG_PARSER_VERSION);
        expect(report.cachedLines).toBe(3);
        expect(report.replayed).toBe(3);
        expect(report.matches).toBe(3);
        expect(report.drifts).toBe(0);
        expect(report.aiErrors).toBe(0);
        expect(report.driftRate).toBe(0);
    });

    it('defaults topN to SEG_REPLAY_DEFAULT_TOP_N', async () => {
        const { db, findMany } = mockDb([]);
        await collectSegReplay(db, jest.fn());
        expect(findMany.mock.calls[0][0].take).toBe(SEG_REPLAY_DEFAULT_TOP_N);
    });

    it('aggregates match / drift / ai_error and computes driftRate excluding ai_error', async () => {
        const rows: CacheRow[] = [
            { lineKey: 'a', hitCount: 9, segmentsJson: [item('eggs'), item('toast')] },
            { lineKey: 'b', hitCount: 8, segmentsJson: [item('chicken'), item('rice')] },
            { lineKey: 'c', hitCount: 7, segmentsJson: [item('oatmeal')] },
        ];
        const { db } = mockDb(rows);
        const segment = jest.fn()
            // a: same names, different order → match (multiset compare)
            .mockResolvedValueOnce([item('toast'), item('eggs')])
            // b: "chicken and rice" now one item → drift
            .mockResolvedValueOnce([item('chicken and rice')])
            // c: LLM failure (ai-segmenter returns null)
            .mockResolvedValueOnce(null);

        const report = await collectSegReplay(db, segment, { topN: 3 });
        expect(report.matches).toBe(1);
        expect(report.drifts).toBe(1);
        expect(report.aiErrors).toBe(1);
        expect(report.driftRate).toBe(0.5); // 1 drift / (1 match + 1 drift)

        const drift = report.entries.find(e => e.status === 'drift')!;
        expect(drift.lineKey).toBe('b');
        expect(drift.cachedCount).toBe(2);
        expect(drift.freshCount).toBe(1);
        expect(drift.onlyCached).toEqual(['chicken', 'rice']);
        expect(drift.onlyFresh).toEqual(['chicken and rice']);
        expect(drift.cachedNames).toEqual(['chicken', 'rice']);
        expect(drift.freshNames).toEqual(['chicken and rice']);

        const aiError = report.entries.find(e => e.status === 'ai_error')!;
        expect(aiError.lineKey).toBe('c');
        expect(aiError.freshCount).toBeNull();
        expect(aiError.freshNames).toBeNull();
        expect(aiError.error).toBeUndefined(); // returned null, did not throw
    });

    it('skips malformed cached segmentsJson without calling the segmenter for it', async () => {
        const rows: CacheRow[] = [
            { lineKey: 'good', hitCount: 3, segmentsJson: [item('eggs')] },
            { lineKey: 'bad', hitCount: 2, segmentsJson: { not: 'an array' } },
            { lineKey: 'empty', hitCount: 1, segmentsJson: [] },
        ];
        const { db } = mockDb(rows);
        const segment = jest.fn().mockResolvedValue([item('eggs')]);

        const report = await collectSegReplay(db, segment, { topN: 3 });
        expect(segment).toHaveBeenCalledTimes(1);
        expect(segment).toHaveBeenCalledWith('good');
        expect(report.cachedLines).toBe(3);
        expect(report.replayed).toBe(1);
        expect(report.skippedMalformed).toBe(2);
        expect(report.matches).toBe(1);
    });

    it('a DB failure is captured as ok:false, never thrown (sweep must not die)', async () => {
        const { db } = mockDb(new Error('connection refused'));
        const segment = jest.fn();
        const report = await collectSegReplay(db, segment, { topN: 5 });
        expect(report.ok).toBe(false);
        expect(report.error).toBe('connection refused');
        expect(report.topN).toBe(5);
        expect(report.replayed).toBe(0);
        expect(report.entries).toEqual([]);
        expect(segment).not.toHaveBeenCalled();
    });

    it('a segmenter THROW becomes that line\'s ai_error and the remaining lines still run', async () => {
        const rows: CacheRow[] = [
            { lineKey: 'a', hitCount: 2, segmentsJson: [item('eggs')] },
            { lineKey: 'b', hitCount: 1, segmentsJson: [item('rice')] },
        ];
        const { db } = mockDb(rows);
        const segment = jest.fn()
            .mockRejectedValueOnce(new Error('LLM down'))
            .mockResolvedValueOnce([item('rice')]);

        const report = await collectSegReplay(db, segment, { topN: 2 });
        expect(report.ok).toBe(true);
        expect(report.aiErrors).toBe(1);
        expect(report.matches).toBe(1);
        const errored = report.entries.find(e => e.lineKey === 'a')!;
        expect(errored.status).toBe('ai_error');
        expect(errored.error).toBe('LLM down');
    });

    it('zero cached lines is a valid ok report (clean zero), not an error', async () => {
        const { db } = mockDb([]);
        const segment = jest.fn();
        const report = await collectSegReplay(db, segment, { topN: 20 });
        expect(report.ok).toBe(true);
        expect(report.cachedLines).toBe(0);
        expect(report.replayed).toBe(0);
        expect(report.driftRate).toBe(0);
        expect(segment).not.toHaveBeenCalled();
    });
});

describe('failedSegReplayReport', () => {
    it('builds the ok:false shell used when the step itself blows up', () => {
        const report = failedSegReplayReport(20, 'prisma init failed');
        expect(report.ok).toBe(false);
        expect(report.error).toBe('prisma init failed');
        expect(report.topN).toBe(20);
        expect(report.parserVersion).toBe(SEG_PARSER_VERSION);
        expect(report.entries).toEqual([]);
    });
});

describe('computeSegReplayTrend', () => {
    it('first run: no previous report', () => {
        expect(computeSegReplayTrend(2, null)).toEqual({ previous: null, previousDrifts: null, delta: null });
    });

    it('delta vs previous drift count (growth, shrink, flat)', () => {
        const prev = { path: '/x/results/seg-replay-2026-07-20.json', drifts: 1 };
        expect(computeSegReplayTrend(3, prev)).toEqual({
            previous: 'seg-replay-2026-07-20.json', previousDrifts: 1, delta: 2,
        });
        expect(computeSegReplayTrend(0, prev).delta).toBe(-1);
        expect(computeSegReplayTrend(1, prev).delta).toBe(0);
    });
});

describe('findPreviousSegReplayReport', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-replay-test-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function writeReport(name: string, content: unknown, mtimeSec: number): string {
        const p = path.join(dir, name);
        fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
        fs.utimesSync(p, mtimeSec, mtimeSec);
        return p;
    }

    it('returns null when the dir does not exist or holds no seg-replay files', () => {
        expect(findPreviousSegReplayReport(path.join(dir, 'nope'))).toBeNull();
        writeReport('flywheel-2026-07-20.json', { drifts: 9 }, 1000);
        writeReport('stuck-keys-2026-07-20.json', { count: 3 }, 1000);
        expect(findPreviousSegReplayReport(dir)).toBeNull();
    });

    it('picks the most recent seg-replay-*.json by mtime and reads its drift count', () => {
        writeReport('seg-replay-2026-07-19.json', { drifts: 4, entries: [] }, 1000);
        const newest = writeReport('seg-replay-2026-07-20.json', { drifts: 1, entries: [] }, 2000);
        expect(findPreviousSegReplayReport(dir)).toEqual({ path: newest, drifts: 1 });
    });

    it('falls back to counting drift entries when drifts is missing, skips unparseable files and excludePath', () => {
        writeReport('seg-replay-a.json', {
            entries: [{ status: 'drift' }, { status: 'match' }, { status: 'drift' }],
        }, 1000);
        writeReport('seg-replay-b.json', '{not json', 2000);
        const excluded = writeReport('seg-replay-c.json', { drifts: 7 }, 3000);
        expect(findPreviousSegReplayReport(dir, excluded))
            .toEqual({ path: path.join(dir, 'seg-replay-a.json'), drifts: 2 });
    });

    it('also accepts legacy seg-replay-diff-*.json artifacts (same prefix family)', () => {
        const legacy = writeReport('seg-replay-diff-2026-07-20.json', {
            entries: [{ status: 'drift' }],
        }, 1000);
        expect(findPreviousSegReplayReport(dir)).toEqual({ path: legacy, drifts: 1 });
    });
});

describe('formatSegReplaySection', () => {
    const firstRun: SegReplayTrend = { previous: null, previousDrifts: null, delta: null };

    function okReport(partial: Partial<SegReplayReport>): SegReplayReport {
        return {
            ok: true, parserVersion: 'seg-v1', topN: 20,
            cachedLines: 0, replayed: 0, skippedMalformed: 0,
            matches: 0, drifts: 0, aiErrors: 0, driftRate: 0, entries: [],
            ...partial,
        };
    }

    it('renders header, summary, trend and drift table with pipe-escaped cells', () => {
        const report = okReport({
            cachedLines: 3, replayed: 3, matches: 1, drifts: 1, aiErrors: 1, driftRate: 0.5,
            entries: [
                {
                    lineKey: 'a', hitCount: 9, status: 'match', cachedCount: 2, freshCount: 2,
                    onlyCached: [], onlyFresh: [], cachedNames: ['eggs', 'toast'], freshNames: ['eggs', 'toast'],
                },
                {
                    lineKey: 'rice | beans', hitCount: 8, status: 'drift', cachedCount: 2, freshCount: 1,
                    onlyCached: ['beans', 'rice'], onlyFresh: ['rice and beans'],
                    cachedNames: ['beans', 'rice'], freshNames: ['rice and beans'],
                },
                {
                    lineKey: 'c', hitCount: 7, status: 'ai_error', cachedCount: 1, freshCount: null,
                    onlyCached: [], onlyFresh: [], cachedNames: ['oatmeal'], freshNames: null,
                },
            ],
        });
        const md = formatSegReplaySection(report, firstRun).join('\n');
        expect(md).toContain('## Seg replay-diff (report-only)');
        expect(md).toContain('no cache read, no cache write');
        expect(md).toContain('3 lines checked · 1 match · 1 drift · 1 ai_error · drift rate 50.0%');
        expect(md).toContain('Trend: first run (no previous seg-replay report).');
        expect(md).toContain('### Drifts (1 of 1 shown, by hitCount)');
        expect(md).toContain('| rice \\| beans | 8 | 2 → 1 | beans, rice | rice and beans |');
        expect(md).toContain('bump SEG_PARSER_VERSION');
        expect(md).toContain('AI errors (fresh split failed — not drift, retry next sweep): "c"');
        // match rows do not get table rows of their own
        expect(md).not.toContain('| a | 9 |');
    });

    it('zero cached lines renders a clean zero-section, not an error', () => {
        const md = formatSegReplaySection(okReport({}), firstRun).join('\n');
        expect(md).toContain('## Seg replay-diff (report-only)');
        expect(md).toContain('clean zero');
        expect(md).toContain('Trend: first run');
        expect(md).not.toContain('### Drifts');
        expect(md).not.toContain('unavailable');
    });

    it('all-match run has no drift table and no drift note', () => {
        const report = okReport({
            cachedLines: 2, replayed: 2, matches: 2,
            entries: [
                {
                    lineKey: 'a', hitCount: 2, status: 'match', cachedCount: 1, freshCount: 1,
                    onlyCached: [], onlyFresh: [], cachedNames: ['eggs'], freshNames: ['eggs'],
                },
                {
                    lineKey: 'b', hitCount: 1, status: 'match', cachedCount: 1, freshCount: 1,
                    onlyCached: [], onlyFresh: [], cachedNames: ['rice'], freshNames: ['rice'],
                },
            ],
        });
        const md = formatSegReplaySection(report, firstRun).join('\n');
        expect(md).toContain('2 lines checked · 2 match · 0 drift · 0 ai_error · drift rate 0.0%');
        expect(md).not.toContain('### Drifts');
        expect(md).not.toContain('bump SEG_PARSER_VERSION');
    });

    it('reports skipped malformed rows in the summary line', () => {
        const md = formatSegReplaySection(
            okReport({ cachedLines: 2, replayed: 1, matches: 1, skippedMalformed: 1 }),
            firstRun,
        ).join('\n');
        expect(md).toContain('1 malformed cached row(s) skipped');
    });

    it('trend line reports the drift delta against the previous artifact', () => {
        const base = okReport({ cachedLines: 1, replayed: 1, drifts: 3, driftRate: 1 });
        const grow: SegReplayTrend = { previous: 'seg-replay-2026-07-20.json', previousDrifts: 1, delta: 2 };
        expect(formatSegReplaySection(base, grow).join('\n'))
            .toContain('Trend: drifts 1 → 3 (+2) vs `seg-replay-2026-07-20.json`.');
        const shrink: SegReplayTrend = { previous: 'seg-replay-2026-07-20.json', previousDrifts: 5, delta: -2 };
        expect(formatSegReplaySection(base, shrink).join('\n')).toContain('(-2)');
        const flat: SegReplayTrend = { previous: 'seg-replay-2026-07-20.json', previousDrifts: 3, delta: 0 };
        expect(formatSegReplaySection(base, flat).join('\n')).toContain('(±0)');
    });

    it('caps the drift table at maxRows but reports the full drift count', () => {
        const entries = Array.from({ length: 8 }, (_, i) => ({
            lineKey: `line ${i}`, hitCount: 8 - i, status: 'drift' as const,
            cachedCount: 1, freshCount: 2, onlyCached: [], onlyFresh: [`extra ${i}`],
            cachedNames: [`food ${i}`], freshNames: [`food ${i}`, `extra ${i}`],
        }));
        const report = okReport({ cachedLines: 8, replayed: 8, drifts: 8, driftRate: 1, entries });
        const md = formatSegReplaySection(report, firstRun, 5).join('\n');
        expect(md).toContain('### Drifts (5 of 8 shown, by hitCount)');
        expect(md).toContain('| line 4 |');
        expect(md).not.toContain('| line 5 |');
    });

    it('failed report renders as unavailable and states it never gates', () => {
        const md = formatSegReplaySection(failedSegReplayReport(20, 'boom'), firstRun).join('\n');
        expect(md).toContain('_unavailable: boom_');
        expect(md).toContain('never affects');
        expect(md).not.toContain('### Drifts');
    });
});

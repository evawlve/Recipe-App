import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    collectStuckKeys,
    computeStuckTrend,
    findPreviousStuckReport,
    formatStuckKeysSection,
    RawQueryClient,
    StuckKeyRow,
    StuckKeysReport,
    StuckTrend,
    STUCK_KEY_CONFIDENCE_GATE,
    STUCK_KEY_MIN_EVENTS,
    STUCK_KEY_ROW_LIMIT,
} from '../stuck-keys';

/**
 * Tests for the flywheel sweep's stuck-key report (sub-gate keys that the
 * FoodMapping cache never saves — served forever off the full pipeline).
 * The DB is mocked; live-shape validation happened against MappingEventLog
 * on the OptiPlex ("mac and cheese" 26 events / max conf 0.61, dup-token
 * "canned canned kidney beans", etc).
 */

function mockDb(result: StuckKeyRow[] | Error): { db: RawQueryClient; spy: jest.Mock } {
    const spy = result instanceof Error
        ? jest.fn().mockRejectedValue(result)
        : jest.fn().mockResolvedValue(result);
    return { db: { $queryRaw: spy } as unknown as RawQueryClient, spy };
}

const ROWS: StuckKeyRow[] = [
    {
        key: 'mac and cheese', events: 26, maxConfidence: 0.612, avgLatencyMs: 102.4,
        sampleRawLine: 'mac and cheese',
        foods: [{ foodId: 'cmrr3yk1k0000e3peumv609wd', foodName: 'Mac and Cheese (Cooked)', n: 26 }],
    },
    {
        key: 'canned canned kidney beans', events: 7, maxConfidence: 0.8214, avgLatencyMs: 52,
        sampleRawLine: 'kidney beans | canned',
        foods: [
            { foodId: 'off_0041188290241', foodName: 'Canned White Kidney Beans', n: 6 },
            { foodId: 'off_0671635706546', foodName: null, n: 1 },
        ],
    },
    {
        key: 'mystery snack', events: 2, maxConfidence: null, avgLatencyMs: null,
        sampleRawLine: null, foods: [],
    },
];

describe('collectStuckKeys', () => {
    const since = new Date('2026-07-14T00:00:00Z');

    it('returns ok report with rows passed through and count set', async () => {
        const { db } = mockDb(ROWS);
        const report = await collectStuckKeys(db, { since, windowDays: 7 });
        expect(report.ok).toBe(true);
        expect(report.error).toBeUndefined();
        expect(report.count).toBe(3);
        expect(report.rows).toEqual(ROWS);
        expect(report.windowDays).toBe(7);
        expect(report.confidenceGate).toBe(STUCK_KEY_CONFIDENCE_GATE);
    });

    it('issues a single query carrying the full stuck-key definition', async () => {
        const { db, spy } = mockDb([]);
        await collectStuckKeys(db, { since, windowDays: 7 });
        expect(spy).toHaveBeenCalledTimes(1);

        const [strings, ...values] = spy.mock.calls[0];
        const sql = (strings as string[]).join('¤');
        // Window + exclusions
        expect(sql).toContain('"createdAt" >=');
        expect(sql).toContain('"noCache" = false');
        expect(sql).toContain('"cacheEscape" IS NULL');
        expect(sql).toContain('"normalizedForm" IS NOT NULL');
        // Per-key all-miss condition (computed per key, not per event)
        expect(sql).toContain('count(*) FILTER (WHERE "cacheHit" IS NOT NULL) = 0');
        // NULL-only confidence still counts as stuck
        expect(sql).toContain('coalesce(max("confidence"), 0) <');
        expect(sql).toContain('ORDER BY s.events DESC');
        // Parameters: since date, min events, gate, foods-per-key, row limit
        expect(values[0]).toBe(since);
        expect(values).toContain(STUCK_KEY_MIN_EVENTS);
        expect(values).toContain(STUCK_KEY_CONFIDENCE_GATE);
        expect(values).toContain(STUCK_KEY_ROW_LIMIT);
    });

    it('zero rows is a valid ok report, not a failure', async () => {
        const { db } = mockDb([]);
        const report = await collectStuckKeys(db, { since, windowDays: 7 });
        expect(report.ok).toBe(true);
        expect(report.count).toBe(0);
        expect(report.rows).toEqual([]);
    });

    it('a query failure is captured, never thrown (sweep must not die)', async () => {
        const { db } = mockDb(new Error('connection refused'));
        const report = await collectStuckKeys(db, { since, windowDays: 7 });
        expect(report.ok).toBe(false);
        expect(report.error).toBe('connection refused');
        expect(report.count).toBe(0);
        expect(report.rows).toEqual([]);
    });

    it('honors a custom limit', async () => {
        const { db, spy } = mockDb([]);
        await collectStuckKeys(db, { since, windowDays: 7, limit: 10 });
        const values = spy.mock.calls[0].slice(1);
        expect(values).toContain(10);
        expect(values).not.toContain(STUCK_KEY_ROW_LIMIT);
    });
});

describe('computeStuckTrend', () => {
    it('first run: no previous report', () => {
        expect(computeStuckTrend(13, null)).toEqual({ previous: null, previousCount: null, delta: null });
    });

    it('delta vs previous count (growth, shrink, flat)', () => {
        const prev = { path: '/x/results/stuck-keys-2026-07-20.json', count: 10 };
        expect(computeStuckTrend(13, prev)).toEqual({
            previous: 'stuck-keys-2026-07-20.json', previousCount: 10, delta: 3,
        });
        expect(computeStuckTrend(4, prev).delta).toBe(-6);
        expect(computeStuckTrend(10, prev).delta).toBe(0);
    });
});

describe('findPreviousStuckReport', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-keys-test-'));
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

    it('returns null when the dir does not exist or holds no stuck-keys files', () => {
        expect(findPreviousStuckReport(path.join(dir, 'nope'))).toBeNull();
        writeReport('flywheel-2026-07-20.json', { count: 99 }, 1000);
        expect(findPreviousStuckReport(dir)).toBeNull();
    });

    it('picks the most recent stuck-keys-*.json by mtime and reads its count', () => {
        writeReport('stuck-keys-2026-07-19.json', { count: 20, rows: [] }, 1000);
        const newest = writeReport('stuck-keys-2026-07-20.json', { count: 13, rows: [] }, 2000);
        const prev = findPreviousStuckReport(dir);
        expect(prev).toEqual({ path: newest, count: 13 });
    });

    it('falls back to rows.length when count is missing, skips unparseable files and excludePath', () => {
        writeReport('stuck-keys-a.json', { rows: [{}, {}, {}] }, 1000);
        writeReport('stuck-keys-b.json', '{not json', 2000);
        const excluded = writeReport('stuck-keys-c.json', { count: 7 }, 3000);
        const prev = findPreviousStuckReport(dir, excluded);
        expect(prev).toEqual({ path: path.join(dir, 'stuck-keys-a.json'), count: 3 });
    });
});

describe('formatStuckKeysSection', () => {
    const okReport = (rows: StuckKeyRow[]): StuckKeysReport => ({
        ok: true, windowDays: 7, confidenceGate: 0.85, count: rows.length, rows,
    });
    const firstRun: StuckTrend = { previous: null, previousCount: null, delta: null };

    it('renders the section header, definition line and table', () => {
        const md = formatStuckKeysSection(okReport(ROWS), firstRun).join('\n');
        expect(md).toContain('## Stuck keys (sub-gate, never cached)');
        expect(md).toContain('3 stuck keys in the 7d window');
        expect(md).toContain('0.85 cache-save gate');
        expect(md).toContain('Trend: first run (no previous stuck-keys report).');
        expect(md).toContain('### Keys (3 of 3 shown, by events)');
        expect(md).toContain('| mac and cheese | 26 | 0.612 | 102ms | mac and cheese |');
        expect(md).toContain('cmrr3yk1k0000e3peumv609wd "Mac and Cheese (Cooked)" ×26');
    });

    it('escapes pipes in raw lines and renders null fields as em-dash / placeholders', () => {
        const lines = formatStuckKeysSection(okReport(ROWS), firstRun);
        const beans = lines.find(l => l.includes('canned canned kidney beans'))!;
        expect(beans).toContain('kidney beans \\| canned');
        expect(beans).toContain('"?" ×1'); // null foodName
        const mystery = lines.find(l => l.includes('mystery snack'))!;
        expect(mystery).toContain('| — | — |');
        expect(mystery).toContain('(never resolved)');
    });

    it('zero rows: section still renders with count 0 and an empty table', () => {
        const md = formatStuckKeysSection(okReport([]), firstRun).join('\n');
        expect(md).toContain('0 stuck keys in the 7d window');
        expect(md).toContain('_none_');
    });

    it('trend line reports the delta against the previous report', () => {
        const grow: StuckTrend = { previous: 'stuck-keys-2026-07-20.json', previousCount: 1, delta: 2 };
        expect(formatStuckKeysSection(okReport(ROWS), grow).join('\n'))
            .toContain('Trend: 1 → 3 (+2) vs `stuck-keys-2026-07-20.json`.');
        const shrink: StuckTrend = { previous: 'stuck-keys-2026-07-20.json', previousCount: 5, delta: -2 };
        expect(formatStuckKeysSection(okReport(ROWS), shrink).join('\n')).toContain('(-2)');
        const flat: StuckTrend = { previous: 'stuck-keys-2026-07-20.json', previousCount: 3, delta: 0 };
        expect(formatStuckKeysSection(okReport(ROWS), flat).join('\n')).toContain('(±0)');
    });

    it('caps the table at maxRows but reports the full count', () => {
        const many = Array.from({ length: 40 }, (_, i) => ({
            key: `key ${i}`, events: 40 - i, maxConfidence: 0.5, avgLatencyMs: 10,
            sampleRawLine: `raw ${i}`, foods: [],
        }));
        const md = formatStuckKeysSection(okReport(many), firstRun, 30).join('\n');
        expect(md).toContain('### Keys (30 of 40 shown, by events)');
        expect(md).toContain('| key 29 |');
        expect(md).not.toContain('| key 30 |');
    });

    it('failed report renders as unavailable, without a table', () => {
        const md = formatStuckKeysSection(
            { ok: false, error: 'boom', windowDays: 7, confidenceGate: 0.85, count: 0, rows: [] },
            firstRun,
        ).join('\n');
        expect(md).toContain('_unavailable: boom_');
        expect(md).not.toContain('### Keys');
    });
});

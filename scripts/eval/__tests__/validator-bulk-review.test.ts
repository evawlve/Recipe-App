/**
 * validator-bulk-review tests (s458 VR) — fakes only: no prisma, no network, no LLM.
 * Fixture rows A-H pin the MEL join; T1-T7 pin the run loop's guards.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    chooseBilledTuple, inBlackoutLA, usdFor, WORST_CALL_USD, rankSuspects, runBulkReview,
    type BulkDeps, type BulkEvent, type BulkOpts,
} from '../validator-bulk-review';
import type { MappingPointer } from '../validator-triage-queue';
import type { CacheValidationOutcome } from '../../../src/lib/mapping/cache-validator';

const row = (normalizedForm: string, target: { off?: string; fdc?: number; fs?: string }, usedCount: number): MappingPointer => ({
    normalizedForm, source: 'x', offBarcode: target.off ?? null, fdcId: target.fdc ?? null, fsId: target.fs ?? null,
    foodName: 'f', brandName: null, validatedBy: 'ai', validatedAt: new Date('2026-01-01'), usedCount,
});
const ev = (nf: string, foodId: string, rawLine: string, grams: number, kcal: number, tier: string | null, noCache: boolean, lastSeen: string): BulkEvent => ({
    nf, foodId, rawLine, foodName: 'food', brandName: null, grams, totalKcal: kcal, servingTier: tier, noCache, lastSeen: new Date(lastSeen),
});

const A = row('banana', { fdc: 173944 }, 2546);
const B = row('oat rolled', { off: '9348219004831' }, 3095);
const C = row('bell soft taco', { off: '1' }, 5);
const D = row('brown rice', { fs: '4513' }, 1258);
const E = row('egg', { fdc: 2 }, 10);
const F = row('pattie peppermint york', { off: '3' }, 7);
const G = row('and half', { off: '4' }, 3);
const H = row('chicken salad', { off: '5' }, 2);
const ROWS = [A, B, C, D, E, F, G, H];
const EVENTS: BulkEvent[] = [
    ev('bananas', 'fdc_173944', '1 banana', 118, 105.02, 'fdc_own_size_serving', false, '2026-11-01'),
    ev('banana', 'fdc_173944', 'a banana', 100, 89, null, true, '2026-11-10'),
    ev('rolled oats', 'off_9348219004831', 'oatmeal', 40, 160, null, false, '2026-10-01'),
    ev('rolled oats', 'off_9348219004831', '1 cup oatmeal', 80, 320, null, false, '2026-11-01'),
    ev('soft taco', 'off_1', 'two soft tacos', 100, 200, null, false, '2026-11-01'),
    ev('brown rice', 'fs_999', '1 cup brown rice', 100, 100, null, false, '2026-11-01'),
    ev('egg', 'fdc_2', 'an egg', 50, 70, null, true, '2026-11-01'),
    ev('pattie peppermint york', 'off_3', '100g pattie peppermint york', 40, 150, null, false, '2026-08-12'),
    ev('york peppermint pattie', 'off_3', 'york peppermint pattie', 40, 150, null, false, '2026-07-24'),
    ev('half and half', 'off_4', 'half and half', 30, 45, null, false, '2026-10-07'),
    ev('chicken salad', 'off_5', 'chicken salad', 100, 200, null, false, '2026-11-01'),
];

describe('chooseBilledTuple', () => {
    it('A: a noCache=false event beats a newer noCache=true one', () => {
        const r = chooseBilledTuple(A, EVENTS.filter((e) => e.foodId === 'fdc_173944')) as { input: { phrase: string } };
        expect(r.input.phrase).toBe('1 banana');
    });
    it('B: newest lastSeen wins among equals', () => {
        const r = chooseBilledTuple(B, EVENTS.filter((e) => e.foodId === 'off_9348219004831')) as { input: { phrase: string } };
        expect(r.input.phrase).toBe('1 cup oatmeal');
    });
    it('C: a token-subset event is NOT the key -> no_exact_key_event', () => {
        expect(chooseBilledTuple(C, EVENTS.filter((e) => e.foodId === 'off_1'))).toEqual({ untupled: 'no_exact_key_event' });
    });
    it('D: events only on another target -> no_event_for_target', () => {
        expect(chooseBilledTuple(D, EVENTS)).toEqual({ untupled: 'no_event_for_target' });
    });
    it('E: only a noCache event is still tupled, flagged', () => {
        const r = chooseBilledTuple(E, EVENTS) as { noCache: boolean };
        expect(r.noCache).toBe(true);
    });
    it('F: a non-key phrase beats an older/newer key phrase', () => {
        const r = chooseBilledTuple(F, EVENTS) as { input: { phrase: string }; keyPhrase: boolean };
        expect(r.input.phrase).toBe('york peppermint pattie');
        expect(r.keyPhrase).toBe(false);
    });
    it('G: adjacent duplicate tokens collapse in the join', () => {
        expect('untupled' in chooseBilledTuple(G, EVENTS)).toBe(false);
    });
    it('H: a key-phrase-only line is tupled with keyPhrase true', () => {
        const r = chooseBilledTuple(H, EVENTS) as { keyPhrase: boolean };
        expect(r.keyPhrase).toBe(true);
    });
});

describe('inBlackoutLA (T6)', () => {
    it('03:29 false / 03:30 true / 05:29 true / 05:30 false, America/Los_Angeles', () => {
        // 2026-11-14 is PST (UTC-8)
        expect(inBlackoutLA(new Date('2026-11-14T11:29:00Z'))).toBe(false);
        expect(inBlackoutLA(new Date('2026-11-14T11:30:00Z'))).toBe(true);
        expect(inBlackoutLA(new Date('2026-11-14T13:29:00Z'))).toBe(true);
        expect(inBlackoutLA(new Date('2026-11-14T13:30:00Z'))).toBe(false);
    });
});

describe('rankSuspects', () => {
    it('usedCount desc then normalizedForm asc', () => {
        const out = rankSuspects([
            { usedCount: 1, normalizedForm: 'b' }, { usedCount: 5, normalizedForm: 'z' }, { usedCount: 1, normalizedForm: 'a' },
        ]);
        expect(out.map((r) => r.normalizedForm)).toEqual(['z', 'a', 'b']);
    });
});

const NOON = new Date('2026-11-14T20:00:00Z'); // 12:00 PST
let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vbr-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function makeDeps(over: Partial<BulkDeps> = {}, tokensPerCall = { p: 1000, c: 300 }) {
    let p = 0; let c = 0;
    const validate = jest.fn(async (input: { phrase: string }, key: string, o: { dryRun: boolean }): Promise<CacheValidationOutcome> => {
        void input; void key;
        if (o.dryRun) return { outcome: 'dry_run' };
        p += tokensPerCall.p; c += tokensPerCall.c;
        return { outcome: 'written', verdict: 'OK', axis: 'none', reason: 'r', model: 'claude-sonnet-5' };
    });
    const sleep = jest.fn(async () => undefined);
    const deps: BulkDeps = {
        readMappings: async () => ROWS,
        readEvents: async () => EVENTS,
        countVerdicts: async () => 7,
        validate,
        usage: () => ({ promptTokens: p, completionTokens: c }),
        now: () => NOON,
        sleep,
        ...over,
    };
    return { deps, validate, sleep };
}
const opts = (o: Partial<BulkOpts> = {}): BulkOpts => ({ outDir: tmp, dryRun: false, maxUsd: 40, concurrency: 1, paceMs: 10, printPrompts: 0, ...o });

describe('runBulkReview', () => {
    it('T1: --dry-run selects 6 tupled / 2 untupled, suppresses one, never sleeps', async () => {
        const { deps, validate, sleep } = makeDeps({
            validate: jest.fn(async (input, key, o) => {
                void input;
                return key === 'oat rolled' ? { outcome: 'suppressed', priorVerdict: 'OK', priorId: 'v', priorAxis: 'none', priorReason: '' } : { outcome: 'dry_run' } as CacheValidationOutcome;
            }),
        });
        const r = await runBulkReview(deps, opts({ dryRun: true, maxUsd: undefined }));
        expect(r.summary).toMatchObject({
            tupled: 6, untupled: 2, keyPhrase: 1, byOutcome: { suppressed: 1, dry_run: 5 }, llmCalls: 0, reconciled: true,
            fmRows: 8, verdictRowsAtStart: 7, verdictRowsAtEnd: 7,
        });
        const calls = (deps.validate as jest.Mock).mock.calls;
        expect(calls).toHaveLength(6);
        expect(calls.every((c) => c[2].dryRun === true)).toBe(true);
        expect(sleep).not.toHaveBeenCalled();
        void validate;
    });

    it('T2: a run writes suspects.tsv (A then E) and usd matches the usage deltas', async () => {
        let p = 0; let c = 0;
        const d2: BulkDeps = {
            ...makeDeps().deps,
            validate: async (input) => {
                p += 1000; c += 300;
                const bad = input.recordId === 'fdc_173944' || input.recordId === 'fdc_2';
                return bad
                    ? { outcome: 'written', verdict: 'SUSPECT', axis: 'serving', reason: 'too\tbig', model: 'm' }
                    : { outcome: 'written', verdict: 'OK', axis: 'none', reason: 'ok', model: 'm' };
            },
            usage: () => ({ promptTokens: p, completionTokens: c }),
        };
        const r = await runBulkReview(d2, opts());
        expect(r.summary.llmCalls).toBe(6);
        const lines = fs.readFileSync(path.join(tmp, 'suspects.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
        const data = lines.slice(1).map((l) => l.split('\t'));
        expect(data.map((d) => d[1])).toEqual(['banana', 'egg']);
        expect(data[0][12]).toBe('too big');
        expect(r.summary.usd as number).toBeCloseTo(6 * usdFor(1000, 300), 10);
    });

    it('T3: --max-calls 1 stops after one LLM call', async () => {
        const { deps } = makeDeps();
        const r = await runBulkReview(deps, opts({ maxCalls: 1 }));
        expect(r.summary).toMatchObject({ llmCalls: 1, stopReason: 'max_calls', reconciled: true });
    });

    it('T4: inside the LA blackout -> exit 3 and validate never called', async () => {
        const { deps, validate } = makeDeps({ now: () => new Date('2026-11-14T12:00:00Z') }); // 04:00 PST
        const r = await runBulkReview(deps, opts());
        expect(r.exitCode).toBe(3);
        expect(validate).not.toHaveBeenCalled();
        expect(r.summary.stopReason).toBe('blackout');
    });

    it('T5: --max-usd 0.025 allows one call, then stops on the worst-case term', async () => {
        const { deps } = makeDeps();
        const r = await runBulkReview(deps, opts({ maxUsd: 0.025 }));
        expect(r.summary).toMatchObject({ llmCalls: 1, stopReason: 'max_usd' });
    });

    it('T7: an llm_error with zero usage delta adds WORST_CALL_USD to spent', async () => {
        const { deps } = makeDeps({ validate: jest.fn(async () => ({ outcome: 'llm_error' }) as CacheValidationOutcome) });
        const r = await runBulkReview(deps, opts({ maxUsd: 0.03 }));
        expect(r.summary).toMatchObject({ llmCalls: 1, stopReason: 'max_usd' });
        expect(WORST_CALL_USD * 2).toBeGreaterThan(0.03);
    });

    it('five consecutive llm_error -> exit 4', async () => {
        const { deps } = makeDeps({ validate: jest.fn(async () => ({ outcome: 'llm_error' }) as CacheValidationOutcome) });
        const r = await runBulkReview(deps, opts({ maxUsd: 1000 }));
        expect(r.exitCode).toBe(4);
        expect(r.summary.llmCalls).toBe(5);
    });
});

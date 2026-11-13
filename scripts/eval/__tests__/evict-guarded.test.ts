/**
 * evict-guarded.test.ts — the pure guards of the eviction wrapper.
 * NO DATABASE, NO SPAWN: only exported pure functions run here.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    dailyCapRefusal,
    executedToday,
    inBlackout,
    keyRefusal,
    laClock,
    MAX_EXECUTE_RUNS_PER_DAY,
    parseDeleted,
    parseGuardedArgs,
    roleARefusal,
    triageRefusals,
} from '../evict-guarded';
import { verifyEvicted } from '../_verify_evicted';

const GOOD = ['--keys', 'k.json', '--screen-snapshot', 's.json', '--reason', 'a ten+ char reason'];

describe('parseGuardedArgs', () => {
    it('accepts a full command, with and without --execute', () => {
        const a = parseGuardedArgs(GOOD);
        expect(a).toMatchObject({ ok: true, keys: 'k.json', screenSnapshot: 's.json', execute: false });
        expect(parseGuardedArgs([...GOOD, '--execute'])).toMatchObject({ ok: true, execute: true });
    });
    it.each([
        ['unknown flag', [...GOOD, '--bogus']],
        ['positional', [...GOOD, 'stray']],
        ['repeated --keys', [...GOOD, '--keys', 'x.json']],
        ['repeated --execute', [...GOOD, '--execute', '--execute']],
        ['missing --keys', GOOD.slice(2)],
        ['missing --reason', GOOD.slice(0, 4)],
        ['value missing', ['--keys', '--screen-snapshot', 's.json', '--reason', 'a ten+ char reason']],
        ['value starts with -', ['--keys', '-k.json', '--screen-snapshot', 's.json', '--reason', 'a ten+ char reason']],
        ['trailing flag no value', [...GOOD.slice(0, 4), '--reason']],
        ['reason too short', [...GOOD.slice(0, 5), 'short']],
        ['reason too long', [...GOOD.slice(0, 5), 'x'.repeat(301)]],
        ['reason with tab', [...GOOD.slice(0, 5), 'has a\ttab in it']],
        ['reason with newline', [...GOOD.slice(0, 5), 'has a\nnewline in it']],
    ])('refuses %s', (_n, argv) => {
        expect(parseGuardedArgs(argv as string[]).ok).toBe(false);
    });
});

describe('laClock / inBlackout', () => {
    it('converts across the UTC date line', () => {
        expect(laClock(new Date('2026-11-10T07:59:00Z')).date).toBe('2026-11-09');
    });
    it.each([
        ['2026-11-09', 8],
        ['2026-07-15', 7],
    ])('blackout edges on %s (UTC-%i)', (day, off) => {
        const at = (h: number, m: number) => new Date(`${day}T${String(h + off).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
        expect(inBlackout(at(3, 29))).toBe(false);
        expect(inBlackout(at(3, 30))).toBe(true);
        expect(inBlackout(at(5, 29))).toBe(true);
        expect(inBlackout(at(5, 30))).toBe(false);
    });
});

describe('keyRefusal / dailyCapRefusal', () => {
    it('allows 5 keys, refuses 6', () => {
        expect(keyRefusal(['a', 'b', 'c', 'd', 'e'])).toBeNull();
        expect(keyRefusal(['a', 'b', 'c', 'd', 'e', 'f'])).not.toBeNull();
    });
    it('refuses pipe and tab in a key', () => {
        expect(keyRefusal(['a|b'])).not.toBeNull();
        expect(keyRefusal(['a\tb'])).not.toBeNull();
    });
    it('caps executes per day', () => {
        expect(dailyCapRefusal(1)).toBeNull();
        expect(dailyCapRefusal(2)).not.toBeNull();
        expect(dailyCapRefusal(MAX_EXECUTE_RUNS_PER_DAY - 1)).toBeNull();
    });
});

describe('triageRefusals', () => {
    const tsv = 'id\tkey\tcoldVerdict\nT1\talpha\tMISS\nT2\tbeta\tSAME\nT3\tgamma\tMISS\n';
    it('names only MISS keys that were asked for', () => {
        expect(triageRefusals(['alpha', 'beta', 'zeta'], tsv)).toEqual([{ key: 'alpha', id: 'T1' }]);
    });
    it('throws on a missing column', () => {
        expect(() => triageRefusals(['a'], 'id\tkey\nT1\ta\n')).toThrow();
    });
    it('the committed corpus: rice white passes, 96 MISS rows refuse', () => {
        const text = fs.readFileSync(path.join(__dirname, '..', 'triage-regression-corpus-2026-11-09.tsv'), 'utf8');
        expect(triageRefusals(['rice white'], text)).toEqual([]);
        const all = text.split('\n').slice(1).filter(Boolean).map(l => l.split('\t'));
        const missKeys = all.filter(r => r[2] === 'MISS').map(r => r[1]);
        expect(missKeys).toHaveLength(96);
        expect(triageRefusals(missKeys, text).length).toBeGreaterThanOrEqual(1);
    });
});

describe('roleARefusal', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    it('accepts 23 h', () => expect(roleARefusal(ago(23 * 3_600_000), now)).toBeNull());
    it('refuses 25 h, 5 min, future and garbage', () => {
        expect(roleARefusal(ago(25 * 3_600_000), now)).not.toBeNull();
        expect(roleARefusal(ago(5 * 60_000), now)).not.toBeNull();
        expect(roleARefusal(ago(-60_000), now)).not.toBeNull();
        expect(roleARefusal('garbage', now)).not.toBeNull();
    });
});

describe('executedToday', () => {
    const head = 'utc\tlaDate\thhmmss\tmode\tkeyCount\n';
    it('counts only execute rows of that date', () => {
        const t = head
            + 'u\t2026-11-09\t1\texecute\t1\n'
            + 'u\t2026-11-09\t2\texecute-result\t1\n'
            + 'u\t2026-11-09\t3\tdry\t1\n'
            + 'u\t2026-11-08\t4\texecute\t1\n';
        expect(executedToday(t, '2026-11-09')).toBe(1);
        expect(executedToday(t, '2026-11-08')).toBe(1);
    });
    it('throws when headerless or malformed', () => {
        expect(() => executedToday('u\t2026-11-09\t1\texecute\t1\n', '2026-11-09')).toThrow();
        expect(() => executedToday(head + 'a\tb\n', '2026-11-09')).toThrow();
    });
});

describe('verifyEvicted', () => {
    it('ok when the count matches and no key remains', () => {
        expect(verifyEvicted(10, 10, [])).toEqual({ ok: true, reasons: [] });
    });
    it('names the count check', () => {
        const v = verifyEvicted(10, 11, []);
        expect(v.ok).toBe(false);
        expect(v.reasons.join()).toMatch(/count check/);
    });
    it('names the presence check', () => {
        const v = verifyEvicted(10, 10, ['x']);
        expect(v.ok).toBe(false);
        expect(v.reasons.join()).toMatch(/presence check/);
    });
});

describe('parseDeleted', () => {
    it('parses the _evict_rows line', () => {
        expect(parseDeleted('DELETED 3 row(s). FoodMapping now 4915 rows.')).toEqual({ deleted: 3, after: 4915 });
    });
    it('returns null on garbage', () => expect(parseDeleted('nothing here')).toBeNull());
});

/**
 * The hard-case loop's pure parts (scripts/eval/adversary/): Tier D bounds, the MEL
 * filters and the probe ledger, and the judge's fail-closed verdict reader and CLI
 * result reader. No network, no DB, no model: the parsed lines below are what the
 * shipped parseIngredientLine() returns for them on master ec86151f (measured Lane A S63).
 */
import { tierD, type ParsedLine, type ServedItem } from '../adversary/tier-d';
import {
    applyFilters, formatLedgerRow, groupEvents, normLine, parseLedger, type MelEvent,
} from '../adversary/filters';
import { claudeArgs, readCliResult, readVerdicts, renderCard } from '../adversary/judge';

const P = (qty: number, unit: string | null, name: string, extra: Partial<ParsedLine> = {}): ParsedLine =>
    ({ qty, multiplier: 1, unit, name, ...extra });
const item = (rawLine: string, parsed: ParsedLine | null, foodName: string, grams: number, kcal: number, tier = 'x'): ServedItem =>
    ({ rawLine, parsed, foodName, grams, kcal, tier });
const rules = (i: ServedItem) => tierD(i).map(h => h.rule);

describe('Tier D', () => {
    it("flags the s'mores bill: 9 pieces at 39 g each is a snack piece over 25 g", () => {
        const i = item("nine pieces of s'mores drizzilicious", P(9, 'piece', "s'mores drizzilicious"), 'S’Mores Bites', 351, 2004.2, 'count_unit_ai');
        expect(rules(i)).toEqual(['D-count']);
        // ...and passes the fixed bill (23.4 g = 2.6 g a piece), so a fix clears it.
        expect(rules({ ...i, grams: 23.4, kcal: 133.6 })).toEqual([]);
    });

    it('flags half a cup of egg whites billed 16.5 g (33 g a cup, under the 60 g floor)', () => {
        const i = item('half a cup of egg whites', P(0.5, 'cup', 'egg', { unitHint: 'white' }), 'Eggs, Grade A, Large, egg white', 16.5, 9.1, 'fdc_size_estimate');
        expect(rules(i)).toEqual(['D-volume']);
        expect(rules({ ...i, grams: 121.5, kcal: 66.8 })).toEqual([]);
    });

    it('flags half a cup of spinach at 60 g as an OVER-bill (120 g a cup, over the leafy ceiling)', () => {
        const i = item('half a cup of spinach', P(0.5, 'cup', 'spinach'), 'Spinach', 60, 14, 'volume_unit');
        expect(tierD(i)[0].detail).toMatch(/leafy-or-herb/);
        expect(rules({ ...i, grams: 15, kcal: 3.5 })).toEqual([]);
        // cooked spinach is dense, not leafy
        expect(rules(item('half a cup of cooked spinach', P(0.5, 'cup', 'cooked spinach'), 'Spinach, cooked', 90, 21))).toEqual([]);
    });

    it('does not flag ordinary counts and volumes', () => {
        expect(rules(item('two eggs', P(2, 'egg', 'eggs'), 'Egg', 100, 143))).toEqual([]);
        expect(rules(item('a slice of toast', P(1, 'slice', 'toast'), 'Toast', 37, 100))).toEqual([]);
        expect(rules(item('1.2 cups egg whites', P(1.2, 'cup', 'egg', { unitHint: 'white' }), 'egg white', 291.6, 160.4))).toEqual([]);
        expect(rules(item('2 tbsp light ranch', P(2, 'tbsp', 'light ranch'), 'Light ranch', 15, 40))).toEqual([]);
        expect(rules(item('1 tbsp honey', P(1, 'tbsp', 'honey'), 'Honey', 21, 64))).toEqual([]);
    });

    it('reads qty × multiplier, never qty alone (a capitalised Half is multiplier 0.5)', () => {
        const i = item('Half a cup of raw spinach', { qty: 1, multiplier: 0.5, unit: 'cup', name: 'raw spinach' }, 'Spinach', 15, 3.5);
        expect(rules(i)).toEqual([]);
        expect(rules({ ...i, grams: 60 })).toEqual(['D-volume']);
    });

    it('flags kcal/g outside 0–9 and the flat 100 g default', () => {
        expect(rules(item('butter', null, 'Butter', 10, 120))).toEqual(['D-kcal-per-g']);
        expect(rules(item('xavier', null, 'Xavier Rosé', 100, 80, 'flat_100g_default'))).toEqual(['D-flat-100g']);
    });

    it('a bare single item is not a count (a pizza is a pizza)', () => {
        expect(rules(item('a pizza', P(1, null, 'pizza'), 'Pizza', 900, 2400))).toEqual([]);
    });
});

const ev = (over: Partial<MelEvent>): MelEvent => ({
    id: 'e', utc: '2026-09-26 01:01:59', pt: '2026-09-25 18:01:59', rawLine: 'x', normalizedForm: null, foodId: 'f',
    foodName: 'F', brandName: null, source: null, servingTier: null, grams: 1, totalKcal: 1, funnelStage: null, cacheHit: null,
    ...over,
});

describe('filters', () => {
    const smores = "nine pieces of s'mores drizzilicious";
    const events = [
        ev({ id: 'organic', rawLine: smores, pt: '2026-09-25 18:01:59' }),
        ev({ id: 's60a', rawLine: smores, pt: '2026-09-27 21:02:41' }),
        ev({ id: 's60b', rawLine: smores, pt: '2026-09-27 21:02:42' }),
        ev({ id: 'sweep', rawLine: 'banana', pt: '2026-09-25 04:33:00' }),
        ev({ id: 'golden', rawLine: '200g Chicken  Breast', pt: '2026-09-25 10:00:00' }),
        ev({ id: 'resent', rawLine: 'egg', pt: '2026-09-25 11:00:00' }),
        ev({ id: 'ledger', rawLine: 'two eggs', utc: '2026-09-29 16:00:03', pt: '2026-09-29 09:00:03' }),
    ];
    const f = applyFilters(events, {
        scriptStrings: new Set([normLine('200g chicken breast')]),
        sweepStrings: new Set(['egg']),
        windows: [{ session: 'Lane A S60', startPt: '2026-09-27 21:02:36', endPt: '2026-09-27 21:02:42', source: 's' }],
        ledger: [{ line: 'two eggs and toast', startUtc: '2026-09-29 16:00:01', endUtc: '2026-09-29 16:00:06', melRawLines: ['two eggs', 'toast'] }],
    });
    const why = Object.fromEntries(f.dropped.map(d => [d.event.id, d.reason]));

    it("keeps the organic s'mores event and drops S60's two probes of the same text by WINDOW", () => {
        expect(f.kept.map(e => e.id)).toEqual(['organic']);
        expect(why.s60a).toBe('lane-a-probe');
        expect(why.s60b).toBe('lane-a-probe');
    });
    it('drops the 04 hour, script strings, sweep strings and the ledger', () => {
        expect(why).toMatchObject({ sweep: 'hour-04', golden: 'script-string', resent: 'sweep-string', ledger: 'adversary-probe' });
    });
    it('a ledger line only drops inside its own time window', () => {
        const later = applyFilters([ev({ id: 'x', rawLine: 'two eggs', utc: '2026-09-30 16:00:03', pt: '2026-09-30 09:00:03' })], {
            scriptStrings: new Set(), sweepStrings: new Set(), windows: [],
            ledger: [{ line: 'two eggs', startUtc: '2026-09-29 16:00:01', endUtc: '2026-09-29 16:00:06', melRawLines: [] }],
        });
        expect(later.kept.map(e => e.id)).toEqual(['x']);
    });
    it('groups by line × record × grams and keeps every event hour', () => {
        const g = groupEvents([ev({ id: 'a', rawLine: 'Two Eggs' }), ev({ id: 'b', rawLine: 'two  eggs', pt: '2026-09-26 08:00:00' }), ev({ id: 'c', rawLine: 'two eggs', grams: 2 })]);
        expect(g.map(x => x.events.map(e => e.id))).toEqual([['a', 'b'], ['c']]);
    });
    it('the ledger round-trips, with tabs in a line flattened', () => {
        const row = formatLedgerRow({ line: 'a\tb', startUtc: '2026-09-29 16:00:01', endUtc: '2026-09-29 16:00:06', melRawLines: ['a b', 'c'] });
        expect(parseLedger(row)).toEqual([{ line: 'a b', startUtc: '2026-09-29 16:00:01', endUtc: '2026-09-29 16:00:06', melRawLines: ['a b', 'c'] }]);
    });
});

describe('judge: fail closed', () => {
    it('every asked id gets one verdict; missing, unreadable and invented ids never read OK', () => {
        const v = readVerdicts({
            verdicts: [
                { id: 'r1', verdict: 'bad', axis: 'portion', expected_grams: 30, reason: 'r' },
                { id: 'r2', verdict: 'fine', axis: 'none', expected_grams: null, reason: '' },
                { id: 'r1', verdict: 'OK', axis: 'none', expected_grams: null, reason: 'dup' },
                { id: 'zz', verdict: 'OK', axis: 'none', expected_grams: null, reason: 'invented' },
            ],
        }, ['r1', 'r2', 'r3']);
        expect(v.map(x => [x.id, x.verdict, x.error])).toEqual([
            ['r1', 'BAD', undefined], ['r2', 'UNSURE', 'unparseable-verdict'], ['r3', 'UNSURE', 'missing-row'],
        ]);
        expect(v[0].expectedGrams).toBe(30);
    });
    it('no readable reply makes every row UNSURE', () => {
        expect(readVerdicts(null, ['a', 'b']).map(x => x.verdict)).toEqual(['UNSURE', 'UNSURE']);
    });
    it('a CLI reply from a different model than asked is refused (the `sonnet` alias trap)', () => {
        const out = JSON.stringify({ subtype: 'success', is_error: false, structured_output: { verdicts: [] }, usage: { input_tokens: 2, output_tokens: 9 }, modelUsage: { 'claude-sonnet-5': {} } });
        expect(readCliResult(out, 'claude-sonnet-5-5', 'judge', 1).call.error).toMatch(/MODEL_MISMATCH/);
        const ok = readCliResult(out.replace('"claude-sonnet-5"', '"claude-sonnet-5-5"'), 'claude-sonnet-5-5', 'judge', 1);
        expect(ok.call.error).toBeUndefined();
        expect(ok.call.outputTokens).toBe(9);
    });
    it('the CLI argv is the lean subscription form: never --bare, schema inline, no alias', () => {
        const a = claudeArgs('claude-sonnet-5-5', '/x/judge.md', { type: 'object' }, 0.5);
        expect(a).not.toContain('--bare');
        expect(a).toEqual(expect.arrayContaining(['--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence']));
        expect(a[a.indexOf('--json-schema') + 1]).toBe('{"type":"object"}');
        expect(a[a.indexOf('--model') + 1]).toBe('claude-sonnet-5-5');
    });
    it('a card carries the line, the record, grams, kcal and kcal/100 g', () => {
        expect(renderCard({ id: 'r1', line: 'x', record: 'R', brand: '', source: 'fatsecret', foodId: 'fs_1', grams: 351, kcal: 2004.2, kcalPer100g: 571, tier: 'count_unit_ai' }))
            .toBe('[r1] line: "x"\n  record: R | brand: (none) | fatsecret fs_1\n  billed: 351 g, 2004 kcal (571 kcal/100 g) | serving tier: count_unit_ai');
    });
});

/**
 * agent-screen-reconcile.test.ts — FAIL INJECTION for the two-phase agent screen.
 *
 * The phase-A/phase-C split exists because a shell script cannot spawn a Claude Code
 * agent, and it introduces a gap the single-process screen never had: a SESSION sits
 * between the row dump and the DELETE. Everything below is a way that gap can produce
 * a plausible, green-looking, WRONG evict list:
 *
 *   - an agent dies mid-batch          -> short verdict set -> its rows silently KEPT
 *   - a fan-out driver double-counts   -> totals inflated by an unknown amount
 *   - an off-by-one in the driver      -> every row judged, none of them its own
 *   - an unrecognised verdict string   -> falls through as "not a REJECT" = keep
 *   - a serving-axis REJECT            -> a DELETE that cannot fix the defect
 *   - policy drift back to `strict`    -> D1 rides in at 73.8% live false-evict
 *
 * Every block carries a POSITIVE CONTROL, per fail-closed.test.ts: a guard that
 * refuses everything is a tautology, not a test.
 *
 * NO NETWORK, NO DATABASE — only the pure exported functions run here.
 */

import {
    reconcile,
    VALID_AXES,
    VALID_VERDICTS,
    NON_EVICTING_RULES,
    type AgentVerdict,
} from '../_agent_screen_reconcile';
import { buildPins, pinOutcome, PIN_VOID_EXIT, parseAddedKeys, parseSeedLines } from '../_pin_batch_seeds';

const ROWS = [{ key: 'a lays' }, { key: 'b oreo' }, { key: 'c sprite' }];

const ok = (over: Partial<AgentVerdict> & { idx: number; key: string }): AgentVerdict => ({
    verdict: 'ACCEPT', axis: 'none', confidence: 0.9, reason: 'fine', ...over,
});

const fullAccept = (): AgentVerdict[] => ROWS.map((r, i) => ok({ idx: i, key: r.key }));

// ===========================================================================
// 1. Coverage — the fleet must account for every dumped row
// ===========================================================================

describe('reconcile: the fleet must account for every row exactly once', () => {
    it('POSITIVE CONTROL — a complete, well-formed verdict set reconciles', () => {
        const r = reconcile(ROWS, fullAccept(), []);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.counts.rows).toBe(3);
        expect(r.result.counts.accept).toBe(3);
        expect(r.result.evict).toEqual([]);
    });

    it('a DEAD AGENT (missing verdicts) refuses — never "those rows are fine"', () => {
        const short = fullAccept().slice(0, 2);
        const r = reconcile(ROWS, short, []);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        const text = r.reasons.join(' ');
        expect(text).toContain('MISSING 1 of 3');
        expect(text).toContain('silently KEEPS');
    });

    it('DUPLICATE verdicts refuse — a twice-judged batch has unknown totals', () => {
        const dup = [...fullAccept(), ok({ idx: 1, key: 'b oreo', verdict: 'REJECT', axis: 'identity' })];
        const r = reconcile(ROWS, dup, []);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reasons.join(' ')).toContain('DUPLICATE');
    });

    it('an OFF-BY-ONE driver refuses even though every row got a verdict', () => {
        // Coverage counting alone cannot see this: 3 rows, 3 verdicts, all present.
        const shifted = ROWS.map((_, i) => ok({ idx: i, key: ROWS[(i + 1) % ROWS.length].key }));
        const r = reconcile(ROWS, shifted, []);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reasons.join(' ')).toContain('MISALIGNED');
    });

    it('verdicts for a DIFFERENT dump (out-of-range idx) refuse', () => {
        const stray = [...fullAccept(), ok({ idx: 47, key: 'z from another batch' })];
        const r = reconcile(ROWS, stray, []);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reasons.join(' ')).toContain('OUT-OF-RANGE');
    });
});

// ===========================================================================
// 2. Shape — an unrecognised judgement must not become a silent KEEP
// ===========================================================================

describe('reconcile: an unreadable judgement is not an ACCEPT', () => {
    it('a verdict carrying an error field refuses', () => {
        const v = fullAccept();
        v[1] = { ...v[1], error: 'agent returned truncated JSON' };
        const r = reconcile(ROWS, v, []);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reasons.join(' ')).toContain('not an ACCEPT');
    });

    it('an unrecognised verdict string refuses rather than defaulting to keep', () => {
        const v = fullAccept();
        v[0] = { ...v[0], verdict: 'PROBABLY_FINE' as unknown as AgentVerdict['verdict'] };
        const r = reconcile(ROWS, v, []);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reasons.join(' ')).toContain('a decision nobody made');
    });

    it('an unknown axis refuses — it could smuggle a serving reject into a DELETE', () => {
        const v = fullAccept();
        v[0] = { ...v[0], verdict: 'REJECT', axis: 'portion' };
        const r = reconcile(ROWS, v, []);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reasons.join(' ')).toContain('axis');
    });

    it('the valid sets are exactly the shipped LLM_SYSTEM contract', () => {
        expect([...VALID_VERDICTS].sort()).toEqual(['ACCEPT', 'REJECT', 'UNSURE']);
        expect([...VALID_AXES].sort()).toEqual(['identity', 'key', 'none', 'nutrition', 'serving']);
    });
});

// ===========================================================================
// 3. The evict set — what a REJECT is allowed to delete
// ===========================================================================

describe('reconcile: building the evict list', () => {
    it('UNSURE never evicts — it is the human queue, not a delete', () => {
        const v = fullAccept();
        v[0] = { ...v[0], verdict: 'UNSURE', axis: 'identity' };
        const r = reconcile(ROWS, v, []);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.evict).toEqual([]);
        expect(r.result.counts.unsure).toBe(1);
    });

    it('a SERVING-axis REJECT is held back — deleting the row cannot fix a serving', () => {
        const v = fullAccept();
        v[0] = { ...v[0], verdict: 'REJECT', axis: 'serving' };
        v[1] = { ...v[1], verdict: 'REJECT', axis: 'identity' };
        const r = reconcile(ROWS, v, []);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.evict).toEqual(['b oreo']);              // identity reject only
        expect(r.result.servingAxisRejects).toEqual(['a lays']);  // reported, not deleted
        expect(r.result.counts.reject).toBe(2);
    });

    it('the list is the UNION of Tier D and the agents, deduplicated and sorted', () => {
        const v = fullAccept();
        v[2] = { ...v[2], verdict: 'REJECT', axis: 'identity' };
        const r = reconcile(ROWS, v, ['a lays', 'c sprite']);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.evict).toEqual(['a lays', 'c sprite']);
        expect(r.result.counts.tierDEvict).toBe(2);
        expect(r.result.counts.agentEvict).toBe(1);
        expect(r.result.counts.overlap).toBe(1);
    });

    it('a Tier-D list from a DIFFERENT run refuses', () => {
        const r = reconcile(ROWS, fullAccept(), ['not in this dump']);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reasons.join(' ')).toContain('different runs');
    });
});

// ===========================================================================
// 4. Policy drift — D1/D5/D6 must not evict behind the agents' reputation
// ===========================================================================

describe('reconcile: rules demoted for cause cannot carry an eviction alone', () => {
    const hit = (rule: string) => ({ rule: rule as never, severity: 'EVICT' as const, detail: '' });

    it('an eviction resting ONLY on D1 refuses (73.8% live false-evict)', () => {
        const r = reconcile(ROWS, fullAccept(), ['a lays'], [{ key: 'a lays', tierD: [hit('D1')] }]);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reasons.join(' ')).toContain('demoted for cause');
    });

    it('POSITIVE CONTROL — the same row evicting on D3 as well is allowed through', () => {
        const r = reconcile(ROWS, fullAccept(), ['a lays'], [{ key: 'a lays', tierD: [hit('D1'), hit('D3')] }]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.evict).toEqual(['a lays']);
    });

    it('the demoted set is exactly D1, D5, D6', () => {
        expect([...NON_EVICTING_RULES].sort()).toEqual(['D1', 'D5', 'D6']);
    });
});

// ===========================================================================
// 5. Pins — zero pins is VOID, and a pin must never be a guess
// ===========================================================================

describe('_pin_batch_seeds: pin coverage IS screen coverage', () => {
    // A stand-in for canonicalizeCacheKey: lowercase, token-sort. The real one is
    // imported by the script itself; re-deriving it HERE would test the stand-in.
    const canon = (s: string) => s.toLowerCase().split(/\s+/).sort().join(' ');

    // NOTE the shapes below: the KEY is token-sorted ('chips lays'), the seed phrase is
    // not ('lays chips'). That asymmetry is the reason pins exist at all — handing the
    // judge the key instead of the phrase reads as a different product name.
    it('POSITIVE CONTROL — seeds that canonicalize onto added keys pin at 100%', () => {
        const b = buildPins(['chips lays', 'oreo'], ['lays chips', 'oreo'], canon);
        expect(b.pins.get('chips lays')).toBe('lays chips');
        expect(b.pins.get('oreo')).toBe('oreo');
        expect(b.unpinned).toEqual([]);
    });

    it('a seed the normalizer renamed simply MISSES — it never mispins another row', () => {
        // "bell pepper" is rewritten to "capsicum" before keying, so its seed cannot
        // reach the row; the row stays unpinned rather than borrowing a neighbour.
        const b = buildPins(['capsicum'], ['bell pepper'], canon);
        expect(b.pins.size).toBe(0);
        expect(b.unpinned).toEqual(['capsicum']);
        expect(b.seedsOffTarget).toBe(1);
    });

    it('two seeds landing on one key are REPORTED, not silently resolved', () => {
        const b = buildPins(['chips lays'], ['lays chips', 'chips lays'], canon);
        expect(b.collisions).toHaveLength(1);
        expect(b.collisions[0].key).toBe('chips lays');
        expect(b.pins.get('chips lays')).toBe('lays chips');   // first wins, deterministically
    });

    it('--merge fills only the gaps, and seed pins WIN where both have a phrase', () => {
        const merged = new Map([['chips lays', 'telemetry phrase'], ['oreo', 'oreo cookies']]);
        const b = buildPins(['chips lays', 'oreo'], ['lays chips'], canon, merged);
        expect(b.pins.get('chips lays')).toBe('lays chips');    // the seed, not telemetry
        expect(b.pins.get('oreo')).toBe('oreo cookies');        // gap filled
        expect(b.fromMerge).toBe(1);
    });

    it('--merge never pins a key the batch did not add', () => {
        const merged = new Map([['some other key', 'phrase']]);
        const b = buildPins(['chips lays'], ['lays chips'], canon, merged);
        expect(b.pins.has('some other key')).toBe(false);
    });

    it('pinning NOTHING is VOID, distinct from success and from error', () => {
        const o = pinOutcome(0, 107);
        expect(o.code).toBe(PIN_VOID_EXIT);
        expect(o.code).not.toBe(0);
        expect(o.code).not.toBe(2);
        expect(o.lines.join(' ')).toContain('0 / 107');
        expect(o.lines.join(' ')).toContain('produced NOTHING');
    });

    it('POSITIVE CONTROL — one pin is a result', () => {
        expect(pinOutcome(1, 107).code).toBe(0);
    });

    it('added.txt is key<TAB>details — the details are never mistaken for a key', () => {
        expect(parseAddedKeys('a lays\tLays | openfoodfacts | ai\nb oreo\tOreo | off | ai\n'))
            .toEqual(['a lays', 'b oreo']);
    });

    it('a batch seed file drops comments and blanks', () => {
        expect(parseSeedLines('# domain: chains\n\nolive garden breadstick\n  \nchipotle bowl\n'))
            .toEqual(['olive garden breadstick', 'chipotle bowl']);
    });
});

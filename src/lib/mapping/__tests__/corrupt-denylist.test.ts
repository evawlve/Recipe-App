/**
 * Unit tests for the corrupt OFF record denylist seam (corrupt-denylist.ts).
 *
 * The denylist is a curated set of triage-confirmed NUTRITION-corrupt OFF
 * barcodes (2026-07-20). The accessor must handle both prefixed ("off_X") and
 * bare barcode forms; the corrupt-marking PR later replaces the implementation
 * behind isDenylistedOffRecord without touching callers.
 */

import {
    CORRUPT_HANDMARKS,
    CORRUPT_HANDMARK_BARCODES,
    CORRUPT_HANDMARK_CLASSES,
    denylistSourceFor,
    isDenylistedOffRecord,
} from '../corrupt-denylist';
import denylist from '../data/corrupt-off-denylist.json';

describe('isDenylistedOffRecord', () => {
    it('returns true for a known corrupt barcode in prefixed form', () => {
        expect(isDenylistedOffRecord('off_0062020001849')).toBe(true); // nutella
        expect(isDenylistedOffRecord('off_0859710005238')).toBe(true); // tuna
    });

    it('returns true for a known corrupt barcode in bare form', () => {
        expect(isDenylistedOffRecord('0062020001849')).toBe(true);
        expect(isDenylistedOffRecord('0840609112113')).toBe(true); // lemon kJ-as-kcal
    });

    it('resolves every denylist entry in both forms', () => {
        for (const entry of denylist) {
            expect(isDenylistedOffRecord(entry.barcode)).toBe(true);
            expect(isDenylistedOffRecord(`off_${entry.barcode}`)).toBe(true);
        }
    });

    it('returns false for unknown barcodes', () => {
        expect(isDenylistedOffRecord('off_0000000000000')).toBe(false);
        expect(isDenylistedOffRecord('4099100088526')).toBe(false);
    });

    it('returns false for non-OFF and malformed ids', () => {
        expect(isDenylistedOffRecord('fdc_171705')).toBe(false);
        expect(isDenylistedOffRecord('fatsecret_12345')).toBe(false);
        expect(isDenylistedOffRecord('off_')).toBe(false);
        expect(isDenylistedOffRecord('')).toBe(false);
    });

    it('never denylists the legitimate whole-egg record (identity-class, plan-excluded)', () => {
        expect(isDenylistedOffRecord('off_0706429100283')).toBe(false);
    });

    it('denylist entries are well-formed (barcode digits, reason, source)', () => {
        expect(denylist.length).toBeGreaterThan(0);
        const barcodes = new Set<string>();
        for (const entry of denylist) {
            expect(entry.barcode).toMatch(/^\d+$/);
            expect(entry.reason.length).toBeGreaterThan(0);
            expect(entry.source).toBe('triage-2026-07-20');
            expect(barcodes.has(entry.barcode)).toBe(false); // no duplicates
            barcodes.add(entry.barcode);
        }
    });
});

/**
 * The hand-authored corrupt marks joined the same lookup on 2026-08-12. These
 * tests exist to hold two properties that the winner-diff gate structurally
 * cannot see:
 *
 *  (a) ADDITIVITY. The 400-query frozen pool used to gate the union contained
 *      ZERO of the handmark barcodes (measured 2026-08-12: 11,014 candidates,
 *      0 hits), so its "0 WINNER-CHANGED" is a statement about rows that carry
 *      no mark — the right statement, but only half the claim. The other half
 *      is that the pre-existing denylist behaviour did not move, which is a
 *      set-membership property and belongs here.
 *  (b) SCHEMA. `resolveJsonModule` widens JSON string literals, so `class`
 *      cannot be a union type at the import site. The compiler will catch a
 *      missing or wrongly-typed field; only a test catches a typo'd class.
 */
describe('hand-authored corrupt marks (corrupt-off-handmarks.json)', () => {
    it('resolves every handmark barcode and every co-marked group member, both forms', () => {
        expect(CORRUPT_HANDMARK_BARCODES.length).toBeGreaterThan(0);
        for (const barcode of CORRUPT_HANDMARK_BARCODES) {
            expect(isDenylistedOffRecord(barcode)).toBe(true);
            expect(isDenylistedOffRecord(`off_${barcode}`)).toBe(true);
        }
    });

    it('is strictly ADDITIVE: the two populations are disjoint and every prior entry still resolves', () => {
        const handmarked = new Set(CORRUPT_HANDMARK_BARCODES);
        for (const entry of denylist) {
            // no handmark may shadow, restate or silently re-author a 2026-07-20 entry
            expect(handmarked.has(entry.barcode)).toBe(false);
            expect(isDenylistedOffRecord(entry.barcode)).toBe(true);
            expect(denylistSourceFor(entry.barcode)).toBe('triage-denylist');
        }
        // union size == sum of parts, i.e. nothing was absorbed or dropped
        const union = new Set([...denylist.map(e => e.barcode), ...CORRUPT_HANDMARK_BARCODES]);
        expect(union.size).toBe(denylist.length + CORRUPT_HANDMARK_BARCODES.length);
    });

    it('leaves ids that carry no mark exactly where they were', () => {
        const marked = new Set([...denylist.map(e => e.barcode), ...CORRUPT_HANDMARK_BARCODES]);
        const unmarked = [
            'off_0706429100283',   // legitimate whole-egg record
            'off_0000000000000',
            'off_4099100088526',
            '4099100088526',
            'off_9329937007601',   // Gotzinger Chicago Hot Dog — the row the Sonic pull did NOT touch
            'off_0850210008118',
            'fdc_171705',
            'fatsecret_12345',
            'fs_63588',
            'off_',
            '',
        ];
        for (const id of unmarked) {
            const bare = id.startsWith('off_') ? id.slice(4) : id;
            expect(marked.has(bare)).toBe(false);
            expect(isDenylistedOffRecord(id)).toBe(false);
            expect(denylistSourceFor(id)).toBeNull();
        }
    });

    it('reports handmark provenance separately from the 2026-07-20 triage list', () => {
        for (const barcode of CORRUPT_HANDMARK_BARCODES) {
            expect(denylistSourceFor(barcode)).toBe('handmark');
            expect(denylistSourceFor(`off_${barcode}`)).toBe('handmark');
        }
    });

    it('every handmark entry carries the fields this lookup depends on', () => {
        // The EVIDENCE fields (`observed`) are corrupt-mark.ts's contract, not
        // this module's — decideHandMark() re-verifies them against the live
        // row. What matters here is only which barcodes get suppressed.
        expect(CORRUPT_HANDMARKS.length).toBeGreaterThan(0);
        for (const entry of CORRUPT_HANDMARKS) {
            expect(entry.barcode).toMatch(/^\d+$/);
            expect(CORRUPT_HANDMARK_CLASSES).toContain(entry.class);
            expect(entry.seed.trim().length).toBeGreaterThan(0);
            expect(entry.reason.trim().length).toBeGreaterThan(0);
            expect(entry.source.trim().length).toBeGreaterThan(0);
            expect(entry.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(Array.isArray(entry.group)).toBe(true);
            for (const member of entry.group) {
                expect(member.barcode).toMatch(/^\d+$/);
                expect(member.barcode).not.toBe(entry.barcode);
                expect(['duplicate-group', 'panel-twin']).toContain(member.basis);
            }
            for (const excluded of entry.groupExclusions ?? []) {
                expect(excluded.barcode).toMatch(/^\d+$/);
                expect(excluded.why.trim().length).toBeGreaterThan(0);
            }
        }
    });

    it('an EXPLICITLY DECLINED group member is never suppressed', () => {
        // groupExclusions is the author saying "I looked at this row and it is
        // a legitimately different product that merely shares a kcal value".
        // Leaking one into the rank-time set would suppress a good record on
        // the strength of a decision that went the other way.
        const excluded = CORRUPT_HANDMARKS.flatMap(e => (e.groupExclusions ?? []).map(x => x.barcode));
        expect(excluded.length).toBeGreaterThan(0); // the assertion must not be vacuous
        for (const barcode of excluded) {
            expect(CORRUPT_HANDMARK_BARCODES).not.toContain(barcode);
            expect(isDenylistedOffRecord(barcode)).toBe(false);
            expect(isDenylistedOffRecord(`off_${barcode}`)).toBe(false);
        }
    });

    it('no barcode is authored twice, and no group member is also an authored barcode', () => {
        const authored = CORRUPT_HANDMARKS.map(e => e.barcode);
        expect(new Set(authored).size).toBe(authored.length);
        // A group member that is elsewhere an authored entry would be marked
        // under two different reason strings, and the --clear-prefix rollback
        // would then be non-selective.
        const authoredSet = new Set(authored);
        const members = CORRUPT_HANDMARKS.flatMap(e => e.group.map(m => m.barcode));
        for (const member of members) expect(authoredSet.has(member)).toBe(false);
        expect(new Set(members).size).toBe(members.length);
        expect(CORRUPT_HANDMARK_BARCODES.length).toBe(authored.length + members.length);
    });
});

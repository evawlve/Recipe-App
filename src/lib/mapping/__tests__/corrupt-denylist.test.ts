/**
 * Unit tests for the corrupt OFF record denylist seam (corrupt-denylist.ts).
 *
 * The denylist is a curated set of triage-confirmed NUTRITION-corrupt OFF
 * barcodes (2026-07-20). The accessor must handle both prefixed ("off_X") and
 * bare barcode forms; the corrupt-marking PR later replaces the implementation
 * behind isDenylistedOffRecord without touching callers.
 */

import { isDenylistedOffRecord } from '../corrupt-denylist';
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

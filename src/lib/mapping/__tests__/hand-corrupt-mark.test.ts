/**
 * The hand-authored corruptReason replay gate.
 *
 * WHAT THESE TESTS ARE FOR. A hand mark is the one curation population nothing
 * re-derives, so it has to be replayed from a file across an OFF refresh. The
 * hazard that makes a replay different from a restore is that a refresh can
 * deliver a CORRECTED panel: replaying a stored conclusion onto a row OFF has
 * since fixed suppresses a good record permanently, and that is precisely the
 * argument that justifies re-deriving the detector marks instead of replaying
 * them. So every test below pins a REFUSAL — the cases where the authored
 * evidence no longer describes the live row.
 *
 * Each `it` is written so it fails if the guard it names is deleted, and the
 * "still marks" cases exist so a mutation that makes a guard fire
 * unconditionally is caught too (a check that always refuses is as broken as
 * one that never does, and it fails silently as "nothing to replay").
 */

import {
    HAND_MARK_PREFIX,
    HandMarkEntry,
    HandMarkLiveRow,
    HandMarkUnit,
    decideHandMark,
    handMarkGroupGaps,
    handMarkReason,
    handMarkServingDrifted,
    handMarkUnitValid,
    handMarkUnits,
    isHandMarkReason,
    readLivePanel,
} from '../corrupt-mark';

/** The real Sonic row, as measured on the live corpus 2026-08-12: a whole-item
 *  panel stored in the per-100g field, servingGrams a meaningless 100. */
const SONIC = {
    name: 'Sonic, 6&quot; Chicago Dog',
    kcal100: 388,
    protein: 11,
    fat: 20,
    carbs: 41,
    servingGrams: 100,
};

function unit(over: Partial<HandMarkUnit> = {}): HandMarkUnit {
    return {
        barcode: '1781154461976987405190',
        class: 'panel',
        authoredAt: '2026-08-12',
        observed: { ...SONIC },
        isGroupMember: false,
        ...over,
    };
}

function live(over: Partial<HandMarkLiveRow> = {}): HandMarkLiveRow {
    return {
        barcode: '1781154461976987405190',
        name: SONIC.name,
        corruptReason: null,
        kcal100: SONIC.kcal100,
        protein: SONIC.protein,
        fat: SONIC.fat,
        carbs: SONIC.carbs,
        servingGrams: SONIC.servingGrams,
        ...over,
    };
}

describe('decideHandMark — the replay writes only while the evidence still holds', () => {
    it('marks when every observed field still matches the live row', () => {
        // Vacuity guard for the whole file: if this stops passing, every refusal
        // test below becomes trivially green.
        expect(decideHandMark(unit(), live())).toEqual({
            mark: true,
            reason: 'hand-triage-2026-08-12:panel',
        });
    });

    it('refuses a row that is gone (row_missing)', () => {
        expect(decideHandMark(unit(), null)).toEqual({ mark: false, skip: 'row_missing' });
    });

    it('refuses a row another instrument already marked (already_marked)', () => {
        // Idempotent re-run AND non-destructive of a detector mark: whichever
        // wrote first owns the row. Deleting this check would let a replay
        // overwrite a detector reason with a hand one and break the census.
        const d = decideHandMark(unit(), live({ corruptReason: 'kcal-impossible:direct' }));
        expect(d.mark).toBe(false);
        expect(d).toMatchObject({ skip: 'already_marked', detail: 'kcal-impossible:direct' });
    });

    it('refuses when the panel has moved beyond tolerance (panel_moved)', () => {
        // THE reason a replay is not a restore: OFF corrected the row.
        expect(decideHandMark(unit(), live({ kcal100: 168 }))).toMatchObject({
            mark: false, skip: 'panel_moved',
        });
        // Every macro is checked, not just calories — a corrected fat with an
        // unchanged energy is still a different panel.
        expect(decideHandMark(unit(), live({ fat: 8 }))).toMatchObject({ mark: false, skip: 'panel_moved' });
        expect(decideHandMark(unit(), live({ protein: 22 }))).toMatchObject({ mark: false, skip: 'panel_moved' });
        expect(decideHandMark(unit(), live({ carbs: 12 }))).toMatchObject({ mark: false, skip: 'panel_moved' });
    });

    it('refuses when a nutrient has become unreadable (panel_moved, fail-closed)', () => {
        // A null is not "unchanged". This is the shape a schema/ingest change
        // takes, and defaulting it to 0 would compare 0 against 388 anyway —
        // but defaulting it to the AUTHORED value would silently pass.
        expect(decideHandMark(unit(), live({ kcal100: null }))).toMatchObject({ mark: false, skip: 'panel_moved' });
    });

    it('still marks inside the 0.5 tolerance (label-rounding drift is not a correction)', () => {
        // Guards the opposite mutation: a tolerance of 0 would refuse the whole
        // batch on float noise and read as "nothing to replay".
        expect(decideHandMark(unit(), live({ kcal100: 388.4, fat: 20.4 })).mark).toBe(true);
    });

    it('refuses when the row is no longer the same food (name_moved)', () => {
        // For an identity-class mark this is the ONLY correction signal there
        // is: the panel can stay byte-identical while the row stops being the
        // food the human judged. The SPARKLING ICE row carries a bread-roll
        // panel; if OFF renames it to the bun it actually is, the mark is wrong.
        const ice = unit({
            class: 'identity',
            observed: { name: 'SPARKLING ICE', kcal100: 256.4, protein: 7.69, fat: 2.56, carbs: 53.85, servingGrams: 39 },
        });
        const liveIce = live({ name: 'Bread Roll', kcal100: 256.4, protein: 7.69, fat: 2.56, carbs: 53.85, servingGrams: 39 });
        expect(decideHandMark(ice, liveIce)).toMatchObject({ mark: false, skip: 'name_moved' });
    });

    it('still marks when the name was only re-punctuated', () => {
        // Names are compared by normalizeNameKey, not raw equality: OFF
        // re-punctuates constantly and that is not a correction. Tightening
        // this to string equality would retire the whole batch on cosmetics.
        expect(decideHandMark(unit(), live({ name: 'sonic,   6&quot;   chicago  dog' })).mark).toBe(true);
    });

    it('refuses a serving-class mark whose serving mass moved (serving_moved)', () => {
        // The kefir shape: panel sound, servingGrams a bogus 5 g. The serving
        // field IS the evidence, so a move invalidates the verdict.
        const kefir = unit({
            class: 'serving',
            observed: { name: 'Kefir', kcal100: 61, protein: 5, fat: 4.4, carbs: 8.3, servingGrams: 5 },
        });
        const fixed = live({ name: 'Kefir', kcal100: 61, protein: 5, fat: 4.4, carbs: 8.3, servingGrams: 245 });
        expect(decideHandMark(kefir, fixed)).toMatchObject({ mark: false, skip: 'serving_moved' });
        // A row that GAINS or LOSES a serving mass has moved too — null is a
        // real observation, not "unknown".
        expect(decideHandMark(kefir, live({ name: 'Kefir', kcal100: 61, protein: 5, fat: 4.4, carbs: 8.3, servingGrams: null })))
            .toMatchObject({ mark: false, skip: 'serving_moved' });
    });

    it('does NOT block a panel-class mark on a serving-mass edit', () => {
        // The class condition is load-bearing in both directions: for a panel
        // mark the panel is the evidence, and retiring a still-true mark on an
        // unrelated field edit would quietly shrink the batch. Deleting the
        // `class === 'serving'` condition makes this test fail.
        const drifted = live({ servingGrams: 236 });
        expect(decideHandMark(unit(), drifted).mark).toBe(true);
        // ...but the drift is still visible to the caller, which reports it.
        expect(handMarkServingDrifted(unit(), drifted)).toBe(true);
        expect(handMarkServingDrifted(unit(), live())).toBe(false);
    });

    it('refuses a structurally invalid unit rather than writing on a partial record', () => {
        expect(decideHandMark(unit({ barcode: '' }), live())).toEqual({ mark: false, skip: 'entry_invalid' });
        expect(decideHandMark(unit({ authoredAt: '12 Aug 2026' }), live())).toEqual({ mark: false, skip: 'entry_invalid' });
        expect(decideHandMark(unit({ class: 'nutrition' as never }), live())).toEqual({ mark: false, skip: 'entry_invalid' });
        expect(decideHandMark(unit({ observed: { ...SONIC, kcal100: NaN } }), live())).toEqual({ mark: false, skip: 'entry_invalid' });
        expect(decideHandMark(unit({ observed: { ...SONIC, name: '  ' } }), live())).toEqual({ mark: false, skip: 'entry_invalid' });
    });

    it('accepts a null serving mass as a real observation, not a missing field', () => {
        const noServing = unit({ observed: { ...SONIC, servingGrams: null } });
        expect(handMarkUnitValid(noServing)).toBe(true);
        expect(decideHandMark(noServing, live({ servingGrams: null })).mark).toBe(true);
    });
});

describe('the reason string is the rollback selector', () => {
    it('is hand-triage-<authoredAt>:<class>, so split_part(:,1) is one generation per batch', () => {
        expect(handMarkReason({ class: 'panel', authoredAt: '2026-08-12' })).toBe('hand-triage-2026-08-12:panel');
        expect(handMarkReason({ class: 'identity', authoredAt: '2026-08-12' })).toBe('hand-triage-2026-08-12:identity');
        // `mark-corrupt-off.ts --clear --clear-prefix hand-triage-2026-08-12`
        // matches on LIKE '<prefix>%', so the date must come before the class or
        // the rollback selects every batch ever written.
        expect(handMarkReason({ class: 'panel', authoredAt: '2026-08-12' }).startsWith('hand-triage-2026-08-12')).toBe(true);
    });

    it('is distinguishable from every detector generation', () => {
        expect(isHandMarkReason('hand-triage-2026-08-12:panel')).toBe(true);
        for (const detector of ['panel-low:direct', 'kcal-impossible:direct', 'panel-inflated-family:sibling-serving']) {
            expect(isHandMarkReason(detector)).toBe(false);
        }
        expect(isHandMarkReason(null)).toBe(false);
        expect(HAND_MARK_PREFIX).toBe('hand-triage-');
    });
});

describe('handMarkGroupGaps — the fail-closed duplicate-group gate', () => {
    const entry: HandMarkEntry = {
        barcode: 'T',
        class: 'panel',
        seed: 'sour cream',
        reason: 'panel is half the truth',
        source: 'test',
        authoredAt: '2026-08-12',
        observed: { name: 'Sour cream', kcal100: 100, protein: 3.33, fat: 6.67, carbs: 6.67, servingGrams: null },
        group: [{ barcode: 'TWIN', basis: 'panel-twin', observed: { name: 'Sour cream', kcal100: 100, protein: 3.33, fat: 6.67, carbs: 6.67, servingGrams: null } }],
        groupExclusions: [{ barcode: 'DECLINED', why: 'shares only the calorie value' }],
    };

    it('reports a live group member the entry neither marks nor declines', () => {
        // This is the §3.2 mechanism: dedupe-off-mark.ts re-elects from scratch
        // and prefers a CLEAN row, so an unmarked twin becomes the next
        // representative and puts the identical bad panel back in the index.
        expect(handMarkGroupGaps(entry, ['TWIN', 'DECLINED', 'UNSEEN'])).toEqual(['UNSEEN']);
    });

    it('counts a marked member as covered', () => {
        expect(handMarkGroupGaps(entry, ['TWIN'])).toEqual([]);
    });

    it('counts an explicitly declined member as covered — a decline must be visible, not an omission', () => {
        expect(handMarkGroupGaps(entry, ['DECLINED'])).toEqual([]);
    });

    it('counts a member another instrument already marked as covered', () => {
        // Already out of the index, so the election cannot promote it for being
        // clean. Without this the batch would be permanently unapplyable the
        // moment a detector reached one of its group members.
        expect(handMarkGroupGaps(entry, ['UNSEEN'], new Set(['UNSEEN']))).toEqual([]);
    });

    it('never reports the target itself', () => {
        expect(handMarkGroupGaps(entry, ['T'])).toEqual([]);
    });

    it('does NOT treat duplicateOfBarcode as coverage', () => {
        // Deliberately not testable through this function — it takes barcodes,
        // not rows — but pinned as intent: the caller passes members regardless
        // of duplicateOfBarcode, because dedupe clears that column every run.
        expect(handMarkGroupGaps(entry, ['CURRENTLY_A_DUPLICATE'])).toEqual(['CURRENTLY_A_DUPLICATE']);
    });
});

describe('handMarkUnits — one entry, one reason, every member verified the same way', () => {
    it('flattens the target and its group, carrying class and authoring date to members', () => {
        const entry: HandMarkEntry = {
            barcode: 'T', class: 'identity', seed: 's', reason: 'r', source: 'x', authoredAt: '2026-08-12',
            observed: { name: 'N', kcal100: 1, protein: 0, fat: 0, carbs: 0, servingGrams: null },
            group: [{ barcode: 'M', basis: 'duplicate-group', observed: { name: 'N', kcal100: 1, protein: 0, fat: 0, carbs: 0, servingGrams: null } }],
        };
        const units = handMarkUnits(entry);
        expect(units.map(u => [u.barcode, u.isGroupMember, u.class, u.basis])).toEqual([
            ['T', false, 'identity', undefined],
            ['M', true, 'identity', 'duplicate-group'],
        ]);
        // Both write the SAME reason string, which is what makes one
        // --clear-prefix reverse the whole group.
        expect(units.map(u => handMarkReason(u))).toEqual([
            'hand-triage-2026-08-12:identity', 'hand-triage-2026-08-12:identity',
        ]);
    });
});

describe('readLivePanel — the panel comparison and the marker read the row the same way', () => {
    it('reads the calories key, and falls back to energy/kcal', () => {
        const base = { barcode: 'b', name: 'n', corruptReason: null, servingGrams: 10 };
        expect(readLivePanel({ ...base, nutrientsPer100g: { calories: 388, protein: 11, fat: 20, carbs: 41 } }).kcal100).toBe(388);
        expect(readLivePanel({ ...base, nutrientsPer100g: { energy: 250 } }).kcal100).toBe(250);
        expect(readLivePanel({ ...base, nutrientsPer100g: { kcal: 70 } }).kcal100).toBe(70);
    });

    it('returns null rather than 0 for a missing or non-numeric nutrient', () => {
        // 0 is a legitimate panel value (a diet soda), so coercing a missing
        // field to 0 would make "the panel is unreadable" indistinguishable
        // from "the panel is zero" — and decideHandMark treats those
        // differently on purpose.
        const p = readLivePanel({ barcode: 'b', name: 'n', corruptReason: null, servingGrams: null, nutrientsPer100g: { calories: '388' } });
        expect(p.kcal100).toBeNull();
        expect(p.protein).toBeNull();
        expect(readLivePanel({ barcode: 'b', name: 'n', corruptReason: null, servingGrams: null, nutrientsPer100g: null }).kcal100).toBeNull();
    });
});

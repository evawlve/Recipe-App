/**
 * The hand-mark replay script's gates: the approval plan, the duplicate-group
 * expansion, and the write statement.
 *
 * Everything exercised here is pure — the script's DB reads are inputs to
 * buildPlan(), so the entire decision surface (which rows are written, which
 * are refused, and whether a batch is applyable at all) is testable without a
 * database. That is deliberate: the failure this machinery exists to prevent is
 * silent and only observable weeks later, on the next dedupe or refresh run.
 *
 * Each `it` names the guard it kills. The "still applies" cases are the vacuity
 * guards — a gate that refuses everything is as broken as one that refuses
 * nothing, and it fails quietly as "nothing to replay".
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    BuildPlanInput,
    GROUP_NOT_SCANNED,
    GroupClassification,
    HANDMARKS_PATH,
    HandMarkPlan,
    OffRow,
    buildMarkStatement,
    buildPlan,
    classifyGroupCandidates,
    offGroupKey,
    parseHandmarks,
    parseArgs,
    prefilterStem,
    reconcileWithPlan,
    refuseApply,
    refuseApplySet,
    replaySet,
    sha256Hex,
    validatePlanText,
} from '../replay-hand-corrupt-marks';
import { HandMarkEntry } from '../../src/lib/mapping/corrupt-mark';
import { normalizeNameKey } from '../../src/lib/search/dedupe-candidates';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function row(over: Partial<OffRow> & Pick<OffRow, 'barcode' | 'name'>): OffRow {
    return {
        brandName: null,
        nutrientsPer100g: { calories: 100, protein: 3.33, fat: 6.67, carbs: 6.67 },
        servingGrams: null,
        corruptReason: null,
        duplicateOfBarcode: null,
        ...over,
    };
}

function entry(over: Partial<HandMarkEntry> = {}): HandMarkEntry {
    return {
        barcode: 'T',
        class: 'panel',
        seed: 'sour cream',
        reason: 'panel is half the truth',
        source: 'test',
        authoredAt: '2026-08-12',
        observed: { name: 'Sour cream', kcal100: 100, protein: 3.33, fat: 6.67, carbs: 6.67, servingGrams: null },
        group: [],
        ...over,
    };
}

function planInput(over: Partial<BuildPlanInput> = {}): BuildPlanInput {
    const e = over.entries ?? [entry()];
    const live = over.liveByBarcode ?? new Map(e.map(x => [x.barcode, row({ barcode: x.barcode, name: x.observed.name })]));
    const groups = over.groups ?? new Map(e.map(x => [x.barcode, { duplicateGroup: [], panelTwins: [], calorieTwins: [] } as GroupClassification | null]));
    return {
        entries: e,
        handmarksSha256: 'a'.repeat(64),
        liveByBarcode: live,
        groups,
        cacheRows: new Map(),
        censusBefore: { 'panel-low': 5362 },
        at: '2026-08-12T00:00:00.000Z',
        ...over,
    };
}

// ---------------------------------------------------------------------------

describe('prefilterStem — the corpus narrowing must never miss a group member', () => {
    it('returns a stem the singular AND every plural form of that token contains', () => {
        // SOUNDNESS PROPERTY. Two rows share a normalizeNameKey only if each key
        // token appears in the other raw name as some form that singularizes to
        // it. If the stem were not contained in every such form, the scan would
        // miss a live twin, report an empty group, and the batch would write a
        // mark the next dedupe run reverts — silently.
        const cases: Array<[string, string[]]> = [
            ['Danish Pastry', ['Danish Pastries', 'Pastry Danish']],
            ['Whataburger, Taquito', ['Whataburger Taquitos']],
            ['Peanut Butter Granola', ['Granolas, peanut butter']],
            ['Arancini', ['ARANCINI']],
        ];
        for (const [name, variants] of cases) {
            const stem = prefilterStem(name)!;
            expect(stem.length).toBeGreaterThanOrEqual(3);
            for (const v of variants) {
                expect(normalizeNameKey(v)).toBe(normalizeNameKey(name)); // the variant really is a group member
                expect(v.toLowerCase()).toContain(stem);                  // ...and the prefilter finds it
            }
        }
    });

    it('strips a trailing y so the -ies plural still matches', () => {
        // normalizeNameKey singularizes blueberries -> blueberry, so a raw
        // "Blueberries" row IS a group member of a "Blueberry" row; without the
        // y-strip the stem "blueberry" would not be contained in it and the
        // scan would report an empty group.
        expect(prefilterStem('Blueberry Muffin')).toBe('blueberr');
        expect('blueberries muffin'.toLowerCase()).toContain('blueberr');
        expect(normalizeNameKey('Blueberries Muffin')).toBe(normalizeNameKey('Blueberry Muffin'));
    });

    it('picks the LONGEST token, because a short one does not narrow the scan', () => {
        expect(prefilterStem('Danish Pastry')).toBe('danish');
    });

    it('returns null when no token is long enough to narrow a million rows', () => {
        // Fail-closed input to the caller: a null stem must make the entry
        // unscannable, not scanned with a useless filter.
        expect(prefilterStem('a of')).toBeNull();
        expect(prefilterStem('')).toBeNull();
    });
});

describe('classifyGroupCandidates — three bases, and only two of them are blocking', () => {
    const target = row({ barcode: 'T', name: 'Sour cream' });

    it('finds the dedupe group the election can promote from', () => {
        // Same name key, same brand, same macro bucket => same groupKey. This is
        // the Sonic/Whataburger shape measured live 2026-08-12.
        const twin = row({ barcode: 'D', name: 'Sour cream' });
        expect(offGroupKey(twin)).toBe(offGroupKey(target));
        const g = classifyGroupCandidates(target, [target, twin]);
        expect(g.duplicateGroup.map(r => r.barcode)).toEqual(['D']);
        expect(g.panelTwins).toEqual([]);
    });

    it('finds a byte-identical panel under another brand as a panel-twin', () => {
        // Different groupKey (brand differs) so dedupe never touches it, but the
        // re-resolution can land on it: the 2026-08-08 eviction no-op one layer
        // up. Measured shape: 01615470 [Friendly Farms] against 0065900106627.
        const twin = row({ barcode: 'P', name: 'Sour cream', brandName: 'Friendly Farms' });
        expect(offGroupKey(twin)).not.toBe(offGroupKey(target));
        const g = classifyGroupCandidates(target, [target, twin]);
        expect(g.panelTwins.map(r => r.barcode)).toEqual(['P']);
    });

    it('classifies a same-name row that shares ONLY the calorie value as review, never as a member', () => {
        // The false-positive surface. A 100 kcal/100g row named "Sour cream"
        // with a different fat can legitimately be a light product, and a mark
        // deletes it from the corpus permanently. Measured: 7 of the 8
        // calorie-sharing sour-cream rows are this, not twins.
        const light = row({ barcode: 'C', name: 'Sour Cream', nutrientsPer100g: { calories: 100, protein: 3.33, fat: 5, carbs: 10 } });
        const g = classifyGroupCandidates(target, [target, light]);
        expect(g.calorieTwins.map(r => r.barcode)).toEqual(['C']);
        expect(g.duplicateGroup).toEqual([]);
        expect(g.panelTwins).toEqual([]);
    });

    it('ignores a same-panel row with a different name', () => {
        const other = row({ barcode: 'X', name: 'Creme fraiche' });
        const g = classifyGroupCandidates(target, [target, other]);
        expect([...g.duplicateGroup, ...g.panelTwins, ...g.calorieTwins]).toEqual([]);
    });

    it('never classifies the target as its own group member', () => {
        const g = classifyGroupCandidates(target, [target]);
        expect([...g.duplicateGroup, ...g.panelTwins, ...g.calorieTwins]).toEqual([]);
    });
});

describe('buildPlan — the group gate is fail-closed at the ENTRY, not per row', () => {
    it('writes every verified unit when the group is complete', () => {
        const plan = buildPlan(planInput());
        expect(plan.write).toEqual([{ barcode: 'T', reason: 'hand-triage-2026-08-12:panel' }]);
        expect(plan.entries[0].groupGaps).toEqual([]);
    });

    it('writes NOTHING for an entry with an uncovered live group member', () => {
        // Not "writes the target and skips the member": a partially marked group
        // is exactly the state dedupe-off-mark.ts re-elects out of, so the whole
        // entry is held. Deleting the `gaps.length === 0` condition makes this
        // fail.
        const groups = new Map<string, GroupClassification | null>([
            ['T', { duplicateGroup: [row({ barcode: 'UNSEEN', name: 'Sour cream' })], panelTwins: [], calorieTwins: [] }],
        ]);
        const plan = buildPlan(planInput({ groups }));
        expect(plan.entries[0].groupGaps).toEqual(['UNSEEN']);
        expect(plan.write).toEqual([]);
        // ...but the unit still reports as verified, so the operator can see the
        // batch is one authored line away from applyable.
        expect(plan.entries[0].units[0].verdict).toBe('write');
    });

    it('treats an unscanned group as a gap, not as an empty one', () => {
        // "0 members found" and "not looked at" are different states. Mapping
        // the second to the first is the fail-open that ships a partial mark;
        // detect-panel-scale-divided.ts documents the same trap as "0 flagged
        // means NOT LOOKED AT, not CLEAN".
        const groups = new Map<string, GroupClassification | null>([['T', null]]);
        const plan = buildPlan(planInput({ groups }));
        expect(plan.entries[0].groupGaps).toEqual([GROUP_NOT_SCANNED]);
        expect(plan.write).toEqual([]);
    });

    it('does not count a live member as a gap once another instrument has marked it', () => {
        const groups = new Map<string, GroupClassification | null>([
            ['T', { duplicateGroup: [row({ barcode: 'M', name: 'Sour cream', corruptReason: 'kcal-impossible:direct' })], panelTwins: [], calorieTwins: [] }],
        ]);
        const plan = buildPlan(planInput({ groups }));
        expect(plan.entries[0].groupGaps).toEqual([]);
        expect(plan.write.map(w => w.barcode)).toEqual(['T']);
    });

    it('writes NOTHING for an entry whose group member trips panel_moved', () => {
        // This case used to assert the opposite — that the target is written and
        // only the moved member is skipped — inside a describe block whose own
        // title says the gate is fail-closed at the ENTRY. The suite contradicted
        // itself, which is how the fail-open survived review.
        //
        // `gaps` proves only that the group is DECLARED covered; it is built from
        // the entry's barcode, group and groupExclusions and never consults what
        // will actually be written. So a member that decideHandMark refuses was
        // recorded as a skip while its target was still pushed — a partial group
        // mark, the exact state dedupe re-elects out of.
        //
        // Holding the whole entry is deliberately conservative. `panel_moved` here
        // means OFF corrected the member since authoring, so the group is no longer
        // uniformly corrupt and the authored observation can no longer be vouched
        // for in either direction. Under "re-run the verdict from measurements,
        // never trust the file's stored conclusion" that is a re-adjudication, not
        // an auto-write. The operator sees it as exit 3 and re-authors the entry.
        //
        // Deleting either half of the commit condition in buildPlan() — the
        // `gaps.length === 0` or the `units.every(u => u.verdict === 'write')` —
        // makes this fail.
        const e = entry({
            group: [{ barcode: 'M', basis: 'duplicate-group', observed: { name: 'Sour cream', kcal100: 100, protein: 3.33, fat: 6.67, carbs: 6.67, servingGrams: null } }],
        });
        const liveByBarcode = new Map([
            ['T', row({ barcode: 'T', name: 'Sour cream' })],
            // OFF corrected this one to the real 198 kcal/100g since authoring.
            ['M', row({ barcode: 'M', name: 'Sour cream', nutrientsPer100g: { calories: 198, protein: 2.4, fat: 19.7, carbs: 4.6 } })],
        ]);
        const groups = new Map<string, GroupClassification | null>([['T', { duplicateGroup: [], panelTwins: [], calorieTwins: [] }]]);
        const plan = buildPlan(planInput({ entries: [e], liveByBarcode, groups }));
        expect(plan.write).toEqual([]);
        // The unit-level verdicts still report the truth, so the operator can see
        // exactly which member moved and why the entry was held.
        expect(plan.entries[0].units[0]).toMatchObject({ barcode: 'T', verdict: 'write' });
        expect(plan.entries[0].units[1]).toMatchObject({ barcode: 'M', verdict: 'skip', skip: 'panel_moved' });
        // And the held entry must not leave its prefix behind: a prefix with no
        // rows behind it makes --clear-prefix look like it has work to do.
        expect(plan.prefixes ?? []).toEqual([]);
    });

    it('carries the calorie-only twins into the plan for review without writing them', () => {
        const groups = new Map<string, GroupClassification | null>([
            ['T', { duplicateGroup: [], panelTwins: [], calorieTwins: [row({ barcode: 'C', name: 'Sour Cream', brandName: 'Ahold' })] }],
        ]);
        const plan = buildPlan(planInput({ groups }));
        expect(plan.entries[0].calorieTwins.map(t => t.barcode)).toEqual(['C']);
        expect(plan.write.map(w => w.barcode)).toEqual(['T']);
    });

    it('emits a snapshot COPY over exactly the barcodes it would write', () => {
        // The restore anchor. A corruptReason write is self-inverting, but the
        // repoint campaign's lesson is that an UPDATE rollback wants both sides.
        const plan = buildPlan(planInput());
        expect(plan.snapshotSql.pre).toContain(`WHERE barcode IN ('T')`);
        expect(plan.snapshotSql.pre).toContain('"corruptReason"');
    });
});

describe('validatePlanText — the approval artifact cannot be widened by hand', () => {
    const good: HandMarkPlan = {
        at: '2026-08-12T00:00:00.000Z',
        generator: 'scripts/replay-hand-corrupt-marks.ts',
        handmarksFile: HANDMARKS_PATH,
        handmarksSha256: 'b'.repeat(64),
        reasonPrefixes: ['hand-triage-2026-08-12'],
        entries: [],
        write: [{ barcode: 'T', reason: 'hand-triage-2026-08-12:panel' }],
        censusBefore: {},
        snapshotSql: { pre: '', post: '' },
    };

    it('accepts a plan this script produced', () => {
        expect(validatePlanText(JSON.stringify(good)).ok).toBe(true);
    });

    it('refuses a plan from another producer', () => {
        const r = validatePlanText(JSON.stringify({ ...good, generator: 'hand-written' }));
        expect(r.ok).toBe(false);
    });

    it('refuses a plan with no usable handmarks pin', () => {
        expect(validatePlanText(JSON.stringify({ ...good, handmarksSha256: 'nope' })).ok).toBe(false);
        expect(validatePlanText(JSON.stringify({ ...good, handmarksSha256: undefined })).ok).toBe(false);
    });

    it('refuses a write row whose reason is not a hand-mark reason', () => {
        // The prefix is the rollback selector. A row written under a detector
        // reason would be invisible to --clear-prefix and unrevertable as a batch.
        const r = validatePlanText(JSON.stringify({ ...good, write: [{ barcode: 'T', reason: 'panel-low:direct' }] }));
        expect(r.ok).toBe(false);
    });

    it('refuses a plan that lists a barcode twice', () => {
        const r = validatePlanText(JSON.stringify({ ...good, write: [good.write[0], good.write[0]] }));
        expect(r.ok).toBe(false);
    });

    it('refuses text that is not JSON', () => {
        expect(validatePlanText('{').ok).toBe(false);
    });
});

describe('reconcileWithPlan — the plan can only ever SHRINK the write set', () => {
    const plan: HandMarkPlan = {
        at: '', generator: 'scripts/replay-hand-corrupt-marks.ts', handmarksFile: HANDMARKS_PATH,
        handmarksSha256: 'c'.repeat(64), reasonPrefixes: [], entries: [], censusBefore: {},
        snapshotSql: { pre: '', post: '' },
        write: [{ barcode: 'T', reason: 'hand-triage-2026-08-12:panel' }],
    };

    it('refuses a barcode live now wants that the approved plan does not name', () => {
        // §3.2's prediction: the duplicate group grew between approval and
        // apply. Writing it would mark a row nobody read. Deleting the
        // notInPlan branch makes this test fail.
        const fresh = { ...plan, write: [...plan.write, { barcode: 'NEW', reason: 'hand-triage-2026-08-12:panel' }] };
        const set = reconcileWithPlan(plan, fresh);
        expect(set.notInPlan).toEqual(['NEW']);
        expect(set.toWrite.map(w => w.barcode)).toEqual(['T']);
    });

    it('drops a plan row live no longer supports, and says why', () => {
        const fresh: HandMarkPlan = {
            ...plan,
            write: [],
            entries: [{
                barcode: 'T', class: 'panel', seed: 's', authoredReason: 'r', groupGaps: [], calorieTwins: [], affectedCacheRows: [],
                units: [{ barcode: 'T', basis: 'target', verdict: 'skip', skip: 'panel_moved', detail: 'kcal100: 100 -> 198' }],
            }],
        };
        const set = reconcileWithPlan(plan, fresh);
        expect(set.toWrite).toEqual([]);
        expect(set.droppedSincePlan).toEqual([{ barcode: 'T', skip: 'panel_moved', detail: 'kcal100: 100 -> 198' }]);
    });

    it('surfaces a group gap discovered after approval as a refusal input', () => {
        const fresh: HandMarkPlan = {
            ...plan,
            entries: [{ barcode: 'T', class: 'panel', seed: 's', authoredReason: 'r', groupGaps: ['UNSEEN'], calorieTwins: [], affectedCacheRows: [], units: [] }],
        };
        expect(reconcileWithPlan(plan, fresh).gaps).toEqual([{ entry: 'T', missing: ['UNSEEN'] }]);
    });
});

describe('replaySet — the refresh path writes only what the git-tracked file names', () => {
    it('carries the file-derived write set and reports the gaps as residue', () => {
        const fresh: HandMarkPlan = {
            at: '', generator: 'scripts/replay-hand-corrupt-marks.ts', handmarksFile: HANDMARKS_PATH,
            handmarksSha256: 'd'.repeat(64), reasonPrefixes: [], censusBefore: {}, snapshotSql: { pre: '', post: '' },
            write: [{ barcode: 'T', reason: 'hand-triage-2026-08-12:panel' }],
            entries: [{
                barcode: 'T', class: 'panel', seed: 's', authoredReason: 'r', groupGaps: ['NEW_TWIN'], calorieTwins: [], affectedCacheRows: [],
                units: [{ barcode: 'T', basis: 'target', verdict: 'write', reason: 'hand-triage-2026-08-12:panel' }],
            }],
        };
        const set = replaySet(fresh);
        expect(set.toWrite.map(w => w.barcode)).toEqual(['T']);
        expect(set.notInPlan).toEqual([]);         // there is no plan to exceed
        expect(set.gaps).toEqual([{ entry: 'T', missing: ['NEW_TWIN'] }]);
    });
});

describe('refuseApply — --apply needs an approval route', () => {
    it('refuses a bare --apply', () => {
        expect(refuseApply(parseArgs(['--apply']))).toMatch(/--plan|--replay/);
    });

    it('allows --apply --plan and --apply --replay', () => {
        expect(refuseApply(parseArgs(['--apply', '--plan', 'p.json']))).toBeNull();
        expect(refuseApply(parseArgs(['--apply', '--replay']))).toBeNull();
    });

    it('refuses both routes at once', () => {
        expect(refuseApply(parseArgs(['--apply', '--replay', '--plan', 'p.json']))).not.toBeNull();
    });

    it('never refuses a dry run', () => {
        expect(refuseApply(parseArgs([]))).toBeNull();
        expect(refuseApply(parseArgs(['--emit-plan', 'p.json']))).toBeNull();
    });

    it('does not read a following flag as a value', () => {
        expect(parseArgs(['--plan', '--apply']).plan).toBeNull();
        expect(parseArgs(['--apply']).plan).toBeNull();
    });
});

describe('refuseApplySet — every apply-time refusal, where a test can reach it', () => {
    const clean = { toWrite: [{ barcode: 'T', reason: 'hand-triage-2026-08-12:panel' }], droppedSincePlan: [], notInPlan: [], gaps: [] };
    const SHA = 'e'.repeat(64);

    it('allows a clean plan apply', () => {
        expect(refuseApplySet({ set: clean, mode: 'plan', planSha: SHA, fileSha: SHA })).toBeNull();
    });

    it('refuses when the handmarks file changed since the plan was emitted', () => {
        // The plan approves a SET. If the file moved, the set a human read is
        // not the set that would be written.
        expect(refuseApplySet({ set: clean, mode: 'plan', planSha: SHA, fileSha: 'f'.repeat(64) }))
            .toMatch(/changed since this plan/);
    });

    it('refuses a plan apply with an uncovered group member', () => {
        const set = { ...clean, gaps: [{ entry: 'T', missing: ['UNSEEN'] }] };
        expect(refuseApplySet({ set, mode: 'plan', planSha: SHA, fileSha: SHA })).toMatch(/neither marked nor declined/);
    });

    it('does NOT refuse the refresh path on a gap — it is residue there, not a stop', () => {
        // Aborting the replay stage mid-refresh would leave a rebuilt corpus
        // with no hand marks at all, which is the loss this machinery exists to
        // prevent. The entries with gaps are already excluded from toWrite.
        const set = { ...clean, gaps: [{ entry: 'OTHER', missing: ['NEW_TWIN'] }] };
        expect(refuseApplySet({ set, mode: 'replay', planSha: null, fileSha: SHA })).toBeNull();
    });

    it('refuses in BOTH modes when live wants a barcode the plan does not list', () => {
        const set = { ...clean, notInPlan: ['NEW'] };
        expect(refuseApplySet({ set, mode: 'plan', planSha: SHA, fileSha: SHA })).toMatch(/does not list/);
        expect(refuseApplySet({ set, mode: 'replay', planSha: null, fileSha: SHA })).toMatch(/does not list/);
    });

    it('refuses an empty write rather than reporting a no-op as success', () => {
        const set = { ...clean, toWrite: [] };
        expect(refuseApplySet({ set, mode: 'plan', planSha: SHA, fileSha: SHA })).toMatch(/no-op/);
        expect(refuseApplySet({ set, mode: 'replay', planSha: null, fileSha: SHA })).toMatch(/no-op/);
    });
});

describe('buildMarkStatement — the write is non-destructive of any existing mark', () => {
    it('carries the corruptReason IS NULL predicate', () => {
        // The SQL half of the already_marked skip: a detector mark that landed
        // between the plan and the apply must not be overwritten, and neither
        // must a second hand generation. mark-corrupt-off.ts's write carries the
        // identical predicate.
        const sql = buildMarkStatement([{ barcode: 'T', reason: 'hand-triage-2026-08-12:panel' }]);
        expect(sql.text.replace(/\s+/g, ' ')).toContain('f."corruptReason" IS NULL');
        expect(sql.text).toContain('UPDATE "OffFood"');
        // Values are parameterised, never interpolated.
        expect(sql.values).toEqual(['T', 'hand-triage-2026-08-12:panel']);
    });
});

describe('parseHandmarks — the authored file is validated before anything is read from the DB', () => {
    const ok = [entry()];

    it('accepts a well-formed file and pins its sha256', () => {
        const text = JSON.stringify(ok);
        const r = parseHandmarks(text);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.sha256).toBe(sha256Hex(text));
    });

    it('refuses a barcode that appears twice anywhere in the file', () => {
        // Two entries claiming one row would write two reason strings and which
        // landed would depend on statement order.
        const dup = [entry(), entry({ barcode: 'X', group: [{ barcode: 'T', basis: 'panel-twin', observed: entry().observed }] })];
        const r = parseHandmarks(JSON.stringify(dup));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/twice/);
    });

    it('refuses an unknown class, a non-ISO authoredAt, and a missing group array', () => {
        expect(parseHandmarks(JSON.stringify([entry({ class: 'nutrition' as never })])).ok).toBe(false);
        expect(parseHandmarks(JSON.stringify([entry({ authoredAt: 'August 2026' })])).ok).toBe(false);
        expect(parseHandmarks(JSON.stringify([{ ...entry(), group: undefined }])).ok).toBe(false);
    });

    it('refuses a group member with an invented basis', () => {
        const bad = [entry({ group: [{ barcode: 'M', basis: 'same-calories' as never, observed: entry().observed }] })];
        expect(parseHandmarks(JSON.stringify(bad)).ok).toBe(false);
    });

    it('refuses a decline with no stated reason', () => {
        // An exclusion satisfies the completeness gate, so an unexplained one is
        // a silent omission wearing a field name.
        const bad = [entry({ groupExclusions: [{ barcode: 'D', why: '' }] })];
        expect(parseHandmarks(JSON.stringify(bad)).ok).toBe(false);
    });

    it('refuses an entry whose observed panel is incomplete', () => {
        const bad = [entry({ observed: { name: 'Sour cream', kcal100: 100, protein: 3.33, fat: 6.67 } as never })];
        expect(parseHandmarks(JSON.stringify(bad)).ok).toBe(false);
    });

    it('refuses a file that is not an array', () => {
        expect(parseHandmarks('{}').ok).toBe(false);
        expect(parseHandmarks('nope').ok).toBe(false);
    });
});

describe('the shipped corrupt-off-handmarks.json', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', HANDMARKS_PATH), 'utf8');
    const parsed = parseHandmarks(text);

    it('parses under the same validation the script applies', () => {
        expect(parsed.ok).toBe(true);
    });

    it('is the 2026-08-12 + 2026-08-14 + 2026-08-15 + 2026-08-25 + 2026-08-28 batches: 26 entries over 34 barcodes', () => {
        // Narrowed from 17/22 on 2026-08-12 after the pre-apply review. Two
        // entries were withdrawn because the mark does not buy a better answer,
        // which is the same criterion that deferred maple and callaloo:
        //   - whataburger taquito (4217347902626355 + twin 8510451122990): the
        //     row promoted in its place is another synthetic-barcode Whataburger
        //     row of the SAME defect class, so the whole family carries the error.
        //   - boston market meatloaf (6958166644797297267792): the live row bills
        //     within 0.2% of the real serving; the replacement lands the Kids SKU
        //     51% low, i.e. marking makes it worse.
        // Both are re-authorable as a separate prefix once verification draws can
        // run; they were held, not refuted.
        //
        // 2026-08-14 added 8 panel entries, none carrying a group member: the
        // panel-axis CORRUPT-MARK backlog was 26 candidates and 18 were refuted.
        // The kill criterion was the same one that narrowed the 2026-08-12 batch
        // — a mark is a deletion, so it is only worth writing when what gets
        // promoted in its place is measurably better. Owner:
        // sync-docs/reports/2026-08-14_corrupt-mark-panel-batch-plan.md (mobile).
        //
        // 2026-08-15 added ONE entry carrying FOUR group members — the
        // 4-and-5-barcode cross-name group the 2026-08-14 batch listed as
        // re-submittable and did not re-submit. It is the first entry whose
        // group the tool's own classifyGroupCandidates() cannot fully compute:
        // two members sit under different names, so the name-scoped gate is
        // blind to them and they are hand-declared.
        //
        // 2026-08-25 added ONE entry with no group (D-A10, Diego's in-session
        // grant): a brandless "1% milk" row carrying a milk-POWDER panel, 8.6x
        // its 34-row exact-name group median. It is the first mark of a class
        // NEITHER detector generation models — a wrong-PRODUCT panel, not a
        // per-serving-as-per-100g scale error: Tier 1 flags an inflated panel
        // only when the serving rescale lands ON the sibling median, and here
        // the row has no serving and the sibling-serving fallback rescales 388
        // to 162, so the rule declines it correctly. Group is the one barcode:
        // duplicateOfBarcode NULL, no members, and no byte-identical panel
        // under any other name (measured 2026-08-25). Owner: the Lane A
        // session-13 write-off (mobile sync-docs/log/2026-08-25_*_a_*.md).
        //
        // 2026-08-28 added ONE entry with no group (repair batch 6, D6 + D17):
        // off_0280996444044 "Quaker Caramel Rice Cakes", whose per-100 g fields
        // hold the label's 2-cake (26 g) panel at 100 kcal/100 g. servingGrams
        // is 0.2599999904632568 — the 26 g serving stored as a FRACTION of
        // 100 g by the same divide-by-100 — so every field x100/26 recovers the
        // real values, calories on 384.6 against FatSecret's independent 385.
        // Unreachable by every shipped detector at once: singleton name key
        // under MIN_GROUP, the 0.26 g serving outside the [2,600] direct gate,
        // tier 2 emits the inflated direction only, and the barcode is exactly
        // 13 chars so detect-panel-scale-divided's length > 13 excludes it.
        // Group is the one barcode: duplicateOfBarcode NULL both ways and a
        // singleton dedupe groupKey. Owner: the Lane A session-26 write-off
        // (mobile sync-docs/log/2026-08-28_*_a_*.md).
        //
        // 26 -> 25 on 2026-08-28: barcode 0063383036356 ("Bun cha") LEFT this
        // file for src/lib/mapping/hand-panel-repairs.json. Its 2026-08-14 mark
        // had the diagnosis right (a 300 g whole-bowl panel in the per-100g
        // field, exactly 3.000000x a live witness row) and the instrument
        // wrong: the factor was determinable, so the row was repairable rather
        // than junk, and suppressing it handed `bun cha` to a char siu BAO for
        // 19 days. A barcode must appear in exactly one of the two authored
        // records — hand-panel-repair.test.ts pins them disjoint — or the
        // refresh chain would repair a row and then re-mark it in the same run.
        if (!parsed.ok) throw new Error('unparseable');
        expect(parsed.entries.length).toBe(25);
        expect(parsed.entries.reduce((n, e) => n + 1 + e.group.length, 0)).toBe(33);
    });

    it('carries the duplicate-group members that make a barcode-scoped mark self-reverting', () => {
        // Measured 2026-08-12: these twins currently point at their targets.
        // Marking only the target lets the next dedupe run elect the twin, so
        // dropping either from this file re-opens §3.2 silently.
        //
        // The whataburger pair (8510451122990 -> 4217347902626355) was in this
        // list until the batch narrowed; it left with its whole entry, not on its
        // own, which is the only way a member may leave.
        if (!parsed.ok) throw new Error('unparseable');
        const members = new Map(parsed.entries.flatMap(e => e.group.map(m => [m.barcode, { target: e.barcode, basis: m.basis }])));
        expect(members.get('355980649788503212113472')).toEqual({ target: '1781154461976987405190', basis: 'duplicate-group' });
        // 2026-08-15: the almond-milk group is the cross-name case. Two of its
        // four members share the target's normalizeNameKey and are therefore
        // computed by classifyGroupCandidates(); the other two sit under
        // different names and are invisible to it, so only this file carries
        // them. 00826638 additionally carries duplicateOfBarcode today — that
        // column is recomputed on every dedupe run and isBetterRepresentative()
        // ranks a CLEAN row above a marked one, so leaving it unmarked is what
        // would hand the identical panel straight back.
        for (const b of ['00826637', '00826638', '0036632079800', '0025293001367']) {
            expect(members.get(b)).toEqual({ target: '78797703', basis: 'panel-twin' });
        }
        // A withdrawn entry must take its members with it — a member left behind
        // pointing at an absent target is an orphan the group gate cannot see.
        expect(members.get('8510451122990')).toBeUndefined();
        expect(parsed.entries.some(e => e.barcode === '4217347902626355')).toBe(false);
        expect(parsed.entries.some(e => e.barcode === '6958166644797297267792')).toBe(false);
    });

    it('writes only known reason generations, and each is a whole batch', () => {
        // A generation is a `--clear-prefix` unit: the rollback for a batch is
        // all-or-nothing on its prefix, so an entry authored on a stray date
        // would be unrevertable as part of the batch it shipped with. Pin the
        // set, and pin each generation's size, so adding an entry to an OLD
        // generation (which would silently widen a shipped batch's rollback)
        // fails here rather than at revert time.
        if (!parsed.ok) throw new Error('unparseable');
        const byGen = new Map<string, number>();
        for (const e of parsed.entries) byGen.set(e.authoredAt, (byGen.get(e.authoredAt) ?? 0) + 1);
        expect([...byGen.keys()].sort()).toEqual(['2026-08-12', '2026-08-14', '2026-08-15', '2026-08-25', '2026-08-28']);
        expect(byGen.get('2026-08-12')).toBe(15);
        // 8 -> 7 on 2026-08-28: 0063383036356 was re-instrumented as a panel
        // RESCALE (see the entry-count test above). That NARROWS the 08-14
        // batch's --clear-prefix rollback unit, which is a deliberate,
        // reviewed change and is why this number is pinned at all.
        expect(byGen.get('2026-08-14')).toBe(7);
        expect(byGen.get('2026-08-15')).toBe(1);
        expect(byGen.get('2026-08-25')).toBe(1);
        expect(byGen.get('2026-08-28')).toBe(1);
    });

    it('records a stated reason for every declined group member', () => {
        if (!parsed.ok) throw new Error('unparseable');
        const declines = parsed.entries.flatMap(e => e.groupExclusions ?? []);
        expect(declines.length).toBeGreaterThan(0);
        for (const d of declines) expect(d.why.trim().length).toBeGreaterThan(10);
    });
});

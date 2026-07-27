/**
 * repair-panel-scale-divided.test.ts — offline fail-injection tests for the
 * divided-panel corpus repair (handoff §5a-2a).
 *
 * NO DATABASE, NO NETWORK. Fixture families run through the REAL detector
 * (runScan is imported, not mocked — the repair must be tested against the
 * machinery it actually reuses), and --execute's write path runs against an
 * in-memory RepairDb fake.
 *
 * Every gate the script's header promises has a failing test here, in the
 * fail-closed.test.ts / cache-ops-guards.test.ts style (PR #177/#182): each
 * refusal block carries a POSITIVE CONTROL, because "the gate refuses" is
 * satisfiable by a gate that refuses everything — a tautology, not a test.
 */

import {
    runScan,
    type Panel,
    type PanelRow,
    type RowStream,
    type ScanReport,
} from '../detect-panel-scale-divided';
import {
    applyPlan,
    buildPlan,
    checkSnapshotCoversPlan,
    executeExitCode,
    EXCLUDED_BARCODES,
    filterByTier,
    formatPlanSummary,
    jsonEqual,
    loadManifest,
    mandatoryNextSteps,
    parseRepairArgs,
    scaleStoredPanel,
    tierOf,
    validateManifestText,
    validatePlanText,
    DEFAULT_SAMPLE_SIZE,
    PLAN_KIND,
    UNSETTLED_FLOOR,
    type LiveRow,
    type PlanEntry,
    type RepairDb,
    type RepairPlan,
} from '../repair-panel-scale-divided';
import { REQUIRED_COLUMNS } from '../snapshot-off-food';

// ===========================================================================
// Fixtures — same generators as panel-scale-divided.test.ts, so the fixture
// cannot drift from the mechanism.
// ===========================================================================

function corruptRow(over: {
    barcode: string; name: string; brandName: string; servingGrams: number; trueDensity: Panel;
}): PanelRow {
    const f = 100 / over.servingGrams;
    const d = over.trueDensity;
    return {
        barcode: over.barcode, name: over.name, brandName: over.brandName, servingGrams: over.servingGrams,
        nutrientsPer100g: {
            calories: d.calories * f,
            protein: (d.protein ?? 0) * f,
            carbs: (d.carbs ?? 0) * f,
            fat: (d.fat ?? 0) * f,
            fiber: (d.fiber ?? 0) * f,
            sugars: (d.sugars ?? 0) * f,
            sodium: (d.sodium ?? 0) * f,
        },
    };
}

function healthyRow(over: {
    barcode: string; name: string; brandName: string; servingGrams: number; panel: Panel;
}): PanelRow {
    return {
        barcode: over.barcode, name: over.name, brandName: over.brandName,
        servingGrams: over.servingGrams, nutrientsPer100g: { ...over.panel },
    };
}

function streamOf(rows: PanelRow[]): RowStream {
    return async function* () { yield rows; };
}

const SYNTH = (n: number) => `9${'0'.repeat(13)}${n}`; // length >= 15 -> synthetic arm

/** Tier-2 shape: 2 sizes, one true density (the Jersey Mike's proof). */
function jmFamily(): PanelRow[] {
    const d: Panel = { calories: 173, protein: 9, carbs: 14, fat: 9, fiber: 1, sugars: 2, sodium: 0.67 };
    return [
        corruptRow({ barcode: SYNTH(1), name: 'Buffalo Chicken Cheese Steak Regular', brandName: "Jersey Mike's Subs", servingGrams: 541, trueDensity: d }),
        corruptRow({ barcode: SYNTH(2), name: 'Buffalo Chicken Cheese Steak Giant', brandName: "Jersey Mike's Subs", servingGrams: 1060, trueDensity: d }),
    ];
}

/** Tier-1 shape: 3 distinct sizes. */
function wawaFamily(): PanelRow[] {
    const d: Panel = { calories: 220, protein: 11, carbs: 25, fat: 8, fiber: 1, sugars: 3, sodium: 0.5 };
    return [
        corruptRow({ barcode: SYNTH(3), name: 'Italian Hoagie Junior', brandName: 'Wawa', servingGrams: 200, trueDensity: d }),
        corruptRow({ barcode: SYNTH(4), name: 'Italian Hoagie Regular', brandName: 'Wawa', servingGrams: 400, trueDensity: d }),
        corruptRow({ barcode: SYNTH(5), name: 'Italian Hoagie Giant', brandName: 'Wawa', servingGrams: 600, trueDensity: d }),
    ];
}

/** The Crunchwrap shape: the 260 g member is ALREADY a correct density, so its
 *  "repair" would invent a 108.1 g/100g macro sum and the guard must refuse it. */
function crunchwrapFamily(): PanelRow[] {
    return [
        healthyRow({ barcode: SYNTH(6), name: 'Crunchwrap Supreme', brandName: 'Taco Bell', servingGrams: 100, panel: { calories: 537, protein: 16, carbs: 71, fat: 21 } }),
        healthyRow({ barcode: SYNTH(7), name: 'Crunchwrap Supreme', brandName: 'Taco Bell', servingGrams: 260, panel: { calories: 204, protein: 5.77, carbs: 28.1, fat: 7.69 } }),
    ];
}

/** The hand-excluded row: `Asda | Thai sticky rice`, barcode 50571723466684
 *  (14 digits -> synthetic arm, which is exactly why it needs the exclusion). */
const ASDA_BARCODE = '50571723466684';
function asdaFamily(): PanelRow[] {
    const d: Panel = { calories: 350, protein: 7, carbs: 78, fat: 1, fiber: 1, sugars: 0.5, sodium: 0.01 };
    return [
        corruptRow({ barcode: ASDA_BARCODE, name: 'Thai sticky rice', brandName: 'Asda', servingGrams: 200, trueDensity: d }),
        corruptRow({ barcode: '50571723466699', name: 'Thai sticky rice', brandName: 'Asda', servingGrams: 400, trueDensity: d }),
    ];
}

function liveRowOf(row: PanelRow, over: Partial<LiveRow> = {}): LiveRow {
    return {
        barcode: row.barcode,
        name: row.name,
        brandName: row.brandName,
        servingGrams: row.servingGrams,
        nutrientsPer100g: JSON.parse(JSON.stringify(row.nutrientsPer100g)),
        corruptReason: null,
        duplicateOfBarcode: null,
        ...over,
    };
}

async function scanOf(rows: PanelRow[]): Promise<ScanReport> {
    return runScan(streamOf(rows), { arm: 'synthetic' });
}

/** Build a plan the way the dry run does: real scan + raw fetch of the same rows. */
async function makePlan(rows: PanelRow[], at = '2026-07-28T10:00:00.000Z'): Promise<RepairPlan> {
    const report = await scanOf(rows);
    const raw = new Map(rows.map(r => [r.barcode, liveRowOf(r)]));
    return buildPlan(report, raw, at);
}

/** Round-trip through JSON, as a real approved plan file would. */
function roundTrip(plan: RepairPlan): RepairPlan {
    const parsed = validatePlanText(JSON.stringify(plan));
    if (!parsed.ok) throw new Error(`fixture plan must validate: ${parsed.reason}`);
    return parsed.plan;
}

/** In-memory RepairDb over LiveRows; records every write. */
function fakeDb(rows: LiveRow[]): RepairDb & { writes: Map<string, Record<string, unknown>>; store: Map<string, LiveRow> } {
    const store = new Map(rows.map(r => [r.barcode, r]));
    const writes = new Map<string, Record<string, unknown>>();
    return {
        store,
        writes,
        async fetchRow(barcode) { return store.get(barcode) ?? null; },
        async writePanel(barcode, panel) { writes.set(barcode, panel); },
    };
}

function validManifestObject(): Record<string, unknown> {
    const columns = [...REQUIRED_COLUMNS, 'embedding'];
    return {
        table: 'OffFood',
        createdAt: '2026-07-28T12:00:00.000Z',
        sshHost: 'owner@192.168.1.133',
        container: 'mealspire-db',
        dbName: 'recipes',
        dbUser: 'postgres',
        file: '/home/owner/snapshots/OffFood-2026-07-28T12-00-00Z.tsv.gz',
        format: 'postgres COPY text (tab-delimited, \\N nulls, one line per row), gzip',
        rowCount: 1069123,
        columnCount: columns.length,
        columns,
        excludeEmbedding: false,
        gzipBytes: 123456789,
        sha256: 'ab'.repeat(32),
        restore: ['# PER-ROW RESTORE — run ON THE DB HOST'],
    };
}

function manifestText(over: Record<string, unknown> = {}, drop: string[] = []): string {
    const m = { ...validManifestObject(), ...over };
    for (const k of drop) delete m[k];
    return JSON.stringify(m);
}

// ===========================================================================
// 1. The Asda exclusion — a named constant, enforced twice
// ===========================================================================

describe('Asda | Thai sticky rice is excluded BY NAME (corrections table: the detector emits it)', () => {
    it('the exclusion list is a named constant containing the barcode, with a reason', () => {
        expect(EXCLUDED_BARCODES.has(ASDA_BARCODE)).toBe(true);
        expect(EXCLUDED_BARCODES.get(ASDA_BARCODE)).toContain('Asda | Thai sticky rice');
    });

    it('the detector DOES flag it (this is why the hand-exclusion exists at all)', async () => {
        const report = await scanOf(asdaFamily());
        expect(report.repairs.map(r => r.barcode)).toContain(ASDA_BARCODE);
    });

    it('buildPlan drops it into `exclusions` — visible and counted, not silently absent', async () => {
        const plan = await makePlan([...asdaFamily(), ...jmFamily()]);
        expect(plan.entries.map(e => e.barcode)).not.toContain(ASDA_BARCODE);
        expect(plan.exclusions).toHaveLength(1);
        expect(plan.exclusions[0].barcode).toBe(ASDA_BARCODE);
        expect(plan.exclusions[0].reason).toContain('Asda');
        // The exclusion is legible in the human summary Diego approves from.
        const text = formatPlanSummary(plan, DEFAULT_SAMPLE_SIZE).join('\n');
        expect(text).toContain('EXCLUDED by name (1)');
        expect(text).toContain(ASDA_BARCODE);
    });

    it('POSITIVE CONTROL — the non-excluded sibling in the same family IS planned', async () => {
        const plan = await makePlan([...asdaFamily(), ...jmFamily()]);
        expect(plan.entries.map(e => e.barcode)).toContain('50571723466699');
    });

    it('validatePlanText refuses ANY plan whose entries carry an excluded barcode (hand-edited or stale plan)', async () => {
        const plan = await makePlan([...asdaFamily(), ...jmFamily()]);
        const tampered = JSON.parse(JSON.stringify(plan)) as RepairPlan;
        // Re-insert the excluded row as if a stale/hand-edited plan carried it.
        const donor = tampered.entries[0];
        tampered.entries.push({ ...donor, barcode: ASDA_BARCODE });
        const res = validatePlanText(JSON.stringify(tampered));
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toContain('EXCLUDED_BARCODES');
    });
});

// ===========================================================================
// 2. Risk tiers
// ===========================================================================

describe('risk tiers: >=3 distinct sizes is tier 1, 2-size families are tier 2', () => {
    it('tierOf splits on distinct servings', () => {
        expect(tierOf({ familyDistinctServings: 3 })).toBe(1);
        expect(tierOf({ familyDistinctServings: 5 })).toBe(1);
        expect(tierOf({ familyDistinctServings: 2 })).toBe(2);
    });

    it('the plan separates the tiers and totals them', async () => {
        const plan = await makePlan([...wawaFamily(), ...jmFamily()]);
        expect(plan.tierTotals.tier1).toEqual({ rows: 3, families: 1 });
        expect(plan.tierTotals.tier2).toEqual({ rows: 2, families: 1 });
        for (const e of plan.entries) {
            expect(e.tier).toBe(e.brandName === 'Wawa' ? 1 : 2);
        }
        const text = formatPlanSummary(plan, DEFAULT_SAMPLE_SIZE).join('\n');
        expect(text).toContain('tier 1');
        expect(text).toContain('tier 2');
        expect(text).toContain('perfect BY CONSTRUCTION');
    });

    it('filterByTier selects exactly the approved tier', async () => {
        const plan = await makePlan([...wawaFamily(), ...jmFamily()]);
        expect(filterByTier(plan.entries, '1').every(e => e.tier === 1)).toBe(true);
        expect(filterByTier(plan.entries, '1')).toHaveLength(3);
        expect(filterByTier(plan.entries, '2')).toHaveLength(2);
        expect(filterByTier(plan.entries, 'all')).toHaveLength(5);
    });
});

// ===========================================================================
// 3. Guard refusals at plan time — the Crunchwrap shape
// ===========================================================================

describe('plan-time guard: an already-correct row in a flagged family is REFUSED and COUNTED', () => {
    it('the Crunchwrap 260 g row lands in refusals, never in entries', async () => {
        const plan = await makePlan([...crunchwrapFamily(), ...jmFamily()]);
        expect(plan.entries.map(e => e.barcode)).not.toContain(SYNTH(7));
        expect(plan.refusalCount).toBe(1);
        expect(plan.refusals[0].barcode).toBe(SYNTH(7));
        expect(plan.refusals[0].reasons.join(' ')).toContain('repaired-macro-sum-impossible');
        // Nothing vanishes: entries + refusals (+ exclusions) == flagged rows.
        expect(plan.entries.length + plan.refusalCount + plan.exclusions.length).toBe(plan.scan.flaggedRows);
        // And the refusal is legible in the summary Diego reads.
        const text = formatPlanSummary(plan, DEFAULT_SAMPLE_SIZE).join('\n');
        expect(text).toContain('REFUSED');
        expect(text).toContain('plausibility guard: 1');
    });

    it('POSITIVE CONTROL — the plausible rows of the same run are still planned', async () => {
        const plan = await makePlan([...crunchwrapFamily(), ...jmFamily()]);
        expect(plan.entries).toHaveLength(2);
        expect(plan.entries.every(e => e.brandName === "Jersey Mike's Subs")).toBe(true);
    });
});

// ===========================================================================
// 4. The repair math and the plan artifact
// ===========================================================================

describe('the plan records every numeric field before -> after, via the same math as the detector', () => {
    it('scaleStoredPanel multiplies every finite numeric field by S/100 and touches nothing else', () => {
        const raw = { calories: 32, protein: 1.66, carbs: null, fat: 1.66, note: 'x', extraNumeric: 2 };
        const out = scaleStoredPanel(raw, 541)!;
        expect(out.calories).toBeCloseTo(173.12, 6);
        expect(out.protein).toBeCloseTo(8.9806, 4);
        expect(out.carbs).toBeNull();               // missing stays missing
        expect(out.note).toBe('x');                 // non-numeric passes through
        expect(out.extraNumeric).toBeCloseTo(10.82, 6); // EVERY numeric field, not a hardcoded list
        expect(scaleStoredPanel(null, 541)).toBeNull();
        expect(scaleStoredPanel([1, 2], 541)).toBeNull();
    });

    it('plan entries agree with the detector repairPanel on every canonical field (the class-A tripwire ran)', async () => {
        const plan = await makePlan(jmFamily());
        for (const e of plan.entries) {
            expect((e.rawAfter.calories as number)).toBeCloseTo(e.repaired.calories, 9);
            expect((e.rawAfter.protein as number)).toBeCloseTo(e.repaired.protein!, 9);
            // Both sizes recover the SAME density — the point of the repair.
            expect(e.rawAfter.calories as number).toBeCloseTo(173, 6);
        }
    });

    it('the plan carries per-family stats and the UNSETTLED floor note', async () => {
        const plan = await makePlan([...wawaFamily(), ...jmFamily()]);
        expect(plan.unsettled).toBe(UNSETTLED_FLOOR);
        expect(plan.familySummaries).toHaveLength(2);
        const wawa = plan.familySummaries.find(f => f.brandName === 'Wawa')!;
        expect(wawa.slope).toBeCloseTo(-1, 2);
        expect(wawa.r2).toBeCloseTo(1, 6);
        expect(wawa.plannedServings).toEqual([200, 400, 600]);
        const text = formatPlanSummary(plan, DEFAULT_SAMPLE_SIZE).join('\n');
        expect(text).toContain('UNSETTLED');
        expect(text).toContain('slope');
    });

    it('the hand-audit sample is deterministic: first N by (familyKey, barcode)', async () => {
        const plan = await makePlan([...wawaFamily(), ...jmFamily()]);
        const sorted = [...plan.entries].sort((a, b) => a.familyKey.localeCompare(b.familyKey) || a.barcode.localeCompare(b.barcode));
        expect(plan.entries.map(e => e.barcode)).toEqual(sorted.map(e => e.barcode));
        // Sample of 1 shows exactly the first entry, with field-level before->after.
        const text = formatPlanSummary(plan, 1).join('\n');
        expect(text).toContain(`the first 1 plan entries`);
        expect(text).toContain(sorted[0].barcode);
        expect(text).toContain('calories');
    });

    it('a row that moved between scan and raw fetch goes to movedDuringPlan, not into the plan', async () => {
        const rows = jmFamily();
        const report = await scanOf(rows);
        const raw = new Map(rows.map(r => [r.barcode, liveRowOf(r)]));
        // Mutate one fetched panel so it no longer matches the scan.
        (raw.get(SYNTH(1))!.nutrientsPer100g as Record<string, number>).calories = 999;
        const plan = buildPlan(report, raw, '2026-07-28T10:00:00.000Z');
        expect(plan.entries.map(e => e.barcode)).toEqual([SYNTH(2)]);
        expect(plan.movedDuringPlan).toHaveLength(1);
        expect(plan.movedDuringPlan[0].barcode).toBe(SYNTH(1));
        // A row MISSING from the fetch is the same refusal, not a crash.
        const raw2 = new Map([[SYNTH(2), liveRowOf(rows[1])]]);
        const plan2 = buildPlan(report, raw2, '2026-07-28T10:00:00.000Z');
        expect(plan2.movedDuringPlan.map(m => m.barcode)).toContain(SYNTH(1));
    });

    it('buildPlan refuses a truncated scan and a wrong-arm scan outright', async () => {
        const report = await runScan(streamOf(jmFamily()), { arm: 'synthetic', limit: 1 });
        expect(report.truncated).toBe(true);
        expect(() => buildPlan(report, new Map(), 'x')).toThrow(/truncated/);
        const eanReport = await runScan(streamOf(jmFamily()), { arm: 'real-ean' });
        expect(() => buildPlan(eanReport, new Map(), 'x')).toThrow(/synthetic/);
    });
});

// ===========================================================================
// 5. CLI: --execute refuses to even parse without the gates
// ===========================================================================

describe('parseRepairArgs: the gates are in the parser', () => {
    it('--execute without --snapshot-manifest refuses, naming the rollback path', () => {
        const r = parseRepairArgs(['--execute', '--plan', 'p.json']);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain('snapshot');
    });

    it('--execute without --plan refuses', () => {
        const r = parseRepairArgs(['--execute', '--snapshot-manifest', 'm.meta.json']);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain('--plan');
    });

    it('--plan / --snapshot-manifest / --tier are execute-only', () => {
        expect(parseRepairArgs(['--plan', 'p.json']).ok).toBe(false);
        expect(parseRepairArgs(['--snapshot-manifest', 'm.meta.json']).ok).toBe(false);
        expect(parseRepairArgs(['--tier', '1']).ok).toBe(false);
    });

    it('unknown flags, stray positionals and bad --tier values refuse (a typo must not become a dry run)', () => {
        expect(parseRepairArgs(['--execut']).ok).toBe(false);
        expect(parseRepairArgs(['extra.json']).ok).toBe(false);
        expect(parseRepairArgs(['--execute', '--plan', 'p.json', '--snapshot-manifest', 'm.meta.json', '--tier', '3']).ok).toBe(false);
        expect(parseRepairArgs(['--sample', '0']).ok).toBe(false);
        expect(parseRepairArgs(['--execute', '--plan', 'p.json', '--snapshot-manifest', 'm.meta.json', '--out', 'x.json']).ok).toBe(false);
    });

    it('POSITIVE CONTROL — both modes parse when complete', () => {
        const dry = parseRepairArgs(['--out', 'plan.json', '--sample', '10']);
        expect(dry).toEqual({ ok: true, mode: 'dry-run', out: 'plan.json', sample: 10 });
        const exec = parseRepairArgs(['--execute', '--plan', 'p.json', '--snapshot-manifest', 'm.meta.json', '--tier', '1']);
        expect(exec).toEqual({ ok: true, mode: 'execute', planPath: 'p.json', manifestPath: 'm.meta.json', tier: '1' });
        const execAll = parseRepairArgs(['--execute', '--plan', 'p.json', '--snapshot-manifest', 'm.meta.json']);
        expect(execAll).toEqual({ ok: true, mode: 'execute', planPath: 'p.json', manifestPath: 'm.meta.json', tier: 'all' });
    });
});

// ===========================================================================
// 6. Snapshot-manifest validation — absent / malformed / unverified all refuse
// ===========================================================================

describe('snapshot manifest gate: only a verified snapshot-off-food.ts .meta.json passes', () => {
    it('POSITIVE CONTROL — a well-formed manifest validates', () => {
        const r = validateManifestText(manifestText());
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.manifest.rowCount).toBe(1069123);
    });

    const refusals: Array<[string, string, string]> = [
        ['empty text', '', 'EMPTY'],
        ['unparseable JSON', '{"table": "OffFood",', 'parseable'],
        ['wrong table', manifestText({ table: 'FoodMapping' }), 'OffFood'],
        ['zero rowCount', manifestText({ rowCount: 0 }), 'positive integer'],
        ['non-integer rowCount', manifestText({ rowCount: 12.5 }), 'positive integer'],
        ['missing sha256', manifestText({}, ['sha256']), 'sha256'],
        ['malformed sha256', manifestText({ sha256: 'not-a-hash' }), 'sha256'],
        ['missing repair-writable column', manifestText({ columns: ['barcode', 'name'], columnCount: 2 }), 'nutrientsPer100g'],
        ['columnCount drift', manifestText({ columnCount: 3 }), 'internally inconsistent'],
        ['.partial data file', manifestText({ file: '/home/owner/snapshots/OffFood-x.tsv.gz.partial' }), 'partial'],
        ['non-final file name', manifestText({ file: '/home/owner/snapshots/OffFood-x.sql' }), 'final'],
        ['zero gzipBytes', manifestText({ gzipBytes: 0 }), 'gzipBytes'],
        ['no restore recipe', manifestText({ restore: [] }), 'restore'],
        ['unparseable createdAt', manifestText({ createdAt: 'yesterday-ish' }), 'createdAt'],
        ['wrong format', manifestText({ format: 'pg_dump custom' }), 'COPY'],
    ];
    it.each(refusals)('refuses: %s', (_label, text, expectInReason) => {
        const r = validateManifestText(text);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain(expectInReason);
    });

    it('loadManifest refuses a path that is not a .meta.json, and a missing file', () => {
        const wrongName = loadManifest('/tmp/OffFood-x.tsv.gz');
        expect(wrongName.ok).toBe(false);
        if (!wrongName.ok) expect(wrongName.reason).toContain('.meta.json');
        const missing = loadManifest('/nonexistent/OffFood-x.meta.json');
        expect(missing.ok).toBe(false);
        if (!missing.ok) expect(missing.reason).toContain('cannot read');
    });

    it('a manifest OLDER than the plan refuses (order is plan -> approve -> snapshot -> execute)', () => {
        const stale = checkSnapshotCoversPlan('2026-07-27T00:00:00.000Z', '2026-07-28T10:00:00.000Z');
        expect(stale.ok).toBe(false);
        if (!stale.ok) expect(stale.reason).toContain('OLDER');
        expect(checkSnapshotCoversPlan('2026-07-28T12:00:00.000Z', '2026-07-28T10:00:00.000Z').ok).toBe(true);
        expect(checkSnapshotCoversPlan('garbage', '2026-07-28T10:00:00.000Z').ok).toBe(false);
    });
});

// ===========================================================================
// 7. Plan validation — a foreign or tampered plan cannot reach --execute
// ===========================================================================

describe('plan validation: shape, provenance, and the one-sided-guard trap', () => {
    it('POSITIVE CONTROL — a plan built by buildPlan round-trips through validation', async () => {
        const plan = roundTrip(await makePlan(jmFamily()));
        expect(plan.planKind).toBe(PLAN_KIND);
        expect(plan.entries).toHaveLength(2);
    });

    it('feeding the DETECTOR\'s own ScanReport refuses — it is not an executable plan', async () => {
        const report = await scanOf(jmFamily());
        const r = validatePlanText(JSON.stringify(report));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain('planKind');
    });

    it('an entry below the 150 g member guard refuses THE WHOLE PLAN — the plausibility guard is one-sided, and a small-S entry would SHRINK a panel under every ceiling', async () => {
        const plan = JSON.parse(JSON.stringify(await makePlan(jmFamily()))) as RepairPlan;
        plan.entries[0] = { ...plan.entries[0], barcode: SYNTH(99), servingGrams: 50 };
        const r = validatePlanText(JSON.stringify(plan));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain('member guard');
    });

    it('duplicate barcodes refuse — a row repaired twice is multiplied twice', async () => {
        const plan = JSON.parse(JSON.stringify(await makePlan(jmFamily()))) as RepairPlan;
        plan.entries.push({ ...plan.entries[0] });
        const r = validatePlanText(JSON.stringify(plan));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain('duplicate');
    });

    it('empty entries, wrong arm, wrong version, empty text all refuse', async () => {
        const plan = await makePlan(jmFamily());
        const cases: Array<Record<string, unknown>> = [
            { entries: [] },
            { arm: 'real-ean' },
            { planVersion: 999 },
        ];
        for (const over of cases) {
            const r = validatePlanText(JSON.stringify({ ...JSON.parse(JSON.stringify(plan)), ...over }));
            expect(r.ok).toBe(false);
        }
        expect(validatePlanText('').ok).toBe(false);
        expect(validatePlanText('{"planKind":').ok).toBe(false);
    });
});

// ===========================================================================
// 8. applyPlan — per-row moved-value refusal, the write-time guard, plan drift
// ===========================================================================

describe('applyPlan: every write is gated per row; refusals are counted and listed', () => {
    async function planAndDb(rows: PanelRow[] = jmFamily()) {
        const plan = roundTrip(await makePlan(rows));
        const db = fakeDb(rows.map(r => liveRowOf(r)));
        return { plan, db };
    }

    it('POSITIVE CONTROL — an unmoved population applies fully, writing the RECOMPUTED panel', async () => {
        const { plan, db } = await planAndDb();
        const res = await applyPlan(plan.entries, db);
        expect(res.applied).toHaveLength(2);
        expect(res.refusals).toHaveLength(0);
        expect(db.writes.size).toBe(2);
        const written = db.writes.get(SYNTH(1))!;
        expect(written.calories as number).toBeCloseTo(173, 6);
        expect(jsonEqual(written, plan.entries.find(e => e.barcode === SYNTH(1))!.rawAfter)).toBe(true);
        expect(executeExitCode(res)).toBe(0);
    });

    it('a row whose panel MOVED since the plan is refused per-row with a field-level diff; the rest proceed', async () => {
        const { plan, db } = await planAndDb();
        (db.store.get(SYNTH(1))!.nutrientsPer100g as Record<string, number>).carbs = 99;
        const res = await applyPlan(plan.entries, db);
        expect(res.applied.map(a => a.barcode)).toEqual([SYNTH(2)]);
        expect(res.refusals).toHaveLength(1);
        expect(res.refusals[0]).toMatchObject({ barcode: SYNTH(1), reason: 'row-moved' });
        expect(res.refusals[0].detail.join(' ')).toContain('carbs');
        expect(db.writes.has(SYNTH(1))).toBe(false);
        // Nothing vanishes: applied + refused == attempted.
        expect(res.applied.length + res.refusals.length).toBe(plan.entries.length);
    });

    it('servingGrams, name, corruptReason and duplicateOfBarcode moves refuse too — the count-only guard was proven fail-open', async () => {
        const { plan, db } = await planAndDb();
        db.store.get(SYNTH(1))!.servingGrams = 600;
        db.store.get(SYNTH(2))!.corruptReason = 'triage-2026-07-28:panel';
        const res = await applyPlan(plan.entries, db);
        expect(res.applied).toHaveLength(0);
        expect(res.refusals.map(r => r.reason)).toEqual(['row-moved', 'row-moved']);
        expect(res.refusals[0].detail.join(' ')).toContain('servingGrams');
        expect(res.refusals[1].detail.join(' ')).toContain('corruptReason');
        expect(db.writes.size).toBe(0);
        expect(executeExitCode(res)).toBe(2); // zero writes is a broken run, not a success
    });

    it('a row deleted since the plan is refused as row-missing-live', async () => {
        const { plan, db } = await planAndDb();
        db.store.delete(SYNTH(2));
        const res = await applyPlan(plan.entries, db);
        expect(res.applied.map(a => a.barcode)).toEqual([SYNTH(1)]);
        expect(res.refusals[0]).toMatchObject({ barcode: SYNTH(2), reason: 'row-missing-live' });
    });

    it('THE WRITE-TIME PLAUSIBILITY GUARD: a hand-crafted entry whose repair is impossible is refused, counted, and NOT written (the Crunchwrap shape reaching for the database)', async () => {
        // Simulate a plan that somehow carries the already-correct 260 g
        // Crunchwrap row (e.g. cut by a buggy earlier version of this script).
        // Validation cannot know the row is honest — only the guard can, and it
        // must be the LAST gate before every write.
        const { plan, db } = await planAndDb();
        const rawBefore = { calories: 204, protein: 5.77, carbs: 28.1, fat: 7.69 };
        const crunchEntry: PlanEntry = {
            ...plan.entries[0],
            barcode: SYNTH(7),
            name: 'Crunchwrap Supreme',
            brandName: 'Taco Bell',
            servingGrams: 260,
            familyKey: 'Taco Bell|crunchwrap supreme',
            rawBefore,
            rawAfter: scaleStoredPanel(rawBefore, 260)!,
        };
        db.store.set(SYNTH(7), {
            barcode: SYNTH(7), name: 'Crunchwrap Supreme', brandName: 'Taco Bell',
            servingGrams: 260, nutrientsPer100g: { ...rawBefore },
            corruptReason: null, duplicateOfBarcode: null,
        });
        const res = await applyPlan([...plan.entries, crunchEntry], db);
        expect(res.applied).toHaveLength(2);
        const guarded = res.refusals.find(r => r.barcode === SYNTH(7))!;
        expect(guarded.reason).toBe('guard-refused');
        expect(guarded.detail.join(' ')).toContain('repaired-macro-sum-impossible');
        expect(db.writes.has(SYNTH(7))).toBe(false);
    });

    it('PLAN DRIFT: a tampered rawAfter is refused — the plan is an approval record, never the written value', async () => {
        const { plan, db } = await planAndDb();
        const tampered = plan.entries.map(e =>
            e.barcode === SYNTH(1)
                ? { ...e, rawAfter: { ...e.rawAfter, calories: (e.rawAfter.calories as number) * 2 } }
                : e);
        const res = await applyPlan(tampered, db);
        expect(res.applied.map(a => a.barcode)).toEqual([SYNTH(2)]);
        expect(res.refusals[0]).toMatchObject({ barcode: SYNTH(1), reason: 'plan-drift' });
        expect(db.writes.has(SYNTH(1))).toBe(false);
    });

    it('tier filtering applies only the approved tier', async () => {
        const rows = [...wawaFamily(), ...jmFamily()];
        const plan = roundTrip(await makePlan(rows));
        const db = fakeDb(rows.map(r => liveRowOf(r)));
        const res = await applyPlan(filterByTier(plan.entries, '1'), db);
        expect(res.applied).toHaveLength(3);
        expect([...db.writes.keys()].sort()).toEqual([SYNTH(3), SYNTH(4), SYNTH(5)].sort());
        expect(db.writes.has(SYNTH(1))).toBe(false); // tier-2 rows untouched
    });
});

// ===========================================================================
// 9. The mandatory-next-steps block
// ===========================================================================

describe('mandatory next steps: the repair is not done at the last UPDATE', () => {
    it('names the FULL Typesense rebuild, the reason, and the FoodMapping implications', () => {
        const text = mandatoryNextSteps('/tmp/OffFood-x.meta.json', 42).join('\n');
        expect(text).toContain('sync-typesense.ts');
        expect(text).toContain('gather-candidates.ts');
        expect(text).toContain('FULL rebuild, not incremental');
        expect(text).toContain('203 cache rows');
        expect(text).toContain('NO eviction is needed');
        expect(text).toContain('07, 08, 09, 10');
        expect(text).toContain('/tmp/OffFood-x.meta.json');
    });
});

/**
 * panel-scale-divided.test.ts — offline tests for detect-panel-scale-divided.ts.
 *
 * NO DATABASE, NO NETWORK. Every fixture family is built in code and fed to
 * `runScan` through an in-memory RowStream, so what is under test is the
 * detector's own logic rather than a snapshot of the corpus.
 *
 * The last block is a FAIL INJECTION in the style of fail-closed.test.ts
 * (PR #177): a total query failure must exit non-zero and must NOT render as a
 * clean "0 rows" summary. The anti-pattern it exists to prevent is
 * cache-parity-sweep.ts printing "0 changed records" on total HTTP failure.
 */

import {
    familyKey,
    familyFlagged,
    familyStats,
    formatSummary,
    guardRepair,
    newFamily,
    addMember,
    repairPanel,
    runScan,
    scanExitCode,
    stripSizeTokens,
    MAX_REPAIRED_KCAL_100G,
    MIN_FLAGGED_SERVING_G,
    type Panel,
    type PanelRow,
    type RowStream,
    type ScanReport,
} from '../detect-panel-scale-divided';
import { MAX_MACRO_SUM_100G } from '../../../src/lib/mapping/corrupt-mark';

// ===========================================================================
// Fixture helpers
// ===========================================================================

/** A row whose stored panel is the TRUE density divided by S/100 — i.e. one
 *  actual instance of the defect, generated from the mechanism rather than
 *  hand-typed, so the fixture cannot drift away from the hypothesis. */
function corruptRow(over: {
    barcode: string;
    name: string;
    brandName: string;
    servingGrams: number;
    trueDensity: Panel;
}): PanelRow {
    const f = 100 / over.servingGrams;
    const d = over.trueDensity;
    return {
        barcode: over.barcode,
        name: over.name,
        brandName: over.brandName,
        servingGrams: over.servingGrams,
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
    barcode: string;
    name: string;
    brandName: string;
    servingGrams: number;
    panel: Panel;
}): PanelRow {
    return {
        barcode: over.barcode, name: over.name, brandName: over.brandName,
        servingGrams: over.servingGrams, nutrientsPer100g: { ...over.panel },
    };
}

/** A stream over fixed rows. Re-iterable, because runScan makes TWO passes. */
function streamOf(rows: PanelRow[]): RowStream {
    return async function* () { yield rows; };
}

const SYNTH = (n: number) => `9${'0'.repeat(13)}${n}`;   // length 15 -> synthetic
const EAN = (n: number) => `50${String(n).padStart(11, '0')}`; // length 13 -> real EAN

const JM_NAME = "Jersey Mike's Subs, #44 Buffalo Chicken Cheese Steak On White";
const JM_BRAND = "Jersey Mike's Subs";

/**
 * The two rows of the live proof, panels copied VERBATIM out of the corpus
 * (2026-07-26) rather than synthesized — so this fixture is evidence, not a
 * restatement of the hypothesis. Same product, two sizes, one true density.
 */
function jerseyMikesFamily(barcode: (n: number) => string): PanelRow[] {
    return [
        healthyRow({
            barcode: barcode(1), name: `${JM_NAME} Regular`, brandName: JM_BRAND, servingGrams: 541,
            panel: { calories: 32, protein: 1.66, carbs: 2.59, fat: 1.66, fiber: 0, sugars: 0.37, sodium: 0.124 },
        }),
        healthyRow({
            barcode: barcode(2), name: `${JM_NAME} Giant`, brandName: JM_BRAND, servingGrams: 1060,
            panel: { calories: 16.3, protein: 0.849, carbs: 1.32, fat: 0.849, fiber: 0, sugars: 0.189, sodium: 0.065 },
        }),
    ];
}

async function scan(rows: PanelRow[], opts: Parameters<typeof runScan>[1] = {}): Promise<ScanReport> {
    return runScan(streamOf(rows), opts);
}

// ===========================================================================
// 1. Family key — size tokens must collapse, identity tokens must not
// ===========================================================================

describe('family key: size words collapse, the product does not', () => {
    it('Regular / Giant / 32 Oz variants of one sub land in ONE key', () => {
        const keys = new Set([
            "Jersey Mike's Subs, #44 Buffalo Chicken Cheese Steak On White Regular",
            "Jersey Mike's Subs, #44 Buffalo Chicken Cheese Steak On White Giant",
            "Jersey Mike's Subs, #44 Buffalo Chicken Cheese Steak On White, 32 Oz",
            "Jersey Mike's Subs - #44 Buffalo Chicken Cheese Steak on White (Mini)",
        ].map(n => familyKey(n, "Jersey Mike's Subs")));
        expect(keys.size).toBe(1);
        expect([...keys][0]).toBe("Jersey Mike's Subs|jersey mike s subs buffalo chicken cheese steak on white");
    });

    it('every listed size token is stripped, including bare integers', () => {
        for (const t of ['mini', 'small', 'sm', 'regular', 'reg', 'medium', 'med', 'large', 'lg',
            'giant', 'kid', 'kids', 'cub', 'junior', 'jr', 'whatameal', 'whatabox', 'combo',
            'value', 'snack', 'single', 'double', 'triple', 'oz', 'fl', 'in', 'inch',
            'footlong', 'half', 'full', 'meal', 'box', 'wrap', 'wraps', 'tub', 'tubs',
            '12', '440']) {
            expect(stripSizeTokens(`Burrito ${t}`)).toBe('burrito');
        }
    });

    it('wrap/tub variants join the base family (the #44 class), exact-token only', () => {
        // The flagship residue: the Wrap variant must land in the SAME family
        // as the Regular/Giant sizes so the detector can examine it.
        const keys = new Set([
            '#44 Buffalo Chicken Cheese Steak On White Regular',
            '#44 Buffalo Chicken Cheese Steak On White Giant',
            '#44 Buffalo Chicken Cheese Steak On White Wrap',
        ].map(n => familyKey(n, "Jersey Mike's Subs")));
        expect(keys.size).toBe(1);
        // Exact-token stripping: 'crunchwrap' is a product name, not a format
        // token, and must survive (the over-stripping trap the POSITIVE
        // CONTROL below guards in general form).
        expect(stripSizeTokens('Taco Bell, Crunchwrap Supreme')).toContain('crunchwrap');
    });

    it('POSITIVE CONTROL — two genuinely different products do NOT collapse', () => {
        // Without this the block above is satisfiable by a key that strips
        // everything, which would merge the whole brand into one family.
        expect(familyKey('Taco Bell, Crunchwrap Supreme', 'Taco Bell'))
            .not.toBe(familyKey('Taco Bell, Cheesy Gordita Crunch', 'Taco Bell'));
        expect(familyKey('Chips, Large', 'Chipotle')).not.toBe(familyKey('Queso, Large', 'Chipotle'));
    });

    it('the same product name under DIFFERENT brands stays separate', () => {
        expect(familyKey('Iced Coffee, Large', 'Wawa')).not.toBe(familyKey('Iced Coffee, Large', 'Dunkin'));
    });

    it('a name that normalizes to nothing yields NO key (the pseudo-family guard)', () => {
        // Live artifact: `Нз|` merged "Паста" (459 kcal/100g, S=50) with
        // "Пържола" (107 kcal/100g, S=186) — unrelated foods that happen to fit
        // a -1.11 slope at r2 1.00. A family key must name a product.
        expect(familyKey('Пържола', 'Нз')).toBeNull();
        expect(familyKey('Паста', 'Нз')).toBeNull();
        expect(familyKey('Large', 'Wawa')).toBeNull();      // all-size-token name
        expect(familyKey('Sub', null)).toBeNull();
        expect(familyKey('Sub', '  ')).toBeNull();
    });

    it('...and those rows are COUNTED, not silently dropped', async () => {
        const rows = [
            healthyRow({ barcode: SYNTH(1), name: 'Паста', brandName: 'Нз', servingGrams: 50, panel: { calories: 459 } }),
            healthyRow({ barcode: SYNTH(2), name: 'Пържола', brandName: 'Нз', servingGrams: 186, panel: { calories: 107 } }),
            healthyRow({ barcode: SYNTH(3), name: 'Пържола', brandName: 'Нз', servingGrams: 186, panel: { calories: 107 } }),
        ];
        const r = await scan(rows, { arm: 'all' });
        expect(r.baseFilterPassed).toBe(3);
        expect(r.skippedEmptyNameKey).toBe(3);
        expect(r.flaggedRowsAllArms).toBe(0);
        // The exclusion is visible in the human summary, not just the JSON.
        expect(formatSummary(r).join('\n')).toContain('empty family key');
    });
});

// ===========================================================================
// 2. The Jersey Mike's shape flags and repairs to a size-invariant density
// ===========================================================================

describe('a 2-size divided family is flagged and repairs to one density', () => {
    it('slope is -1 at r2 1 and both sizes recover the SAME density', async () => {
        const r = await scan(jerseyMikesFamily(SYNTH));

        expect(r.flaggedFamilies).toBe(1);
        expect(r.flaggedRows).toBe(2);
        expect(r.repairs).toHaveLength(2);
        expect(r.refusalCount).toBe(0);

        for (const rep of r.repairs) {
            // -1.0029 on the real rounded panels, not exactly -1: this is why
            // the flag band is [-1.15, -0.85] and not an equality test.
            expect(rep.familySlope).toBeCloseTo(-1, 2);
            expect(rep.familyR2).toBeCloseTo(1, 6);
            expect(rep.familySize).toBe(2);
            expect(rep.familyDistinctServings).toBe(2);
        }

        // THE POINT: a per-100g density cannot depend on serving mass. Before
        // repair the two sizes disagree ~2x; after repair they agree to 0.2%.
        const byServing = [...r.repairs].sort((a, b) => a.servingGrams - b.servingGrams);
        const stored = byServing.map(x => x.current.calories);
        expect(stored[0] / stored[1]).toBeGreaterThan(1.9);

        const recovered = byServing.map(x => x.repaired.calories);
        expect(recovered[0]).toBeCloseTo(173.1, 1);
        expect(recovered[1]).toBeCloseTo(172.8, 1);
        expect(Math.abs(recovered[0] - recovered[1]) / recovered[0]).toBeLessThan(0.003);

        // Every macro recovers to an equally size-invariant value. The 3%
        // tolerance is the STORED rounding, not the method: the Giant's sodium
        // is filed as 0.065 g/100g (two significant figures), and multiplying a
        // 2-s.f. number by 10.6 carries that rounding straight through.
        for (const k of ['protein', 'carbs', 'fat', 'sugars', 'sodium'] as const) {
            const a = byServing[0].repaired[k]!;
            const b = byServing[1].repaired[k]!;
            expect(Math.abs(a - b) / a).toBeLessThan(0.03);
        }

        // ...and the two sizes stop billing the identical number they bill today.
        expect(Math.round(byServing[0].currentServingKcal)).toBe(173);
        expect(Math.round(byServing[1].currentServingKcal)).toBe(173);
        expect(Math.round(byServing[0].repairedServingKcal)).toBe(937);
        expect(Math.round(byServing[1].repairedServingKcal)).toBe(1831);
        expect(byServing[0].understatementFactor).toBeCloseTo(5.4, 1);
        expect(byServing[1].understatementFactor).toBeCloseTo(10.6, 1);
    });

    it('EVERY numeric field is repaired, not just calories', () => {
        // The refuted kJ-slip hypothesis predicts calories-only. The macros
        // moved too, which is why the corrupt rows are Atwater-PERFECT.
        const stored: Panel = { calories: 32, protein: 1.66, carbs: 2.59, fat: 1.66, fiber: 0, sugars: 0.37, sodium: 0.124 };
        const rep = repairPanel(stored, 541);
        for (const k of ['calories', 'protein', 'carbs', 'fat', 'sugars', 'sodium'] as const) {
            expect(rep[k]!).toBeCloseTo((stored[k] as number) * 5.41, 6);
        }
        // A MISSING field stays missing — never invented as a measured zero.
        expect(repairPanel({ calories: 32, protein: null }, 541).protein).toBeNull();
        expect(repairPanel({ calories: 32 }, 541).fiber).toBeNull();
    });

    it('the corrupt panel is Atwater-CONSISTENT, so Atwater cannot detect it', () => {
        // Guards the refuted hypothesis: if someone reintroduces an Atwater
        // cross-check as the detector, this documents why it sees nothing.
        const row = jerseyMikesFamily(SYNTH)[0].nutrientsPer100g as Record<string, number>;
        const atwater = 4 * row.protein + 4 * row.carbs + 9 * row.fat;
        expect(Math.abs(atwater - row.calories) / row.calories).toBeLessThan(0.01);
    });

    it('a family whose sizes are too CLOSE together does not qualify', () => {
        const acc = newFamily();
        addMember(acc, 200, 100);
        addMember(acc, 240, 83.33);   // spread 1.2 < 1.3
        expect(familyStats(acc).sizeSpread).toBeCloseTo(1.2, 6);
        expect(familyFlagged(familyStats(acc))).toBe(false);
    });

    it('a NOISY family (real recipe drift between sizes) fails the r2 gate', async () => {
        const rows = [
            healthyRow({ barcode: SYNTH(11), name: 'Combo Platter Regular', brandName: 'Diner', servingGrams: 300, panel: { calories: 200, protein: 10, carbs: 20, fat: 8 } }),
            healthyRow({ barcode: SYNTH(12), name: 'Combo Platter Large', brandName: 'Diner', servingGrams: 500, panel: { calories: 260, protein: 12, carbs: 26, fat: 10 } }),
            healthyRow({ barcode: SYNTH(13), name: 'Combo Platter Giant', brandName: 'Diner', servingGrams: 800, panel: { calories: 190, protein: 9, carbs: 19, fat: 7 } }),
        ];
        expect((await scan(rows)).flaggedRows).toBe(0);
    });

    it('members BELOW the serving guard are not flagged even in a flagged family', async () => {
        const rows = [
            ...jerseyMikesFamily(SYNTH),
            corruptRow({ barcode: SYNTH(3), name: `${JM_NAME} Mini`, brandName: JM_BRAND, servingGrams: 120, trueDensity: { calories: 173.1, protein: 8.98, carbs: 14.01, fat: 8.98 } }),
        ];
        const r = await scan(rows);
        expect(r.flaggedRows).toBe(2);
        expect(r.repairs.every(x => x.servingGrams >= MIN_FLAGGED_SERVING_G)).toBe(true);
        expect(r.repairs.map(x => x.barcode)).not.toContain(SYNTH(3));
    });
});

// ===========================================================================
// 3. Arms — the portion-standardized retail family is not a repair candidate
// ===========================================================================

describe('arms: a real-EAN retail family stays OUT of the synthetic arm', () => {
    // Wegmans/M&S/Great Value shape: per-100g panels standardized by retail
    // policy across pack sizes produce the same -1 slope HONESTLY. Every
    // hand-checked false positive lived here (measured 10.0% FP, 3 of 30, on
    // the unrestricted set), which is why the default arm excludes it.
    const retail = [
        corruptRow({ barcode: EAN(1), name: 'Muenster Cheese Slices, Small', brandName: 'Wegmans', servingGrams: 200, trueDensity: { calories: 100, protein: 7, carbs: 1, fat: 8 } }),
        corruptRow({ barcode: EAN(2), name: 'Muenster Cheese Slices, Large', brandName: 'Wegmans', servingGrams: 400, trueDensity: { calories: 100, protein: 7, carbs: 1, fat: 8 } }),
    ];

    it('it is invisible in the default (synthetic) arm', async () => {
        const r = await scan(retail);
        expect(r.arm).toBe('synthetic');
        expect(r.flaggedRows).toBe(0);
        expect(r.repairs).toHaveLength(0);
        // ...but the detector still ADMITS it flagged, so a 0 here is a
        // deliberate arm exclusion and not a claim the corpus is clean.
        expect(r.flaggedRowsAllArms).toBe(2);
    });

    it('--arm real-ean shows it, --arm all shows both, and the arms partition', async () => {
        const rows = [...retail, ...jerseyMikesFamily(SYNTH)];
        const synth = await scan(rows, { arm: 'synthetic' });
        const ean = await scan(rows, { arm: 'real-ean' });
        const all = await scan(rows, { arm: 'all' });

        expect(synth.flaggedRows).toBe(2);
        expect(synth.byBrand.map(b => b.brandName)).toEqual(["Jersey Mike's Subs"]);
        expect(ean.flaggedRows).toBe(2);
        expect(ean.byBrand.map(b => b.brandName)).toEqual(['Wegmans']);
        expect(all.flaggedRows).toBe(4);
        expect(synth.flaggedRows + ean.flaggedRows).toBe(all.flaggedRows);
        // flaggedRowsAllArms is arm-independent — the denominator never moves.
        for (const r of [synth, ean, all]) expect(r.flaggedRowsAllArms).toBe(4);
    });
});

// ===========================================================================
// 4. Single-size brands are STRUCTURALLY unexaminable, and the reason matters
// ===========================================================================

describe('White Claw shape: a single-size brand is never flagged, and the reason is "no family"', () => {
    const whiteClaw: PanelRow[] = ['Black Cherry', 'Mango', 'Lime', 'Raspberry', 'Watermelon']
        .map((flavour, i) => healthyRow({
            barcode: SYNTH(20 + i),
            name: `White Claw Hard Seltzer ${flavour}, 12 Fl Oz`,
            brandName: 'White Claw',
            servingGrams: 355,
            panel: { calories: 2.8, protein: 0, carbs: 0.56, fat: 0 },
        }));

    it('zero rows flagged', async () => {
        const r = await scan(whiteClaw, { arm: 'all' });
        expect(r.flaggedRows).toBe(0);
        expect(r.flaggedRowsAllArms).toBe(0);
        expect(r.repairs).toHaveLength(0);
    });

    it('the REASON is that no multi-size family forms — its kcal is never examined', async () => {
        // This is the load-bearing assertion. "0 flagged" for White Claw must
        // not be read as "White Claw is clean": five distinct flavours are five
        // one-member families at one serving size, so no family qualifies and
        // no density comparison ever happens. Reading it as an all-clear is the
        // fixture-blindness failure this project keeps rediscovering.
        const r = await scan(whiteClaw, { arm: 'all' });
        expect(r.baseFilterPassed).toBe(5);
        expect(r.families).toBe(5);
        expect(r.qualifyingFamilies).toBe(0);

        // And it is the FAMILY test that excludes it, not any kcal threshold:
        // at 0.028 kcal/g White Claw is far BELOW the corrupt Jersey Mike's sub
        // (0.21 kcal/g), so any absolute energy floor hits the seltzer first.
        for (const row of whiteClaw) {
            const acc = newFamily();
            addMember(acc, row.servingGrams!, (row.nutrientsPer100g as { calories: number }).calories);
            const s = familyStats(acc);
            expect(s.n).toBe(1);
            expect(s.distinctServings).toBe(1);
            expect(familyFlagged(s)).toBe(false);
        }
    });

    it('POSITIVE CONTROL — give the same brand a SECOND size and it becomes examinable', async () => {
        // Without this, "White Claw never flags" is satisfiable by a detector
        // that flags nothing at all.
        const surge = { calories: 40, protein: 0, carbs: 8, fat: 0 };
        const twoSize = [
            ...whiteClaw,
            corruptRow({ barcode: SYNTH(30), name: 'White Claw Surge Blackberry, 16 Fl Oz', brandName: 'White Claw', servingGrams: 473, trueDensity: surge }),
            corruptRow({ barcode: SYNTH(31), name: 'White Claw Surge Blackberry, 12 Fl Oz', brandName: 'White Claw', servingGrams: 355, trueDensity: surge }),
        ];
        const r = await scan(twoSize, { arm: 'all' });
        expect(r.qualifyingFamilies).toBe(1);
        expect(r.flaggedRows).toBe(2);
    });
});

// ===========================================================================
// 5. The post-repair plausibility guard
// ===========================================================================

describe('plausibility guard: an impossible repair is REFUSED and COUNTED', () => {
    it('refuses a repaired energy density above the physical ceiling', () => {
        expect(guardRepair({ calories: MAX_REPAIRED_KCAL_100G + 1 }).join(' ')).toContain('repaired-kcal-impossible');
        expect(guardRepair({ calories: MAX_REPAIRED_KCAL_100G })).toEqual([]);
    });

    it('refuses a repaired macro sum above the existing MAX_MACRO_SUM_100G slack', () => {
        // 105, not 100: corrupt-mark.ts grants that slack to label rounding
        // deliberately. Reused, not reinvented — a second copy would fork it.
        expect(MAX_MACRO_SUM_100G).toBe(105);
        expect(guardRepair({ calories: 400, protein: 40, carbs: 40, fat: 26 }).join(' '))
            .toContain('repaired-macro-sum-impossible');
        expect(guardRepair({ calories: 400, protein: 40, carbs: 40, fat: 25 })).toEqual([]);
    });

    it('the refused row is reported with its reason, never dropped into silence', async () => {
        // The live shape: Taco Bell "Crunchwrap Supreme" pairs a 100 g row at
        // 537 kcal/100g with a 260 g row at 204 — a -1.01 slope at r2 1.00. But
        // the 260 g row is ALREADY a correct density, so "repairing" it would
        // invent a 108 g/100g macro sum. The guard is what catches it.
        const rows = [
            healthyRow({ barcode: SYNTH(40), name: 'Taco Bell, Crunchwrap Supreme', brandName: 'Taco Bell', servingGrams: 100, panel: { calories: 537, protein: 16, carbs: 71, fat: 21 } }),
            healthyRow({ barcode: SYNTH(41), name: 'Taco Bell, Crunchwrap Supreme', brandName: 'Taco Bell', servingGrams: 260, panel: { calories: 204, protein: 5.77, carbs: 28.1, fat: 7.69 } }),
        ];
        const r = await scan(rows);

        expect(r.flaggedRows).toBe(1);              // only the >=150 g member
        expect(r.repairs).toHaveLength(0);          // ...and it was refused
        expect(r.refusalCount).toBe(1);
        expect(r.refusals).toHaveLength(1);
        expect(r.refusals[0].barcode).toBe(SYNTH(41));
        expect(r.refusals[0].reasons.join(' ')).toContain('repaired-macro-sum-impossible');

        // A refusal must be legible in the human summary. If the only place a
        // dropped row appears is a JSON field nobody opens, an emptied plan
        // reads exactly like a clean corpus.
        const text = formatSummary(r).join('\n');
        expect(text).toContain('REFUSED');
        expect(text).toContain('Repairs REFUSED by the post-repair plausibility guard: 1');
        // The per-brand summary carries the refusal too.
        expect(r.byBrand).toEqual([{ brandName: 'Taco Bell', rows: 1, families: 1, refusals: 1 }]);
    });

    it('POSITIVE CONTROL — a plausible repair in the same run is still emitted', async () => {
        const rows = [
            healthyRow({ barcode: SYNTH(40), name: 'Taco Bell, Crunchwrap Supreme', brandName: 'Taco Bell', servingGrams: 100, panel: { calories: 537, protein: 16, carbs: 71, fat: 21 } }),
            healthyRow({ barcode: SYNTH(41), name: 'Taco Bell, Crunchwrap Supreme', brandName: 'Taco Bell', servingGrams: 260, panel: { calories: 204, protein: 5.77, carbs: 28.1, fat: 7.69 } }),
            ...jerseyMikesFamily(SYNTH),
        ];
        const r = await scan(rows);
        expect(r.repairs).toHaveLength(2);
        expect(r.refusalCount).toBe(1);
        expect(r.flaggedRows).toBe(3);
        // repairs + refusals accounts for EVERY flagged row: nothing vanishes.
        expect(r.repairs.length + r.refusalCount).toBe(r.flaggedRows);
    });

    it('--limit truncates the plan but never the counts, and says so', async () => {
        const r = await scan(jerseyMikesFamily(SYNTH), { limit: 1 });
        expect(r.repairs).toHaveLength(1);
        expect(r.flaggedRows).toBe(2);
        expect(r.truncated).toBe(true);
        expect(formatSummary(r).join('\n')).toContain('TRUNCATED');
    });
});

// ===========================================================================
// 6. FAIL INJECTION — a dead query is not a clean corpus
// ===========================================================================

describe('fail-closed: a total query failure exits non-zero and prints no clean summary', () => {
    const boom: RowStream = async function* () {
        throw new Error('P1001: Can\'t reach database server at 192.168.1.133:5432');
        // eslint-disable-next-line no-unreachable
        yield [];
    };

    it('runScan PROPAGATES the failure instead of returning an empty report', async () => {
        // The anti-pattern: cache-parity-sweep.ts catches, returns nothing, and
        // prints "0 changed records" with exit 0 on a total outage. A scan that
        // swallowed this would report "0 rows flagged" over a dead database.
        await expect(runScan(boom, { arm: 'all' })).rejects.toThrow(/reach database server/);
    });

    it('a failure mid-stream propagates too, not just a failure on the first read', async () => {
        const partial: RowStream = async function* () {
            yield jerseyMikesFamily(SYNTH);
            throw new Error('ECONNRESET');
        };
        await expect(runScan(partial, { arm: 'all' })).rejects.toThrow('ECONNRESET');
    });

    it('the CLI wrapper shape: a rejection means no summary is ever composed', async () => {
        // Mirrors main(): runScan is NOT wrapped in a try/catch of its own, so a
        // rejection reaches the top-level handler and exits 2. Assert that the
        // only path to formatSummary is a report that actually exists.
        const printed: string[] = [];
        let exitCode = 0;
        try {
            const report = await runScan(boom, { arm: 'all' });
            for (const line of formatSummary(report)) printed.push(line);
            exitCode = scanExitCode(report);
        } catch {
            exitCode = 2;
        }
        expect(exitCode).toBe(2);
        expect(printed).toHaveLength(0);
        expect(printed.join('\n')).not.toMatch(/Flagged|0 rows|Repairs emitted/);
    });

    it('an EMPTY result set is exit 2 as well — nothing scanned is not a clean run', async () => {
        const empty = await scan([], { arm: 'all' });
        expect(empty.scanned).toBe(0);
        expect(scanExitCode(empty)).toBe(2);
        // ...and so is a scan where every row failed the base filter: a filter
        // typo or a wrong-database pointer produces exactly this.
        const allFiltered = await scan([
            healthyRow({ barcode: SYNTH(50), name: 'Sub', brandName: 'X', servingGrams: 1, panel: { calories: 200 } }),
        ], { arm: 'all' });
        expect(allFiltered.scanned).toBe(1);
        expect(allFiltered.baseFilterPassed).toBe(0);
        expect(scanExitCode(allFiltered)).toBe(2);
    });

    it('POSITIVE CONTROL — a real scan exits 0 and DOES compose a summary', async () => {
        // Without this, "exit code is not 0" is satisfiable by a script that
        // never succeeds, which is a tautology rather than a test.
        const ok = await scan(jerseyMikesFamily(SYNTH));
        expect(scanExitCode(ok)).toBe(0);
        expect(formatSummary(ok).join('\n')).toContain('Repairs emitted: 2');
    });

    it('a run that flags NOTHING still exits 0 — absence of the defect is a real answer', async () => {
        // The converse guard: only a broken INSTRUMENT is red. A healthy corpus
        // must not be reported as an error, or the exit code stops meaning
        // anything.
        const clean = await scan([
            healthyRow({ barcode: SYNTH(60), name: 'Oat Milk, Large', brandName: 'Cafe', servingGrams: 500, panel: { calories: 45, protein: 1, carbs: 7, fat: 1.5 } }),
            healthyRow({ barcode: SYNTH(61), name: 'Oat Milk, Small', brandName: 'Cafe', servingGrams: 250, panel: { calories: 45, protein: 1, carbs: 7, fat: 1.5 } }),
        ], { arm: 'all' });
        expect(clean.flaggedRows).toBe(0);
        expect(scanExitCode(clean)).toBe(0);
    });
});

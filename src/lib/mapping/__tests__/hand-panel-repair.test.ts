/**
 * Pins the decision half of the hand-authored panel rescale. The live case is
 * `bun cha` (off_0063383036356): a 300 g whole-bowl panel written into the
 * per-100g field, witnessed by off_0060383068356 whose stored panel already
 * equals this one divided by 3 on every field.
 */
import {
    HandPanelLiveRow,
    HandPanelRepairEntry,
    decideHandPanelRepair,
    guardRepairedPanel,
    rescaleServingPanelTo100g,
} from '../hand-panel-repair';
import authored from '../hand-panel-repairs.json';

const BUN_CHA_PANEL = {
    fat: 13,
    carbs: 63,
    fiber: 2,
    sodium: 1.019999980926514,
    sugars: 27,
    protein: 16,
    calories: 430,
};

const WITNESS_PANEL = {
    fat: 4.333333492279053,
    carbs: 21,
    fiber: 0.6666666865348816,
    sodium: 0.3400000035762787,
    sugars: 9,
    protein: 5.333333492279053,
    calories: 143.3333282470703,
};

const entry = (): HandPanelRepairEntry => ({
    barcode: '0063383036356',
    class: 'serving-panel',
    seed: 'bun cha',
    reason: 'per-serving panel in the per-100g field',
    source: 'test',
    authoredAt: '2026-08-28',
    clearsMark: 'hand-triage-2026-08-14:panel',
    observed: { name: 'Bun cha', servingGrams: 300, panel: { ...BUN_CHA_PANEL } },
    witness: { barcode: '0060383068356', note: 'panel witness' },
});

const target = (over: Partial<HandPanelLiveRow> = {}): HandPanelLiveRow => ({
    barcode: '0063383036356',
    name: 'Bun cha',
    corruptReason: 'hand-triage-2026-08-14:panel',
    servingGrams: 300,
    panel: { ...BUN_CHA_PANEL },
    ...over,
});

const witness = (over: Partial<HandPanelLiveRow> = {}): HandPanelLiveRow => ({
    barcode: '0060383068356',
    name: 'Chicken Bun Cha',
    corruptReason: null,
    servingGrams: 300,
    panel: { ...WITNESS_PANEL },
    ...over,
});

describe('rescaleServingPanelTo100g', () => {
    it('divides every field by servingGrams/100', () => {
        const out = rescaleServingPanelTo100g(BUN_CHA_PANEL, 300);
        expect(out.calories).toBeCloseTo(143.3333, 4);
        expect(out.carbs).toBeCloseTo(21, 6);
        expect(out.protein).toBeCloseTo(5.33333, 4);
        expect(Object.keys(out).sort()).toEqual(Object.keys(BUN_CHA_PANEL).sort());
    });

    it('is the INVERSE of the divided-panel repair, not the same operation', () => {
        // repair-panel-scale-divided.ts multiplies by S/100; this divides.
        const dividedRepair = Object.fromEntries(
            Object.entries(BUN_CHA_PANEL).map(([k, v]) => [k, v * (300 / 100)])
        );
        const out = rescaleServingPanelTo100g(BUN_CHA_PANEL, 300);
        expect(out.calories).not.toBeCloseTo(dividedRepair.calories, 1);
    });
});

describe('decideHandPanelRepair — the live bun cha case', () => {
    it('repairs, clears the authored mark, and lands on the witness panel', () => {
        const d = decideHandPanelRepair(entry(), target(), witness());
        expect(d.repair).toBe(true);
        if (!d.repair) return;
        expect(d.clearsMark).toBe('hand-triage-2026-08-14:panel');
        for (const k of Object.keys(WITNESS_PANEL) as Array<keyof typeof WITNESS_PANEL>) {
            expect(d.panel[k]).toBeCloseTo(WITNESS_PANEL[k], 4);
        }
    });
});

describe('decideHandPanelRepair — refusals', () => {
    it('refuses when the row is gone', () => {
        expect(decideHandPanelRepair(entry(), null, witness())).toMatchObject({ repair: false, skip: 'row_missing' });
    });

    it('refuses when the live panel has moved (a refresh delivered a correction)', () => {
        const moved = target({ panel: { ...BUN_CHA_PANEL, calories: 143.33 } });
        expect(decideHandPanelRepair(entry(), moved, witness())).toMatchObject({ repair: false, skip: 'panel_moved' });
    });

    it('refuses when another writer has re-marked the row', () => {
        const remarked = target({ corruptReason: 'physics-tier-2026-08-01:macro-sum' });
        expect(decideHandPanelRepair(entry(), remarked, witness())).toMatchObject({ repair: false, skip: 'mark_moved' });
    });

    it('refuses when the name key has moved', () => {
        expect(decideHandPanelRepair(entry(), target({ name: 'Bun bo hue' }), witness()))
            .toMatchObject({ repair: false, skip: 'name_moved' });
    });

    it('refuses when servingGrams has moved', () => {
        expect(decideHandPanelRepair(entry(), target({ servingGrams: 250 }), witness()))
            .toMatchObject({ repair: false, skip: 'serving_moved' });
    });

    it('refuses a serving mass in the 90-110 g dead zone, where the repair is a no-op', () => {
        const e = entry();
        e.observed.servingGrams = 100;
        expect(decideHandPanelRepair(e, target({ servingGrams: 100 }), witness()))
            .toMatchObject({ repair: false, skip: 'serving_out_of_window' });
    });

    it('refuses without a live witness — the formula alone is not evidence', () => {
        expect(decideHandPanelRepair(entry(), target(), null))
            .toMatchObject({ repair: false, skip: 'witness_missing' });
    });

    it('refuses when the witness no longer agrees with the repaired panel', () => {
        const w = witness({ panel: { ...WITNESS_PANEL, protein: 9 } });
        expect(decideHandPanelRepair(entry(), target(), w))
            .toMatchObject({ repair: false, skip: 'witness_mismatch' });
    });

    it('refuses a witness whose field set differs', () => {
        const { sugars, ...rest } = WITNESS_PANEL;
        expect(decideHandPanelRepair(entry(), target(), witness({ panel: rest })))
            .toMatchObject({ repair: false, skip: 'witness_field_set_differs' });
    });

    it('refuses a panel field whose scaling behaviour is not reasoned about', () => {
        const e = entry();
        e.observed.panel = { ...BUN_CHA_PANEL, servingsPerContainer: 4 };
        const t = target({ panel: { ...BUN_CHA_PANEL, servingsPerContainer: 4 } });
        expect(decideHandPanelRepair(e, t, witness()))
            .toMatchObject({ repair: false, skip: 'unknown_panel_field' });
    });

    it('refuses a BEFORE panel that is not Atwater-coherent — a scale slip preserves the identity', () => {
        const broken = { ...BUN_CHA_PANEL, carbs: 5 };
        const e = entry();
        e.observed.panel = broken;
        expect(decideHandPanelRepair(e, target({ panel: broken }), witness()))
            .toMatchObject({ repair: false, skip: 'before_not_atwater_consistent' });
    });

    it('refuses an entry with no witness declared at all', () => {
        const e = entry();
        // @ts-expect-error deliberately malformed authored record
        delete e.witness;
        expect(decideHandPanelRepair(e, target(), witness()))
            .toMatchObject({ repair: false, skip: 'entry_invalid' });
    });
});

describe('guardRepairedPanel', () => {
    it('passes the repaired bun cha panel', () => {
        expect(guardRepairedPanel(rescaleServingPanelTo100g(BUN_CHA_PANEL, 300))).toBeNull();
    });
    it('refuses an impossible macro sum', () => {
        expect(guardRepairedPanel({ calories: 400, protein: 50, carbs: 50, fat: 20 })).toMatch(/macro_sum_above/);
    });
    it('refuses a panel with no calories', () => {
        expect(guardRepairedPanel({ protein: 5 })).toBe('no_calories');
    });
});

describe('the authored record', () => {
    it('is a non-empty array and every entry declares a witness', () => {
        expect(Array.isArray(authored)).toBe(true);
        expect(authored.length).toBeGreaterThan(0);
        for (const e of authored as HandPanelRepairEntry[]) {
            expect(e.class).toBe('serving-panel');
            expect(typeof e.witness?.barcode).toBe('string');
            expect(e.witness.barcode).not.toBe(e.barcode);
            expect(e.seed.length).toBeGreaterThan(0);
        }
    });

    it('has no barcode also present in the hand-MARK record — the two instruments must not both fire', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const marks = require('../corrupt-off-handmarks.json') as Array<{ barcode: string }>;
        const marked = new Set(marks.map(m => m.barcode));
        for (const e of authored as HandPanelRepairEntry[]) {
            expect(marked.has(e.barcode)).toBe(false);
        }
    });
});

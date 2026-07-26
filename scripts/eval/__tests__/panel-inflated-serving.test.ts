/**
 * panel-inflated-serving.test.ts — the sibling-free per-serving-panel rule,
 * tested against real corpus rows on both sides.
 *
 * Same hard requirement as failure-classes.test.ts: a detector that no longer
 * fires on the rows that motivated it is worse than no detector, because the
 * report then reads "class closed". So every exemplar below is a REAL row
 * (barcode + measured panel, read from the live corpus on 2026-07-26), and every
 * negative control is a real row too — a legitimately large serving that this
 * rule must refuse. The negatives are chosen so that each one clears every
 * condition except the one named in its expectation: a control that failed at
 * the first gate would execute none of the rule and prove nothing.
 *
 * The rule permanently removes records from the index once the (separate,
 * human-gated) marking op runs, so its refusals matter as much as its hits.
 */

import {
    MAX_MACRO_SUM_100G,
    MIN_DRY_MACRO_SUM_100G,
    MIN_IMPLIED_SERVING_KCAL,
    SERVING_WINDOW_MAX_G,
    SERVING_WINDOW_MIN_G,
    atwaterKcal,
    decideMark,
    impliedServingKcal,
    rejectPanelInflatedServing,
    type CorruptScanFlag,
    type ServingScalePanel,
} from '../../../src/lib/mapping/corrupt-mark';

interface Exemplar {
    barcode: string;
    label: string;
    panel: ServingScalePanel;
    /** What the reviewer concluded the row really is. */
    note: string;
}

// ---------------------------------------------------------------------------
// Positive exemplars — measured members of the class
// ---------------------------------------------------------------------------

const MEMBERS: Exemplar[] = [
    {
        barcode: '7500618202346',
        label: 'Factor "Pork chili Mac"',
        panel: { kcal100: 560, servingGrams: 357, protein: 29, carbs: 46, fat: 29 },
        note: '560 kcal is the TRAY, not 100 g of it. Believed per-100g it bills 1,999 kcal.',
    },
    {
        barcode: '00040420',
        label: 'Raymond et Roquelaure "Cassoulet canard"',
        panel: { kcal100: 597, servingGrams: 420, protein: 44, carbs: 30, fat: 30 },
        note: 'A 420 g tin of cassoulet cannot be 597 kcal per 100 g; 2,507 kcal implied.',
    },
    {
        barcode: '7500021202235',
        label: 'Factor "Grilled chicken a la vodka"',
        panel: { kcal100: 630, servingGrams: 366, protein: 42, carbs: 10, fat: 50 },
        note: '2,306 kcal implied for one meal tray.',
    },
    {
        barcode: '2062759005994',
        label: 'Market Basket "Whole Steak Cheese Sub"',
        panel: { kcal100: 570, servingGrams: 269, protein: 30, carbs: 41, fat: 32 },
        note: 'Deli singleton — no same-name siblings, so the median rule cannot see it.',
    },
    {
        barcode: '0088332030056',
        label: 'Sodebo "Salade et compagnie"',
        panel: { kcal100: 575, servingGrams: 320, protein: 26, carbs: 51, fat: 28 },
        note: 'Macro sum lands on exactly 105 — the top edge of the rounding slack.',
    },
    {
        barcode: '0990739144666',
        label: 'KFC chocolate shake',
        panel: { kcal100: 522.7999877929688, servingGrams: 310, protein: 9, carbs: 74, fat: 20 },
        note: 'Restaurant singleton: 522.8 kcal is the cup. Believed per-100g it bills 1,621.',
    },
];

// ---------------------------------------------------------------------------
// Negative controls — real rows that are NOT this class
// ---------------------------------------------------------------------------

const CONTROLS: Array<Exemplar & { expected: string }> = [
    {
        barcode: '8413080019282',
        label: 'Gourmet refined sunflower oil, 1 L bottle',
        panel: { kcal100: 826, servingGrams: 1000, protein: 0, carbs: 9, fat: 91.8 },
        note:
            'The single largest implied per-serving energy in the whole corpus (8,260 kcal) ' +
            'and a perfectly correct panel: 826 kcal/100g IS refined oil. servingGrams is the ' +
            'bottle. It clears the dry band, the Atwater test and the energy threshold — only ' +
            'the serving window saves it, which is exactly what that window is for.',
        expected: 'serving_outside_single_serving_window',
    },
    {
        barcode: '8964001506133',
        label: 'Hemani coconut oil, 700 g jar',
        panel: { kcal100: 900, servingGrams: 700, protein: 0, carbs: 0, fat: 100 },
        note: 'Pure fat, panel exactly right, 6,300 kcal implied from a jar-sized "serving".',
        expected: 'serving_outside_single_serving_window',
    },
    {
        barcode: '0850000628168',
        label: 'Naked Mass weight-gainer, 315 g scoop',
        panel: { kcal100: 390, servingGrams: 315, protein: 15.9, carbs: 78.7, fat: 1.27 },
        note:
            'A genuinely ~1,229 kcal SINGLE serving: the scoop really is 315 g and the powder ' +
            'really is 390 kcal/100g. Clears the dry band, Atwater and the serving window; the ' +
            'energy threshold is the only thing between this rule and deleting mass gainers.',
        expected: 'implied_serving_kcal_below_threshold',
    },
    {
        barcode: '0810056840174',
        label: 'Keto Brick, 141 g bar',
        panel: { kcal100: 709, servingGrams: 141, protein: 21.3, carbs: 8.51, fat: 65.2 },
        note:
            'The largest legitimate single-serve item measured in the corpus: 999.7 kcal in one ' +
            'bar, correct 709 kcal/100g density. It is the row the 1,500 threshold has to clear.',
        expected: 'implied_serving_kcal_below_threshold',
    },
    {
        barcode: '00524803',
        label: "Sainsbury's hickory smoked BBQ beef brisket, 1.2 kg family tray",
        panel: { kcal100: 188, servingGrams: 1200, protein: 25.6, carbs: 4.2, fat: 7.4 },
        note:
            'A family tray whose implied energy IS absurd (2,256 kcal) but whose panel is an ' +
            'ordinary wet food. The dry band rejects it before the energy test is even reached.',
        expected: 'macro_sum_outside_dry_band',
    },
    {
        barcode: '9310645215297',
        label: 'Coles "Triple Chicken" (servingGrams === calories)',
        panel: { kcal100: 543, servingGrams: 543, protein: 20.6, carbs: 61, fat: 23.3 },
        note:
            'Almost certainly a per-serving panel, but servingGrams carries the CALORIES value — ' +
            'a measured ingest artifact. The serving mass is unusable, so the 2,948 kcal it ' +
            'implies is evidence about that field, not about the panel. Refuse and leave it to ' +
            'human triage.',
        expected: 'serving_grams_mirrors_calories',
    },
    {
        barcode: '209752824208588986029219',
        label: "Wendy's Spicy Chicken Sandwich (validatedBy = human-triage)",
        panel: { kcal100: 513, servingGrams: 100, protein: 30, carbs: 51, fat: 21 },
        note:
            'The adjacent-band row a human already validated. Macro sum 102 (inside the dry ' +
            'band) and Atwater-exact, so it reaches the serving window and is refused there: ' +
            'at a 100 g serving the two readings of the panel are identical, which is why the ' +
            'window floor sits above it. Human-validated rows must never be auto-marked.',
        expected: 'serving_outside_single_serving_window',
    },
    {
        barcode: '0681603525666',
        label: 'Shrimp tacos (already marked panel-inflated:foodtype-sibling)',
        panel: { kcal100: 600, servingGrams: 475, protein: 28, carbs: 19, fat: 37 },
        note:
            'A known member of the broader per-serving-panel family that this rule does NOT ' +
            'reach: its macros sum to 84 g/100g, below the dry band. Pinned so the miss is a ' +
            'recorded property of the rule rather than a surprise. The sibling-median rule ' +
            'already caught it.',
        expected: 'macro_sum_outside_dry_band',
    },
];

function flagFor(panel: ServingScalePanel, overrides: Partial<CorruptScanFlag> = {}): CorruptScanFlag {
    return {
        barcode: '0000000000000',
        name: 'Test Food',
        brandName: null,
        kcal100: panel.kcal100,
        servingGrams: panel.servingGrams,
        tier: 'direct',
        direction: 'panel-inflated-serving',
        rescaled: Math.round((panel.kcal100 * 100) / panel.servingGrams),
        siblingMedian: 0,
        groupSize: 0,
        triageConfirmed: false,
        value: impliedServingKcal(panel),
        panel,
        check: { field: 'calories', value: panel.kcal100 },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------

describe('rejectPanelInflatedServing — measured members', () => {
    for (const m of MEMBERS) {
        it(`flags ${m.label} (off_${m.barcode})`, () => {
            expect(rejectPanelInflatedServing(m.panel)).toBeNull();
        });
    }

    it('every member is internally coherent — which is why no per-field rule sees them', () => {
        for (const m of MEMBERS) {
            const atwater = atwaterKcal(m.panel);
            expect(Math.abs(m.panel.kcal100 - atwater)).toBeLessThanOrEqual(0.1 * m.panel.kcal100);
        }
    });

    it('every member sits INSIDE the existing macro-sum slack, so macro-sum-impossible cannot claim it', () => {
        for (const m of MEMBERS) {
            const macroSum = m.panel.protein + m.panel.fat + m.panel.carbs;
            expect(macroSum).toBeLessThanOrEqual(MAX_MACRO_SUM_100G);
            expect(macroSum).toBeGreaterThanOrEqual(MIN_DRY_MACRO_SUM_100G);
        }
    });

    it('every member bills an absurd single serving if the per-100g field is believed', () => {
        for (const m of MEMBERS) {
            expect(impliedServingKcal(m.panel)).toBeGreaterThan(MIN_IMPLIED_SERVING_KCAL);
        }
    });
});

describe('rejectPanelInflatedServing — negative controls', () => {
    for (const c of CONTROLS) {
        it(`refuses ${c.label} with ${c.expected}`, () => {
            expect(rejectPanelInflatedServing(c.panel)).toBe(c.expected);
        });
    }

    it('the large-legitimate-serving controls are non-vacuous — each clears every earlier condition', () => {
        // Oil, coconut oil and the gainer all reach the condition that rejects
        // them. If a future edit reordered or broke an earlier condition these
        // would start failing at the wrong gate, and this assertion is what
        // notices. (The brisket and shrimp-taco controls stop at the dry band by
        // design, and the Wendy's row is asserted separately below.)
        const oil = CONTROLS.find(c => c.barcode === '8413080019282')!.panel;
        const gainer = CONTROLS.find(c => c.barcode === '0850000628168')!.panel;
        for (const p of [oil, gainer]) {
            const macroSum = p.protein + p.fat + p.carbs;
            expect(macroSum).toBeGreaterThanOrEqual(MIN_DRY_MACRO_SUM_100G);
            expect(macroSum).toBeLessThanOrEqual(MAX_MACRO_SUM_100G);
            expect(Math.abs(p.kcal100 - atwaterKcal(p))).toBeLessThanOrEqual(0.1 * p.kcal100);
        }
        // Oil is stopped only by the window; the gainer only by the threshold.
        expect(oil.servingGrams).toBeGreaterThan(SERVING_WINDOW_MAX_G);
        expect(impliedServingKcal(oil)).toBeGreaterThan(MIN_IMPLIED_SERVING_KCAL);
        expect(gainer.servingGrams).toBeGreaterThan(SERVING_WINDOW_MIN_G);
        expect(gainer.servingGrams).toBeLessThanOrEqual(SERVING_WINDOW_MAX_G);
        expect(impliedServingKcal(gainer)).toBeLessThanOrEqual(MIN_IMPLIED_SERVING_KCAL);
    });

    it("the human-triage Wendy's row is Atwater-exact and inside the dry band, and still refused", () => {
        const wendys = CONTROLS.find(c => c.barcode === '209752824208588986029219')!.panel;
        expect(atwaterKcal(wendys)).toBe(wendys.kcal100);
        expect(wendys.protein + wendys.fat + wendys.carbs).toBeGreaterThanOrEqual(MIN_DRY_MACRO_SUM_100G);
        expect(rejectPanelInflatedServing(wendys)).toBe('serving_outside_single_serving_window');
        expect(decideMark(flagFor(wendys)).mark).toBe(false);
    });

    it('refuses a missing or unusable panel instead of assuming', () => {
        expect(rejectPanelInflatedServing(undefined)).toBe('serving_scale_panel_missing');
        expect(rejectPanelInflatedServing(null)).toBe('serving_scale_panel_missing');
        expect(rejectPanelInflatedServing({ kcal100: 0, servingGrams: 400, protein: 30, carbs: 40, fat: 30 }))
            .toBe('serving_scale_panel_missing');
        expect(rejectPanelInflatedServing({ kcal100: 560, servingGrams: 0, protein: 30, carbs: 40, fat: 30 }))
            .toBe('serving_scale_panel_missing');
        expect(rejectPanelInflatedServing({ kcal100: 560, servingGrams: 357, protein: NaN, carbs: 46, fat: 29 }))
            .toBe('serving_scale_panel_missing');
    });
});

describe('rejectPanelInflatedServing — boundaries', () => {
    /** Pork chili Mac, with one dimension moved to the edge under test. */
    const at = (o: Partial<ServingScalePanel>): ServingScalePanel =>
        ({ kcal100: 560, servingGrams: 357, protein: 29, carbs: 46, fat: 29, ...o });

    it('accepts a macro sum at exactly MAX_MACRO_SUM_100G and rejects just above it', () => {
        // 105 stays a member: above it the row belongs to macro-sum-impossible.
        expect(rejectPanelInflatedServing(at({ protein: 30, carbs: 46, fat: 29 }))).toBeNull();
        expect(rejectPanelInflatedServing(at({ protein: 31, carbs: 46, fat: 29 })))
            .toBe('macro_sum_outside_dry_band');
    });

    it('rejects a macro sum just under the dry-band floor', () => {
        // 94.9 g/100g: a food with >5% water is not a plausible per-100g panel
        // for this class, and the wet-food population is far too large to touch.
        expect(rejectPanelInflatedServing(at({ protein: 24, carbs: 42, fat: 28.9 })))
            .toBe('macro_sum_outside_dry_band');
    });

    it('rejects an incoherent panel — one bad field is a different class', () => {
        expect(rejectPanelInflatedServing(at({ kcal100: 900 }))).toBe('panel_not_atwater_consistent');
    });

    it('rejects at the serving-window edges and accepts strictly inside', () => {
        expect(rejectPanelInflatedServing(at({ servingGrams: SERVING_WINDOW_MIN_G })))
            .toBe('serving_outside_single_serving_window');
        expect(rejectPanelInflatedServing(at({ servingGrams: SERVING_WINDOW_MAX_G + 0.1 })))
            .toBe('serving_outside_single_serving_window');
        expect(rejectPanelInflatedServing(at({ servingGrams: SERVING_WINDOW_MAX_G }))).toBeNull();
    });

    it('rejects at exactly MIN_IMPLIED_SERVING_KCAL and accepts strictly above', () => {
        const grams = (MIN_IMPLIED_SERVING_KCAL * 100) / 560;
        expect(impliedServingKcal(at({ servingGrams: grams }))).toBeCloseTo(MIN_IMPLIED_SERVING_KCAL, 6);
        expect(rejectPanelInflatedServing(at({ servingGrams: grams })))
            .toBe('implied_serving_kcal_below_threshold');
        expect(rejectPanelInflatedServing(at({ servingGrams: grams + 1 }))).toBeNull();
    });
});

describe('decideMark — panel-inflated-serving', () => {
    it('marks a measured member with the family reason string', () => {
        const d = decideMark(flagFor(MEMBERS[0].panel));
        expect(d).toEqual({ mark: true, reason: 'panel-inflated-serving:direct' });
    });

    it('re-runs the WHOLE rule from the raw panel, so an inflated `value` cannot mark a clean row', () => {
        // The self-verification guard every other direction has: a hand-edited or
        // stale scan file must not be able to mark a row the rule would refuse
        // today. Here the panel is the Keto Brick (999.7 kcal, legitimate) while
        // `value` claims 9,999 — decideMark must believe the measurements.
        const brick = CONTROLS.find(c => c.barcode === '0810056840174')!.panel;
        const d = decideMark(flagFor(brick, { value: 9999 }));
        expect(d).toEqual({ mark: false, skip: 'implied_serving_kcal_below_threshold' });
    });

    it('refuses every negative control, naming the condition that refused it', () => {
        for (const c of CONTROLS) {
            expect(decideMark(flagFor(c.panel))).toEqual({ mark: false, skip: c.expected });
        }
    });

    it('refuses a flag that carries no panel at all', () => {
        const d = decideMark(flagFor(MEMBERS[0].panel, { panel: undefined, value: 99999 }));
        expect(d).toEqual({ mark: false, skip: 'serving_scale_panel_missing' });
    });

    it('does not borrow the sibling trust floors — the rule is sibling-free', () => {
        // groupSize 0 / siblingMedian 0 is the normal shape for this direction
        // (name-space singletons). If it ever started sharing panel-inflated's
        // MIN_INFLATED_GROUP_SIZE floor, nothing would ever mark.
        const d = decideMark(flagFor(MEMBERS[0].panel, { groupSize: 0, siblingMedian: 0 }));
        expect(d.mark).toBe(true);
    });
});

describe('the existing classes are untouched', () => {
    it('keeps MAX_MACRO_SUM_100G at 105 — the deliberate label-rounding slack', () => {
        expect(MAX_MACRO_SUM_100G).toBe(105);
    });

    it('leaves macro-sum-impossible deciding purely on its own value', () => {
        const base = {
            barcode: '0000000000000', name: 'x', brandName: null, kcal100: 500,
            servingGrams: 400, tier: 'direct' as const, rescaled: 0,
            siblingMedian: 0, groupSize: 0, triageConfirmed: false,
        };
        expect(decideMark({ ...base, direction: 'macro-sum-impossible', value: 106 }))
            .toEqual({ mark: true, reason: 'macro-sum-impossible:direct' });
        expect(decideMark({ ...base, direction: 'macro-sum-impossible', value: 105 }))
            .toEqual({ mark: false, skip: 'value_below_threshold' });
        // A panel that would satisfy the NEW rule must not change that verdict.
        expect(decideMark({
            ...base, direction: 'macro-sum-impossible', value: 105,
            panel: MEMBERS[0].panel,
        })).toEqual({ mark: false, skip: 'value_below_threshold' });
    });

    it('leaves the sibling-based panel directions on their group-size and median floors', () => {
        const base = {
            barcode: '0000000000000', name: 'x', brandName: null, kcal100: 900,
            servingGrams: 30, tier: 'direct' as const, rescaled: 270,
            siblingMedian: 265, groupSize: 8, triageConfirmed: false,
        };
        expect(decideMark({ ...base, direction: 'panel-inflated' }))
            .toEqual({ mark: true, reason: 'panel-inflated:direct' });
        expect(decideMark({ ...base, direction: 'panel-inflated', groupSize: 7 }))
            .toEqual({ mark: false, skip: 'inflated_group_too_small' });
        expect(decideMark({ ...base, direction: 'panel-low', kcal100: 160, siblingMedian: 540 }))
            .toEqual({ mark: true, reason: 'panel-low:direct' });
    });

    it('gives the new class its own reason string, distinct from panel-inflated', () => {
        const neu = decideMark(flagFor(MEMBERS[0].panel));
        expect(neu).toEqual({ mark: true, reason: 'panel-inflated-serving:direct' });
        // Same family prefix on purpose (mark-corrupt-off.ts --clear-prefix
        // "panel-inflated" clears both generations), but distinguishable:
        // "panel-inflated:" selects only the sibling-median generation.
        expect('panel-inflated-serving:direct'.startsWith('panel-inflated')).toBe(true);
        expect('panel-inflated-serving:direct'.startsWith('panel-inflated:')).toBe(false);
    });
});

/**
 * correctness-screen.test.ts — Tier D, pinned against the batch-01 ground truth.
 *
 * NO NETWORK, NO DATABASE, NO API KEY. Tier D is a pure function of (row, policy),
 * and this file proves it: `fetch` is spied on and asserted never called, nothing
 * imports normalization-rules (which constructs a PrismaClient at module load), and
 * the fixture carries its own attributed seeds so no canonicalizer is needed.
 *
 * WHY THE MATRIX IS PINNED TO EXACT NUMBERS
 * The screen exists because batch 01 passed every structural gate with 27.2% of its
 * new rows wrong. Its own load-bearing claim is RECALL — 19 of 23 BAD rows flagged
 * by Tier D alone, and 15 of those by D3 on its own. A refactor that quietly breaks
 * the stemmer, the brand split or the head-noun rule would still produce a screen
 * that runs, prints a summary and evicts *something*; only an exact matrix notices.
 *
 * IF THESE NUMBERS MOVE: report the real numbers. An honest lower recall is a
 * finding. Editing the fixture's labels, or special-casing a rule until the old
 * number comes back, converts this test into decoration — which is the exact
 * failure mode (a green gate that cannot see its own worst outcome) that the
 * eval-harness-blindness work already had to fix once.
 *
 * WHAT THIS TEST CANNOT SEE
 *   - Tier L. It costs money and is not deterministic enough to pin (four runs at
 *     temperature 0 agreed exactly on BAD and GOOD and disagreed by one SUSPECT
 *     row). The shipped operating point is Tier D + Tier L; this file defends only
 *     the deterministic half, which is 78% of the measured recall.
 *   - D9 in the wild: it fired ZERO times across all 81 rows, so its only coverage
 *     anywhere is the synthetic case below.
 *
 * CLOSED 2026-07-27 — "whether a flagged row actually bills wrong" used to sit in
 * the list above, because D5/D6 read a reconstruction rather than
 * hydrateAndSelectServing. They now read the real anchor, and the fixture carries
 * it (`row.real`), so this file is still offline and deterministic while pinning
 * the number the USER IS BILLED. Measured agreement between the two on these 81
 * rows: 78/81 = 96.3%. The remaining gap is why D5/D6 abstain to INFO rather than
 * evict whenever the real anchor did not run.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    D1_FALSE_EVICT_RATE_REAL_CACHE,
    D8_FATSECRET_FALSE_FIRE_RATE_REAL_CACHE,
    FITTED_GOOD_FP_RATE,
    FlagError,
    HELD_OUT_GOOD_FP_RATE,
    MEASURED_BAD_RECALL_TIER_D_ONLY,
    MEASURED_BAD_RECALL_WITH_LLM,
    MEASURED_BAD_RECALL_WITH_LLM_MINI,
    POLICIES,
    ROW_SQL,
    TIER_D_RULE_IDS,
    attribute,
    atwater,
    confusionOf,
    contentStems,
    decide,
    llmUserPrompt,
    parseIntFlag,
    parsePolicy,
    parseSeedFile,
    per100gPanelBasis,
    realServing,
    resolveServingGrams,
    screenBatch,
    servingLevelKcal,
    stem,
    tierD,
    toks,
    type Hit,
    type Label,
    type LlmVerdict,
    type Policy,
    type RuleId,
    type ScreenRow,
} from '../correctness-screen';
// The REAL reader the FatSecret macro-only branch bills through — imported into
// the tests so the parity suite feeds the production call site and the screen
// call site identical fixtures (review item 1, playbook §11 class A).
import { servingMacros } from '../../../src/lib/mapping/fs-serving-macros';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface LabelledRow {
    verdict: Label;
    axes: string[];
    correctRecordExists: boolean | null;
    correctRecordId: string | null;
    labelReason: string;
    row: ScreenRow;
}

const FIXTURE = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'correctness-screen-batch01.json'), 'utf8'),
) as { rows: LabelledRow[] };

const BATCH01: ScreenRow[] = FIXTURE.rows.map(r => r.row);
const LABELS = new Map<string, Label>(FIXTURE.rows.map(r => [r.row.key, r.verdict]));

/** Keys a given rule id fires on, over the whole batch, at a given policy. */
function firedBy(rule: RuleId, policy: Policy = 'balanced'): Set<string> {
    return new Set(BATCH01.filter(r => tierD(r, policy).some(h => h.rule === rule)).map(r => r.key));
}

// ---------------------------------------------------------------------------
// Synthetic rows for the per-rule tests
// ---------------------------------------------------------------------------

/** A GOOD-shaped row: real panel, real serving, brand present, head noun present. */
function baseRow(over: Partial<ScreenRow> = {}): ScreenRow {
    return {
        key: 'almond great value',
        src: 'openfoodfacts',
        conf: 0.9,
        validatedby: 'ai',
        mapfoodname: 'Great value, almonds',
        mapbrand: 'Great Value',
        recname: 'Great value, almonds, smoke',
        recbrand: 'Great Value',
        per100g: { calories: 600, protein: 21, carbs: 20, fat: 53 },
        off_serving_grams: 28,
        off_serving_size: '28 g',
        pkg_qty: null,
        pkg_unit: '',
        corruptreason: '',
        dupof: '',
        fs_serving_desc: '',
        fs_serving_grams: null,
        fs_serving_nutrients: null,
        recid: '0000000000001',
        n_off_servings: 1,
        off_serv_min_g: null,
        off_serv_max_g: null,
        seed: 'great value almonds',
        ...over,
    };
}

const rules = (hits: Hit[]): RuleId[] => hits.map(h => h.rule);

// ---------------------------------------------------------------------------
// 1. The fixture itself
// ---------------------------------------------------------------------------

describe('batch-01 ground truth fixture', () => {
    it('is the 81 audited rows, 23 BAD / 10 SUSPECT / 48 GOOD', () => {
        expect(BATCH01).toHaveLength(81);
        const counts = { BAD: 0, SUSPECT: 0, GOOD: 0 };
        for (const v of LABELS.values()) counts[v]++;
        expect(counts).toEqual({ BAD: 23, SUSPECT: 10, GOOD: 48 });
    });

    it('carries an attributed seed for every row (0 unattributed on this batch)', () => {
        expect(BATCH01.filter(r => !r.seed)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// 2. The pinned Tier-D confusion matrix
// ---------------------------------------------------------------------------

describe('Tier D over batch 01 — pinned confusion matrix', () => {
    it('does not touch the network', async () => {
        const spy = jest.spyOn(globalThis, 'fetch');
        for (const r of BATCH01) tierD(r, 'balanced');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('is deterministic — the same rows screened twice give byte-identical hits', () => {
        const once = BATCH01.map(r => tierD(r, 'balanced'));
        const twice = BATCH01.map(r => tierD(r, 'balanced'));
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    });

    /**
     * Per-rule, standalone. `fires` is the total number of rows the rule flags;
     * BAD/GOOD/SUSPECT are how those rows were graded by the human audit.
     *
     * The shape of this table is the argument for the whole tier: D3 is 15 of the 19
     * BAD catches at ZERO cost in GOOD rows, D5 is a SUSPECT detector rather than a
     * BAD detector (which is why `balanced` sends it to REVIEW), and D9 fires on
     * nothing at all.
     *
     * UPDATED 2026-07-27 — D5/D6 now read the REAL billing anchor
     * (hydrateAndSelectServing) instead of the column reconstruction, and the fixture
     * carries it. Measured effect on these same 81 rows: reconstruction and real
     * anchor agree on 78/81 (96.3%), and the 3 that differ move D5 STRICTLY in the
     * right direction — it gains the BAD row `bar emerge protein simple truth`
     * (billing flat-100g, which the 55 g column hid) and drops two SUSPECT rows that
     * do resolve a real serving via `fs_serving_macros_only`. BAD recall is unchanged
     * at every policy; the screen simply withholds one fewer row.
     */
    const PER_RULE: { rule: RuleId; fires: number; bad: number; good: number; suspect: number; note: string }[] = [
        { rule: 'D1', fires: 1, bad: 1, good: 0, suspect: 0, note: 'bare-brand key: `joe trader`' },
        { rule: 'D2', fires: 1, bad: 0, good: 0, suspect: 1, note: 'generic-key takeover (millville lost)' },
        { rule: 'D3', fires: 16, bad: 15, good: 0, suspect: 1, note: 'THE WORKHORSE — head noun absent' },
        { rule: 'D4', fires: 3, bad: 3, good: 0, suspect: 0, note: 'a subset of D3 in practice' },
        { rule: 'D5', fires: 7, bad: 2, good: 0, suspect: 5, note: 'a SUSPECT detector, not a BAD detector' },
        { rule: 'D6', fires: 3, bad: 3, good: 0, suspect: 0, note: '1.0 g chili oil, 1.9 g muffin, 1106 g banana' },
        { rule: 'D7', fires: 2, bad: 1, good: 0, suspect: 1, note: 'Atwater: inconsistency, not wrongness' },
        { rule: 'D8', fires: 1, bad: 0, good: 0, suspect: 1, note: 'the one fire (`publix sandwich sub`) is a FatSecret serving-nutrition row — INFO since 2026-07-27' },
        { rule: 'D9', fires: 0, bad: 0, good: 0, suspect: 0, note: 'UNEXERCISED — corruptReason never set here' },
        { rule: 'D10', fires: 1, bad: 0, good: 0, suspect: 1, note: 'blank brand fields are common and benign' },
        { rule: 'D11', fires: 2, bad: 0, good: 2, suspect: 0, note: 'INFO only — it flags GOOD rows and must never gate' },
    ];

    it.each(PER_RULE)('$rule fires on $fires row(s): $bad BAD / $good GOOD / $suspect SUSPECT — $note',
        ({ rule, fires, bad, good, suspect }) => {
            const flagged = firedBy(rule);
            const c = confusionOf(flagged, LABELS);
            expect({ fires: flagged.size, bad: c.badCaught, good: c.goodFlagged, suspect: c.susFlagged })
                .toEqual({ fires, bad, good, suspect });
        });

    it('covers every rule id in the per-rule table', () => {
        expect(PER_RULE.map(p => p.rule)).toEqual(TIER_D_RULE_IDS);
    });

    it('D9 fired ZERO times on all 81 rows — unexercised, not validated', () => {
        // Kept as its own assertion rather than a row in the table above so it reads
        // as the finding it is: the corpus's own corruption detector (PR #119, 8
        // classes, 23,916 rows marked) misses all three records this batch's audit
        // proved corrupt. Budget no recall to D9.
        expect(firedBy('D9').size).toBe(0);
    });

    it('any flagging rule (D11 excluded, it is INFO) catches 19/23 BAD and 0/48 GOOD', () => {
        const flagged = new Set(
            BATCH01.filter(r => tierD(r, 'balanced').some(h => h.severity !== 'INFO')).map(r => r.key),
        );
        const c = confusionOf(flagged, LABELS);
        expect({ flagged: flagged.size, bad: c.badCaught, good: c.goodFlagged, suspect: c.susFlagged })
            .toEqual({ flagged: 26, bad: 19, good: 0, suspect: 7 });
        expect(c.recall).toBeCloseTo(19 / 23, 10);
    });

    /**
     * Whole-tier decisions per policy. `balanced` is the shipped operating point's
     * deterministic half; `strict` buys TWO extra BAD rows over it and withholds
     * eight more; `lenient` is not a screen — it now evicts ZERO rows on the whole
     * fixture, which is the honest picture of what the two purely-structural rules
     * (D8/D9) can do alone.
     *
     * MOVED 2026-07-27 (D8 serving-nutrition abstention): lenient was evict 1 /
     * review 25. Batch 01's only D8 fire — `publix sandwich sub`, a SUSPECT row —
     * is itself a FatSecret serving-nutrition row (bills a real 350 kcal through
     * `fs_serving_macros_only`), i.e. exactly the shape whose false-fire rate on
     * the real cache measured 34/35. D8 now reports INFO on it, and the row lands
     * in REVIEW via D3 instead of being evicted, so it never leaves the screen's
     * sight. `balanced` and `strict` are byte-identical to the pre-fix pins: the
     * row was already an EVICT there on D3's authority, not D8's.
     */
    const PER_POLICY: { policy: Policy; evict: number; evictBad: number; review: number; reviewBad: number; keep: number }[] = [
        { policy: 'lenient', evict: 0, evictBad: 0, review: 26, reviewBad: 19, keep: 55 },
        { policy: 'balanced', evict: 16, evictBad: 15, review: 10, reviewBad: 4, keep: 55 },
        { policy: 'strict', evict: 19, evictBad: 16, review: 7, reviewBad: 3, keep: 55 },
    ];

    it.each(PER_POLICY)('policy $policy: EVICT $evict ($evictBad BAD) · REVIEW $review · KEEP $keep, and 0 GOOD ever evicted',
        ({ policy, evict, evictBad, review, reviewBad, keep }) => {
            const verdicts = screenBatch(BATCH01, policy);
            const ev = new Set(verdicts.filter(v => v.decision === 'EVICT').map(v => v.key));
            const rv = new Set(verdicts.filter(v => v.decision === 'REVIEW').map(v => v.key));
            const ce = confusionOf(ev, LABELS);
            const cr = confusionOf(rv, LABELS);
            expect({
                evict: ev.size, evictBad: ce.badCaught, review: rv.size, reviewBad: cr.badCaught,
                keep: verdicts.filter(v => v.decision === 'KEEP').length,
            }).toEqual({ evict, evictBad, review, reviewBad, keep });
            // 0/48 GOOD evicted is a real Tier-D measurement (it is the Tier-L half of
            // the combined screen whose 0% is fitted — see the honesty block below).
            expect(ce.goodFlagged).toBe(0);
        });

    it('the 4 BAD rows Tier D misses are the sparkling-water / cheddar / elote-dip shapes Tier L exists for', () => {
        const flagged = new Set(
            BATCH01.filter(r => tierD(r, 'balanced').some(h => h.severity !== 'INFO')).map(r => r.key),
        );
        const missed = [...LABELS].filter(([k, v]) => v === 'BAD' && !flagged.has(k)).map(([k]) => k).sort();
        // Each shares its head noun with the record it was wrongly mapped to
        // ('sparkling water' -> 'Water Crackers'), so NO token rule can separate them.
        // That is the structural reason Tier D cannot reach 100% on its own.
        expect(missed).toEqual([
            'and gather good sparkling water',
            'cheddar joe trader unexpected',
            'dip elote joe trader',
            'select signature sparkling water',
        ]);
    });
});

// ---------------------------------------------------------------------------
// 3. The honesty constants
// ---------------------------------------------------------------------------

describe('reported accuracy', () => {
    it('quotes the HELD-OUT false-positive rate (6/48 = 12.5%), not the fitted 0%', () => {
        // The shipped Tier-L rubric scores 0/48 GOOD flagged on batch 01, but its
        // variant-class taxonomy was written after reading the errors the clean
        // held-out rubric (v3, no batch-01 content) made on those same rows. 12.5% is
        // what a new batch should be planned against. Do not "simplify" this constant
        // to the measured 0 — that would restate a fitted number as an expectation.
        expect(HELD_OUT_GOOD_FP_RATE).toBeCloseTo(0.125, 10);
        expect(FITTED_GOOD_FP_RATE).toBe(0);
        expect(HELD_OUT_GOOD_FP_RATE).toBeGreaterThan(FITTED_GOOD_FP_RATE);
    });

    it('records that recall — unlike precision — is NOT fitted', () => {
        // Recall held at 23/23 under all four rubric variants tried, including the one
        // with no batch-01 content of any kind — the rubric is not the fragile part.
        // The shipped figure is 22/23 because D1/D6 were retired as evictors, not
        // because the rubric moved: the lost row is `joe trader`, which Tier L ACCEPTs.
        expect(MEASURED_BAD_RECALL_WITH_LLM).toBeCloseTo(22 / 23, 10);
        expect(MEASURED_BAD_RECALL_WITH_LLM_MINI).toBeCloseTo(21 / 23, 10);
        expect(MEASURED_BAD_RECALL_TIER_D_ONLY).toBeCloseTo(15 / 23, 10);
        // The screen's own recall must never be quoted above what the weaker of its
        // two measured Tier-L models delivers without saying which model.
        expect(MEASURED_BAD_RECALL_WITH_LLM).toBeGreaterThan(MEASURED_BAD_RECALL_WITH_LLM_MINI);
    });

    it('pins D8\'s real-cache FatSecret false-fire rate — the number that forced the abstention', () => {
        // 48 D8 fires on the real 3,248-row cache = 35 fatsecret + 13 id-less
        // mappings + 0 fdc; 34 of the 35 FatSecret rows billed fine through
        // FatSecretServing.nutrients. D8 was an evictor under EVERY policy at the
        // time, certified by a "0.0% false-evict" measured over a subset that never
        // contained these rows. A future "promote D8 back to firing on panel-less
        // FatSecret rows" has to argue with this number, not with a fixture —
        // batch 01's one D8 fire cannot see the class (playbook §11 class C).
        expect(D8_FATSECRET_FALSE_FIRE_RATE_REAL_CACHE).toBeCloseTo(34 / 35, 10);
        expect(D8_FATSECRET_FALSE_FIRE_RATE_REAL_CACHE).toBeGreaterThan(0.9);
    });
});

// ---------------------------------------------------------------------------
// 4. Per-rule unit tests — one positive and one negative case each
// ---------------------------------------------------------------------------

describe('D1 — bare-brand key', () => {
    it('fires when the key is nothing but the brand', () => {
        const r = baseRow({ seed: 'trader joes', key: 'joe trader', recname: 'Peppermint Joe Joes' });
        expect(rules(tierD(r, 'balanced'))).toContain('D1');
    });
    it('does not fire when the key keeps a content token', () => {
        const r = baseRow({ seed: 'trader joes hummus', key: 'hummus joe trader', recname: 'Trader Joes Hummus' });
        expect(rules(tierD(r, 'balanced'))).not.toContain('D1');
    });
});

describe('D2 — the key dropped the seed brand entirely (generic-key takeover)', () => {
    it('fires when a branded seed produced an unbranded key', () => {
        const r = baseRow({ seed: 'chobani greek yogurt', key: 'greek yogurt', recname: 'Chobani Greek Yogurt', recbrand: 'Chobani' });
        expect(rules(tierD(r, 'balanced'))).toContain('D2');
    });
    it('does not fire when the key still carries the brand', () => {
        const r = baseRow({ seed: 'chobani greek yogurt', key: 'chobani greek yogurt', recname: 'Chobani Greek Yogurt', recbrand: 'Chobani' });
        expect(rules(tierD(r, 'balanced'))).not.toContain('D2');
    });
});

describe('D3 — seed head noun absent from the record', () => {
    it('fires on turkey bacon -> Turkey Breast (head noun `bacon` is gone)', () => {
        const r = baseRow({
            seed: 'kirkland signature turkey bacon', key: 'bacon kirkland signature turkey',
            recname: 'Kirkland Signature Turkey Breast', recbrand: 'Kirkland Signature',
            mapfoodname: 'Kirkland Signature Turkey Breast',
        });
        expect(rules(tierD(r, 'balanced'))).toContain('D3');
    });
    it('tolerates a qualifier the record adds — almonds -> almonds, smoke stays', () => {
        // The stricter "seed head must EQUAL the record head" variant was tried and
        // rejected precisely because it fires here.
        expect(rules(tierD(baseRow(), 'balanced'))).not.toContain('D3');
    });
});

describe('D4 — zero seed/record content-token overlap', () => {
    it('fires on gone bananas -> Boneless Skinless Chicken Breast', () => {
        const r = baseRow({
            seed: 'trader joes gone bananas', key: 'banana gone joe trader',
            recname: 'Boneless Skinless Chicken Breast', recbrand: 'Trader Joes',
            mapfoodname: 'Boneless Skinless Chicken Breast',
        });
        expect(rules(tierD(r, 'balanced'))).toContain('D4');
    });
    it('does not fire when any content token survives', () => {
        expect(rules(tierD(baseRow(), 'balanced'))).not.toContain('D4');
    });
});

describe('D5 — no serving weight anywhere', () => {
    const noCols = { off_serving_grams: null, fs_serving_grams: null, off_serv_min_g: null };

    it('fires when the REAL anchor resolves no serving', () => {
        const r = baseRow({ ...noCols, real: { grams: null, tier: null, kcal: null } });
        expect(rules(tierD(r, 'balanced'))).toContain('D5');
        // ...and under `balanced` it is a REVIEW, not an EVICT: 5 of its 7 fires on
        // batch 01 were SUSPECT rows.
        expect(tierD(r, 'balanced').find(h => h.rule === 'D5')?.severity).toBe('REVIEW');
    });

    it('fires on flat_100g_default — 100 g there is the ABSENCE of an anchor', () => {
        // The real function reports the flat-100g fallback as `100 g`, which sits
        // squarely inside D6's plausible band. Reading it literally silenced D5 on 6
        // batch-01 rows (one of them BAD) the first time this was wired up.
        const r = baseRow({ ...noCols, real: { grams: 100, tier: 'flat_100g_default', kcal: 250 } });
        expect(rules(tierD(r, 'balanced'))).toContain('D5');
        expect(rules(tierD(r, 'balanced'))).not.toContain('D6');
    });

    it('does NOT fire when the real anchor found a serving the columns could not', () => {
        // `cashew kirkland signature`: no gram column anywhere, but the FatSecret
        // macros-only path resolves 56.7 g. The reconstruction called this D5; the
        // real anchor clears it.
        const r = baseRow({ ...noCols, real: { grams: 56.7, tier: 'fs_serving_macros_only', kcal: 320 } });
        expect(rules(tierD(r, 'balanced'))).not.toContain('D5');
    });

    it('ABSTAINS to INFO when the real anchor never ran — an unmeasured reconstruction may not evict', () => {
        // `real: undefined` is an offline --rows replay or --no-serving. D5/D6 must
        // report, never gate: the reconstruction's agreement with the real anchor is
        // 96.3%, not 100%, so on its own authority it may not throw a row away.
        const r = baseRow(noCols);
        const h = tierD(r, 'balanced').find(x => x.rule === 'D5');
        expect(h?.severity).toBe('INFO');
        expect(h?.detail).toContain('UNJUDGED');
    });

    it('D6 also abstains without the real anchor, at a weight that would otherwise EVICT', () => {
        const h = tierD(baseRow({ off_serving_grams: 1.0 }), 'balanced').find(x => x.rule === 'D6');
        expect(h?.severity).toBe('INFO');
    });

    it('does not fire when any column anchors a weight', () => {
        const r = baseRow({ off_serving_grams: null, fs_serving_grams: 44, off_serv_min_g: null });
        expect(rules(tierD(r, 'balanced'))).not.toContain('D5');
        expect(resolveServingGrams(r)).toEqual({ grams: 44, from: 'FatSecretServing.grams' });
    });
});

describe('D6 — implausible serving weight', () => {
    it.each([
        ['1.0 g of chili crunch', 1.0],
        ['1106 g of banana', 1106],
    ])('fires on %s', (_label, grams) => {
        expect(rules(tierD(baseRow({ off_serving_grams: grams }), 'balanced'))).toContain('D6');
    });
    it('does not fire on a 28 g serving', () => {
        expect(rules(tierD(baseRow(), 'balanced'))).not.toContain('D6');
    });
});

describe('D7 — Atwater inconsistency', () => {
    it('fires when declared kcal cannot be made from the macros', () => {
        const r = baseRow({ per100g: { calories: 500, protein: 5, carbs: 5, fat: 1 } });
        expect(rules(tierD(r, 'balanced'))).toContain('D7');
        expect(atwater(r.per100g)!.ratio).toBeGreaterThan(1.15);
    });
    it('does not fire on an internally consistent panel — which is NOT the same as a correct one', () => {
        // All three records this batch's audit PROVED corrupt are Atwater-consistent.
        // D7 detects arithmetic, not wrongness.
        expect(rules(tierD(baseRow(), 'balanced'))).not.toContain('D7');
    });
});

describe('D8 — no usable billing basis anywhere', () => {
    /**
     * The 2026-07-27 fix, pinned against rows copied VERBATIM from the whole-cache
     * capture. D8's old premise — "an empty/zero per-100g panel has nothing to
     * scale from" — is false for the FatSecret lane: serving macros live in
     * FatSecretServing.nutrients and the row bills through the macro-only branch.
     * 34 of the 35 FatSecret rows D8 fired on across the real 3,248-row cache
     * billed fine, and D8 was an EVICTOR UNDER EVERY POLICY at the time, on the
     * strength of a "0.0% false-evict" measured over a rules-flagged subset that
     * never contained these rows.
     */
    const D8FIX = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'fixtures', 'd8-fatsecret-serving-rows.json'), 'utf8'),
    ) as { pinnedFalsePositives: ScreenRow[]; the35thRow: ScreenRow; truePositive: ScreenRow };

    it.each([
        ['an empty {} panel', {} as Record<string, number>],
        ['a 0 kcal panel', { calories: 0, protein: 0, carbs: 0, fat: 0 }],
    ])('still fires on %s when NO serving-level nutrition exists', (_label, per100g) => {
        // baseRow has fs_serving_nutrients: null — the true-positive shape.
        const hits = tierD(baseRow({ per100g }), 'balanced');
        expect(rules(hits)).toContain('D8');
        expect(hits.find(h => h.rule === 'D8')?.severity).toBe('EVICT');
    });

    it('does not fire on a real panel', () => {
        expect(rules(tierD(baseRow(), 'balanced'))).not.toContain('D8');
    });

    it.each(
        ['and company noodle pad thai', 'beef italian portillo sandwich', 'bowl cava falafel', 'bowl cava lamb meatball spicy', 'propel water']
            .map(k => [k] as [string]),
    )('regression: must not evict `%s` under ANY policy — it bills fine via serving macros', (key) => {
        const row = D8FIX.pinnedFalsePositives.find(r => r.key === key)!;
        expect(row).toBeDefined();
        for (const policy of ['lenient', 'balanced', 'strict'] as Policy[]) {
            const hit = tierD(row, policy).find(h => h.rule === 'D8');
            // D8 still SEES the row (the panel really is empty/zero — that is the
            // lane's shape and worth reporting) but may only say INFO, never gate.
            expect([key, policy, hit?.severity]).toEqual([key, policy, 'INFO']);
            expect(hit?.detail).toContain('ABSTAIN');
            // Under lenient only D8/D9 evict, so the decision doubles as a direct
            // assertion that no OTHER rule evicts these five either: the 320-key
            // evict list must be re-cut to 315 (handoff §2a).
            if (policy === 'lenient') {
                expect([key, screenBatch([row], policy)[0].decision]).not.toEqual([key, 'EVICT']);
            }
        }
    });

    it('propel water: per-100g 0 kcal AND serving 0 kcal is a GENUINE zero, not an absence', () => {
        const propel = D8FIX.pinnedFalsePositives.find(r => r.key === 'propel water')!;
        // The kcal<=0 arm is what fired here. Zero calories with serving nutrients
        // present and readable is a VALUE — a fitness water has no calories.
        expect(Number(propel.per100g?.calories)).toBe(0);
        expect(servingLevelKcal(propel)).toBe(0);
        expect(tierD(propel, 'lenient').find(h => h.rule === 'D8')?.severity).toBe('INFO');
    });

    it('fails CLOSED when serving nutrients exist but carry no readable kcal', () => {
        // An empty {} nutrients object, or one without a finite calories/kcal field,
        // is NOT a billing basis. Absence of the evidence keeps D8 firing — the
        // abstention needs the number, not the column.
        for (const nutrients of [{}, { sodium: 230 }, { calories: NaN } as unknown as Record<string, number>]) {
            const r = baseRow({ per100g: {}, fs_serving_nutrients: nutrients });
            expect(servingLevelKcal(r)).toBeNull();
            expect(tierD(r, 'balanced').find(h => h.rule === 'D8')?.severity).toBe('EVICT');
        }
    });

    it('true positive, real capture shape: an id-less mapping still fires D8 under every policy', () => {
        // `bay` -> "Bay Scallops": offBarcode/fsId/fdcId ALL NULL, so nothing joined
        // — no record, no panel, no serving nutrition. All 13 surviving D8 fires on
        // the real cache are this shape. Deleting the row IS actionable: the key
        // re-resolves to a record that exists. This is what keeps D8 an evictor.
        for (const policy of ['lenient', 'balanced', 'strict'] as Policy[]) {
            const hit = tierD(D8FIX.truePositive, policy).find(h => h.rule === 'D8');
            expect([policy, hit?.severity]).toEqual([policy, 'EVICT']);
        }
    });

    it('the 35th FatSecret row (`blaze pepperoni pizza`, bills 20 kcal) abstains here — its defect is Tier L\'s axis', () => {
        // The one FatSecret D8 fire that does NOT bill fine: 20 kcal for a pepperoni
        // pizza. That is an implausible-nutrition defect on the RECORD — world
        // knowledge, Tier L's nutrition axis (the whole-cache audit REJECTed it) —
        // not "nothing to scale from". A presence check cannot and should not catch
        // it; pinned so nobody re-tightens D8 to chase this row.
        expect(servingLevelKcal(D8FIX.the35thRow)).toBe(20);
        expect(tierD(D8FIX.the35thRow, 'balanced').find(h => h.rule === 'D8')?.severity).toBe('INFO');
    });

    it('the record card explains the serving-nutrition lane instead of reading as corruption', () => {
        // The whole-cache audit REJECTed 30 of the 35 panel-less FatSecret rows on
        // the nutrition axis, citing the empty panel ("bills 490 kcal from
        // nowhere") — the card showed "NO CALORIES [PANEL IS EMPTY {}]" next to a
        // real billed total and let the judge read the contradiction as corruption.
        const card = llmUserPrompt(D8FIX.pinnedFalsePositives.find(r => r.key === 'and company noodle pad thai')!);
        expect(card).toContain('[PANEL IS EMPTY {}]');
        expect(card).toContain('serving-level nutrition (FatSecret "1 serving"): 520 kcal');
        expect(card).toContain('not corruption');
        // ...and a row with a real panel gets no such line.
        expect(llmUserPrompt(baseRow())).not.toContain('serving-level nutrition');
        // ...nor does a row with nothing anywhere — no basis must never read as one.
        expect(llmUserPrompt(D8FIX.truePositive)).not.toContain('serving-level nutrition');
    });

    it('a NEGATIVE serving kcal is UNUSABLE — D8 keeps firing (fail closed)', () => {
        // Review item 2 (2026-07-27): a negative finite kcal used to count as a
        // billing basis and abstain D8. Nobody can be billed -520 kcal; a record
        // whose only nutrition is negative has no usable basis anywhere.
        for (const calories of [-520, -0.5, '-1' as unknown as number]) {
            const r = baseRow({ per100g: {}, fs_serving_nutrients: { calories } });
            expect(servingLevelKcal(r)).toBeNull();
            expect(tierD(r, 'balanced').find(h => h.rule === 'D8')?.severity).toBe('EVICT');
            // ...and the record card must not present a negative as the billing basis.
            expect(llmUserPrompt(r)).not.toContain('serving-level nutrition');
        }
        // The real reader DOES return the negative (production carries no guard
        // there — changing production is not this instrument's call). That makes
        // the clamp the ONE sanctioned divergence between the two call sites;
        // asserted so it stays deliberate instead of drifting silent.
        expect(servingMacros({ calories: -520 })?.kcal).toBe(-520);
    });
});

describe('servingLevelKcal ↔ servingMacros — one reader, pinned parity', () => {
    /**
     * Review item 1 (2026-07-27, playbook §11 class A): the screen's first draft
     * RE-IMPLEMENTED the macro-only branch's kcal reader with `Number(...)` and
     * diverged from the real reader's parseFloat on string-typed Json values —
     * `Number('') === 0` manufactures a 0-kcal billing basis out of an empty
     * string, `Number('520 kcal') === NaN` refuses a value the lane bills as 520.
     * The fix is SHARED CODE: servingLevelKcal now calls the very servingMacros
     * that build-fatsecret-result.ts bills through. This suite feeds BOTH call
     * sites identical fixtures so any re-fork goes red the day it is written.
     */
    type Nutr = Record<string, number> | null;
    const CASES: [string, Nutr][] = [
        ['numeric 520', { calories: 520 }],
        ['numeric 0 (Propel — zero is a VALUE)', { calories: 0 }],
        ['string "520" — Json columns carry no schema', { calories: '520' } as unknown as Nutr],
        ['string "0"', { calories: '0' } as unknown as Nutr],
        ['string "520 kcal" — parseFloat reads it, the old fork refused it', { calories: '520 kcal' } as unknown as Nutr],
        ['empty string — the old fork read a 0-kcal basis out of NOTHING', { calories: '' } as unknown as Nutr],
        ['null calories, kcal synonym', { calories: null, kcal: 340 } as unknown as Nutr],
        ['undefined calories, no fallback', { calories: undefined } as unknown as Nutr],
        ['empty object {}', {}],
        ['null nutrients', null],
        ['no kcal field at all', { sodium: 230 }],
        ['NaN calories', { calories: NaN }],
        ['negative -520', { calories: -520 }],
        ['negative string "-1"', { calories: '-1' } as unknown as Nutr],
        ['boolean true — neither reader may coerce it', { calories: true } as unknown as Nutr],
    ];

    it.each(CASES)('parity on %s', (_label, nutrients) => {
        const screenReads = servingLevelKcal(baseRow({ fs_serving_nutrients: nutrients }));
        const laneBills = servingMacros(nutrients);
        if (laneBills == null || laneBills.kcal < 0) {
            // No basis (or the sanctioned negative clamp): the screen must read null.
            expect(screenReads).toBeNull();
        } else {
            // A basis: the screen must read the EXACT kcal the lane bills.
            expect(screenReads).toBe(laneBills.kcal);
        }
    });

    it('pins the two shapes the old fork got wrong, in both directions', () => {
        // Direction 1 — fork abstained D8 on a row with no usable nutrition:
        // Number('') === 0 read "genuine zero" where the real reader reads nothing.
        expect(servingMacros({ calories: '' })).toBeNull();
        expect(servingLevelKcal(baseRow({ fs_serving_nutrients: { calories: '' } as unknown as Nutr }))).toBeNull();
        // Direction 2 — fork re-fired D8 on a row that bills fine: the lane's
        // parseFloat bills '520 kcal' as 520; the fork's Number(...) read NaN.
        expect(servingMacros({ calories: '520 kcal' })?.kcal).toBe(520);
        expect(servingLevelKcal(baseRow({ fs_serving_nutrients: { calories: '520 kcal' } as unknown as Nutr }))).toBe(520);
    });
});

describe('per100gPanelBasis — the one panel-unusable predicate', () => {
    /**
     * Review item 3 (2026-07-27): tierD's D8 gate and llmUserPrompt's record
     * card carried two inline copies of "this panel is not a billing basis".
     * Two copies of a predicate drift. Both call sites now read THIS function,
     * and each case asserts all three surfaces move together.
     */
    const PANELS: [string, Record<string, number> | null, boolean][] = [
        ['null panel', null, true],
        ['empty {}', {}, true],
        ['zero kcal', { calories: 0, protein: 0, carbs: 0, fat: 0 }, true],
        ['negative kcal', { calories: -5 }, true],
        ['NaN kcal', { calories: NaN }, true],
        ['no calories field', { protein: 10 }, true],
        ['real panel', { calories: 600, protein: 21, carbs: 20, fat: 53 }, false],
        ['kcal-synonym panel', { kcal: 480 }, false],
    ];

    it.each(PANELS)('%s — predicate, D8 and the record card move together', (_label, per100g, unusable) => {
        expect(per100gPanelBasis(per100g).unusable).toBe(unusable);
        // tierD: a D8 hit (any severity) appears exactly when the panel is unusable.
        expect(tierD(baseRow({ per100g, fs_serving_nutrients: null }), 'balanced').some(h => h.rule === 'D8')).toBe(unusable);
        // The record card: the serving-level explanation line appears exactly when
        // the panel is unusable AND serving nutrition exists to explain with.
        const withServing = baseRow({ per100g, fs_serving_nutrients: { calories: 520, protein: 10 } });
        expect(llmUserPrompt(withServing).includes('serving-level nutrition')).toBe(unusable);
    });
});

describe('D9 — the corpus already flagged this record', () => {
    // !! UNEXERCISED IN THE WILD. D9 fired ZERO times on all 81 rows of batch 01, so
    // these two synthetic rows are its ONLY coverage anywhere. Passing here means the
    // rule is wired, not that it catches anything the corpus actually marks: the three
    // records the batch-01 audit proved corrupt carry no corruptReason at all.
    it('fires on a corruptReason', () => {
        expect(rules(tierD(baseRow({ corruptreason: 'kcal-impossible' }), 'balanced'))).toContain('D9');
    });
    it('fires on a duplicateOfBarcode', () => {
        expect(rules(tierD(baseRow({ dupof: '0000000000002' }), 'balanced'))).toContain('D9');
    });
    it('does not fire on an unmarked record', () => {
        expect(rules(tierD(baseRow(), 'balanced'))).not.toContain('D9');
    });
});

describe('D10 — seed brand absent from the record', () => {
    it('fires when the record belongs to a different brand', () => {
        const r = baseRow({
            seed: 'chobani greek yogurt', key: 'chobani greek yogurt',
            recname: 'Greek Yogurt', recbrand: 'Dannon', mapfoodname: 'Greek Yogurt',
        });
        expect(rules(tierD(r, 'balanced'))).toContain('D10');
    });
    it('does not fire when the brand is on the record', () => {
        expect(rules(tierD(baseRow(), 'balanced'))).not.toContain('D10');
    });
});

describe('D11 — a seed token vanished from the key (INFORMATIONAL ONLY)', () => {
    it('fires when the key dropped a non-brand token', () => {
        const r = baseRow({
            seed: 'great value frozen chicken breast', key: 'breast chicken great value',
            recname: 'Great Value Frozen Chicken Breast', mapfoodname: 'Great Value Chicken Breast',
        });
        expect(rules(tierD(r, 'balanced'))).toContain('D11');
    });
    it('does not fire when the key keeps every content token', () => {
        expect(rules(tierD(baseRow(), 'balanced'))).not.toContain('D11');
    });
    it('is INFO under EVERY policy and can never withhold a row', () => {
        // On batch 01 it fired on 2 GOOD rows and 0 BAD. Promoting it to a flag was
        // the prior proposal's rule (d); it would buy nothing but thrown-away coverage.
        const r = baseRow({
            seed: 'great value frozen chicken breast', key: 'breast chicken great value',
            recname: 'Great Value Frozen Chicken Breast', mapfoodname: 'Great Value Chicken Breast',
        });
        for (const policy of ['lenient', 'balanced', 'strict'] as Policy[]) {
            const hits = tierD(r, policy);
            expect(hits.find(h => h.rule === 'D11')?.severity).toBe('INFO');
            expect(hits.filter(h => h.rule !== 'D11')).toHaveLength(0);
            expect(screenBatch([r], policy)[0].decision).toBe('KEEP');
        }
    });
});

describe('Tier D abstains rather than fires when it does not know the seed', () => {
    it('an unattributed row (empty seed) triggers none of the token rules', () => {
        const r = baseRow({ seed: '', recname: 'Something Entirely Different', mapfoodname: 'Something Entirely Different' });
        // The screen goes quiet, not loud — conservative in the right direction, but
        // it does mean an attribution failure hides rows rather than surfacing them.
        for (const id of ['D1', 'D2', 'D3', 'D4', 'D10', 'D11'] as RuleId[]) {
            expect(rules(tierD(r, 'balanced'))).not.toContain(id);
        }
    });
});

// ---------------------------------------------------------------------------
// 5. Policy tables, decisions, and the two-tier requirement
// ---------------------------------------------------------------------------

describe('policies', () => {
    it('balanced evicts exactly the rules measured at precision 1.00 on batch 01', () => {
        expect(POLICIES.balanced.evict).toEqual(['D3', 'D4', 'D8', 'D9', 'L']);
    });
    it('lenient never evicts on a token rule, so it cannot see the D3 class at all', () => {
        expect(POLICIES.lenient.evict).not.toContain('D3');
        expect(POLICIES.lenient.evict).not.toContain('L');
    });
    it('D11 is in no policy', () => {
        for (const p of Object.values(POLICIES)) expect(p.evict).not.toContain('D11');
    });

    /**
     * D1 and D6 were evictors under all three policies until 2026-07-27. Both were
     * retired on evidence this fixture is structurally incapable of producing, so
     * both need a test that argues with the fixture rather than from it.
     */
    it('D1 evicts under NO policy — 100% precise here, 73.8% FALSE-evict on the real cache', () => {
        for (const [name, p] of Object.entries(POLICIES)) {
            expect([name, p.evict.includes('D1')]).toEqual([name, false]);
        }
        // The fixture's own verdict on D1, kept visible so the contradiction is legible:
        // 1 BAD flagged, 0 GOOD flagged — perfect precision on 81 store-brand rows.
        const flagged = firedBy('D1');
        expect([...flagged].filter(k => LABELS.get(k) === 'GOOD')).toEqual([]);
        expect([...flagged].filter(k => LABELS.get(k) === 'BAD')).toEqual(['joe trader']);
        // ...and the number that overrides it. Batch 01 is a store-brand batch, where
        // "a key that is only a brand is not a food" holds. The real cache contains
        // `sprite`, `fritos`, `oikos`, `rice krispies`, where the brand IS the food.
        expect(D1_FALSE_EVICT_RATE_REAL_CACHE).toBeGreaterThan(0.5);
    });

    it('D6 evicts under NO policy — FoodMapping is identity-only, so eviction cannot fix a serving', () => {
        for (const [name, p] of Object.entries(POLICIES)) {
            expect([name, p.evict.includes('D6')]).toEqual([name, false]);
        }
        // This one is a category error, not a precision problem: there is no grams
        // column on FoodMapping. Deleting the row throws away a correct identity and
        // re-resolves the same weight on the next request. 21 rows on the real cache
        // rested on D6 alone with provably correct identities.
    });

    it('D8 stays an evictor under every policy — legal ONLY because of the serving-nutrition abstention', () => {
        for (const [name, p] of Object.entries(POLICIES)) {
            expect([name, p.evict.includes('D8')]).toEqual([name, true]);
        }
        // What post-fix D8 fires on — no per-100g basis AND no serving-level
        // nutrition anywhere — is a property of the chosen record, so deleting the
        // row is actionable: the key re-resolves to a record that has data. Without
        // the abstention, this same table is the configuration that would have
        // deleted four correctly-billing chain-restaurant rows and a genuinely
        // zero-calorie Propel (handoff 2026-07-27 §2a).
    });

    it('every evictor is a rule whose fires are actionable by DELETING the row', () => {
        // The D6 mistake generalised: a rule may only evict if the thing it detects is
        // a property of the MAPPING (which row we chose), not of a stage downstream of
        // it. D5/D6 are serving-stage rules; D7 is a panel-arithmetic rule on the
        // corpus record and evicts only under `strict`, where the operator has opted in.
        const SERVING_STAGE_RULES: RuleId[] = ['D5', 'D6'];
        for (const [name, p] of Object.entries(POLICIES)) {
            for (const r of SERVING_STAGE_RULES) {
                expect([name, r, p.evict.includes(r)]).toEqual([name, r, false]);
            }
        }
    });
});

describe('decide() — combining the tiers', () => {
    const accept: LlmVerdict = { verdict: 'ACCEPT', axis: 'none', confidence: 1, reason: '' };
    const reject: LlmVerdict = { verdict: 'REJECT', axis: 'identity', confidence: 1, reason: 'different food' };
    const unsure: LlmVerdict = { verdict: 'UNSURE', axis: 'identity', confidence: 0.4, reason: 'cannot tell' };
    const evictHit: Hit[] = [{ rule: 'D3', severity: 'EVICT', detail: '' }];
    const reviewHit: Hit[] = [{ rule: 'D5', severity: 'REVIEW', detail: '' }];
    const infoHit: Hit[] = [{ rule: 'D11', severity: 'INFO', detail: '' }];

    it('a Tier-L REJECT evicts under balanced', () => {
        expect(decide([], reject, 'balanced')).toBe('EVICT');
    });
    it('a Tier-L UNSURE routes to a human, never to eviction', () => {
        expect(decide([], unsure, 'balanced')).toBe('REVIEW');
        expect(decide([], unsure, 'strict')).toBe('REVIEW');
    });
    it('a Tier-L REJECT only reviews under lenient, which does not list L', () => {
        expect(decide([], reject, 'lenient')).toBe('REVIEW');
    });
    it('a Tier-L ACCEPT does NOT rescue a row Tier D evicted', () => {
        // This is the load-bearing case: Tier L ACCEPTed 3 of the 23 BAD rows, and
        // Tier D caught all 3. If an ACCEPT could override Tier D, those 3 would be
        // cached wrong — which is why the tiers are OR'd, never AND'd.
        expect(decide(evictHit, accept, 'balanced')).toBe('EVICT');
    });
    it('an INFO-only row is KEEP; a REVIEW-only row is REVIEW', () => {
        expect(decide(infoHit, accept, 'balanced')).toBe('KEEP');
        expect(decide(reviewHit, accept, 'balanced')).toBe('REVIEW');
    });
    it('no Tier-L verdict at all behaves exactly like ACCEPT (Tier-D-only runs)', () => {
        expect(decide(reviewHit, null, 'balanced')).toBe('REVIEW');
        expect(decide([], undefined, 'balanced')).toBe('KEEP');
    });
});

// ---------------------------------------------------------------------------
// 6. Supporting machinery
// ---------------------------------------------------------------------------

describe('tokenising', () => {
    it('stems symmetrically, which is what makes over-truncation harmless', () => {
        // The `-ses` lesson: `cheeses` -> `chees` is fine ONLY because the record side
        // is stemmed the same way. Never apply this to one side of a comparison.
        expect(stem('cheeses')).toBe(stem('cheeses'));
        expect(stem('almonds')).toBe('almond');
        expect(stem('berries')).toBe('berry');
        expect(stem('hummus')).toBe('hummus');
        expect(stem('oats')).toBe('oat');
    });
    it('drops stopwords, digits and the detected brand from the seed content', () => {
        const content = contentStems('great value almonds', new Set(['great', 'value']));
        expect(content).toEqual(['almond']);
    });
    it('splits on anything non-alphanumeric', () => {
        expect(toks("Trader Joe's, Elote-Dip!")).toEqual(['trader', 'joe', 's', 'elote', 'dip']);
    });
});

describe('attribute()', () => {
    const rows = (): ScreenRow[] => [
        baseRow({ key: 'almond great value', seed: undefined }),
        baseRow({ key: 'breast chicken skinless amazon', seed: undefined }),
        baseRow({ key: 'entirely unrelated widget', seed: undefined }),
    ];
    const seeds = ['great value almonds', 'amazon fresh chicken breast'];

    it('falls back to stem-Jaccard when no canonicalizer is available', () => {
        // No canon => no prisma import => this path is what CI and any offline replay
        // actually exercise. On batch 01 it reproduced all 81 audited seeds by itself.
        const rs = rows();
        const { unattributed } = attribute(rs, seeds, null);
        expect(rs[0].seed).toBe('great value almonds');
        expect(rs[1].seed).toBe('amazon fresh chicken breast');
        expect(unattributed).toEqual(['entirely unrelated widget']);
    });

    it('prefers an injected canonicalizer for the exact match', () => {
        const rs = rows();
        const canon = (s: string) => (s === 'great value almonds' ? 'almond great value' : s);
        attribute(rs, seeds, canon);
        expect(rs[0].seed).toBe('great value almonds');
    });

    it('leaves an unattributable row with an empty seed so the token rules abstain', () => {
        const rs = rows();
        attribute(rs, seeds, null);
        expect(rs[2].seed).toBe('');
        expect(tierD(rs[2], 'balanced').map(h => h.rule)).not.toContain('D3');
    });
});

describe('flag validation — refused, not coerced', () => {
    it('rejects an unknown policy instead of silently evicting nothing', () => {
        expect(() => parsePolicy('balenced')).toThrow(FlagError);
        expect(parsePolicy(undefined)).toBe('balanced');
        expect(parsePolicy('strict')).toBe('strict');
    });
    it('rejects a non-integer or out-of-range --concurrency', () => {
        expect(() => parseIntFlag('--concurrency', 'abc', 6, 1)).toThrow(FlagError);
        expect(() => parseIntFlag('--concurrency', '--out', 6, 1)).toThrow(FlagError);
        expect(() => parseIntFlag('--concurrency', '0', 6, 1)).toThrow(FlagError);
        expect(parseIntFlag('--concurrency', undefined, 6, 1)).toBe(6);
        expect(parseIntFlag('--concurrency', '3', 6, 1)).toBe(3);
    });
});

describe('confusionOf()', () => {
    it('counts a SUSPECT flag as precision-positive under BAD+SUS but not under BAD', () => {
        const labels = new Map<string, Label>([['a', 'BAD'], ['b', 'SUSPECT'], ['c', 'GOOD']]);
        const c = confusionOf(new Set(['a', 'b']), labels);
        expect(c).toMatchObject({ badCaught: 1, badMissed: 0, susFlagged: 1, goodFlagged: 0, goodClean: 1 });
        expect(c.precBad).toBeCloseTo(0.5, 10);
        expect(c.precBadSus).toBeCloseTo(1.0, 10);
        expect(c.recall).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// The three blind spots closed 2026-07-27. Each of these tests exists because the
// screen produced a confident, wrong number over the full 3,248-row cache.
// ---------------------------------------------------------------------------

describe('ROW_SQL joins every source a FoodMapping row can point at', () => {
    it('joins FdcFood — its absence false-evicted 78 of 78 fdc rows', () => {
        // FoodMapping.fdcId is a first-class source, but ROW_SQL joined only OffFood
        // and FatSecretFood. Every fdc row therefore arrived with recname='' and
        // per100g=null, so D8 ("no usable per-100g basis") fired on all of them and
        // D3/D4 compared the seed against an empty string. Batch 01 had no fdc rows,
        // which is exactly why the measured operating point never saw it.
        expect(ROW_SQL).toContain('"FdcFood"');
        expect(ROW_SQL).toMatch(/LEFT JOIN "FdcFood" \w+\s+ON \w+\."fdcId" = m\."fdcId"/);
    });

    it('coalesces the fdc record into name, brand and panel — not just the join', () => {
        // A join nobody selects from is the same bug with extra steps.
        expect(ROW_SQL).toMatch(/coalesce\(o\.name, f\.name, fd\.description/);
        expect(ROW_SQL).toMatch(/coalesce\(o\."nutrientsPer100g", f\."nutrientsPer100g", fd\."nutrientsPer100g"\)/);
    });

    it('reads FdcFood.servingSize as grams ONLY when the unit says grams', () => {
        const asGrams = baseRow({
            off_serving_grams: null, fs_serving_grams: null, off_serv_min_g: null,
            fdc_serving_size: 85, fdc_serving_unit: 'g',
        });
        expect(resolveServingGrams(asGrams)).toEqual({ grams: 85, from: 'FdcFood.servingSize' });

        // `1 cup` in the servingSize column is a VOLUME. Reading 240 there as 240 g
        // would invent a weight for every liquid in the FDC corpus.
        const asVolume = baseRow({
            off_serving_grams: null, fs_serving_grams: null, off_serv_min_g: null,
            fdc_serving_size: 240, fdc_serving_unit: 'ml',
        });
        expect(resolveServingGrams(asVolume).grams).toBeNull();
    });
});

describe('realServing() — the anchor D5/D6 judge', () => {
    it('reports judged=false when the pass never ran, so the rules abstain', () => {
        expect(realServing(baseRow()).judged).toBe(false);
        expect(realServing(baseRow({ real: null })).judged).toBe(false);
        expect(realServing(baseRow({ real: { grams: null, tier: null, kcal: null, error: 'boom' } })).judged).toBe(false);
    });

    it('normalises flat_100g_default to "no anchor" rather than a plausible 100 g', () => {
        const r = realServing(baseRow({ real: { grams: 100, tier: 'flat_100g_default', kcal: 250 } }));
        expect(r.judged).toBe(true);
        expect(r.grams).toBeNull();
        expect(r.from).toContain('flat_100g_default');
    });

    it('treats an AI-ESTIMATED tier as UNJUDGED — a fresh model guess cannot evict a row', () => {
        // hydrateAndSelectServing invokes the ambiguous-serving estimator for rows the
        // corpus cannot anchor. That number is not a property of the cached row; it can
        // differ on the next request. Same rule as the serving gate's
        // AI-NONDETERMINISTIC verdict (PR #174): report it, never gate on it.
        for (const tier of ['ai_estimated_serving', 'fdc_size_estimated', 'count_ai_default']) {
            const r = realServing(baseRow({ real: { grams: 28, tier, kcal: 90 } }));
            expect(r.judged).toBe(false);
            expect(r.from).toContain('ai-estimated');
        }
        const h = tierD(baseRow({ real: { grams: 1.0, tier: 'ai_estimated_serving', kcal: 5 } }), 'balanced')
            .find(x => x.rule === 'D6');
        expect(h?.severity).toBe('INFO');
    });

    it('passes a genuine anchor through untouched', () => {
        const r = realServing(baseRow({ real: { grams: 56.7, tier: 'fs_serving_macros_only', kcal: 320 } }));
        expect(r).toEqual({ grams: 56.7, from: 'hydrateAndSelectServing:fs_serving_macros_only', judged: true });
    });
});

describe('parseSeedFile() + pinned attribution', () => {
    it('parses bare phrases, key<TAB>phrase pins, comments and blanks', () => {
        const s = parseSeedFile('# a comment\n\nplain seed phrase\nsome key\tthe observed phrase\n');
        expect(s.phrases).toEqual(['plain seed phrase', 'the observed phrase']);
        expect(s.byKey.get('some key')).toBe('the observed phrase');
    });

    it('a pin beats the Jaccard guess — the failure that made 332 evictions unquotable', () => {
        // Measured 2026-07-27 over the whole cache: a TURKEY key drew the seed
        // `85% lean 15% fat beef` because it was the nearest phrase in a 4,168-entry
        // list, and D3 then reported "head noun 'beef' absent" on a correct row.
        const rows = [baseRow({ key: '15% 85% fat lean turkey', recname: '85% lean ground turkey' })];
        const seeds = parseSeedFile('85% lean 15% fat beef\n15% 85% fat lean turkey\t85% lean 15% fat turkey\n');

        attribute(rows, seeds, null);
        expect(rows[0].seed).toBe('85% lean 15% fat turkey');
        expect(rules(tierD(rows[0], 'balanced'))).not.toContain('D3');
    });

    it('without the pin the same row draws the wrong seed and D3 misfires', () => {
        const rows = [baseRow({ key: '15% 85% fat lean turkey', recname: '85% lean ground turkey' })];
        attribute(rows, parseSeedFile('85% lean 15% fat beef\n'), null);
        expect(rows[0].seed).toBe('85% lean 15% fat beef');
        expect(rules(tierD(rows[0], 'balanced'))).toContain('D3');
    });

    it('still accepts a plain string[] so batch callers are unaffected', () => {
        const rows = [baseRow({ key: 'almond great value' })];
        attribute(rows, ['great value almonds'], null);
        expect(rows[0].seed).toBe('great value almonds');
    });
});

describe('Tier-L failure is fail-SAFE, not fail-open', () => {
    const failed = (): LlmVerdict =>
        ({ verdict: 'UNSURE', axis: 'none', confidence: 0, reason: 'Unexpected end of JSON input', error: 'call-failed' });

    it('an unadjudicated row goes to REVIEW, never KEEP', () => {
        // It used to default to ACCEPT. Measured 2026-07-27: swapping --model to
        // claude-sonnet-5 truncated 16 of 81 responses mid-JSON, and under ACCEPT all
        // 16 landed in KEEP with only a WARN line to say so — a silently
        // unscreened row reading as clean is the defect class this file exists for.
        expect(decide([], failed(), 'balanced')).toBe('REVIEW');
    });

    it('still cannot mass-EVICT on an outage — that was the reason ACCEPT was chosen', () => {
        // The fail-safe has to preserve the original property: a network blip must not
        // throw the cache away. UNSURE reaches REVIEW and stops there under every policy.
        for (const p of ['lenient', 'balanced', 'strict'] as Policy[]) {
            expect(decide([], failed(), p)).not.toBe('EVICT');
        }
    });

    it('a real ACCEPT still keeps the row, so the change costs no precision', () => {
        expect(decide([], { verdict: 'ACCEPT', axis: 'none', confidence: 0.9, reason: '' }, 'balanced')).toBe('KEEP');
    });
});

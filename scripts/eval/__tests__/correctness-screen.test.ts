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
 *   - Whether a flagged row actually bills wrong. D5/D6 read a RECONSTRUCTION of the
 *     billing anchor, not hydrateAndSelectServing. Never measured.
 *   - D9 in the wild: it fired ZERO times across all 81 rows, so its only coverage
 *     anywhere is the synthetic case below.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    FITTED_GOOD_FP_RATE,
    FlagError,
    HELD_OUT_GOOD_FP_RATE,
    MEASURED_BAD_RECALL_TIER_D_ONLY,
    MEASURED_BAD_RECALL_WITH_LLM,
    POLICIES,
    TIER_D_RULE_IDS,
    attribute,
    atwater,
    confusionOf,
    contentStems,
    decide,
    parseIntFlag,
    parsePolicy,
    resolveServingGrams,
    screenBatch,
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
     */
    const PER_RULE: { rule: RuleId; fires: number; bad: number; good: number; suspect: number; note: string }[] = [
        { rule: 'D1', fires: 1, bad: 1, good: 0, suspect: 0, note: 'bare-brand key: `joe trader`' },
        { rule: 'D2', fires: 1, bad: 0, good: 0, suspect: 1, note: 'generic-key takeover (millville lost)' },
        { rule: 'D3', fires: 16, bad: 15, good: 0, suspect: 1, note: 'THE WORKHORSE — head noun absent' },
        { rule: 'D4', fires: 3, bad: 3, good: 0, suspect: 0, note: 'a subset of D3 in practice' },
        { rule: 'D5', fires: 8, bad: 1, good: 0, suspect: 7, note: 'a SUSPECT detector, not a BAD detector' },
        { rule: 'D6', fires: 3, bad: 3, good: 0, suspect: 0, note: '1.0 g chili oil, 1.9 g muffin, 1106 g banana' },
        { rule: 'D7', fires: 2, bad: 1, good: 0, suspect: 1, note: 'Atwater: inconsistency, not wrongness' },
        { rule: 'D8', fires: 1, bad: 0, good: 0, suspect: 1, note: 'empty panels are a restaurant-batch rule' },
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
            .toEqual({ flagged: 27, bad: 19, good: 0, suspect: 8 });
        expect(c.recall).toBeCloseTo(19 / 23, 10);
    });

    /**
     * Whole-tier decisions per policy. `balanced` is the shipped operating point's
     * deterministic half; `strict` buys ONE extra BAD row over it and withholds eight
     * more; `lenient` is not a screen.
     */
    const PER_POLICY: { policy: Policy; evict: number; evictBad: number; review: number; reviewBad: number; keep: number }[] = [
        { policy: 'lenient', evict: 5, evictBad: 4, review: 22, reviewBad: 15, keep: 54 },
        { policy: 'balanced', evict: 19, evictBad: 18, review: 8, reviewBad: 1, keep: 54 },
        { policy: 'strict', evict: 27, evictBad: 19, review: 0, reviewBad: 0, keep: 54 },
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
        // 23/23 held under all four rubric variants tried, including the one with no
        // batch-01 content of any kind. Tier D alone accounts for 18 of those 23.
        expect(MEASURED_BAD_RECALL_WITH_LLM).toBe(1);
        expect(MEASURED_BAD_RECALL_TIER_D_ONLY).toBeCloseTo(18 / 23, 10);
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
    it('fires when every gram column is empty (a unitless `1 x` bills a flat 100 g)', () => {
        const r = baseRow({ off_serving_grams: null, fs_serving_grams: null, off_serv_min_g: null });
        expect(rules(tierD(r, 'balanced'))).toContain('D5');
        // ...and under `balanced` it is a REVIEW, not an EVICT: 7 of its 8 fires on
        // batch 01 were SUSPECT rows, and the anchor it reads is a reconstruction.
        expect(tierD(r, 'balanced').find(h => h.rule === 'D5')?.severity).toBe('REVIEW');
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

describe('D8 — unusable per-100g basis', () => {
    it.each([
        ['an empty {} panel', {} as Record<string, number>],
        ['a 0 kcal panel', { calories: 0, protein: 0, carbs: 0, fat: 0 }],
    ])('fires on %s', (_label, per100g) => {
        expect(rules(tierD(baseRow({ per100g }), 'balanced'))).toContain('D8');
    });
    it('does not fire on a real panel', () => {
        expect(rules(tierD(baseRow(), 'balanced'))).not.toContain('D8');
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
        expect(POLICIES.balanced.evict).toEqual(['D1', 'D3', 'D4', 'D6', 'D8', 'D9', 'L']);
    });
    it('lenient never evicts on a token rule, so it cannot see the D3 class at all', () => {
        expect(POLICIES.lenient.evict).not.toContain('D3');
        expect(POLICIES.lenient.evict).not.toContain('L');
    });
    it('D11 is in no policy', () => {
        for (const p of Object.values(POLICIES)) expect(p.evict).not.toContain('D11');
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

/**
 * fail-closed.test.ts — FAIL INJECTION for every eval instrument that consults an
 * external or fallible source.
 *
 * WHY THIS FILE EXISTS
 * Three separate instruments under scripts/eval shipped a confidently wrong number
 * while their own suites were 100% green. The recurring shape is not "the logic is
 * wrong" — it is that an ABSENCE OF SIGNAL was encoded as the PASSING verdict:
 *
 *   the LLM call failed          -> the row read as ACCEPT -> KEEP        (PR #176)
 *   the mapper returned no pick  -> foodName echoed the query -> PASS     (PR #152)
 *   the row pull returned []     -> nEvict 0 -> exit 0 "clean batch"
 *   --grep matched nothing       -> "0 real failures" -> exit 0
 *   the noise-floor snapshot was empty -> "0 diffs" -> a passing receipt
 *
 * Every test below FORCES the underlying call to fail and asserts the verdict is
 * NOT the passing one. Each block also carries a POSITIVE CONTROL: without one,
 * "the verdict is not PASS" is satisfiable by an instrument that never passes
 * anything, which is a tautology, not a test (playbook §5).
 *
 * NO NETWORK, NO DATABASE. `fetch` is replaced per-test; the production mapper is
 * jest.mock'd with a factory so the real module (which builds a PrismaClient at
 * import time) is never loaded.
 */

import {
    driftedKnownIssues,
    evalExitCode,
    scoreNlpCase,
    scoreSearchCase,
    type BaselineEntry,
} from '../assertions';
import {
    callLlm,
    decide,
    realServing,
    resolveRealServings,
    runLlm,
    screenBatch,
    screenExitCode,
    tierD,
    type LlmConfig,
    type LlmVerdict,
    type Policy,
    type ScreenRow,
} from '../correctness-screen';
import { noiseGate, type NoiseFloorLedger, type ReplayFile } from '../winner-diff-screens';

// The screen requires this lazily, inside resolveRealServings. A FACTORY mock means
// the real module is never evaluated, so no PrismaClient is constructed.
jest.mock('../../../src/lib/mapping/map-ingredient-with-fallback', () => ({
    hydrateAndSelectServing: jest.fn(),
}));
const { hydrateAndSelectServing } = require('../../../src/lib/mapping/map-ingredient-with-fallback');

const ALL_POLICIES: Policy[] = ['lenient', 'balanced', 'strict'];

/** A GOOD-shaped row: real panel, brand present, head noun present, seed attributed. */
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
        fdc_serving_size: null,
        fdc_serving_unit: '',
        fdc_serv_min_g: null,
        seed: 'great value almonds',
        ...over,
    };
}

/** The exact wire shape the no-pick branch returns (api/nlp/parse/route.ts). */
function abstentionFor(query: string) {
    return {
        rawText: query, foodName: query, brandName: null, foodId: undefined,
        source: 'ai_estimated', matchConfidence: 0.0, servingConfidence: 0.0, grams: 0,
        nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
        nutritionPer100g: { kcal100: 0, protein100: 0, carbs100: 0, fat100: 0 },
        servingOptions: [],
    };
}

// ===========================================================================
// 1. The golden-set harness — a no-pick must never score PASS
// ===========================================================================

describe('golden-set harness: abstention is not a pass', () => {
    // 37 of the 243 nlp cases assert a name with no numeric band. The abstain branch
    // returns `foodName: parsed?.name ?? rawText` — THE QUERY TEXT — so substring
    // containment matched trivially and the mapper answering "I have nothing" scored
    // a pass on every one of them.
    //
    // isAbstention() was already unit-tested. What was NOT tested is the code that
    // COMPOSES it into a verdict, which is where the guard actually has to live and
    // where it can be deleted by a refactor without any test noticing.
    const nameOnlyCase = { expectName: [['burrito']] };

    it('a total abstention FAILS a name-only case', () => {
        const failures = scoreNlpCase(nameOnlyCase, [abstentionFor('chipotle chicken burrito')]);
        expect(failures.length).toBeGreaterThan(0);
        expect(failures.join(' ')).toContain('NO PICK (abstained)');
    });

    it('POSITIVE CONTROL — a genuine pick still passes the same case', () => {
        const pick = { foodName: 'Chicken Queso Burrito', brandName: 'Qdoba', foodId: 'fs_1', matchConfidence: 0.95, grams: 320 };
        expect(scoreNlpCase(nameOnlyCase, [pick])).toEqual([]);
    });

    it('a segmentation case still passes when ONE real item matches', () => {
        const pick = { foodName: 'Chicken Burrito', foodId: 'fs_1', matchConfidence: 0.9 };
        expect(scoreNlpCase({ expectName: [['burrito']], expectItems: 2 }, [abstentionFor('zzz'), pick])).toEqual([]);
    });

    it('an abstention cannot trip a NEGATIVE assertion either', () => {
        // Symmetry: the echoed query text must not count as a forbidden match, or
        // forbidName would fire on the mapper doing the right thing.
        expect(scoreNlpCase({ forbidName: [['tequila lime']] },
            [abstentionFor('qdoba tequila lime chicken burrito')])).toEqual([]);
    });

    it('an EMPTY item list is a failure, not a vacuous pass', () => {
        // A 500, a `{"error": ...}` body and a dead segmenter all look like this.
        expect(scoreNlpCase(nameOnlyCase, []).length).toBeGreaterThan(0);
        expect(scoreNlpCase(nameOnlyCase, null).length).toBeGreaterThan(0);
        expect(scoreNlpCase(nameOnlyCase, { error: 'boom' }).length).toBeGreaterThan(0);
        // ...and it fails even for a case that asserts NOTHING, because "no response"
        // is a failure of the run, not of the assertions.
        expect(scoreNlpCase({}, []).length).toBeGreaterThan(0);
    });

    it('search: an empty hit list FAILS instead of having nothing to disagree with', () => {
        const c = { match: [['almond']] };
        expect(scoreSearchCase(c, []).pass).toBe(false);
        expect(scoreSearchCase(c, { error: 'typesense unreachable' }).pass).toBe(false);
        expect(scoreSearchCase(c, []).detail).toContain('EMPTY');
        // POSITIVE CONTROL
        expect(scoreSearchCase(c, [{ name: 'Almonds', kcal100: 600 }]).pass).toBe(true);
    });

    it('a run that executed ZERO cases exits 2, not 0', () => {
        expect(evalExitCode([])).toBe(2);
        // POSITIVE CONTROLS — the ordinary codes are unchanged.
        expect(evalExitCode([{ pass: true }])).toBe(0);
        expect(evalExitCode([{ pass: false }])).toBe(1);
        expect(evalExitCode([{ pass: false, knownIssue: true }])).toBe(0);
    });
});

// ===========================================================================
// 2. knownIssue suppression cannot hide a VALUE regression
// ===========================================================================

describe('knownIssue suppresses the FAILURE, never the DRIFT', () => {
    const baseline: Record<string, BaselineEntry> = {
        'n-cook-06': { foodId: 'off_1', foodName: 'Rolled Oats', grams: 234, kcal100: 361, abstained: false },
    };

    it('a suppressed case whose kcal collapsed 361 -> 0 still reports', () => {
        // Both values fail the same band and both are knownIssue, so the pass/fail
        // boolean is identical either way. Only a value comparison can see it.
        const drift = driftedKnownIssues(
            [{ id: 'n-cook-06', knownIssue: true, observed: { foodId: 'off_2', foodName: 'oats', grams: 234, kcal100: 0 } }],
            baseline);
        expect(drift).toHaveLength(1);
        expect(drift[0].what).toContain('kcal100 361 -> 0');
        expect(drift[0].what).toContain('record off_1 -> off_2');
    });

    it('a suppressed case that started ABSTAINING reports', () => {
        const drift = driftedKnownIssues(
            [{ id: 'n-cook-06', knownIssue: true, observed: { foodId: null, grams: 0, kcal100: 0, abstained: true } }],
            baseline);
        expect(drift[0].what).toContain('abstained false -> true');
    });

    it('a suppressed case that stopped answering ENTIRELY reports', () => {
        // The doubly-invisible case: the transport failure is exempted by the pin AND
        // there is no observation to diff, so `if (!r.observed) continue` erased it
        // from the only output still watching that case.
        const drift = driftedKnownIssues([{ id: 'n-cook-06', knownIssue: true }], baseline);
        expect(drift).toHaveLength(1);
        expect(drift[0].what).toContain('errored false -> true');
    });

    it('POSITIVE CONTROL — a case failing exactly as recorded reports nothing', () => {
        expect(driftedKnownIssues(
            [{ id: 'n-cook-06', knownIssue: true, observed: { ...baseline['n-cook-06'] } }],
            baseline)).toEqual([]);
    });

    it('noise inside 10% is still not a report', () => {
        expect(driftedKnownIssues(
            [{ id: 'n-cook-06', knownIssue: true, observed: { ...baseline['n-cook-06'], kcal100: 380 } }],
            baseline)).toEqual([]);
    });
});

// ===========================================================================
// 3. Tier L — the LLM call itself, not a hand-written verdict
// ===========================================================================

describe('callLlm: a failed or unreadable reply is UNSURE, never ACCEPT', () => {
    const CFG: LlmConfig = { model: 'test-model', baseUrl: 'http://llm.invalid/v1', apiKey: 'k', concurrency: 1 };
    let fetchSpy: jest.SpyInstance;

    afterEach(() => { fetchSpy?.mockRestore(); });

    const reply = (content: string) => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
    }) as unknown as Response;

    // The existing "Tier-L failure is fail-SAFE" test hand-builds the failed verdict
    // and checks decide(). That leaves callLlm's OWN mapping untested: flipping its
    // catch branch back to ACCEPT keeps every other test in the suite green.

    it('a network exception -> UNSURE + error', async () => {
        fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
        const v = await callLlm(baseRow(), CFG);
        expect(v.verdict).toBe('UNSURE');
        expect(v.error).toBe('call-failed');
        expect(v.verdict).not.toBe('ACCEPT');
    }, 20000);

    it('a persistent HTTP 500 -> UNSURE + error, not a silent ACCEPT', async () => {
        fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
        const v = await callLlm(baseRow(), CFG);
        expect(v.verdict).toBe('UNSURE');
        expect(v.error).toBe('call-failed');
    }, 20000);

    it('a reply TRUNCATED mid-JSON -> UNSURE (the claude-sonnet-5 shape)', async () => {
        // Measured: swapping --model to a reasoning model truncated 16 of 81 replies
        // mid-object. Under the old default all 16 landed in KEEP.
        fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply('{"verdict":"REJ'));
        const v = await callLlm(baseRow(), CFG);
        expect(v.verdict).toBe('UNSURE');
        expect(v.error).toBe('call-failed');
    }, 20000);

    it('an UNRECOGNISED verdict string -> UNSURE, not ACCEPT by fallthrough', async () => {
        // `=== 'REJECT' ? : === 'UNSURE' ? : 'ACCEPT'` made every unknown token an
        // approval, so a model that answered anything the rubric did not literally
        // spell had its row silently KEPT.
        for (const body of ['{"verdict":"probably fine"}', '{}', '{"axis":"identity"}', '{"verdict":null}']) {
            fetchSpy?.mockRestore();
            fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply(body));
            const v = await callLlm(baseRow(), CFG);
            expect(v.verdict).toBe('UNSURE');
            expect(v.error).toBe('unparseable-verdict');
        }
    }, 20000);

    it('a CASE-DIFFERENT verdict is honoured, not silently inverted to ACCEPT', async () => {
        // `"reject"` used to fall through the === chain and KEEP the row — the worst
        // possible reading of the reply, since the model had said the opposite.
        fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply('{"verdict":"reject","reason":"different food"}'));
        const v = await callLlm(baseRow(), CFG);
        expect(v.verdict).toBe('REJECT');
        expect(v.error).toBeUndefined();
    }, 20000);

    it('POSITIVE CONTROL — a well-formed reply is honoured on all three verdicts', async () => {
        for (const want of ['ACCEPT', 'UNSURE', 'REJECT'] as const) {
            fetchSpy?.mockRestore();
            fetchSpy = jest.spyOn(globalThis, 'fetch')
                .mockResolvedValue(reply(`{"verdict":"${want}","axis":"identity","confidence":0.9,"reason":"ok"}`));
            const v = await callLlm(baseRow(), CFG);
            expect(v.verdict).toBe(want);
            expect(v.error).toBeUndefined();
        }
    }, 20000);
});

describe('a TOTAL Tier-L outage produces REVIEW, never KEEP and never EVICT', () => {
    it('every otherwise-clean row is withheld for a human', async () => {
        const spy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('LLM down'));
        try {
            const rows = [baseRow(), baseRow({ key: 'cashew kirkland signature', seed: 'kirkland signature cashews', recname: 'Kirkland Signature Cashews', recbrand: 'Kirkland Signature', mapbrand: 'Kirkland Signature' })];
            const llm = await runLlm(rows, { model: 'm', baseUrl: 'http://llm.invalid/v1', apiKey: 'k', concurrency: 2 });
            expect([...llm.values()].every(v => v.error === 'call-failed')).toBe(true);

            for (const p of ALL_POLICIES) {
                const decisions = screenBatch(rows, p, llm).map(v => v.decision);
                // Not KEEP: an unadjudicated row must not read as clean.
                expect(decisions).not.toContain('KEEP');
                // Not EVICT: an outage must not throw the cache away either. The
                // fail-safe has to hold in BOTH directions.
                expect(decisions).not.toContain('EVICT');
                expect(new Set(decisions)).toEqual(new Set(['REVIEW']));
            }
        } finally { spy.mockRestore(); }
    }, 30000);
});

// ===========================================================================
// 4. resolveRealServings — a row whose anchor threw is UNJUDGED, never EVICT
// ===========================================================================

describe('resolveRealServings: a serving-resolution failure downgrades D5/D6 to INFO', () => {
    beforeEach(() => { (hydrateAndSelectServing as jest.Mock).mockReset(); });

    /** A row whose ONLY defect can be the serving anchor. */
    const cleanBut = (over: Partial<ScreenRow> = {}) => baseRow({ off_serving_grams: null, ...over });

    it('hydrateAndSelectServing THROWING marks the row errored, not resolved', async () => {
        (hydrateAndSelectServing as jest.Mock).mockRejectedValue(new Error('FDC API 503'));
        const rows = [cleanBut()];
        await resolveRealServings(rows, 2);

        expect(rows[0].real?.error).toBe('FDC API 503');
        expect(realServing(rows[0]).judged).toBe(false);
    });

    it('...and that row can NEVER be evicted on D5 or D6, under any policy', async () => {
        (hydrateAndSelectServing as jest.Mock).mockRejectedValue(new Error('FDC API 503'));
        const rows = [cleanBut(), cleanBut({ fs_serving_grams: 1.0 })];  // the second would be D6
        await resolveRealServings(rows, 2);

        for (const p of ALL_POLICIES) {
            for (const r of rows) {
                const servingHits = tierD(r, p).filter(h => h.rule === 'D5' || h.rule === 'D6');
                expect(servingHits.length).toBeGreaterThan(0);          // it still REPORTS
                expect(servingHits.every(h => h.severity === 'INFO')).toBe(true);
                expect(servingHits.every(h => h.detail.includes('UNJUDGED'))).toBe(true);
            }
            expect(screenBatch(rows, p).map(v => v.decision)).not.toContain('EVICT');
        }
    });

    it('a null return (no serving selected) is also UNJUDGED, not "no anchor exists"', async () => {
        (hydrateAndSelectServing as jest.Mock).mockResolvedValue(null);
        const rows = [cleanBut()];
        await resolveRealServings(rows, 1);
        expect(rows[0].real).toBeNull();
        expect(realServing(rows[0]).judged).toBe(false);
        expect(tierD(rows[0], 'strict').find(h => h.rule === 'D5')?.severity).toBe('INFO');
    });

    it('a row the screen cannot even address is errored, not silently skipped', async () => {
        // No record id => candidateId() returns null => the anchor never ran. That has
        // to be recorded as an error, or the row falls through to the reconstruction
        // wearing a `judged` flag it did not earn.
        const rows = [cleanBut({ recid: '' })];
        await resolveRealServings(rows, 1);
        expect(rows[0].real?.error).toContain('no record id');
        expect(realServing(rows[0]).judged).toBe(false);
        expect(hydrateAndSelectServing).not.toHaveBeenCalled();
    });

    it('POSITIVE CONTROL — a resolved anchor IS judged and DOES escalate past INFO', async () => {
        // Without this the block above is satisfiable by a screen that never judges
        // anything, which would be a tautology rather than a test.
        //
        // The escalation ceiling is REVIEW, not EVICT: since 2026-07-27 D5/D6 evict
        // under no policy, because FoodMapping is identity-only and deleting the row
        // cannot produce a serving weight. What this control still proves is what it
        // was written for — a JUDGED anchor is treated differently from an unjudged
        // one, so the UNJUDGED->INFO downgrade tested above is not vacuous.
        (hydrateAndSelectServing as jest.Mock).mockResolvedValue({ grams: 1.0, servingTier: 'label_serving_default', kcal: 6 });
        const rows = [cleanBut()];
        await resolveRealServings(rows, 1);

        expect(realServing(rows[0]).judged).toBe(true);
        const d6 = tierD(rows[0], 'balanced').find(h => h.rule === 'D6');
        expect(d6?.severity).toBe('REVIEW');
        expect(d6?.detail).not.toContain('UNJUDGED');
        expect(screenBatch(rows, 'balanced')[0].decision).toBe('REVIEW');
    });
});

// ===========================================================================
// 5. The screen's own exit code — zero rows is not a clean batch
// ===========================================================================

describe('screenExitCode: screening nothing is RED, not green', () => {
    it('zero rows screened exits 2 regardless of the eviction count', () => {
        // `json_agg` over no matching rows is SQL NULL -> `?? []`; an empty added.txt
        // and a `--rows` file of `[]` produce the same. All three used to print
        // "EVICT 0 · REVIEW 0 · KEEP 0" and exit 0.
        expect(screenExitCode(0, 0)).toBe(2);
    });

    it('POSITIVE CONTROLS — the ordinary codes are unchanged', () => {
        expect(screenExitCode(81, 0)).toBe(0);
        expect(screenExitCode(81, 19)).toBe(1);
    });
});

// ===========================================================================
// 6. winner-diff's noise floor — a receipt over zero rows is not a floor
// ===========================================================================

describe('noiseGate: an EMPTY noise-floor receipt does not certify determinism', () => {
    const replay = (over: Partial<ReplayFile> = {}): ReplayFile => ({
        variant: 'A', snapshotTakenAt: '2026-07-27T00:00:00Z', gitDirty: 'clean',
        withServing: false, rows: [],
        ...over,
    } as ReplayFile);

    const ledgerWith = (rows: number): NoiseFloorLedger => ({
        kind: 'winner-diff/noise-floor-ledger', version: 1,
        receipts: (['A', 'B'] as const).map(variant => ({
            kind: 'winner-diff/noise-floor', version: 1,
            snapshotTakenAt: '2026-07-27T00:00:00Z', gitDirty: 'clean', gitHead: 'abc1234', variant,
            rows, winnerDiffs: 0, pathDiffs: 0, servingDiffs: 0, withServing: false,
            ranAt: '2026-07-27T01:00:00Z',
        })),
    } as unknown as NoiseFloorLedger);

    it('rejects a 0-row receipt — "0 differences" over nothing is not a measurement', () => {
        const v = noiseGate(ledgerWith(0), replay(), replay({ variant: 'B' }), { crossSnapshot: false });
        expect(v.ok).toBe(false);
        expect(v.problems.join(' ')).toContain('ZERO rows');
    });

    it('POSITIVE CONTROL — a real 0-diff receipt over real rows still passes', () => {
        expect(noiseGate(ledgerWith(420), replay(), replay({ variant: 'B' }), { crossSnapshot: false }).ok).toBe(true);
    });
});

// ===========================================================================
// 7. decide() — the shape every block above depends on
// ===========================================================================

describe('decide(): an unadjudicated verdict is never a pass and never a purge', () => {
    const failed: LlmVerdict = { verdict: 'UNSURE', axis: 'none', confidence: 0, reason: 'x', error: 'call-failed' };
    it('holds for every policy', () => {
        for (const p of ALL_POLICIES) {
            expect(decide([], failed, p)).toBe('REVIEW');
        }
    });
});

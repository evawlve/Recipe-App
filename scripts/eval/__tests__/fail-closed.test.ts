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
    DEFAULT_MIN_ITEMS,
    describeDrift,
    driftedKnownIssues,
    evalExitCode,
    mergeBaseline,
    nutritionMissing,
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
        // minItems:1 keeps this case about the EMPTY-list contract alone. Without it the
        // one-hit positive control below trips the browse-list floor and this test would
        // pass for the wrong reason — green because the list is short, not because the
        // empty list was rejected.
        const c = { match: [['almond']], minItems: 1 };
        expect(scoreSearchCase(c, []).pass).toBe(false);
        expect(scoreSearchCase(c, { error: 'typesense unreachable' }).pass).toBe(false);
        expect(scoreSearchCase(c, []).detail).toContain('EMPTY');
        // POSITIVE CONTROL
        expect(scoreSearchCase(c, [{ name: 'Almonds', kcal100: 600 }]).pass).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Browse-list destruction (the Stage 0 blind spot, closed 2026-07-29)
    //
    // Measured before writing these: `scoreSearchCase` scored `list.slice(0, rank ?? 3)`
    // and never read `list.length`, and the largest `rank` in the golden set is 5 — so
    // truncating every list to 5 rows passed all 105 search cases BY CONSTRUCTION. The
    // top hit does not move, and the top hit was the only thing anyone looked at.
    // -----------------------------------------------------------------------

    /** 24 plausible rows, the shape a healthy browse list has. */
    const fullList = (n = 24) =>
        Array.from({ length: n }, (_, i) => ({ name: i === 0 ? 'Almond butter' : `Filler ${i}`, kcal100: 600 }));

    it('search: a gutted list FAILS even though the expected hit is still #1', () => {
        const c = { match: [['almond']], minItems: 14 };
        // THE REGRESSION. Identical winner, identical top-3, 24 rows -> 3.
        const gutted = scoreSearchCase(c, fullList(3));
        expect(gutted.pass).toBe(false);
        expect(gutted.detail).toContain('LIST TOO SHORT');
        // ...and the winner is still named, because "right hit" and "gutted list" are
        // two facts and a reader needs both to tell a filter bug from a ranking bug.
        expect(gutted.detail).toContain('Almond butter');
        // POSITIVE CONTROL — the same case, same winner, intact list.
        expect(scoreSearchCase(c, fullList(24)).pass).toBe(true);
    });

    it('search: the floor is per-case, and DEFAULT_MIN_ITEMS applies when it is unset', () => {
        expect(DEFAULT_MIN_ITEMS).toBeGreaterThan(1);
        const noFloor = { match: [['almond']] };
        expect(scoreSearchCase(noFloor, fullList(DEFAULT_MIN_ITEMS - 1)).pass).toBe(false);
        expect(scoreSearchCase(noFloor, fullList(DEFAULT_MIN_ITEMS)).pass).toBe(true);
        // A per-case floor OVERRIDES the default in both directions — a narrow query may
        // legitimately return fewer rows, and a broad one must be held to more.
        expect(scoreSearchCase({ match: [['almond']], minItems: 1 }, fullList(1)).pass).toBe(true);
        expect(scoreSearchCase({ match: [['almond']], minItems: 20 }, fullList(19)).pass).toBe(false);
    });

    // -----------------------------------------------------------------------
    // The manufactured zero (closed 2026-08-14)
    //
    // `/api/foods/search` writes `kcal100: c.nutrition?.kcal ?? 0`, so a candidate the
    // route knows nothing about leaves as a finite 0 rather than as an absence. The
    // pre-existing invariant reads `hasNum`, and `hasNum(0) === true`, so 3,394
    // FatSecret chain records shipped 0 kcal past the one check written to stop them —
    // and it only read `list.slice(0, rank ?? 3)` anyway, while those rows sit at
    // ranks 9–22 of a ~25-row browse list.
    // -----------------------------------------------------------------------

    it('search: the null-nutrition invariant reads the WHOLE list, not just topN', () => {
        // The row is at index 10, far outside `rank`. Before 2026-08-14 this passed.
        const list: any[] = fullList(24);
        list[10] = { name: 'Junk row', kcal100: null, protein100: null, carbs100: null, fat100: null };
        const c = { match: [['almond']], minItems: 14 };
        const r = scoreSearchCase(c, list);
        expect(r.pass).toBe(false);
        expect(r.detail).toContain('NULL-NUTRITION');
        expect(r.detail).toContain('Junk row');
        // POSITIVE CONTROL — the same list without the junk row.
        expect(scoreSearchCase(c, fullList(24)).pass).toBe(true);
    });

    it('search: requireEnergy FAILS a named food returned at a manufactured zero', () => {
        const list: any[] = fullList(24);
        // The live shape, verbatim from the box 2026-08-14: real name, all-zero macros,
        // fabricated portion. `nutritionMissing` cannot see it — assert that too, so a
        // future "just widen nutritionMissing" edit has to confront why this test exists.
        const whopper = {
            name: 'Whopper Jr.', kcal100: 0, protein100: 0, carbs100: 0, fat100: 0,
            servingOptions: [{ label: '100 g', grams: 100 }],
        };
        expect(nutritionMissing(whopper)).toBe(false);
        list[19] = whopper;
        const c = { match: [['almond']], minItems: 14, requireEnergy: [['whopper jr']] };
        const r = scoreSearchCase(c, list);
        expect(r.pass).toBe(false);
        expect(r.detail).toContain('ZERO-KCAL');
        expect(r.detail).toContain('Whopper Jr.');
    });

    it('search: requireEnergy passes once the row carries real energy', () => {
        const list: any[] = fullList(24);
        list[19] = {
            name: 'Whopper Jr.', kcal100: 200, protein100: 8.82, carbs100: 17.65, fat100: 10.59,
            servingOptions: [{ label: '1 serving', grams: 170 }], portionEstimated: true,
        };
        const c = { match: [['almond']], minItems: 14, requireEnergy: [['whopper jr']] };
        expect(scoreSearchCase(c, list).pass).toBe(true);
    });

    it('search: requireEnergy is FAIL-CLOSED when the named food is absent entirely', () => {
        // Otherwise "stop returning the row" would silence the assertion — the cheapest
        // wrong fix for a zero-kcal row, and the one this must not reward.
        const c = { match: [['almond']], minItems: 14, requireEnergy: [['whopper jr']] };
        const r = scoreSearchCase(c, fullList(24));
        expect(r.pass).toBe(false);
        expect(r.detail).toContain('NO-ENERGY-CANDIDATE');
    });

    it('search: an all-zero hit NOT named by requireEnergy still passes', () => {
        // THE REFUTED ALTERNATIVE. A global "all-zero macros == missing" rule reds
        // s-edge-03 ("water") and s-sem-04 ("zero sugar soda") permanently, because
        // 0/0/0/0 is a complete and correct panel for those foods. Measured on the box
        // 2026-08-14: 16 such rows survive across 4 cases even after the chain-record
        // defect is fixed. This test pins that they are allowed through.
        const list: any[] = fullList(24);
        list[21] = {
            name: 'Tap Water', kcal100: 0, protein100: 0, carbs100: 0, fat100: 0,
            servingOptions: [{ label: '1 cup', grams: 237 }],
        };
        expect(scoreSearchCase({ match: [['almond']], minItems: 14 }, list).pass).toBe(true);
    });

    it('search: a short list cannot LAUNDER a wrong winner into a pass', () => {
        // Both defects at once. The floor must not overwrite the match verdict with a
        // friendlier one, and neither check may mask the other.
        const c = { match: [['almond']], minItems: 14 };
        const r = scoreSearchCase(c, [{ name: 'Peanut butter', kcal100: 600 }]);
        expect(r.pass).toBe(false);
        expect(r.detail).toContain('LIST TOO SHORT');
    });

    it('drift: itemCount collapse on a pinned case is reported', () => {
        const was: BaselineEntry = { foodId: 'off:1', itemCount: 24 };
        expect(describeDrift(was, { foodId: 'off:1', itemCount: 3 })
            .some(s => s.includes('itemCount'))).toBe(true);
        // Zero is the degenerate shape and must always register.
        expect(describeDrift(was, { foodId: 'off:1', itemCount: 0 })
            .some(s => s.includes('itemCount'))).toBe(true);
        // POSITIVE CONTROL — ordinary corpus churn is not drift.
        expect(describeDrift(was, { foodId: 'off:1', itemCount: 23 })).toEqual([]);
    });

    it('baseline refresh PRESERVES pins the run did not observe', () => {
        // The real shape: 15 pins stored, 13 of them nlp, and `--only search` observes 2.
        const stored: Record<string, BaselineEntry> = {
            's-typo-08': { foodId: 'off:old', itemCount: 20 },
            'n-cook-06': { foodId: 'oats', kcal100: 361 },
            'n-mq-38': { foodId: 'burrito', kcal100: 166 },
        };
        const m = mergeBaseline(stored, { 's-typo-08': { foodId: 'off:new', itemCount: 22 } });
        expect(m.cases['s-typo-08'].foodId).toBe('off:new');   // refreshed
        expect(m.cases['n-cook-06']).toEqual(stored['n-cook-06']); // untouched, not deleted
        expect(m.cases['n-mq-38']).toEqual(stored['n-mq-38']);
        expect(Object.keys(m.cases)).toHaveLength(3);
        expect(m.refreshed).toBe(1);
        expect(m.preserved).toBe(2);
    });

    it('a refresh that observed NOTHING does not empty the baseline', () => {
        // `--grep` matching nothing is the same input shape as a total outage. Emptying
        // the file here would exempt every pin from drift forever, silently.
        const stored: Record<string, BaselineEntry> = { 'n-cook-06': { foodId: 'oats' } };
        const m = mergeBaseline(stored, {});
        expect(m.cases).toEqual(stored);
        expect(m.refreshed).toBe(0);
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

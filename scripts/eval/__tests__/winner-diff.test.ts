/**
 * winner-diff.test.ts — the parts of the winner-diff harness that have a right and
 * a wrong answer, pinned against fixtures.
 *
 * NO DATABASE, NO NETWORK. It imports only ./winner-diff-screens, which by
 * construction touches nothing under src/lib. Importing ../winner-diff would
 * construct a PrismaClient and force env flags at module load — that is exactly the
 * shape of untestability that let the abstention hole in run-eval.ts survive.
 *
 * WHAT THIS FILE DOES NOT COVER, stated so nobody mistakes green for proven:
 *   - the TRANSCRIPTION in winner-diff.ts section 9. Only `winner-diff verify`
 *     (real mapper, real pool, foodId compare) can test that, and it needs the box.
 *   - the drift hashes. They are a change detector over a file this test cannot see
 *     without pinning a hash that would break on every unrelated caller edit.
 *   - snapshot capture. It requires Typesense, FatSecret and the LLM.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
    ATWATER_BAND,
    CLASS_NOUNS,
    GoldenCase,
    NoiseFloorLedger,
    NoiseFloorReceipt,
    PanelLike,
    ReplayFile,
    ReplayRow,
    SelectionPath,
    WinnerInfo,
    assertedBands,
    atwaterInconsistent,
    atwaterRatio,
    checkGoldenBands,
    classifyOrigin,
    classifyVerdict,
    counterfactualSummary,
    deltaHistogram,
    extraClassNouns,
    findReceipt,
    formatGoldenScreen,
    gateReasonHistogram,
    goldenCoverage,
    isDeterministicSingleItemText,
    isSingleIngredientCase,
    isTokenSorted,
    kcalDeltaPct,
    noiseGate,
    originSplit,
    parseGoldenSet,
    parseQueryFile,
    pathHistogram,
    rowHasMovement,
    runGoldenScreen,
    runScreens,
    structurallyBlindBands,
    windowChurn,
    windowChurnIsMeaningless,
} from '../winner-diff-screens';

// ============================================================
// fixtures
// ============================================================

function panel(kcal: number, protein = 0, carbs = 0, fat = 0, per100g = true): PanelLike {
    return { kcal, protein, carbs, fat, per100g };
}

function win(id: string, name: string, p: PanelLike | null = panel(100, 5, 10, 4), extra: Partial<WinnerInfo> = {}): WinnerInfo {
    return {
        foodId: id,
        foodName: name,
        brandName: null,
        source: 'openfoodfacts',
        kcalPer100g: p && p.per100g ? p.kcal : null,
        panel: p,
        confidence: 0.9,
        selectionReason: 'rerank',
        indexInFiltered: 0,
        inTop10: true,
        inRerankWindow: true,
        ...extra,
    };
}

function row(q: string, winner: WinnerInfo | null, over: Partial<ReplayRow> = {}): ReplayRow {
    return {
        query: q,
        path: (winner ? 'rerank' : 'no_winner_rerank_declined') as SelectionPath,
        relaxedRecovery: false,
        pool: {
            gather: 40, afterTokenFilter: 20, afterCoreToken: 18, afterZeroMacro: 18,
            afterPlausibility: 17, afterDenylist: 17, admitted: 17, rerankWindow: 10,
        },
        rerankWindowIds: ['a', 'b', 'c'],
        admittedIds: ['a', 'b', 'c'],
        rerankRan: true,
        gate: { skipAiRerank: false, reason: 'margin_too_small (0.010 < 0.150)', confidence: 0.9 },
        winner,
        notes: [],
        ...over,
    };
}

function replayFile(over: Partial<ReplayFile> = {}): ReplayFile {
    return {
        kind: 'winner-diff/replay',
        version: 1,
        label: 'A',
        variant: 'baseline',
        ranAt: '2026-07-26T00:00:00.000Z',
        gitHead: 'abc1234',
        gitDirty: 'deadbeef',
        snapshotTakenAt: '2026-07-26T00:00:00.000Z',
        snapshotPopulation: '--from-file fixtures',
        callerHash: 'cafe',
        helpersHash: 'babe',
        rows: [],
        ...over,
    };
}

function receipt(over: Partial<NoiseFloorReceipt> = {}): NoiseFloorReceipt {
    return {
        kind: 'winner-diff/noise-floor',
        version: 1,
        ranAt: '2026-07-26T01:00:00.000Z',
        snapshotTakenAt: '2026-07-26T00:00:00.000Z',
        gitHead: 'abc1234',
        gitDirty: 'deadbeef',
        variant: 'baseline',
        rows: 40,
        winnerDiffs: 0,
        pathDiffs: 0,
        ...over,
    };
}

function ledger(...rs: NoiseFloorReceipt[]): NoiseFloorLedger {
    return { kind: 'winner-diff/noise-floor-ledger', version: 1, receipts: rs };
}

// ============================================================
// 1. verdict table — the measurement the harness exists to produce
// ============================================================

describe('classifyVerdict', () => {
    it('reports a moved winner as WINNER-CHANGED', () => {
        expect(classifyVerdict(row('q', win('x', 'X')), row('q', win('y', 'Y')))).toBe('WINNER-CHANGED');
    });

    it('distinguishes both directions of appearing/disappearing winners', () => {
        expect(classifyVerdict(row('q', null), row('q', win('y', 'Y')))).toBe('NOWINNER->WINNER');
        expect(classifyVerdict(row('q', win('x', 'X')), row('q', null))).toBe('WINNER->NOWINNER');
    });

    it('reports the same food reached by a different path as PATH-CHANGED, not SAME', () => {
        const a = row('q', win('x', 'X'), { path: 'confidence_gate_early_exit' });
        const b = row('q', win('x', 'X'), { path: 'rerank' });
        expect(classifyVerdict(a, b)).toBe('PATH-CHANGED');
    });

    it('treats relaxed-recovery flips as PATH-CHANGED even when the winner holds', () => {
        const a = row('q', win('x', 'X'), { relaxedRecovery: true });
        const b = row('q', win('x', 'X'), { relaxedRecovery: false });
        expect(classifyVerdict(a, b)).toBe('PATH-CHANGED');
    });

    it('is SAME only when identity AND path AND recovery all hold', () => {
        expect(classifyVerdict(row('q', win('x', 'X')), row('q', win('x', 'X')))).toBe('SAME');
    });

    it('errors on either side dominate', () => {
        expect(classifyVerdict(row('q', win('x', 'X'), { path: 'replay_error' }), row('q', win('x', 'X')))).toBe('ERROR');
        expect(classifyVerdict(row('q', win('x', 'X')), row('q', win('x', 'X'), { path: 'snapshot_failed' }))).toBe('ERROR');
    });
});

describe('movement detection (HARD RULE: measure winners, but surface silent churn)', () => {
    it('flags an unchanged winner whose admitted pool moved', () => {
        const a = row('q', win('x', 'X'));
        const b = row('q', win('x', 'X'), { pool: { ...a.pool, admitted: 18 } });
        expect(classifyVerdict(a, b)).toBe('SAME');
        expect(rowHasMovement(a, b)).toBe(true);
    });

    it('flags an unchanged winner whose rerank window churned', () => {
        const a = row('q', win('x', 'X'), { rerankWindowIds: ['a', 'b'] });
        const b = row('q', win('x', 'X'), { rerankWindowIds: ['a', 'z'] });
        expect(rowHasMovement(a, b)).toBe(true);
        expect(windowChurn(a, b)).toEqual({ evicted: ['b'], added: ['z'] });
    });

    it('suppresses the eviction claim across a gate flip, where the window was never built', () => {
        const a = row('q', win('x', 'X'), { rerankRan: false, rerankWindowIds: [] });
        const b = row('q', win('x', 'X'), { rerankRan: true, rerankWindowIds: ['a', 'b'] });
        expect(windowChurnIsMeaningless(a, b)).toBe(true);
        expect(windowChurnIsMeaningless(row('q', null), row('q', null))).toBe(false);
    });
});

// ============================================================
// 2. gate-reason histogram — the 6x misread
// ============================================================

describe('gateReasonHistogram', () => {
    it('separates firings from declines, and derives firing from skipAiRerank not from a reason list', () => {
        const rows = [
            row('a', win('1', 'A'), { gate: { skipAiRerank: false, reason: 'margin_too_small (0.01 < 0.15)', confidence: 0.9 } }),
            row('b', win('2', 'B'), { gate: { skipAiRerank: false, reason: 'margin_too_small (0.02 < 0.15)', confidence: 0.9 } }),
            row('c', win('3', 'C'), { gate: { skipAiRerank: false, reason: 'confidence_below_threshold (0.4 < 0.8)', confidence: 0.4 } }),
            row('d', win('4', 'D'), { gate: { skipAiRerank: true, reason: 'high_confidence_clear_winner', confidence: 0.95 } }),
            row('e', win('5', 'E'), { gate: { skipAiRerank: true, reason: 'basic_produce_bypass', confidence: 1 } }),
            // a firing reason that did NOT occur in the original read; a hardcoded
            // reason list would have silently dropped it from the firing bucket.
            row('f', win('6', 'F'), { gate: { skipAiRerank: true, reason: 'yeast_variant_preference', confidence: 0.95 } }),
        ];
        const h = gateReasonHistogram(rows);
        expect(h.firingTotal).toBe(3);
        expect(h.nonFiringTotal).toBe(3);
        expect(h.firing.map(([k]) => k).sort()).toEqual(['basic_produce_bypass', 'high_confidence_clear_winner', 'yeast_variant_preference']);
        // the parenthesised measurement is stripped so the reasons group
        expect(h.nonFiring.find(([k]) => k === 'margin_too_small')![1]).toBe(2);
    });

    it('pathHistogram is sorted by frequency', () => {
        const rows = [row('a', win('1', 'A')), row('b', win('2', 'B')), row('c', null, { path: 'no_winner_all_filtered' })];
        expect(pathHistogram(rows)[0]).toEqual(['rerank', 2]);
    });
});

// ============================================================
// 3. screens
// ============================================================

describe('atwater screen', () => {
    it('computes (4P+4C+9F)/kcal and flags outside the band', () => {
        expect(atwaterRatio(panel(100, 10, 10, 20 / 9))!).toBeCloseTo(1.0, 3);
        expect(atwaterRatio(null)).toBeNull();
        expect(atwaterRatio(panel(0, 10, 10, 10))).toBeNull();  // kcal 0 is not a ratio
        expect(atwaterInconsistent(panel(100, 0, 0, 0))).toBe(true);       // ratio 0
        expect(atwaterInconsistent(panel(100, 10, 10, 20 / 9))).toBe(false);
        expect(ATWATER_BAND).toBe(0.25);
    });
});

describe('class-drift screen', () => {
    it('fires when the winner name carries a food-class noun the query never used', () => {
        expect(extraClassNouns('subway cold cut combo', 'Cold Cut Combo Salad')).toEqual(['salad']);
    });

    it('does NOT fire when the query itself asked for that class', () => {
        expect(extraClassNouns('chicken salad', 'Chicken Salad')).toEqual([]);
    });

    it('every CLASS_NOUN is a lowercase food-class noun, and the list is deduplicated', () => {
        expect(new Set(CLASS_NOUNS).size).toBe(CLASS_NOUNS.length);
        for (const n of CLASS_NOUNS) expect(n).toBe(n.toLowerCase());
        expect(CLASS_NOUNS.length).toBeGreaterThanOrEqual(48);
    });
});

describe('kcal delta histogram', () => {
    it('is a > threshold histogram with median/mean/max', () => {
        const h = deltaHistogram([1, 6, 11, 51, 201]);
        expect(h.n).toBe(5);
        expect(h.buckets.find(b => b.threshold === 0)!.count).toBe(5);
        expect(h.buckets.find(b => b.threshold === 5)!.count).toBe(4);
        expect(h.buckets.find(b => b.threshold === 50)!.count).toBe(2);
        expect(h.buckets.find(b => b.threshold === 200)!.count).toBe(1);
        expect(h.median).toBe(11);
        expect(h.max).toBe(201);
    });

    it('survives an empty input rather than dividing by zero', () => {
        const h = deltaHistogram([]);
        expect(h.n).toBe(0);
        expect(h.median).toBeNull();
        expect(h.buckets.every(b => b.pct === 0)).toBe(true);
    });

    it('kcalDeltaPct refuses to divide by a zero baseline', () => {
        expect(kcalDeltaPct(win('a', 'A', panel(0)), win('b', 'B', panel(50)))).toBeNull();
        expect(kcalDeltaPct(win('a', 'A', panel(100)), win('b', 'B', panel(150)))).toBeCloseTo(50);
        expect(kcalDeltaPct(win('a', 'A', null), win('b', 'B', panel(150)))).toBeNull();
    });
});

describe('runScreens', () => {
    const pairs = [
        // identical pick — excluded from every screen
        { query: 'apple', a: win('1', 'Apple'), b: win('1', 'Apple') },
        // B drifted to a different class AND doubled kcal
        { query: 'subway cold cut combo', a: win('2', 'Cold Cut Combo', panel(70, 5, 5, 4)), b: win('3', 'Cold Cut Combo Salad', panel(15, 1, 2, 0.5)) },
        // A's panel violates Atwater, B's does not
        { query: 'greek yogurt', a: win('4', 'Greek Yogurt', panel(100, 0, 0, 0)), b: win('5', 'Greek Yoghurt', panel(100, 10, 10, 20 / 9)) },
        // B picked nothing
        { query: 'ghost cinnamon roll', a: win('6', 'Ghost Whey'), b: null },
    ];

    it('counts disagreements, one-sided picks and the direction split', () => {
        const s = runScreens(pairs, 'GATE', 'RERANK');
        expect(s.disagreements).toBe(2);
        expect(s.aOnly).toBe(1);   // "B picked nothing" is NOT a disagreement
        expect(s.bOnly).toBe(0);
        expect(s.neither).toBe(0);
        // The cold-cut pair moved 70 -> 15 kcal (A higher). The yogurt pair is a
        // different RECORD at the same 100 kcal, so it lands in `equal` — a record
        // swap with no kcal movement still has to be counted somewhere.
        expect(s.direction).toEqual({ aLower: 0, aHigher: 1, equal: 1 });
        expect(s.delta.n).toBe(2);
    });

    it('attributes class drift to the right side and sorts the worst list by |kcal delta|', () => {
        const s = runScreens(pairs, 'GATE', 'RERANK');
        expect(s.classDrift.onlyB).toBe(1);
        expect(s.classDrift.onlyA).toBe(0);
        expect(s.classDrift.worstB[0].nouns).toEqual(['salad']);
    });

    it('attributes Atwater inconsistency to the right side', () => {
        const s = runScreens(pairs, 'GATE', 'RERANK');
        expect(s.atwater.onlyA).toBe(1);
        expect(s.atwater.onlyB).toBe(0);
    });

    it('counts no-panel winners per side — an asymmetry that can run against the change', () => {
        const s = runScreens([
            { query: 'x', a: win('1', 'A', panel(100)), b: win('2', 'B', null) },
            { query: 'y', a: win('3', 'C', panel(100)), b: win('4', 'D', null) },
        ]);
        expect(s.noPanel).toEqual({ a: 0, b: 2 });
    });
});

// ============================================================
// 4. noise-floor gate — it must actually REFUSE
// ============================================================

describe('noiseGate', () => {
    const A = replayFile({ label: 'BASE', gitDirty: 'aaaa1111' });
    const B = replayFile({ label: 'BRANCH', gitDirty: 'bbbb2222' });

    it('passes only with a zero receipt for BOTH trees', () => {
        const led = ledger(receipt({ gitDirty: 'aaaa1111' }), receipt({ gitDirty: 'bbbb2222' }));
        expect(noiseGate(led, A, B, { crossSnapshot: false }).ok).toBe(true);
    });

    it('refuses when a receipt is missing, and names which side', () => {
        const led = ledger(receipt({ gitDirty: 'aaaa1111' }));
        const v = noiseGate(led, A, B, { crossSnapshot: false });
        expect(v.ok).toBe(false);
        expect(v.problems.join(' ')).toContain('side B');
    });

    it('refuses when the receipt exists but is NON-ZERO', () => {
        const led = ledger(receipt({ gitDirty: 'aaaa1111' }), receipt({ gitDirty: 'bbbb2222', winnerDiffs: 2 }));
        const v = noiseGate(led, A, B, { crossSnapshot: false });
        expect(v.ok).toBe(false);
        expect(v.problems.join(' ')).toContain('NON-ZERO');
    });

    it('refuses entirely when there is no ledger at all', () => {
        expect(noiseGate(null, A, B, { crossSnapshot: false }).ok).toBe(false);
    });

    it('refuses a cross-snapshot diff unless it is asked for explicitly', () => {
        const A2 = replayFile({ gitDirty: 'aaaa1111', snapshotTakenAt: '2026-07-26T00:00:00.000Z' });
        const B2 = replayFile({ gitDirty: 'bbbb2222', snapshotTakenAt: '2026-07-26T00:05:00.000Z' });
        const led = ledger(
            receipt({ gitDirty: 'aaaa1111', snapshotTakenAt: '2026-07-26T00:00:00.000Z' }),
            receipt({ gitDirty: 'bbbb2222', snapshotTakenAt: '2026-07-26T00:05:00.000Z' }),
        );
        const strict = noiseGate(led, A2, B2, { crossSnapshot: false });
        expect(strict.ok).toBe(false);
        expect(strict.problems.join(' ')).toContain('DIFFERENT snapshots');
        expect(noiseGate(led, A2, B2, { crossSnapshot: true }).ok).toBe(true);
    });

    it('will not accept a receipt taken against a different snapshot or variant', () => {
        expect(findReceipt(ledger(receipt()), 'OTHER-TIME', 'deadbeef', 'baseline')).toBeNull();
        expect(findReceipt(ledger(receipt()), '2026-07-26T00:00:00.000Z', 'deadbeef', 'gate-backstop')).toBeNull();
        expect(findReceipt(ledger(receipt()), '2026-07-26T00:00:00.000Z', 'deadbeef', 'baseline')).not.toBeNull();
    });
});

// ============================================================
// 5. populations
// ============================================================

describe('parseQueryFile', () => {
    it('strips comments and blanks, keeps order', () => {
        expect(parseQueryFile('# note\n\n 200g chicken breast \n1 apple\n')).toEqual(['200g chicken breast', '1 apple']);
    });
});

describe('origin tagging (population contamination)', () => {
    it('tags a token-sorted 100g-prefixed line as warmer-shaped', () => {
        // Both of these are real cache-parity-sweep lines: "100g " + a token-SORTED
        // FoodMapping key. They read like gibberish precisely because word order was
        // destroyed by the key, which is why they exercise different filters than a
        // sentence a user types (deriveMustHaveTokens is order-sensitive).
        expect(classifyOrigin('100g debbie little roll swiss')).toBe('warmer');
        expect(classifyOrigin('100g bar big colossal met rx')).toBe('warmer');
        expect(classifyOrigin('2 eggs and toast')).toBe('user');
        // A 100g-prefixed line whose tokens are NOT sorted is a real measurement request.
        expect(classifyOrigin('100g chicken breast')).toBe('user');
        expect(classifyOrigin('100g chicken')).toBe('user');  // single token: not evidence
    });

    it('isTokenSorted needs at least two tokens', () => {
        expect(isTokenSorted('apple')).toBe(false);
        expect(isTokenSorted('apple banana')).toBe(true);
        expect(isTokenSorted('banana apple')).toBe(false);
    });

    it('originSplit reports a percentage that a report can print', () => {
        const s = originSplit(['100g a b c', 'two eggs', '100g c b a']);
        expect(s.warmer).toBe(1);
        expect(s.user).toBe(2);
        expect(s.warmerPct).toBeCloseTo(33.3, 1);
    });
});

const GOLDEN_PATH = path.join(__dirname, '..', 'golden-set.json');
const GOLDEN_RAW = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

/** A GoldenCase built by hand. Defaults are the single-ingredient shape. */
function gcase(over: Partial<GoldenCase> = {}): GoldenCase {
    return {
        id: 'n-gen-01',
        category: 'generic_staples',
        rawText: '200g chicken breast',
        expectName: [['chicken']],
        shape: 'item',
        deterministicSingleItem: true,
        ...over,
    };
}

describe('parseGoldenSet', () => {
    it('reads the {_readme, search, nlp} OBJECT shape — reading it as an array yields nothing', () => {
        expect(Array.isArray(GOLDEN_RAW)).toBe(false);
        const cases = parseGoldenSet(GOLDEN_RAW);
        expect(cases.length).toBeGreaterThan(100);
        expect(cases.every(c => c.shape === 'item')).toBe(true);
        expect(cases.find(c => c.id === 'n-gen-01')!.rawText).toBe('200g chicken breast');
    });

    it('excludes multi-item `text` lines by default and includes them on request', () => {
        const single = parseGoldenSet(GOLDEN_RAW);
        const all = parseGoldenSet(GOLDEN_RAW, { includeMultiItem: true });
        expect(all.length).toBeGreaterThan(single.length);
        expect(all.some(c => c.shape === 'text')).toBe(true);
    });

    it('throws rather than silently returning an empty population on the wrong shape', () => {
        expect(() => parseGoldenSet([{ id: 'x' }])).toThrow(/nlp/);
    });

    /**
     * NON-VACUITY: the previous GoldenCase carried `expectName` and `macros` only, so
     * every count below except those two was ZERO — `grams`, `total` and `expectItems`
     * were dropped on the floor by the parser and could not be asserted on at all.
     * These are the numbers re-derived directly from golden-set.json on 2026-07-26; if
     * the corpus changes, this test is where the screen's coverage claim is renewed.
     */
    it('carries EVERY assertion kind run-eval supports, at the counts the corpus actually has', () => {
        const all = parseGoldenSet(GOLDEN_RAW, { includeMultiItem: true });
        const nlp = (GOLDEN_RAW as { nlp: Array<Record<string, unknown>> }).nlp;
        expect(all.length).toBe(nlp.length);
        // 245 since 2026-08-12: n-mq-48/49, the adjectival-egg parser-gate cases
        // (egg noodles: expectName + grams; egg salad sandwich: expectName only).
        expect(all.length).toBe(245);

        const n = (pred: (c: GoldenCase) => boolean) => all.filter(pred).length;
        expect(n(c => c.expectName.length > 0)).toBe(245);
        expect(n(c => !!c.grams)).toBe(149);              // the majority assertion; 149 since 2026-08-12 (n-mq-48)
        expect(n(c => !!c.macros)).toBe(65);
        expect(n(c => typeof c.expectItems === 'number')).toBe(47);
        // 36 since 2026-08-04: n-cook-03 gained a total band, because its scale-free
        // kcal100/carbs100 were passing on a 240 g / 295 kcal bill against USDA's
        // 172 g / 227 kcal. Adding one here also adds one to the `total` blind count
        // below — this screen cannot judge totals at all.
        // 37 since 2026-08-07: n-mq-34 gained total.calories [130,160] (its fat100
        // band alone could not distinguish the two recorded arms; see its note).
        expect(n(c => !!c.total)).toBe(37);
        // documented in _readme, no live case uses them — parsed anyway so the screen
        // does not go blind the moment one is added back
        expect(n(c => !!c.forbidName)).toBe(0);
        expect(n(c => c.expectAbstain === true)).toBe(0);
        expect(n(c => typeof c.maxConfidence === 'number')).toBe(0);
        // no case asserts nothing at all
        expect(n(c => assertedBands(c).length === 0)).toBe(0);
        // 38 assert a name and no numeric band — the population the _readme names.
        // Was 47 before PR #167 added calorie bands; those 10 are the whole point of
        // that PR, and this line is the receipt that they landed. 38 since
        // 2026-08-12: n-mq-49 is deliberately identity-only — its key is virgin
        // post-fix and no record serving has been measured to band against (its
        // notes carry the add-a-band-once-measured instruction).
        expect(n(c => !c.grams && !c.total && !c.macros)).toBe(38);

        // split by shape: `--golden` replays item-shaped cases unless --include-multi-item
        const item = all.filter(c => c.shape === 'item');
        const text = all.filter(c => c.shape === 'text');
        expect([item.length, text.length]).toEqual([162, 83]);
        expect(item.filter(c => c.grams).length).toBe(118);
        expect(item.filter(c => c.macros).length).toBe(47);
        // 17 since 2026-08-07: n-mq-34 (item shape) gained a total.calories band.
        expect(item.filter(c => c.total).length).toBe(17);
        expect(text.filter(c => c.grams).length).toBe(31);
        expect(text.filter(c => typeof c.expectItems === 'number').length).toBe(47);

        // and the individual bands survive the round-trip
        expect(all.find(c => c.id === 'n-qty-04')!.grams).toEqual([24, 120]);
        expect(all.find(c => c.id === 'n-qty-08')!.grams).toEqual([240, 500]);
        expect(all.find(c => c.id === 'n-qty-09')!.grams).toEqual([480, 1100]);
        expect(all.find(c => c.id === 'n-serv-39')!.total).toEqual({ calories: [60, 180] });
        expect(all.find(c => c.id === 'n-serv-14')!.unit).toBe('tsp');
    });
});

/**
 * NON-VACUITY: this function did not exist. Without it every `text` case would have
 * to be either evaluated (wrong for a segmenter line) or blanket-skipped (wrong for
 * "7up"), and the three cases named in the defect report — n-qty-04/08/09 — are all
 * `text`-shaped, so a blanket skip would have hidden them a second time.
 */
describe('isDeterministicSingleItemText (mirror of route.ts singleItemFromText)', () => {
    it('accepts the short separator-free lines the route maps WITHOUT the segmenter', () => {
        expect(isDeterministicSingleItemText('7up')).toBe(true);
        expect(isDeterministicSingleItemText('2 7up')).toBe(true);
        expect(isDeterministicSingleItemText('three slices of bacon')).toBe(true);
        expect(isDeterministicSingleItemText('chicken breast for lunch')).toBe(true);  // meal suffix stripped
    });

    it('rejects everything the route hands to the LLM segmenter', () => {
        expect(isDeterministicSingleItemText('2 eggs and toast')).toBe(false);   // "and"
        expect(isDeterministicSingleItemText('coffee, bagel')).toBe(false);      // comma
        expect(isDeterministicSingleItemText('a b c d e f g')).toBe(false);      // > 6 words
        expect(isDeterministicSingleItemText('x'.repeat(61))).toBe(false);       // > 60 chars
        expect(isDeterministicSingleItemText('   ')).toBe(false);
        expect(isDeterministicSingleItemText('for lunch')).toBe(false);          // nothing left after the suffix
    });

    it('agrees with the corpus: every item-shaped case is single-item by construction', () => {
        const all = parseGoldenSet(GOLDEN_RAW, { includeMultiItem: true });
        expect(all.filter(c => c.shape === 'item').every(c => c.deterministicSingleItem)).toBe(true);
        expect(all.find(c => c.id === 'n-qty-08')!.deterministicSingleItem).toBe(true);
    });

    /**
     * The flag is optional so a hand-built case cannot become a compile error in the
     * runner. An omitted flag must therefore default the SAFE way: unjudgeable, not
     * silently judged. This is the same failure mode as the grams band, one level up.
     */
    it('defaults an unspecified `text` case to segmenter-bound rather than judgeable', () => {
        const c: GoldenCase = { id: 'x', category: 'x', rawText: '2 eggs and toast', expectName: [['egg']], shape: 'text' };
        expect(isSingleIngredientCase(c)).toBe(false);
        expect(checkGoldenBands(c, win('1', 'Eggs')).verdict).toBe('UNKNOWN');
        expect(isSingleIngredientCase({ ...c, shape: 'item', rawText: '2 eggs' })).toBe(true);
    });
});

describe('checkGoldenBands (HARD RULE 6: assert the right answer)', () => {
    const c = gcase({ macros: { protein100: [15, 40] } });

    it('passes a winner that satisfies the positive expectation', () => {
        expect(checkGoldenBands(c, win('1', 'Chicken Breast', panel(165, 31, 0, 3.6))).verdict).toBe('PASS');
    });

    it('FAILS a winner that moved to a different wrong food, not just a named wrong brand', () => {
        const v = checkGoldenBands(c, win('2', 'Turkey Breast', panel(135, 30, 0, 1)));
        expect(v.verdict).toBe('FAIL');
        expect(v.failures[0]).toContain('expectName');
    });

    it('FAILS a macro band violation even when the name matches', () => {
        const v = checkGoldenBands(c, win('3', 'Chicken Broth', panel(5, 1, 0, 0)));
        expect(v.verdict).toBe('FAIL');
        expect(v.failures.join(' ')).toContain('protein100');
    });

    it('reports UNKNOWN, not PASS, when the band cannot be measured', () => {
        const v = checkGoldenBands(c, win('4', 'Chicken Breast', null));
        expect(v.verdict).toBe('UNKNOWN');
    });

    it('a total abstention is a FAIL, never a pass', () => {
        expect(checkGoldenBands(c, null).verdict).toBe('FAIL');
    });
});

// ============================================================
// 5b. THE BLINDNESS THIS SECTION EXISTS TO REMOVE
//
// Every test below FAILS against the pre-2026-07-26 implementation, in which
// GoldenCase carried `expectName` + `macros` only and checkGoldenBands returned a
// clean PASS for any winner whose NAME matched — regardless of the grams/total/
// expectItems band the case actually asserted. 148 of 243 nlp cases assert grams.
// ============================================================

describe('grams / total / expectItems are reported UNKNOWN, never silently satisfied', () => {
    /**
     * NON-VACUITY: old code ignored `grams` entirely, so this returned PASS. The whole
     * defect is that PASS -> PASS across a winner move reads as "nothing changed".
     */
    it('a grams band makes the verdict UNKNOWN even when the name matches perfectly', () => {
        const v = checkGoldenBands(gcase({ grams: [24, 120] }), win('1', 'Chicken Breast'));
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.blind).toEqual(['grams']);
        expect(v.violations).toEqual([]);
        expect(v.notEvaluable.join(' ')).toMatch(/grams comes from serving resolution/);
        expect(v.failures.join(' ')).toContain('NOT-EVALUABLE');
    });

    /** NON-VACUITY: `total` was not even a field on GoldenCase. */
    it('a total band is UNKNOWN — total = panel x grams/100 and grams is not resolved', () => {
        const v = checkGoldenBands(gcase({ total: { calories: [60, 180] } }), win('1', 'Chicken Breast'));
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.blind).toEqual(['total']);
    });

    /** NON-VACUITY: `expectItems` was not a field either. */
    it('an expectItems band is UNKNOWN — a single-query replay never runs the segmenter', () => {
        const v = checkGoldenBands(gcase({ expectItems: 2 }), win('1', 'Chicken Breast'));
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.blind).toEqual(['expectItems']);
    });

    /**
     * A judged band still fails loudly while an unjudgeable one sits beside it — a
     * blind band must not launder a real violation into UNKNOWN.
     */
    it('a real violation still wins over an unjudgeable band', () => {
        const v = checkGoldenBands(gcase({ grams: [24, 120] }), win('1', 'Turkey Breast'));
        expect(v.verdict).toBe('FAIL');
        expect(v.blind).toEqual(['grams']);
    });

    /**
     * NON-VACUITY: old code did `if (v === undefined) continue` on an unrecognised
     * macro key, so a band on `fiber100` — which the replay panel cannot carry —
     * silently produced PASS. Same class of bug, one field over.
     */
    it('a macro band on a key the replay panel does not carry is UNKNOWN, not skipped', () => {
        const v = checkGoldenBands(gcase({ macros: { fiber100: [1, 5] } }), win('1', 'Chicken Breast', panel(165, 31, 0, 3.6)));
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.blind).toEqual(['macros']);
    });

    it('a mixed macro band judges what it can and says which key it did not', () => {
        const v = checkGoldenBands(
            gcase({ macros: { kcal100: [100, 200], fiber100: [1, 5] } }),
            win('1', 'Chicken Breast', panel(165, 31, 0, 3.6)),
        );
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.violations).toEqual([]);
        expect(v.notEvaluable.join(' ')).toContain('fiber100');
        // and the measurable half is genuinely enforced
        expect(checkGoldenBands(
            gcase({ macros: { kcal100: [100, 200], fiber100: [1, 5] } }),
            win('1', 'Chicken Breast', panel(500, 31, 0, 3.6)),
        ).verdict).toBe('FAIL');
    });

    /**
     * NON-VACUITY: old code evaluated a multi-item `text` case's expectName against
     * the single replayed winner, which is a different function from the one run-eval
     * asserts on ("any of items[] matches").
     */
    it('a segmenter-bound `text` case is blind end to end, but a route-bypassed one is not', () => {
        const seg = gcase({ id: 'n-seg-01', rawText: '2 eggs and toast', shape: 'text', deterministicSingleItem: false, expectItems: 2 });
        const v = checkGoldenBands(seg, win('1', 'Eggs'));
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.blind.sort()).toEqual(['expectItems', 'expectName']);

        const bypassed = gcase({ id: 'n-qty-08', rawText: '7up', shape: 'text', deterministicSingleItem: true, expectName: [['7up']] });
        expect(checkGoldenBands(bypassed, win('1', '7UP Soda')).verdict).toBe('PASS');
        expect(checkGoldenBands(bypassed, win('1', 'Sprite')).verdict).toBe('FAIL');
    });
});

describe('the assertion kinds run-eval supports that the screen never consulted', () => {
    /** NON-VACUITY: forbidName was deliberately unread; a winner landing on a forbidden record scored PASS. */
    it('forbidName is a CONJUNCT — it can add a failure, never manufacture a pass', () => {
        const c = gcase({ forbidName: [["mary's"]] });
        expect(checkGoldenBands(c, win('1', 'Chicken Breast', panel(165, 31, 0, 3.6), { brandName: "Mary's Chicken" })).verdict).toBe('FAIL');
        expect(checkGoldenBands(c, win('2', 'Chicken Breast', panel(165, 31, 0, 3.6), { brandName: 'Great Value' })).verdict).toBe('PASS');
        // forbid-only cases are never a clean PASS: not matching a wrong name is not
        // evidence the answer is right.
        const forbidOnly = gcase({ expectName: [], forbidName: [["mary's"]] });
        const v = checkGoldenBands(forbidOnly, win('3', 'Anything Else'));
        expect(v.verdict).toBe('UNKNOWN');
        expect(v.notEvaluable.join(' ')).toContain('WEAK ASSERTION');
    });

    /** NON-VACUITY: old code returned FAIL for EVERY null winner, so an expectAbstain case could never pass. */
    it('expectAbstain is the one assertion a no-winner row satisfies', () => {
        const c = gcase({ expectAbstain: true, expectName: [] });
        expect(checkGoldenBands(c, null).verdict).toBe('PASS');
        const v = checkGoldenBands(c, win('1', 'Chipotle, Chicken'));
        expect(v.verdict).toBe('FAIL');
        expect(v.violations.join(' ')).toContain('expected abstention');
    });

    /** NON-VACUITY: maxConfidence was not a field; a cache-worthy confidence on a guess scored PASS. */
    it('maxConfidence is enforced against the winner confidence', () => {
        const c = gcase({ maxConfidence: 0.6 });
        expect(checkGoldenBands(c, win('1', 'Chicken Breast', panel(165), { confidence: 0.5 })).verdict).toBe('PASS');
        const v = checkGoldenBands(c, win('1', 'Chicken Breast', panel(165), { confidence: 0.95 }));
        expect(v.verdict).toBe('FAIL');
        expect(v.violations.join(' ')).toContain('maxConfidence');
    });
});

describe('structurallyBlindBands / goldenCoverage over the REAL corpus', () => {
    const all = parseGoldenSet(GOLDEN_RAW, { includeMultiItem: true });

    /**
     * NON-VACUITY: goldenCoverage did not exist, and the data it counts (grams/total/
     * expectItems) was not parsed. This is the table that replaces "no golden case
     * changed verdict" as the thing a reader is allowed to quote.
     */
    it('reports how much of the corpus this screen can and cannot judge', () => {
        const cov = goldenCoverage(all);
        const kind = (k: string) => cov.byKind.find(b => b.kind === k)!;
        // 245 / 149 since 2026-08-12: n-mq-48/49 (see the count pin above).
        expect(cov.cases).toBe(245);
        expect(kind('grams')).toEqual({ kind: 'grams', asserted: 149, blind: 149 });
        // 37 since 2026-08-07: n-mq-34's total.calories band (see the count pin above).
        expect(kind('total')).toEqual({ kind: 'total', asserted: 37, blind: 37 });
        expect(kind('expectItems')).toEqual({ kind: 'expectItems', asserted: 47, blind: 47 });
        // expectName is judgeable except on the segmenter-bound text lines
        const en = kind('expectName');
        expect(en.asserted).toBe(245);
        expect(en.blind).toBeGreaterThan(0);
        expect(en.blind).toBeLessThan(245);
        // every grams band in the corpus is unjudgeable here...
        expect(cov.gramsCases).toBe(149);
        // ...and only a handful would be record-INdependent even with a resolver,
        // i.e. the blindness sits exactly where a winner change moves the answer.
        expect(cov.gramsRecordIndependent).toBeLessThanOrEqual(5);
    });

    it('the item-only population (what `--golden` replays by default) is mostly blind too', () => {
        const cov = goldenCoverage(all.filter(c => c.shape === 'item'));
        // 162 / 118 since 2026-08-12: n-mq-48/49 are item-shaped; n-mq-48 carries grams.
        expect(cov.cases).toBe(162);
        expect(cov.byKind.find(b => b.kind === 'grams')).toEqual({ kind: 'grams', asserted: 118, blind: 118 });
        // 118 item cases assert grams + 17 assert a total, less the 9 that assert both.
        // The `total` term was 7 before PR #167 added calorie bands, 16 before
        // 2026-08-07 added n-mq-34's (an item case with a total and no grams band).
        expect(all.filter(c => c.shape === 'item' && c.grams && c.total).length).toBe(9);
        expect(cov.casesWithBlindBand).toBe(118 + 17 - 9);
    });

    it('an item case with only a name and a measurable macro band is fully judgeable', () => {
        expect(structurallyBlindBands(gcase({ macros: { protein100: [15, 40] } }))).toEqual([]);
    });
});

describe('runGoldenScreen — the population the old clearance line swallowed', () => {
    const c = gcase({ id: 'n-qty-08', rawText: '7up', shape: 'text', deterministicSingleItem: true, expectName: [['7up'], ['7 up']], grams: [240, 500] });
    const a = [row('7up', win('off_a', '7UP Soda 330ml'), { goldenId: 'n-qty-08' })];
    const b = [row('7up', win('off_b', '7UP Free 2L Bottle'))];

    /**
     * NON-VACUITY, and this is the exact reported defect. Under the old code both
     * sides returned PASS (name matches, grams invisible), reportGoldenBands compared
     * `va.verdict !== vb.verdict`, saw equality, and printed "no golden case changed
     * verdict" — while the record behind a 240-500g band had moved from a can to a 2L
     * bottle. The verdict column is STILL quiet here (UNKNOWN -> UNKNOWN); what makes
     * the move visible is `movedButBlind`, which did not exist.
     */
    it('surfaces a moved winner sitting behind a band it cannot judge', () => {
        const s = runGoldenScreen([c], a, b);
        expect(s.matched).toBe(1);
        expect(s.winnerMoved).toBe(1);
        expect(s.changed).toEqual([]);                    // verdict comparison alone says NOTHING
        expect(s.movedButBlind).toHaveLength(1);
        expect(s.movedButBlind[0].id).toBe('n-qty-08');
        expect(s.movedButBlind[0].b.blind).toEqual(['grams']);
    });

    it('still reports an ordinary verdict flip', () => {
        const bWrong = [row('7up', win('off_c', 'Sprite Lemon Lime'))];
        const s = runGoldenScreen([c], a, bWrong);
        expect(s.changed).toHaveLength(1);
        expect([s.changed[0].a.verdict, s.changed[0].b.verdict]).toEqual(['UNKNOWN', 'FAIL']);
    });

    it('counts rows it could not pair rather than silently dropping them', () => {
        const s = runGoldenScreen([c], [...a, row('unpaired', win('x', 'X'), { goldenId: 'n-qty-08' })], b);
        expect(s.unmatched).toBe(1);
        expect(s.matched).toBe(1);
    });

    it('never prints a bare clearance line — the coverage table always comes with it', () => {
        const quiet = runGoldenScreen([c], a, [row('7up', win('off_a', '7UP Soda 330ml'))]);
        expect(quiet.changed).toEqual([]);
        expect(quiet.movedButBlind).toEqual([]);
        const out = formatGoldenScreen(quiet).join('\n');
        expect(out).toContain('NOT EVALUABLE');
        expect(out).toContain('grams');
        expect(out).toMatch(/only worth as much as the coverage table/);
        // the moved-winner case prints the unjudged bands by name
        expect(formatGoldenScreen(runGoldenScreen([c], a, b)).join('\n'))
            .toMatch(/WINNER MOVED but the case has a band this screen CANNOT judge: 1/);
    });
});

// ============================================================
// 6. counterfactual summary
// ============================================================

describe('counterfactualSummary', () => {
    const mk = (q: string, gateWin: WinnerInfo, cfWin: WinnerInfo | null, reason: string): ReplayRow =>
        row(q, gateWin, {
            path: 'confidence_gate_early_exit',
            rerankRan: false,
            rerankWindowIds: [],
            gate: { skipAiRerank: true, reason, confidence: 0.95 },
            counterMicros: 120,
            counter: { path: cfWin ? 'rerank' : 'no_winner_rerank_declined', rerankWindow: 10, rerankWindowIds: [], winner: cfWin, notes: [] },
        });

    const rows: ReplayRow[] = [
        mk('carrots', win('1', 'Carrots'), win('1', 'Carrots'), 'basic_produce_bypass'),
        mk('subway cold cut combo', win('2', 'Cold Cut Combo Salad', panel(15)), win('3', 'Cold Cut Combo', panel(70)), 'high_confidence_clear_winner'),
        mk('mystery', win('4', 'Mystery'), null, 'high_confidence_clear_winner'),
        row('normal', win('9', 'Normal')),   // never reached the gate's firing branch
    ];

    it('counts agree/disagree/declined over ONLY the early-exit population', () => {
        const s = counterfactualSummary(rows);
        expect(s.rows).toBe(4);
        expect(s.earlyExit).toBe(3);
        expect(s.agree).toBe(1);
        expect(s.disagree).toBe(1);
        expect(s.rerankDeclined).toBe(1);
    });

    it('breaks the disagreement rate down by exit reason', () => {
        const byReason = Object.fromEntries(counterfactualSummary(rows).byReason);
        expect(byReason['high_confidence_clear_winner']).toEqual({ disagree: 1, total: 2 });
        expect(byReason['basic_produce_bypass']).toEqual({ disagree: 0, total: 1 });
    });

    it('hands the disagreements to the screens as GATE-vs-RERANK pairs', () => {
        const s = counterfactualSummary(rows);
        expect(s.pairs).toHaveLength(1);
        const screens = runScreens(s.pairs, 'GATE', 'RERANK');
        expect(screens.classDrift.onlyA).toBe(1);   // "Salad" is on the gate side
        expect(screens.delta.n).toBe(1);
    });

    it('reports the measured cost of the Step 4 the gate skipped', () => {
        expect(counterfactualSummary(rows).medianCounterMicros).toBe(120);
    });
});

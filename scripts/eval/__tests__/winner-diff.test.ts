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

import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
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
    selectHashablePaths,
    isSkippedHashDir,
    HASHED_EXTRA_FILES,
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
        // 249 since 2026-08-15: the four micronutrient cases — n-chain-01..03
        // (chain records whose fibre/sugar/sodium billed 0, expectName + total)
        // and n-micro-01 (the grams-not-milligrams unit control, the only case in
        // the corpus asserting macros.sodium100; expectName + grams + macros + total).
        // 265 since 2026-08-17: the PROSE SET, n-prose-01..16 (category `prose`) —
        // sixteen `text` cases: twelve one-item hedge/partitive/filler lines with
        // TRUTH bands (grams + total.calories on all twelve, kcal100/protein100
        // on three, expectItems 1 on all) and four multi-item sentences asserting
        // expectItems + identities only. Two are knownIssue (n-prose-01 egg whites
        // until P3; n-prose-03 pasta, a measured nondeterministic rung). Five carry
        // `expectServingTier`, which this parser does not read (the replay screen
        // cannot see a tier; the live eval scores it under the debug echo only).
        // 271 since 2026-08-24: the SYNONYM-DIRECTION SET, n-syn-01..06 (category
        // `synonym_direction`, D-A9 / PR #381) — six bare `text` lines (ham, ground
        // beef, baking soda, light corn syrup, hamburger bun, and gammon as the
        // UK->US control) asserting expectName + macros.kcal100 only: no grams, no
        // total, no expectItems, none knownIssue. Serving is a draw there and is
        // deliberately unasserted.
        // 274 / 165 / 78 / 108 since 2026-08-24 (same day): n-dup-01..03, the A7/K4 OFF-twin
        // cold seeds (PR #382) — three bare `text` lines with grams + kcal100 bands.
        // 281 / 166 / 115 since 2026-08-24 (same day, third set): n-grd-01..07, the ground-meat
        // identity set — seven bare/quantity `text` lines asserting expectName + macros.kcal100;
        // ONE grams band (n-grd-06 `4 oz ground chicken`, deterministic at 113.4 g), no total,
        // no expectItems, none knownIssue; n-grd-07 `ground turkey` is the control that stays.
        // 285 / 169 / 119 / 89 since 2026-08-24 (fourth set): n-pct-01..04, the percent-modifier set
        // (PR #385) — three grams bands (n-pct-01/02 wide by design, n-pct-04 the `2 cups` control), all four kcal100.
        // 288 since 2026-08-25 (fifth set): n-k3-01..03, the FatSecret macro-only-serving set
        // (A8 row 1) — three bare `text` lines asserting expectName + total.calories, the ONLY
        // set here that bands `total` and not `grams`, because on this tier grams is
        // `estimateServingGrams` (kcal / 2.0) and banding it would band the estimator. No
        // kcal100 either, for the same reason: it is a flat 200 by construction.
        // 291 since 2026-08-25 (sixth set): n-n1-01..03, the brand-led product-name set
        // (A8 row 3, N1) — three bare `text` lines, every one carrying `forbidName`, which is
        // the discriminator here: on n-n1-03 the two records the case separates are 566 and
        // 592 kcal/100 g, so no band can tell them apart. One `total` (n-n1-01) and two
        // `macros.kcal100` (n-n1-02/03); no grams band, because what N1 moves is the record,
        // not the rung.
        // 294 since 2026-08-26 (seventh set): n-k2-01..03, the brand-led admission set
        // (A8 row 3, K2) -- three bare `text` lines, every one carrying `forbidName` as the
        // discriminator (crust/tender/bites), because on n-k2-03 the two records the case
        // separates are both exactly 200 kcal/100 g, so no density band can. Two kcal100
        // bands (n-k2-01/02) and one `total` (n-k2-03); no grams band -- n-k2-01's winner
        // sits on K3's macro-only tier where grams is kcal/2.0 by construction.
        // 300 / 171 / 134 since 2026-08-26: n-p1-01..03, n-p2-01..02, n-cn-01 (A8 row 5 —
        // a brand-led line is a product name). Six `text` lines; TWO new grams bands, and
        // which two is the point. The P1 cases are identity-only because the records they
        // separate are close on density (Breakfast Jack 202 vs Jumbo Jack 104 kcal/100 g is
        // the exception that still cannot be banded, since a band holding one holds the
        // other). n-p2-02 and n-cn-01 DO carry grams, because on those two the identity was
        // already right on both arms and only the COUNT moved — 2 cups of yogurt vs 1, and
        // 12 wings at the 100 g no-serving default vs at the 34 g seed.
        expect(all.length).toBe(300);

        const n = (pred: (c: GoldenCase) => boolean) => all.filter(pred).length;
        expect(n(c => c.expectName.length > 0)).toBe(300);
        // 150 since 2026-08-15 (n-micro-01); 162 since 2026-08-17 (the twelve one-item prose lines)
        // 171 since 2026-08-26: n-p2-02 and n-cn-01 (A8 row 5) — the two of six new cases
        // where identity held on both arms and only the count moved.
        expect(n(c => !!c.grams)).toBe(171);              // the majority assertion
        // 66 since 2026-08-15 (n-micro-01's sodium100 band); 69 since 2026-08-17
        // (n-prose-01 protein100/fat100, n-prose-03 and n-prose-10 kcal100 as the
        // cooked-vs-dry discriminator the _readme's STANDING RULE asks for)
        // 75 since 2026-08-24: the six synonym-direction kcal100 bands.
        // 85 since 2026-08-24 (n-grd-01..07, every one carries a kcal100 band)
        // 91 since 2026-08-25 (n-n1-02/03 kcal100; n-n1-01 bands `total` instead)
        // 93 since 2026-08-26 (n-k2-01/02 kcal100; n-k2-03 bands `total` instead --
        // its two candidate records are density-identical, see the case note)
        // 94 since 2026-08-26: n-p1-01 (A8 row 5) — kcal100 rather than a total band,
        // because what was 5.8x wrong on that line is the SERVING (725 g of a combo
        // platter vs 126 g of 5 boneless wings), not the density.
        // 95 since 2026-09-05: n-mq-11 kcal100 [20,110] — the sugar axis. Its graceful-
        // degrade reading is retired (the "fake brand" is G Hughes and the accepted generic
        // was the FULL-SUGAR product at 167-467 kcal/100 g); expectName now also names the
        // brand, and the band is what keeps the case gated whichever G Hughes row wins.
        expect(n(c => !!c.macros)).toBe(95);
        // 47 -> 63 on 2026-08-17: every prose case declares expectItems (1 on the
        // twelve one-item lines, 7/2/3/3 on the four sentences)
        expect(n(c => typeof c.expectItems === 'number')).toBe(63);
        // 36 since 2026-08-04: n-cook-03 gained a total band, because its scale-free
        // kcal100/carbs100 were passing on a 240 g / 295 kcal bill against USDA's
        // 172 g / 227 kcal. Adding one here also adds one to the `total` blind count
        // below — this screen cannot judge totals at all.
        // 37 since 2026-08-07: n-mq-34 gained total.calories [130,160] (its fat100
        // band alone could not distinguish the two recorded arms; see its note).
        // 41 since 2026-08-15: all four micronutrient cases band `total` and not
        // `macros` for their sodium, deliberately — per-100g on an empty-panel
        // FatSecret record is a self-consistency term against an invented weight,
        // so only the BILLED figure is a sound assertion there. n-micro-01 is the
        // exception that proves it: a panel-bearing record, where sodium100 IS a
        // density and is banded.
        // 53 since 2026-08-17: all twelve one-item prose lines carry total.calories
        // (the STANDING RULE for one-food cases; two also band total.fat).
        // 56 since 2026-08-25: n-k3-01..03 (A8 row 1) each band total.calories at the
        // record's own published serving +-35% — the same STANDING RULE, and on that
        // tier the only band that says anything (grams is kcal / 2.0, kcal100 a flat 200).
        // 57 since 2026-08-25: n-n1-01 `mcdonalds hamburger`, banded on McDonald's published
        // 250 kcal +-35%. n-n1-02/03 band kcal100 instead — see the count pin above.
        // 58 since 2026-08-26: n-k2-03 `wendys biggie fries`, banded on the observed
        // record's own 450 kcal serving +-35% because Biggie Bites and Baconator Fries
        // are both exactly 200 kcal/100 g and only the billed total separates them.
        expect(n(c => !!c.total)).toBe(58);
        // 3 since 2026-08-25 (n-n1-01..03, A8 row 3 N1) — the FIRST live users of
        // `forbidName` in the nlp corpus. It was documented in _readme on 2026-07-25 and
        // implemented in run-eval, and this pin read 0 for a month: the parser was carrying
        // it so the screen would not go blind the moment a case used it, and now one does.
        // On all three it is the DISCRIMINATOR, not decoration — n-n1-03 separates a 70%
        // from an 85% bar, which are 566 and 592 kcal/100 g, so no band can.
        // 6 since 2026-08-26 (n-k2-01..03, A8 row 3 K2) -- again the discriminator on
        // all three: crust/tender/bites name the WRONG record, which shares the brand
        // and (on n-k2-03) the exact density of the right one.
        // 10 since 2026-08-26 (n-p1-01..03 + n-p2-01, A8 row 5) -- the discriminator on
        // all four, and on three of them the forbidden record is the one the PARSER's
        // own strip produced: `things` (Boneless Wings & Things, once `boneless` was
        // gone), `breakfast` (Breakfast Jack, once `jumbo` was gone), `jersey` (a
        // sandwich chain's fountain listing, once `leaf` was gone) and `fries` (Fries,
        // Little, once `five` had been read as a count). n-p2-02 and n-cn-01 carry
        // grams bands instead, because there the identity never moved.
        expect(n(c => !!c.forbidName)).toBe(10);
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
        // UNCHANGED at 38 by the 2026-08-15 additions: all four carry a numeric band.
        // 42 since 2026-08-17: the four multi-item prose sentences (n-prose-13..16)
        // are identity + expectItems only, by the _readme's own rule — bands read
        // items[0], and index 0 of a seven-item sentence is a segmentation artefact.
        // 45 since 2026-08-26: n-p1-02/03 and n-p2-01 (A8 row 5) are identity-only on
        // purpose. On each the two records a band would have to separate are close or
        // inverted on density -- Breakfast Jack 202 vs Jumbo Jack 104 kcal/100 g, two
        // Pure Leaf teas at ~29 and ~31 -- so forbidName is the only honest
        // discriminator, and on n-p2-01 the serving residue is still wrong post-fix.
        expect(n(c => !c.grams && !c.total && !c.macros)).toBe(45);

        // split by shape: `--golden` replays item-shaped cases unless --include-multi-item
        const item = all.filter(c => c.shape === 'item');
        const text = all.filter(c => c.shape === 'text');
        // 166 since 2026-08-15: the four micronutrient cases are all item-shaped,
        // deliberately — an `item` bypasses AI segmentation, so the assertion is
        // about the mapper and not about a segmenter draw. `text` is unchanged.
        // [166, 99] since 2026-08-17: the sixteen prose cases are ALL `text` —
        // the point of the set is the route's prose path (single-item fast path
        // or the segmenter), so none is item-shaped and the item counts below are
        // untouched by it.
        // [166, 105] since 2026-08-24: n-syn-01..06 are ALL `text` (bare lines are
        // the only shape Step 0a's canonicalizer ever rewrote); item counts untouched.
        // [166, 122] since 2026-08-25: n-k3-01..03 are all `text` (bare brand-led lines);
        // item counts untouched, and their `total` bands land in the text column below.
        // [166, 125] since 2026-08-25: n-n1-01..03 are all `text` (bare brand-led product
        // names — the only shape the normalizer's brand gate can be exercised on); item
        // counts untouched, and their bands land in the text columns below.
        // [166, 128] since 2026-08-26: n-k2-01..03 are all `text` (bare brand-led menu
        // lines -- the shape deriveMustHaveTokens() fires on); item counts untouched.
        // text 134 since 2026-08-26: all six A8 row 5 cases are `text`, because the
        // defect is in the PARSER and an item-shaped case supplies name/qty/unit
        // directly — it would bypass the very code under test.
        expect([item.length, text.length]).toEqual([166, 134]);
        expect(item.filter(c => c.grams).length).toBe(119);
        expect(item.filter(c => c.macros).length).toBe(48);
        // 17 since 2026-08-07: n-mq-34 (item shape) gained a total.calories band.
        // 21 since 2026-08-15: n-chain-01..03 + n-micro-01.
        expect(item.filter(c => c.total).length).toBe(21);
        // 31 -> 43 and 47 -> 63 on 2026-08-17 (prose set; see the count pin above)
        // 47 since 2026-08-24: n-grd-06 `4 oz ground chicken` is text-shaped with a grams band.
        // 52 since 2026-08-26: n-p2-02 and n-cn-01 (A8 row 5) — the two text-shaped
        // cases whose identity held on both arms, so grams is the discriminator.
        expect(text.filter(c => c.grams).length).toBe(52);
        // 35 since 2026-08-25: n-k3-01..03 band total.calories and nothing else.
        // 36 since 2026-08-25 (N1): n-n1-01 adds one; n-n1-02/03 band kcal100 instead.
        // 37 since 2026-08-26 (K2): n-k2-03 adds one; n-k2-01/02 band kcal100 instead.
        expect(text.filter(c => c.total).length).toBe(37);
        expect(text.filter(c => typeof c.expectItems === 'number').length).toBe(63);

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
        // 249 / 150 / 41 since 2026-08-15: the four micronutrient cases (see the
        // count pin above). NOTE WHAT THIS TABLE SAYS ABOUT THEM — all four land
        // wholly in the `blind` column, because this screen replays the selection
        // cascade and the defect they gate lives in resolveFoodDetails(), which
        // the replay never calls. They are gated by the LIVE golden eval only.
        // 265 / 162 / 53 / 63 since 2026-08-17: the prose set. Same story one
        // more time — every prose band lands in `blind`: the one-item lines are
        // deterministicSingleItem `text` (the route's fast path) but grams/total
        // are replay-blind by construction, and the four sentences are
        // segmenter-bound. Their `expectServingTier` is not even parsed here.
        // 271 since 2026-08-24: n-syn-01..06 add six expectName + macros cases and
        // move no grams/total/expectItems count.
        // 281 / 166 since 2026-08-24 (n-grd-01..07): one more grams band, n-grd-06.
        // 288 / 56 since 2026-08-25 (n-k3-01..03, A8 row 1): three more `total` bands
        // and no grams band. Same `blind` story as every entry above, and here it is
        // load-bearing rather than incidental — the defect those cases gate is a
        // SERVING failure, so the selection replay is structurally blind to them and
        // they were gated by the live cold eval on a locally-served build instead
        // (3/3 red on master, 3/3 green on the branch, same host and same DB).
        // 291 / 57 since 2026-08-25 (n-n1-01..03, A8 row 3 N1): one more `total` band
        // (n-n1-01) and no grams band. These are gateable by the selection replay in
        // principle — N1 moves the WINNER, not the serving — but not by THIS harness:
        // normalization-rules.ts is a FROZEN_INPUT path, so replaySelection() reads the
        // pre-change normalizedName off the snapshot. They were gated on a locally-served
        // build instead (3/3 red on master Gp4AsbVJN027dnQaPgn6C, 3/3 green on the branch
        // oyB3mkJzuYUprkbjLV6qt, same host and same DB).
        // 294 / 58 since 2026-08-26 (n-k2-01..03, A8 row 3 K2): one more `total` band
        // (n-k2-03) and no grams band. Same FROZEN_INPUT story as N1 -- they ship
        // together, and both were gated on locally-served builds (K2's frozen-pool gate
        // is in the k2-gate-2026-08-25 artifacts; the live pair is 3/3 red on
        // Gp4AsbVJN027dnQaPgn6C, 3/3 green on g0Wf3qBUpQkLOSTV2me4G).
        expect(cov.cases).toBe(300);
        expect(kind('grams')).toEqual({ kind: 'grams', asserted: 171, blind: 171 });
        // 37 since 2026-08-07: n-mq-34's total.calories band (see the count pin above).
        expect(kind('total')).toEqual({ kind: 'total', asserted: 58, blind: 58 });
        expect(kind('expectItems')).toEqual({ kind: 'expectItems', asserted: 63, blind: 63 });
        // expectName is judgeable except on the segmenter-bound text lines
        const en = kind('expectName');
        expect(en.asserted).toBe(300);
        expect(en.blind).toBeGreaterThan(0);
        expect(en.blind).toBeLessThan(274);
        // every grams band in the corpus is unjudgeable here...
        expect(cov.gramsCases).toBe(171);
        // ...and only a handful would be record-INdependent even with a resolver,
        // i.e. the blindness sits exactly where a winner change moves the answer.
        expect(cov.gramsRecordIndependent).toBeLessThanOrEqual(5);
    });

    it('the item-only population (what `--golden` replays by default) is mostly blind too', () => {
        const cov = goldenCoverage(all.filter(c => c.shape === 'item'));
        // 166 / 119 since 2026-08-15: the four micronutrient cases are item-shaped;
        // only n-micro-01 carries grams.
        expect(cov.cases).toBe(166);
        expect(cov.byKind.find(b => b.kind === 'grams')).toEqual({ kind: 'grams', asserted: 119, blind: 119 });
        // 119 item cases assert grams + 21 assert a total, less the 10 that assert both.
        // The `total` term was 7 before PR #167 added calorie bands, 16 before
        // 2026-08-07 added n-mq-34's (an item case with a total and no grams band),
        // and 17 before 2026-08-15 added n-chain-01..03 (total, no grams) and
        // n-micro-01 (both, hence the 9 -> 10).
        expect(all.filter(c => c.shape === 'item' && c.grams && c.total).length).toBe(10);
        expect(cov.casesWithBlindBand).toBe(119 + 21 - 10);
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

/**
 * selectHashablePaths — the tree-hash membership rule.
 *
 * THE MUTATION THESE KILL, and it was executed before the fix (2026-08-14):
 * the old rule was a four-entry list read one directory deep for `.ts` only. Against
 * the live tree it hashed 54 files where a replay can load 164. Touching
 * `src/lib/mapping/data/corrupt-off-denylist.json` — which `dropDenylistedCandidates()`
 * reads LIVE at replay — left the old hash byte-identical at `0240e08c`, so the BASE
 * noise-floor receipt satisfied the BRANCH and the run declared itself a noise-floor
 * check while real winners moved. Under the walk the same edit moves the hash
 * (`5f8dc968` -> `89094528`) and restores deterministically.
 *
 * Revert `selectHashablePaths` to `.ts`-only, or to one-level-deep, or drop the JSON
 * extension, and the corresponding case below fails.
 */
describe('selectHashablePaths — which files decide a replay', () => {
    it('includes JSON the replay reads live, which the .ts-only rule missed', () => {
        const got = selectHashablePaths(['src/lib/mapping/data/corrupt-off-denylist.json']);
        expect(got).toEqual(['src/lib/mapping/data/corrupt-off-denylist.json']);
    });

    it('descends past one level, which the readdir-one-deep rule missed', () => {
        const got = selectHashablePaths([
            'src/lib/mapping/serving/hydration-lane.ts',
            'src/lib/parse/ingredient-line.ts',
            'src/lib/search/typesense-client.ts',
        ]);
        expect(got).toHaveLength(3);
    });

    it('covers the brand surface the frozen-input abort also names', () => {
        const got = selectHashablePaths([
            'src/lib/mapping/brand-detector.ts',
            'src/lib/mapping/brand-lexicon.json',
            'src/lib/mapping/digit-brands.ts',
        ]);
        expect(got).toHaveLength(3);
    });

    it('includes the cwd-relative rules JSON that overrides shipped code', () => {
        expect(selectHashablePaths(['data/fatsecret/normalization-rules.json']))
            .toEqual(['data/fatsecret/normalization-rules.json']);
        expect(HASHED_EXTRA_FILES).toContain('data/fatsecret/normalization-rules.json');
    });

    it('excludes __tests__ at any depth — a test cannot change a replay', () => {
        expect(selectHashablePaths([
            'src/lib/mapping/__tests__/rerank-pool.test.ts',
            'src/lib/servings/__tests__/deep/helper.ts',
        ])).toEqual([]);
        expect(isSkippedHashDir('__tests__')).toBe(true);
    });

    it('excludes files outside the hashed roots and non-source extensions', () => {
        expect(selectHashablePaths([
            'src/app/api/nlp/parse/route.ts',
            'scripts/eval/winner-diff.ts',
            'src/lib/mapping/README.md',
            'src/lib/mapping/notes.txt',
        ])).toEqual([]);
    });

    it('is sorted and deduped, so the hash is stable across readdir order', () => {
        const a = selectHashablePaths(['src/lib/b.ts', 'src/lib/a.ts', 'src/lib/b.ts']);
        expect(a).toEqual(['src/lib/a.ts', 'src/lib/b.ts']);
    });
});

// ============================================================================
// winner-gate.sh's abort membership — shared reader for all three path lists
// ============================================================================
/**
 * WHY THESE ARE TESTED FROM THE SHELL FILE and not from a TypeScript constant.
 * The aborts run BEFORE the driver starts any node process, deliberately: they must
 * be cheap and must not depend on ts-node, node_modules or a database. So the
 * patterns live in winner-gate.sh and those strings are the single source of truth.
 * A mirror in TS would be a second copy free to drift; this reads the shipped ones —
 * INCLUDING the test-file filter, which used to be restated here as a literal
 * `grep -v '__tests__'` and would have silently kept passing after the shipped filter
 * was widened to the colocated `*.test.ts` convention.
 */
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_PATH = path.join(REPO_ROOT, 'scripts', 'eval', 'winner-gate.sh');
const GATE_SRC = fs.readFileSync(GATE_PATH, 'utf8');

/** One shipped `NAME='…'` assignment, read out of the script rather than restated. */
function gatePattern(name: string): string {
    const m = GATE_SRC.match(new RegExp(`^${name}='([^']*)'`, 'm'));
    if (!m) {
        throw new Error(
            `winner-gate.sh no longer defines ${name}='…' on a single line. ` +
            'This test cannot read the shipped membership, which is a FAILURE, not a skip.');
    }
    return m[1];
}

/**
 * The gate's own predicate, run through the same tools the gate runs it through:
 * `changed_paths | grep -vE "$NON_REPLAY_PATHS" | grep -qE "$PAT"`.
 * A JS RegExp would be a MODEL of ERE; this is the thing itself, so a pattern that
 * means something different to grep cannot pass here.
 */
function gateAbortsOn(patternName: string, changedPaths: string[]): boolean {
    const res = spawnSync('bash', ['-c', 'grep -vE "$SKIP" | grep -qE "$PAT"'], {
        input: changedPaths.join('\n') + '\n',
        env: { ...process.env, PAT: gatePattern(patternName), SKIP: gatePattern('NON_REPLAY_PATHS') },
        encoding: 'utf8',
    });
    if (res.error) throw res.error;
    if (res.status !== 0 && res.status !== 1) {
        throw new Error(`grep failed (status ${res.status}): ${res.stderr}`);
    }
    return res.status === 0;
}

/** Every pattern alternative must name a real path — a typo is a silent hole, not a red. */
function missingPathsIn(patternName: string): string[] {
    return gatePattern(patternName)
        .split('|')
        .map(p => p.replace(/\\/g, '').replace(/\/$/, ''))
        .filter(rel => !fs.existsSync(path.join(REPO_ROOT, rel)));
}

// ============================================================================
// winner-gate.sh's FROZEN_INPUT_PATHS — the abort membership
// ============================================================================
/**
 *
 * WHAT IT KILLS (2026-08-15). `src/lib/mapping/llm-output-guards.ts` was absent from
 * the list while writing THREE of the seven frozen snapshot fields — normalizedName and
 * aiCanonicalBase (stripIntroducedFoodTokens, restoreNutritionModifiers) and
 * isBrandedQuery (resolveIsBrandedQuery). PR #316 changed that file and the gate did
 * not abort, so a frozen-pool receipt on that branch would have been green and vacuous.
 * Delete `llm-output-guards` from FROZEN_INPUT_PATHS and the first case below fails.
 *
 * The membership is asserted in BOTH directions on purpose. Over-inclusion is not free:
 * a gate that aborts on changes it can see is a gate people learn to bypass (#311, the
 * false abort on a `__tests__` edit), so the files the replay RUNS have their own cases
 * pinning that they do NOT abort.
 */
describe('winner-gate.sh FROZEN_INPUT_PATHS — what the frozen-pool diff must refuse', () => {
    const gateAborts = (changed: string[]) => gateAbortsOn('FROZEN_INPUT_PATHS', changed);

    it('ABORTS on llm-output-guards.ts — the producer PR #316 changed with a green gate', () => {
        expect(gateAborts(['src/lib/mapping/llm-output-guards.ts'])).toBe(true);
    });

    it.each([
        // pre-existing members, re-pinned so a cleanup cannot quietly drop one
        ['src/lib/parse/ingredient-line.ts', 'parsed'],
        ['src/lib/parse/qualifiers.ts', 'parsed / baseName'],
        ['src/lib/mapping/normalization-rules.ts', 'normalizedName'],
        ['data/fatsecret/normalization-rules.json', 'normalizedName (read off cwd at runtime)'],
        ['src/lib/mapping/brand-detector.ts', 'isBrandedQuery / targetBrand'],
        ['src/lib/mapping/brand-lexicon.json', 'isBrandedQuery / targetBrand'],
        ['src/lib/mapping/digit-brands.ts', 'isBrandedQuery, before BRAND_SET is consulted'],
        ['src/lib/mapping/ai-normalize.ts', 'normalizedName / aiCanonicalBase / aiNutritionEstimate'],
        ['src/lib/mapping/normalize-gate.ts', 'whether the LLM writer of normalizedName runs'],
        // added 2026-08-15
        ['src/lib/mapping/llm-output-guards.ts', 'normalizedName / aiCanonicalBase / isBrandedQuery'],
        ['src/lib/mapping/ai-parse.ts', 'parsed, replaced wholesale when the regex parser finds no unit'],
        ['src/lib/mapping/ai-synonym-generator.ts', 'the query itself, before parseIngredientLine()'],
        ['src/lib/mapping/modifier-constraints.ts', 'an input to shouldNormalizeLlm()'],
        ['src/lib/mapping/cache-key-core.ts', 'IDENTITY_UNIT_HINTS -> baseName -> normalizedName'],
    ])('ABORTS on %s (produces: %s)', (changed) => {
        expect(gateAborts([changed])).toBe(true);
    });

    it.each([
        // The replay RUNS these, so both sides are observed and the diff is a real
        // measurement. Aborting here would refuse the gate its own purpose.
        'src/lib/mapping/simple-rerank.ts',
        'src/lib/mapping/filter-candidates.ts',
        'src/lib/mapping/rerank-pool.ts',
        'src/lib/mapping/count-label.ts',
        'src/lib/mapping/macro-plausibility.ts',
        'src/lib/mapping/data/corrupt-off-denylist.json',
        // Deliberate exclusion, reasoned in the script: an orchestrator that 76 of 637
        // commits touch. If this ever starts aborting it must be a conscious decision,
        // taken by editing this case.
        'src/lib/mapping/map-ingredient-with-fallback.ts',
        'src/lib/mapping/validated-mapping-helpers.ts',
        // retrieval — a DIFFERENT abort (RETRIEVAL_PATHS), not this one
        'src/lib/mapping/gather-candidates.ts',
        // the harness itself
        'scripts/eval/winner-diff.ts',
        'scripts/eval/winner-gate.sh',
    ])('does NOT abort on %s', (changed) => {
        expect(gateAborts([changed])).toBe(false);
    });

    it('does NOT abort on a test-only edit to a frozen producer (the #311 false abort)', () => {
        expect(gateAborts([
            'src/lib/mapping/__tests__/llm-output-guards.test.ts',
            'src/lib/parse/__tests__/ingredient-line.test.ts',
        ])).toBe(false);
    });

    it('aborts on a mixed change set — one frozen producer among innocent files', () => {
        expect(gateAborts([
            'scripts/eval/winner-gate.sh',
            'src/lib/mapping/simple-rerank.ts',
            'src/lib/mapping/llm-output-guards.ts',
        ])).toBe(true);
    });

    it('every pattern names a path that EXISTS — a typo is a silent hole, not a red', () => {
        expect(missingPathsIn('FROZEN_INPUT_PATHS')).toEqual([]);
    });

    it('does NOT abort on an HTTP route — that is a DIFFERENT abort with a different reason', () => {
        // Filing routes here was considered and rejected: the frozen-input reason
        // ("the field is replayed off the snapshot") is FALSE for a route, and an abort
        // that gives the wrong reason is worse than the honest one below.
        expect(gateAborts(['src/app/api/foods/search/route.ts'])).toBe(false);
        expect(gateAborts(['src/app/api/nlp/parse/route.ts'])).toBe(false);
    });
});

// ============================================================================
// winner-gate.sh's RETRIEVAL_PATHS — the gather the replay freezes
// ============================================================================
/**
 * THE FIRST ABORT, PINNED LAST (2026-08-24). The frozen and unobserved lists below
 * were asserted in both directions from the day they shipped; this one was only ever
 * described in comments, and a real hole sat in it: `src/lib/openfoodfacts/search.ts`
 * is the OFF gather — `searchOffSimple()`/`searchOffSemantic()` are imported by
 * gather-candidates.ts and by nothing else the replay reaches, and `computeOffScore()`
 * there sets the OFF lane's order into buildRerankPool() — yet it matched none of the
 * three patterns. A change to it ran the diff on a pool the changed tree would never
 * have produced and printed the result as signal. Found by the A7 tie-arbitration code
 * census (plan 11 §6), which needed exactly that file to be gateable-or-refused.
 *
 * DELETE `src/lib/openfoodfacts/search\.ts` FROM RETRIEVAL_PATHS AND THE FIRST CASE
 * BELOW FAILS.
 *
 * The negative cases matter as much. `openfoodfacts/hydrate.ts` lives in the SAME
 * directory and IS executed by the replay (serving/hydration-lane.ts imports it), so
 * the membership names the file, never the directory — a directory pattern would be a
 * false abort on a file the diff genuinely observes, the #311 shape again. And the
 * pick-layer files A7 designs against must stay silent here: they are what a
 * frozen-pool diff is FOR.
 *
 * No `missingPathsIn` case for this list: four of its alternatives (`query-builder`,
 * `typesense`, `fatsecret-lane`, `embedding`) are deliberate substrings, not paths, so
 * that check would red on the shipped membership by design. The path-shaped
 * alternatives are checked to exist individually instead.
 */
describe('winner-gate.sh RETRIEVAL_PATHS — the gather the replay freezes', () => {
    const gateAborts = (changed: string[]) => gateAbortsOn('RETRIEVAL_PATHS', changed);

    it('ABORTS on src/lib/openfoodfacts/search.ts — the OFF gather, unlisted until 2026-08-24', () => {
        expect(gateAborts(['src/lib/openfoodfacts/search.ts'])).toBe(true);
    });

    it('the path-shaped alternatives name files that EXIST — a typo is a silent hole, not a red', () => {
        for (const rel of ['src/lib/openfoodfacts/search.ts', 'src/lib/mapping/gather-candidates.ts', 'src/lib/search']) {
            expect(fs.existsSync(path.join(REPO_ROOT, rel))).toBe(true);
        }
    });

    it.each([
        ['src/lib/mapping/gather-candidates.ts', 'the gather itself'],
        ['src/lib/mapping/fatsecret-lane.ts', 'the FS lane'],
        // src/lib/search/ is listed as a DIRECTORY, so this file aborts by path even though
        // the mapper never calls it today. A design that wants isBetterRepresentative()
        // must reuse it by import or move it; editing it in place voids the diff.
        ['src/lib/search/dedupe-candidates.ts', 'the whole src/lib/search/ directory'],
    ])('ABORTS on %s (%s)', (changed) => {
        expect(gateAborts([changed])).toBe(true);
    });

    it.each([
        // same directory as the listed file, and the replay RUNS it
        'src/lib/openfoodfacts/hydrate.ts',
        // the pick layer — what a frozen-pool diff measures
        'src/lib/mapping/simple-rerank.ts',
        'src/lib/mapping/rerank-pool.ts',
        'src/lib/mapping/filter-candidates.ts',
        'src/lib/mapping/map-ingredient-with-fallback.ts',
        // the harness itself
        'scripts/eval/winner-gate.sh',
        'scripts/eval/winner-diff.ts',
    ])('does NOT abort on %s', (changed) => {
        expect(gateAborts([changed])).toBe(false);
    });

    it('does NOT abort on a test-only edit to the OFF gather (the #311 false abort)', () => {
        expect(gateAborts(['src/lib/openfoodfacts/__tests__/search.test.ts'])).toBe(false);
        expect(gateAborts(['src/lib/openfoodfacts/search.test.ts'])).toBe(false);
    });

    it('aborts on a mixed change set — the OFF gather among files the replay does observe', () => {
        expect(gateAborts([
            'src/lib/mapping/simple-rerank.ts',
            'src/lib/openfoodfacts/search.ts',
        ])).toBe(true);
    });
});

// ============================================================================
// winner-gate.sh's UNOBSERVED_SURFACE_PATHS — the code the replay never runs
// ============================================================================
/**
 * THE THIRD STATEMENT, and it is neither of the other two.
 *
 * RETRIEVAL_PATHS says "winner-diff runs your change against a pool neither tree
 * would have produced, so the diff is void". FROZEN_INPUT_PATHS says "winner-diff
 * runs, but replays your changed field off the snapshot instead of recomputing it,
 * so it reports SAME vacuously". Both describe an instrument POINTED AT the change.
 *
 * This one says winner-diff never executes the code at all. replaySelection() calls
 * mapIngredientWithFallback directly and issues no HTTP request; `src/lib` imports
 * `src/app` in zero files, so no refactor can put a route on the replay's path.
 *
 * WHAT IT KILLS. PR #324 changed `runLocalSearch()` in
 * src/app/api/foods/search/route.ts — the route was billing kcal100 0 on 3,394
 * FatSecret chain records — and every existing guard was quiet: it matches neither
 * path list, and gitDirtyHash() does not hash `src/app/api` at all
 * (HASHED_SOURCE_ROOTS = ['src/lib'], pinned by the selectHashablePaths cases above,
 * which deliberately use a route file as their excluded example). A winner-gate run
 * on that branch would have reported SAME on every row while measuring nothing about
 * the defect.
 *
 * DELETE `src/app/api/` FROM UNOBSERVED_SURFACE_PATHS AND THE FIRST CASE BELOW FAILS.
 *
 * Asserted in both directions, same discipline as the frozen list: the whole point of
 * a separate list is that it refuses a DIFFERENT population, so the src/lib files the
 * replay does observe must be pinned as not aborting here.
 */
describe('winner-gate.sh UNOBSERVED_SURFACE_PATHS — the surface the replay never executes', () => {
    const gateAborts = (changed: string[]) => gateAbortsOn('UNOBSERVED_SURFACE_PATHS', changed);

    it('ABORTS on foods/search/route.ts — the file PR #324 shipped under a green gate', () => {
        expect(gateAborts(['src/app/api/foods/search/route.ts'])).toBe(true);
    });

    it.each([
        // the two lanes the mapper work actually reads through
        ['src/app/api/foods/search/route.ts', 'the search lane; runLocalSearch serves all four mobile call sites'],
        ['src/app/api/nlp/parse/route.ts', 'the parse lane; singleItemFromText decides whether the segmenter runs'],
        // the routes the #324 write-off names as carrying the same latent defect. These
        // are why the list is the whole directory rather than the two lanes: narrowing
        // would hand exactly these a silent green.
        ['src/app/api/foods/barcode/route.ts', 'needs the same isDegenerateNutrition fallback'],
        ['src/app/api/foods/[id]/serving/route.ts', 'the one path in the blast radius that WRITES'],
        // and the rest of the directory, which is equally unreachable from a replay
        ['src/app/api/ok/route.ts', 'the LLM egress counters — read by every deploy receipt'],
    ])('ABORTS on %s (%s)', (changed) => {
        expect(gateAborts([changed])).toBe(true);
    });

    it.each([
        // The replay RUNS these. They are the frozen list's business or the gate's own
        // purpose; either way this abort must stay silent or it becomes the #311 failure
        // at directory scale.
        'src/lib/mapping/simple-rerank.ts',
        'src/lib/mapping/filter-candidates.ts',
        'src/lib/mapping/llm-output-guards.ts',
        'src/lib/mapping/map-ingredient-with-fallback.ts',
        'src/lib/parse/ingredient-line.ts',
        'src/lib/mapping/data/corrupt-off-denylist.json',
        // not an API route: src/app also holds pages, which this list does not claim
        'src/app/page.tsx',
        // the harness itself
        'scripts/eval/winner-diff.ts',
        'scripts/eval/winner-gate.sh',
        'scripts/eval/winner-diff-screens.ts',
    ])('does NOT abort on %s', (changed) => {
        expect(gateAborts([changed])).toBe(false);
    });

    /**
     * THE #311 FALSE ABORT, RESHAPED. `src/app/api` uses the COLOCATED test convention
     * (`route.test.ts` beside `route.ts`), which has no `__tests__` segment — so the
     * filter that made #311's fix work did not cover these files, and shipping this list
     * against the old filter would have re-introduced the exact failure it was fixed for.
     * All six of the repo's colocated route tests are represented here by shape.
     */
    it('does NOT abort on a colocated route test — a test cannot change what a replay produces', () => {
        expect(gateAborts([
            'src/app/api/foods/search/route.test.ts',
            'src/app/api/foods/search/route.cache-ladder.test.ts',
            'src/app/api/nlp/parse/route.seg-cache.test.ts',
            'src/app/api/ok/route.usage.test.ts',
        ])).toBe(false);
    });

    it('still aborts when a real route change rides along with its own test', () => {
        expect(gateAborts([
            'src/app/api/foods/search/route.test.ts',
            'src/app/api/foods/search/route.ts',
        ])).toBe(true);
    });

    it('aborts on a mixed change set — one route among files the replay does observe', () => {
        expect(gateAborts([
            'scripts/eval/winner-gate.sh',
            'src/lib/mapping/simple-rerank.ts',
            'src/app/api/nlp/parse/route.ts',
        ])).toBe(true);
    });

    /**
     * src/lib/nlp/ IS ON THIS LIST AND IS NOT A ROUTE (added 2026-08-18).
     *
     * The list's original argument was "src/lib imports src/app in zero files, so no
     * refactor can put a route on the replay's path". src/lib/nlp/ earns the same abort by
     * the same argument one level down: it is imported ONLY by src/app/api/nlp/parse/route.ts
     * and that route's colocated tests. src/lib/mapping, src/lib/parse, src/lib/search and
     * src/lib/servings — the set replaySelection() actually reaches through
     * mapIngredientWithFallback — import it in ZERO files. Re-derive:
     * `grep -rn "lib/nlp/" src --include=*.ts | grep -v '^src/lib/nlp/'`.
     *
     * BEFORE THIS, a segmenter change matched NONE of the three lists. The gate RAN, the
     * replay never called the segmenter, and it printed a clean SAME over code it had not
     * executed — a vacuous green with no warning attached, which is strictly worse than
     * either abort. winner-diff-screens.ts already said so in its own words: item count
     * "comes from the LLM segmenter, which a single-query replay never runs".
     *
     * DELETE `src/lib/nlp/` FROM UNOBSERVED_SURFACE_PATHS AND THE FOUR CASES BELOW FAIL.
     */
    it.each([
        ['src/lib/nlp/ai-segmenter.ts', 'the segmenter itself; the replay never calls it'],
        ['src/lib/nlp/segmentation-cache.ts', 'read and write both sit behind the route'],
        ['src/lib/nlp/seg-line-key.ts', 'the cache key the prose path is keyed on'],
        ['src/lib/nlp/segmentation-diff.ts', 'the drift instrument; nothing replays it'],
    ])('ABORTS on %s (%s)', (changed) => {
        expect(gateAborts([changed])).toBe(true);
    });

    it('every pattern names a path that EXISTS — a typo is a silent hole, not a red', () => {
        expect(missingPathsIn('UNOBSERVED_SURFACE_PATHS')).toEqual([]);
    });

    /**
     * The exit code is the machine-readable half of "this is a different reason".
     * Collapsing it onto 3 would make the two indistinguishable to anything that reads
     * a status, which is the same conflation the separate list exists to prevent.
     */
    it('exits 5, distinct from the 3 the two vacuous-diff aborts use', () => {
        const block = GATE_SRC.slice(GATE_SRC.indexOf('UNOBSERVED_SURFACE_PATHS='));
        expect(block).toMatch(/\n\s*exit 5\n/);
        expect(GATE_SRC.match(/\n\s*exit 5\n/g) ?? []).toHaveLength(1);
    });
});

// ============================================================================
// one-hop-guard.sh ONE_HOP_SYMBOLS — the symbols RETRIEVAL reaches one import hop away
// ============================================================================
/**
 * THE FOURTH ABORT (2026-09-02), and why it is a SYMBOL list rather than a path list.
 *
 * RETRIEVAL_PATHS names the three files that PRODUCE the frozen pool, and a path list
 * is blind to what they import: gather-candidates.ts calls detectGrainCookingContext()
 * from filter-candidates.ts at ONE gather site (gatherCandidates) and one gate site
 * (confidenceGate, which the replay runs live), and filter-candidates.ts is on no list
 * because the rest of it is the admission layer a frozen-pool diff is FOR. Listing the
 * file is unusable (8 of the last 20 commits touching src/lib/mapping, src/lib/units or
 * src/lib/openfoodfacts edit a listed FILE, 0 edit a listed symbol — one-hop-guard.sh
 * owns that census and its re-derive). So the membership is `<file>:<symbol>` pairs,
 * read out of one-hop-guard.sh the way the path lists are read out of winner-gate.sh,
 * and the predicate is the SHIPPED bash: the symbol's source REGION compared between the
 * base ref and the working tree. Every case below runs those functions through bash;
 * none restates them in TypeScript.
 *
 * Both directions, again: a listed file changed OUTSIDE its listed symbol must NOT
 * abort (filter-candidates.ts carries live admission work), a __tests__ path never
 * reaches the guard, and the one producer import the replay executes LIVE
 * (RERANK_DECLINED_CONFIDENCE) is pinned as deliberately ABSENT with its receipt.
 *
 * WHAT THESE CASES CANNOT SEE, and why the executing describe further down exists: they
 * call one-hop-guard.sh's functions directly and read winner-gate.sh as text, so none of
 * them can tell a WIRED gate from an unwired one.
 */
const GUARD_PATH = path.join(REPO_ROOT, 'scripts', 'eval', 'one-hop-guard.sh');

/**
 * READ LAZILY, ON PURPOSE. This was a module-scope `fs.readFileSync(GUARD_PATH)`, so a
 * deleted or renamed helper threw at import time and jest reported 0 of 168 cases in
 * this file as executed — a broken one-hop guard took down every unrelated pin here,
 * including the ones that would have told you what else was wrong. Reading inside the
 * `it` bodies keeps the blast radius to the one-hop cases. It is memoized because two
 * dozen cases read it.
 */
let guardSrcCache: string | null = null;
function guardSrc(): string {
    if (guardSrcCache === null) guardSrcCache = fs.readFileSync(GUARD_PATH, 'utf8');
    return guardSrcCache;
}

/** One shipped `NAME='…'` assignment out of one-hop-guard.sh, never restated. */
function guardVar(name: string): string {
    const m = guardSrc().match(new RegExp(`^${name}='([^']*)'`, 'm'));
    if (!m) {
        throw new Error(
            `one-hop-guard.sh no longer defines ${name}='…' on a single line. ` +
            'This test cannot read the shipped membership, which is a FAILURE, not a skip.');
    }
    return m[1];
}

function oneHopEntries(): Array<{ file: string; symbol: string }> {
    return guardVar('ONE_HOP_SYMBOLS').trim().split(/\s+/).map(e => {
        const i = e.indexOf(':');
        if (i <= 0 || i === e.length - 1) throw new Error(`malformed ONE_HOP_SYMBOLS entry: ${e}`);
        return { file: e.slice(0, i), symbol: e.slice(i + 1) };
    });
}

/** Runs the SHIPPED functions through bash, under the gate's own `-u -o pipefail`. */
function guardShell(script: string, cwd: string, env: Record<string, string> = {}) {
    const res = spawnSync('bash', ['-c', `set -uo pipefail; source "$GUARD"; ${script}`], {
        cwd, encoding: 'utf8', env: { ...process.env, ...env, GUARD: GUARD_PATH },
    });
    if (res.error) throw res.error;
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function symbolRegion(file: string, symbol: string, cwd: string = REPO_ROOT): string {
    const r = guardShell('symbol_region "$F" "$S"', cwd, { F: file, S: symbol });
    if (r.status !== 0) throw new Error(`symbol_region failed (${r.status}): ${r.stderr}`);
    return r.stdout;
}

/** The gate's consumer contract: exit 0 = changed, 1 = unchanged. */
function symbolChangedVsHead(repo: string, file: string, symbol: string): boolean {
    const r = guardShell('one_hop_symbol_changed HEAD "$F" "$S"', repo, { F: file, S: symbol });
    if (r.status !== 0 && r.status !== 1) {
        throw new Error(`one_hop_symbol_changed failed (${r.status}): ${r.stderr}`);
    }
    return r.status === 0;
}

/** Whether a path survives the gate's NON_REPLAY_PATHS filter; the guard sees only survivors. */
function survivesNonReplayFilter(p: string): boolean {
    const res = spawnSync('bash', ['-c', 'grep -vE "$SKIP"'], {
        input: p + '\n', encoding: 'utf8',
        env: { ...process.env, SKIP: gatePattern('NON_REPLAY_PATHS') },
    });
    if (res.error) throw res.error;
    return res.stdout.trim() === p;
}

/** A throwaway repo with one commit, isolated from the user's git config. */
function throwawayRepo(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-hop-guard-'));
    const git = (...args: string[]) => {
        const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
            cwd: dir, encoding: 'utf8',
            env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
        });
        if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    };
    git('init', '-q');
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    git('add', '-A');
    git('commit', '-qm', 'base');
    return dir;
}

const FILTER_FIXTURE_REL = 'src/lib/mapping/filter-candidates.ts';

/**
 * ONE character added INSIDE `symbol`'s region: a trailing space.
 *
 * WHICH LINE MATTERS. symbol_region stops AT the declaration line when that line closes
 * the statement, so for a one-line `const X = /re/i;` the next line is already outside
 * the region and an edit there proves nothing. Pick the declaration line in that case
 * and the line after it otherwise.
 */
function editInside(src: string, symbol: string): string {
    const lines = src.split('\n');
    const i = lines.findIndex(l => new RegExp(`^(export )?(async )?(function|const) ${symbol}[ (<:=]`).test(l));
    if (i < 0) throw new Error(`fixture: ${symbol} not found`);
    const target = /[;}][ \t]*$/.test(lines[i]) ? i : i + 1;
    lines[target] += ' ';
    return lines.join('\n');
}

/** `{specifier} from './x'` names, resolved to repo-relative .ts paths, for one importer. */
function importedSymbolsByFile(importers: string[]): Map<string, Set<string>> {
    const importedFrom = new Map<string, Set<string>>();
    const IMPORT_RE = /^import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']+)'/gm;
    for (const importer of importers) {
        const src = fs.readFileSync(path.join(REPO_ROOT, importer), 'utf8');
        let m: RegExpExecArray | null;
        while ((m = IMPORT_RE.exec(src)) !== null) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), m[2])) + '.ts';
            const names = m[1].split(',')
                .map(s => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
                .filter(Boolean);
            const set = importedFrom.get(target) ?? new Set<string>();
            names.forEach(n => set.add(n));
            importedFrom.set(target, set);
        }
    }
    return importedFrom;
}

/** Repo-relative by default; an absolute path (a fixture in a tmpdir) passes through. */
function repoPath(file: string): string {
    return path.isAbsolute(file) ? file : path.join(REPO_ROOT, file);
}

/**
 * The top-level declarations of one file, in exactly the two shapes `symbol_region`
 * parses — i.e. the ones that can be WRITTEN into ONE_HOP_SYMBOLS at all.
 */
function expressibleTopLevelDecls(file: string): Set<string> {
    const out = new Set<string>();
    for (const line of fs.readFileSync(repoPath(file), 'utf8').split('\n')) {
        const fn = line.match(/^(?:export )?(?:async )?function ([A-Za-z0-9_$]+)[ (<]/);
        if (fn) { out.add(fn[1]); continue; }
        const cn = line.match(/^(?:export )?const ([A-Za-z0-9_$]+)[ :=]/);
        if (cn) out.add(cn[1]);
    }
    return out;
}

/**
 * EVERY top-level VALUE declaration of one file, including the shapes `symbol_region`
 * cannot express: `let`, `var`, `class`, `enum`, and a destructured
 * `const { a, b } = …` / `const [a] = …`.
 *
 * WHY BOTH SCANNERS EXIST (2026-09-03, refuter F3). The closure test below used the
 * expressible set for both halves of its question, which quietly made the guard's own
 * blind spot into the closure's blind spot: a `let EXTRA_COOKED_GRAINS = [...]` or an
 * `enum GrainMode {…}` read inside detectGrainCookingContext was invisible to the
 * scanner, so the test could not demand it be listed, and a later branch widening that
 * table reached exit 2 with a clean receipt — BLOCKER 2 reopened one keyword over.
 * Scanning with the BROAD set and requiring the EXPRESSIBLE set to cover it makes the
 * gap FAIL CLOSED: an unexpressible reference is a red that names the identifier and
 * says what to do about it, rather than silence.
 *
 * TYPES ARE DELIBERATELY OUT (`type`, `interface`, and a bare `declare`). They are
 * erased before anything runs, so they cannot move a pool, and a signature that names a
 * same-file type would otherwise red this test for nothing.
 */
function allTopLevelValueDecls(file: string): Set<string> {
    const out = new Set<string>(expressibleTopLevelDecls(file));
    for (const line of fs.readFileSync(repoPath(file), 'utf8').split('\n')) {
        const kw = line.match(/^(?:export )?(?:abstract )?(?:let|var|class|enum|const enum) ([A-Za-z0-9_$]+)[ :=<({]/);
        if (kw) { out.add(kw[1]); continue; }
        // destructured const/let/var: every binding name on the left of the `=`
        const de = line.match(/^(?:export )?(?:const|let|var) ([{[].*?[}\]])\s*(?::[^=]*)?=/);
        if (de) for (const n of de[1].matchAll(/([A-Za-z0-9_$]+)\s*(?:[,}\]]|$)/g)) out.add(n[1]);
    }
    return out;
}

/** Which of `names` appear as identifiers inside `region` (not as a property access). */
function referencedIn(region: string, names: Iterable<string>): string[] {
    const hits: string[] = [];
    for (const n of names) {
        if (new RegExp(`(^|[^A-Za-z0-9_$.])${n}([^A-Za-z0-9_$]|$)`, 'm').test(region)) hits.push(n);
    }
    return hits;
}

describe('one-hop-guard.sh ONE_HOP_SYMBOLS — the symbols RETRIEVAL reaches one import hop away', () => {
    const FILTER_REL = FILTER_FIXTURE_REL;
    const FILTER_SRC = fs.readFileSync(path.join(REPO_ROOT, FILTER_REL), 'utf8');
    const tmpDirs: string[] = [];
    afterAll(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });
    const repoWith = (files: Record<string, string>) => {
        const d = throwawayRepo(files);
        tmpDirs.push(d);
        return d;
    };

    it('lists detectGrainCookingContext in filter-candidates.ts — the hole this guard was built for', () => {
        expect(oneHopEntries()).toContainEqual({ file: FILTER_REL, symbol: 'detectGrainCookingContext' });
    });

    // NOT `it.each(oneHopEntries())`: that calls the guard reader during COLLECTION, and
    // a throw there fails the whole file — the blast radius this block just narrowed.
    it('every entry names a real file AND a non-empty region on the current tree (typo guard, both halves)', () => {
        for (const { file, symbol } of oneHopEntries()) {
            expect({ file, exists: fs.existsSync(path.join(REPO_ROOT, file)) })
                .toEqual({ file, exists: true });
            const region = symbolRegion(file, symbol);
            expect({ file, symbol, empty: region.length === 0 })
                .toEqual({ file, symbol, empty: false });
            expect(region.split('\n')[0])
                .toMatch(new RegExp(`^(export )?(async )?(function|const) ${symbol}\\b`));
        }
    });

    it('every listed symbol is REACHED: imported by a producer, or read by a listed region of its own file', () => {
        const importedFrom = importedSymbolsByFile(guardVar('ONE_HOP_IMPORTERS').trim().split(/\s+/));
        const entries = oneHopEntries();
        for (const e of entries) {
            const imported = importedFrom.get(e.file)?.has(e.symbol) ?? false;
            // clause (4): a module-level table is not imported — it is read by a listed
            // declaration of the same file. Either justification is enough; NEITHER is a
            // symbol nothing reaches, i.e. a guard that refuses work for no reason.
            const readBy = entries
                .filter(o => o.file === e.file && o.symbol !== e.symbol)
                .filter(o => referencedIn(symbolRegion(o.file, o.symbol), [e.symbol]).length > 0)
                .map(o => o.symbol);
            expect({ ...e, reached: imported || readBy.length > 0 })
                .toEqual({ ...e, reached: true });
        }
    });

    /**
     * THE CENSUS IN THE OTHER DIRECTION — IMPORT -> LIST (2026-09-03, refuter F4).
     *
     * The test above asks "is every LISTED symbol reached?", which is the list -> reach
     * direction, and `importedSymbolsByFile()` had exactly that one caller. Nothing asked
     * the converse — "is every REACHED symbol listed?" — so membership clause (1) was
     * documented in the helper header and pinned by nothing, and four deletions survived
     * the whole suite: dropping all four count-label.ts entries, dropping
     * corrupt-mark.ts:isCorruptExclusionEnabled, dropping
     * density.ts:DRY_GRANULE_DENSITY_CATEGORIES, and adding an escape hatch. The first is
     * the worst: those entries cover da6d7a5, the ONE commit in the 100-commit census
     * this guard would have caught — i.e. the guard's entire measured firing population,
     * deletable with zero tests going red.
     *
     * So: re-derive clause (1) from the three producers, and require every named import
     * that lands on a file NEITHER path list already covers to be LISTED or on the
     * explicit allowlist below. The allowlist is the helper header's DELIBERATELY NOT
     * LISTED section restated as data, one entry per symbol, so a new unlisted import is
     * a red that has to be argued for rather than absorbed.
     *
     * MEASURED 2026-09-03 on this tree: 19 named imports land on an existing, non-producer
     * file that neither path list covers; 6 are listed and 13 are on the allowlist.
     * Re-derive: `grep -nE "^import|^\} from" $(read ONE_HOP_IMPORTERS)`.
     *
     * WHAT IT CANNOT SEE, stated: `import * as ns` and default imports (neither appears in
     * the three producers today), and the two-hop reach the helper header already names.
     */
    it('IMPORT CENSUS: every symbol a producer imports from a non-path-listed file is LISTED or explicitly excluded', () => {
        // The helper header's DELIBERATELY NOT LISTED section, as data. Each line is the
        // reason in one clause; the header owns the full argument.
        const NOT_LISTED: Record<string, string> = {
            'src/lib/db.ts:prisma': 'transport',
            'src/lib/logger.ts:logger': 'logging',
            'src/lib/mapping/client.ts:FatSecretClient': 'the FatSecret HTTP wrapper: a class, which symbol_region does not parse, and what it returns is the remote API answer',
            'src/lib/mapping/client.ts:FatSecretFoodSummary': 'a TYPE from that wrapper, erased before anything runs',
            'src/lib/mapping/client.ts:FatSecretServing': 'a TYPE from that wrapper, erased before anything runs',
            'src/lib/mapping/config.ts:FATSECRET_CLIENT_ID': 'credential, shapes nothing',
            'src/lib/mapping/config.ts:FATSECRET_CLIENT_SECRET': 'credential, shapes nothing',
            'src/lib/mapping/config.ts:FATSECRET_LANE_MAX_RESULTS': 'env-value reader; the one whose default is live on the Mac — a one-token widening if re-decided',
            'src/lib/mapping/config.ts:FATSECRET_LANE_TIMEOUT_MS': 'truncates the lane nondeterministically — already retrieval noise',
            'src/lib/mapping/config.ts:FATSECRET_PERSIST_RUNNERS_UP': 'storage cap, applied after the hits exist',
            'src/lib/mapping/config.ts:FATSECRET_RETRIEVAL_ENABLED': 'env-value reader, set in the gating .env',
            'src/lib/mapping/declined-confidence.ts:RERANK_DECLINED_CONFIDENCE': 'winner-diff.ts requires it LIVE from each tree, so the diff SEES a change to it; listing it would be the #311 false abort',
            'src/lib/mapping/deferred-hydration.ts:registerBackgroundTask': 'persistence bookkeeping after the hits exist',
        };
        const importers = guardVar('ONE_HOP_IMPORTERS').trim().split(/\s+/);
        const importedFrom = importedSymbolsByFile(importers);
        const listed = new Set(oneHopEntries().map(e => `${e.file}:${e.symbol}`));

        const unaccounted: string[] = [];
        const scanned: string[] = [];
        for (const [file, names] of [...importedFrom].sort()) {
            // a producer importing another producer is inside RETRIEVAL_PATHS already;
            // a non-existent resolution is a package or a path alias, not a repo file
            if (importers.includes(file)) continue;
            if (!fs.existsSync(path.join(REPO_ROOT, file))) continue;
            if (gateAbortsOn('RETRIEVAL_PATHS', [file]) || gateAbortsOn('FROZEN_INPUT_PATHS', [file])) continue;
            for (const name of [...names].sort()) {
                const key = `${file}:${name}`;
                scanned.push(key);
                if (!listed.has(key) && !(key in NOT_LISTED)) unaccounted.push(key);
            }
        }
        expect(unaccounted).toEqual([]);
        // the census must not go VACUOUS: an importer path typo, a changed import style or
        // a widened path list could empty it, and an empty census asserts nothing.
        expect(scanned.length).toBeGreaterThanOrEqual(15);
        // and the allowlist must not rot: every excluded key is still a real import
        expect(Object.keys(NOT_LISTED).filter(k => !scanned.includes(k))).toEqual([]);
        // the entries the guard's own firing population depends on are in the SCANNED set,
        // so deleting any of them lands in `unaccounted` above rather than passing quietly
        for (const key of [
            'src/lib/mapping/count-label.ts:countedPieceNoun',
            'src/lib/mapping/corrupt-mark.ts:isCorruptExclusionEnabled',
            'src/lib/units/density.ts:DRY_GRANULE_DENSITY_CATEGORIES',
            'src/lib/units/density.ts:inferCategoryFromName',
            'src/lib/units/density.ts:categoryDensity',
            'src/lib/mapping/filter-candidates.ts:detectGrainCookingContext',
        ]) {
            expect({ key, scanned: scanned.includes(key), listed: listed.has(key) })
                .toEqual({ key, scanned: true, listed: true });
        }
    });

    /**
     * NO ESCAPE HATCH, PINNED (2026-09-03, refuter F4). The PR body says "There is no
     * --force, deliberately" and the abort text says it to the reader, and an adversarial
     * pass added a `WINNER_GATE_SKIP_ONE_HOP` env bypass to the block with the whole suite
     * still green. A prose promise nothing reads is not a property.
     *
     * The predicate is an ALLOWLIST OF SHELL VARIABLES the one-hop block may expand. Any
     * new name — an env bypass by construction has to be one — reds here and has to be
     * added deliberately. That is stronger than grepping for a keyword: it does not care
     * what the hatch is called.
     */
    it('the one-hop block has NO escape hatch: it expands only its own variables', () => {
        const from = GATE_SRC.indexOf('source scripts/eval/one-hop-guard.sh');
        const to = GATE_SRC.indexOf("UNOBSERVED_SURFACE_PATHS='");
        expect(from).toBeGreaterThan(0);
        expect(to).toBeGreaterThan(from);
        const block = GATE_SRC.slice(from, to);
        const ALLOWED = new Set([
            'BASE_REF', 'ONE_HOP_CHANGED', 'ONE_HOP_MERGE_BASE', 'ONE_HOP_HITS',
            'ONE_HOP_BEHIND', 'ONE_HOP_SYMBOLS', 'one_hop_entry', 'one_hop_file', 'one_hop_sym',
        ]);
        // EXECUTABLE LINES ONLY: quoted heredocs are text printed to the reader (one of
        // them says "There is no --force, deliberately", which a naive grep would read as
        // the hatch), and comments quote shell fragments verbatim on purpose.
        const codeOnly = block
            .replace(/<<'(EOF[A-Z_]*)'[\s\S]*?\n\1\n/g, '\n')
            .split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
        const used = new Set<string>();
        for (const m of codeOnly.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);
        expect([...used].filter(v => !ALLOWED.has(v)).sort()).toEqual([]);
        // belt and braces on the spellings a hatch actually took in review
        expect(codeOnly).not.toMatch(/SKIP_ONE_HOP|WINNER_GATE_SKIP|--force/);
        expect(GATE_SRC).not.toContain('SKIP_ONE_HOP');
        // the heredoc really was stripped — otherwise the two assertions above are vacuous
        expect(codeOnly).not.toContain('There is no --force, deliberately.');
        // and the promise the abort text makes to the reader is still there
        expect(block).toContain('There is no --force, deliberately.');
    });

    /**
     * THE MEMBERSHIP SEAT (2026-09-03, refuter F1/F2). `git diff --name-only` reports only
     * the NEW path for a rename, so `git mv filter-candidates.ts candidate-filter.ts` plus
     * an edit inside detectGrainCookingContext produced a change set the OLD path is not
     * in: the whole-line membership pre-filter `continue`d and one_hop_symbol_changed's own
     * fail-closed `[[ -f "$file" ]] || return 0` was never reached — the guard skipped
     * ENTIRELY on the move that most obviously relocates a pool producer (MEASURED: exit 2
     * past all four aborts). An ABSENT listed file must therefore bypass the pre-filter.
     * The executing case below proves the behaviour; this reads the shipped line so a
     * future edit that drops it is named rather than red somewhere else.
     */
    it('the membership pre-filter EXEMPTS an absent listed file, so a rename cannot skip the guard', () => {
        const from = GATE_SRC.indexOf('source scripts/eval/one-hop-guard.sh');
        const block = GATE_SRC.slice(from, GATE_SRC.indexOf("UNOBSERVED_SURFACE_PATHS='"));
        expect(block).toContain('{ [[ ! -f "$one_hop_file" ]] \\');
        expect(block).not.toMatch(/^\s*\[\[ \$'\\n'"\$ONE_HOP_CHANGED".*\]\] \|\| continue$/m);
        // the fail-closed check the exemption falls through TO
        expect(guardSrc()).toContain('[[ -f "$file" ]] || return 0');
    });

    /**
     * THE TEST THAT WOULD HAVE CAUGHT THE SIX-ENTRY LIST (blocker 2, 2026-09-03).
     *
     * `symbol_region` compares a declaration's OWN text and nothing else, so a listed
     * function that reads a module-level table of the same file is guarded on half its
     * behaviour. Measured witness at the time: adding `'bulgur'` to VOLUME_COOKED_GRAINS
     * flips detectGrainCookingContext('1 cup bulgur','bulgur') from preferDry to
     * softCooked — the branch that appends the "cooked <name>" FDC search in
     * gatherCandidates() — while the guard read UNCHANGED and the gate exited 0.
     *
     * So: the reference closure over the SHIPPED list, recomputed from the tree, must be
     * a subset of the shipped list.
     *
     * AND IT FAILS CLOSED ON WHAT THE GUARD CANNOT EXPRESS (2026-09-03, refuter F3). The
     * walk scans with allTopLevelValueDecls() — `let`, `var`, `class`, `enum`,
     * destructured `const` included — while only the two shapes symbol_region parses can
     * be written into ONE_HOP_SYMBOLS. A referenced declaration in the wider set and not
     * the narrower one is therefore a HOLE, not a limitation to note in a comment, and it
     * reds here with the identifier named. Before this the two halves used the same
     * narrow scanner, so `let EXTRA_COOKED_GRAINS = [...]` read inside
     * detectGrainCookingContext was invisible to the test AND to the guard, and widening
     * it later reached exit 2 with a clean receipt.
     *
     * Limits that remain, stated rather than hidden: this walks only SAME-FILE, TOP-LEVEL
     * declarations, so it says nothing about two-hop reach (see the helper's STILL BLIND
     * note) and cannot see a table declared inside another function or exported from a
     * third file.
     */
    it('REFERENCE CLOSURE: every same-file top-level declaration a listed region reads is itself listed', () => {
        const entries = oneHopEntries();
        const listed = new Set(entries.map(e => `${e.file}:${e.symbol}`));
        const missing: string[] = [];
        const inexpressible: string[] = [];
        // fixpoint, so a newly listed function drags its own tables in too
        const queue = [...entries];
        const seen = new Set(listed);
        while (queue.length > 0) {
            const e = queue.shift()!;
            const expressible = expressibleTopLevelDecls(e.file);
            const others = [...allTopLevelValueDecls(e.file)].filter(d => d !== e.symbol);
            for (const ref of referencedIn(symbolRegion(e.file, e.symbol), others)) {
                const key = `${e.file}:${ref}`;
                if (!expressible.has(ref)) {
                    // symbol_region parses `function` and `const` only, so this table can
                    // never be listed as things stand. Widen symbol_region and both
                    // scanners here, or restructure the declaration into a `const`.
                    inexpressible.push(`${key}  (read by ${e.symbol}; symbol_region parses function/const only)`);
                    continue;
                }
                if (!listed.has(key)) missing.push(`${key}  (read by ${e.symbol})`);
                if (!seen.has(key)) { seen.add(key); queue.push({ file: e.file, symbol: ref }); }
            }
        }
        expect({ missing, inexpressible }).toEqual({ missing: [], inexpressible: [] });
    });

    /**
     * The fail-closed half of the closure, pinned on a FIXTURE so it does not depend on
     * the listed files staying free of these shapes. If the two scanners ever collapse
     * back into one, this is the case that says so.
     */
    it('the closure scanner sees the shapes symbol_region CANNOT express — that gap is a red, not a silence', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-hop-decls-'));
        tmpDirs.push(dir);
        const fx = path.join(dir, 'fx.ts');
        fs.writeFileSync(fx, [
            'export const OK_CONST = 1;',
            'export function okFn() { return 1; }',
            'let EXTRA_COOKED_GRAINS = new Set([\'bulgur\']);',
            'var LEGACY = 2;',
            'export enum GrainMode { Dry, Cooked }',
            'export class Helper {}',
            'const { DESTRUCTURED_A, DESTRUCTURED_B } = someTable;',
            'export type ErasedType = string;',
            'export interface ErasedShape { a: number }',
            '',
        ].join('\n'));
        const narrow = expressibleTopLevelDecls(fx);
        const broad = allTopLevelValueDecls(fx);
        expect([...narrow].sort()).toEqual(['OK_CONST', 'okFn']);
        for (const name of ['EXTRA_COOKED_GRAINS', 'LEGACY', 'GrainMode', 'Helper', 'DESTRUCTURED_A', 'DESTRUCTURED_B']) {
            expect({ name, broad: broad.has(name), narrow: narrow.has(name) })
                .toEqual({ name, broad: true, narrow: false });
        }
        // types are erased before anything runs, so they must NOT red the closure
        for (const name of ['ErasedType', 'ErasedShape']) {
            expect({ name, broad: broad.has(name) }).toEqual({ name, broad: false });
        }
    });

    it('every listed file is on NEITHER path list — the premise of the narrow form', () => {
        for (const e of oneHopEntries()) {
            expect({ file: e.file, retrieval: gateAbortsOn('RETRIEVAL_PATHS', [e.file]) })
                .toEqual({ file: e.file, retrieval: false });
            expect({ file: e.file, frozen: gateAbortsOn('FROZEN_INPUT_PATHS', [e.file]) })
                .toEqual({ file: e.file, frozen: false });
        }
    });

    it('a one-character edit INSIDE detectGrainCookingContext is CHANGED', () => {
        const repo = repoWith({ [FILTER_REL]: FILTER_SRC });
        expect(symbolChangedVsHead(repo, FILTER_REL, 'detectGrainCookingContext')).toBe(false);
        fs.writeFileSync(path.join(repo, FILTER_REL), editInside(FILTER_SRC, 'detectGrainCookingContext'));
        expect(symbolChangedVsHead(repo, FILTER_REL, 'detectGrainCookingContext')).toBe(true);
    });

    it('the same edit inside hasCriticalModifierMismatch ONLY is NOT changed — the live ROW 1 shape stays gateable', () => {
        const repo = repoWith({ [FILTER_REL]: FILTER_SRC });
        fs.writeFileSync(path.join(repo, FILTER_REL), editInside(FILTER_SRC, 'hasCriticalModifierMismatch'));
        expect(symbolChangedVsHead(repo, FILTER_REL, 'detectGrainCookingContext')).toBe(false);
        // the edit landed, and a multi-line signature is captured from its first line
        expect(symbolChangedVsHead(repo, FILTER_REL, 'hasCriticalModifierMismatch')).toBe(true);
    });

    it('a file absent on either side counts as CHANGED', () => {
        const repo = repoWith({ 'keep.ts': 'export const keep = 1;\n' });
        fs.writeFileSync(path.join(repo, 'new.ts'), 'export function f() {\n  return 1;\n}\n');
        expect(symbolChangedVsHead(repo, 'new.ts', 'f')).toBe(true);
        fs.unlinkSync(path.join(repo, 'keep.ts'));
        expect(symbolChangedVsHead(repo, 'keep.ts', 'keep')).toBe(true);
    });

    it('a __tests__ or colocated test path never reaches the guard — NON_REPLAY_PATHS strips it first', () => {
        expect(survivesNonReplayFilter('src/lib/mapping/__tests__/filter-candidates.test.ts')).toBe(false);
        expect(survivesNonReplayFilter('src/lib/units/density.test.ts')).toBe(false);
        expect(survivesNonReplayFilter(FILTER_REL)).toBe(true);
    });

    describe('symbol_region', () => {
        const FIXTURE = [
            '// header',
            'export const X = 0.78;',
            'export const Y: ReadonlySet<string> = new Set<string>([',
            "  'a', 'b',",
            ']);',
            'const Z = {',
            '  k: 1,',
            '};',
            // the clause-(4) table shapes, added 2026-09-03 with the tables themselves
            'const RE = /\\b(cups?|bowls?)\\b/i;',
            'const REC: Record<string, number> = {',
            '  oil: 0.91,',
            '};',
            'const GEN: Array<{ category: string; keywords: string[] }> = [',
            "  { category: 'legume', keywords: ['bean'] },",
            '];',
            'export function f(a: string): { ok: boolean } {',
            '  if (a) {',
            '    return { ok: true };',
            '  }',
            '  return { ok: false };',
            '}',
            'export async function g(',
            '  a: string,',
            '): Promise<void> {',
            '  return;',
            '}',
            'function h() { return 1; }',
            '',
        ].join('\n');
        let dir: string;
        let file: string;
        beforeAll(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-hop-region-'));
            tmpDirs.push(dir);
            file = path.join(dir, 'fx.ts');
            fs.writeFileSync(file, FIXTURE);
        });

        it.each([
            ['X', ['export const X = 0.78;']],
            ['Y', ['export const Y: ReadonlySet<string> = new Set<string>([', "  'a', 'b',", ']);']],
            ['Z', ['const Z = {', '  k: 1,', '};']],
            // a RegExp literal closes its own statement, so the region is ONE line — an
            // edit on the line AFTER it is outside the region, which is why editInside()
            // targets the declaration line for this shape.
            ['RE', ['const RE = /\\b(cups?|bowls?)\\b/i;']],
            ['REC', ['const REC: Record<string, number> = {', '  oil: 0.91,', '};']],
            // the `;` inside the generic must NOT be read as the end of the statement
            ['GEN', ['const GEN: Array<{ category: string; keywords: string[] }> = [', "  { category: 'legume', keywords: ['bean'] },", '];']],
            ['f', ['export function f(a: string): { ok: boolean } {', '  if (a) {', '    return { ok: true };', '  }', '  return { ok: false };', '}']],
            ['g', ['export async function g(', '  a: string,', '): Promise<void> {', '  return;', '}']],
            ['h', ['function h() { return 1; }']],
        ])('%s -> exactly its own declaration, one-line or bracketed', (sym, expected) => {
            expect(symbolRegion(file, sym as string, dir).replace(/\n$/, '').split('\n')).toEqual(expected);
        });

        it('an absent symbol is an EMPTY region — the typo-guard case above turns that into a red', () => {
            expect(symbolRegion(file, 'nope', dir)).toBe('');
        });

        it('reads stdin as `-` and strips CR, so a CRLF checkout equals its LF `git show`', () => {
            const r = spawnSync('bash', ['-c', 'set -uo pipefail; source "$GUARD"; symbol_region - Y'], {
                input: FIXTURE.replace(/\n/g, '\r\n'), encoding: 'utf8',
                env: { ...process.env, GUARD: GUARD_PATH },
            });
            expect(r.status).toBe(0);
            expect(r.stdout).toBe(symbolRegion(file, 'Y', dir));
        });
    });

    it('does NOT list declined-confidence.ts:RERANK_DECLINED_CONFIDENCE — winner-diff.ts requires it LIVE, so the diff sees it', () => {
        expect(oneHopEntries().some(e => e.file.endsWith('declined-confidence.ts'))).toBe(false);
        // The receipt. If either line goes, re-decide the membership; do not just re-green this.
        const wd = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'eval', 'winner-diff.ts'), 'utf8');
        expect(wd).toContain("require('../../src/lib/mapping/declined-confidence')");
        expect(wd).toMatch(/const \{ confidenceGate, assessConfidence \} = gatherMod;/);
    });

    // TEXT-LEVEL, and that is ALL it is. It pins WHERE the block sits and what it says,
    // never that it is wired: an adversarial pass mutated `-n` to `-z`, emptied the loop
    // list and emptied ONE_HOP_SYMBOLS after the source line, and all three left this
    // green while the real gate never aborted. The executing pin below is the one that
    // kills those; keep both, and never add a wiring claim to this one.
    it('winner-gate.sh sources the helper and aborts AFTER the frozen-input abort, BEFORE the unobserved-surface one, with exit 3', () => {
        const at = GATE_SRC.indexOf('source scripts/eval/one-hop-guard.sh');
        expect(at).toBeGreaterThan(GATE_SRC.indexOf("FROZEN_INPUT_PATHS='"));
        expect(at).toBeLessThan(GATE_SRC.indexOf("UNOBSERVED_SURFACE_PATHS='"));
        const block = GATE_SRC.slice(at, GATE_SRC.indexOf("UNOBSERVED_SURFACE_PATHS='"));
        expect(block).toMatch(/one_hop_symbol_changed "\$BASE_REF"/);
        expect(block).toMatch(/\n\s*exit 3\n/);
        expect(block).toContain('--cross-snapshot');
        expect(block).toContain('cold golden');
    });

    // The `|| true` that keeps a clean or test-only change set runnable. The BEHAVIOUR is
    // pinned by the executing block below ('a clean change set …'); this reads the
    // shipped line so a future edit that drops it is named, not just red somewhere.
    it('reads changed_paths with `|| true` — grep -v exits 1 on an empty result and errexit would kill the gate', () => {
        expect(GATE_SRC).toContain('ONE_HOP_CHANGED="$(changed_paths || true)"');
        expect(GATE_SRC).not.toContain('ONE_HOP_CHANGED="$(changed_paths)"');
    });
});

// ============================================================================
// winner-gate.sh one-hop abort — THE EXECUTING PIN
// ============================================================================
/**
 * WHY A SECOND, HEAVIER PIN EXISTS FOR THE SAME BLOCK.
 *
 * Everything above reads winner-gate.sh as TEXT or calls one-hop-guard.sh's functions
 * directly. Neither form can tell a wired gate from an unwired one, and an adversarial
 * pass measured exactly that: `-n` -> `-z` on ONE_HOP_HITS, `for one_hop_entry in ""`,
 * `ONE_HOP_SYMBOLS=""` after the source line, and a `one_hop_symbol_changed` that
 * ignores its <base-ref> argument ALL left the suite green while the real gate never
 * aborted — the last of those silently unguarding the COMMITTED edit, which is the
 * normal state a branch is gated in. Dropping five of the six list entries failed
 * nothing, and deleting the whole-line membership test failed nothing either.
 *
 * So these cases run the SHIPPED script — `bash scripts/eval/winner-gate.sh` — inside a
 * throwaway git repo holding the real listed files, with a stub `npx` first on PATH.
 *
 * HOW THE SENTINEL WORKS. The stub answers `winner-diff hashes` with a resolvable
 * variant line and every other subcommand with nothing, exit 0. A run that clears all
 * four aborts therefore reaches the snapshot check and dies there with
 * `exit 2, "the cold snapshot holds 0 of N seeds"`. So exit 2 means "got past the
 * one-hop block", exit 3 means one of the aborts fired (the stderr says which), and the
 * blocker-1 shape — errexit killing the gate at the first top-level `changed_paths` —
 * shows up as its own distinct exit 1 with EMPTY stderr.
 *
 * Cost: each case is a bash run plus a handful of git calls. The three cases that get
 * past the aborts also make and remove a `/tmp/winner-gate-base-<stamp>` worktree, the
 * way a real run does; they are serial, and each run's own EXIT trap removes it.
 */
describe('winner-gate.sh one-hop abort — executed end to end in a throwaway repo', () => {
    /** Exit 2 with this text = every abort cleared; the stub has no winner-diff to run. */
    const PAST_ALL_ABORTS = 2;
    const PAST_MARKER = 'the cold snapshot holds 0 of';

    let repo = '';
    let binDir = '';
    let base0 = '';
    const artifacts = new Set<string>();

    const git = (...args: string[]) => {
        const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
            cwd: repo, encoding: 'utf8',
            env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
        });
        if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
        return r.stdout.trim();
    };

    const write = (rel: string, content: string) => {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
        fs.writeFileSync(path.join(repo, rel), content);
    };
    const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

    function runGate(baseRef: string) {
        const r = spawnSync('bash', [
            'scripts/eval/winner-gate.sh',
            '--cold-seeds', 'seeds.txt', '--base', baseRef, '--regression', '0',
        ], {
            cwd: repo, encoding: 'utf8', timeout: 120_000,
            env: {
                ...process.env,
                PATH: `${binDir}:${process.env.PATH}`,
                GIT_CONFIG_GLOBAL: '/dev/null',
                GIT_CONFIG_NOSYSTEM: '1',
            },
        });
        if (r.error) throw r.error;
        for (const m of (r.stdout ?? '').matchAll(/^artifacts:\s+(\/tmp\/\S+)$/gm)) artifacts.add(m[1]);
        // a run that materialized a BASE worktree removes it in its own trap; prune the
        // admin entry so a later add to the same path in the same second cannot collide
        spawnSync('git', ['worktree', 'prune'], { cwd: repo, encoding: 'utf8' });
        return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    }

    beforeAll(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'one-hop-gate-'));
        // The stub lives OUTSIDE the repo on purpose: inside, it would be an untracked
        // file, changed_paths would never be empty, and the blocker-1 case below could
        // not exist.
        binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-hop-bin-'));
        fs.writeFileSync(path.join(binDir, 'npx'), [
            '#!/usr/bin/env bash',
            '# stub: resolve the caller variant, run no winner-diff, never fail (pipefail).',
            'for a in "$@"; do [ "$a" = "hashes" ] && { echo "this tree is: baseline (stub)"; exit 0; }; done',
            'exit 0',
            '',
        ].join('\n'), { mode: 0o755 });

        // the two shipped scripts, the files the guard lists, and the three producers it
        // names — all read from the tree so the fixture cannot drift from the real one
        write('scripts/eval/winner-gate.sh', fs.readFileSync(GATE_PATH, 'utf8'));
        write('scripts/eval/one-hop-guard.sh', guardSrc());
        write('scripts/eval/winner-diff.ts', '// stub: the gate only checks that this exists\n');
        const fixtureFiles = new Set<string>([
            ...oneHopEntries().map(e => e.file),
            ...guardVar('ONE_HOP_IMPORTERS').trim().split(/\s+/),
        ]);
        for (const rel of fixtureFiles) write(rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
        write('seeds.txt', 'one\ntwo\nthree\n');

        git('init', '-q', '-b', 'feature');
        git('add', '-A');
        git('commit', '-qm', 'base');
        base0 = git('rev-parse', 'HEAD');

        // a simulated base ref that moved a listed symbol AFTER the branch point
        git('checkout', '-q', '-B', 'basesim', base0);
        write(FILTER_FIXTURE_REL, editInside(read(FILTER_FIXTURE_REL), 'detectGrainCookingContext'));
        git('add', '-A');
        git('commit', '-qm', 'base ref moves a listed symbol');
        git('checkout', '-q', 'feature');
    });

    afterAll(() => {
        for (const d of [repo, binDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
        for (const a of artifacts) fs.rmSync(a, { recursive: true, force: true });
    });

    beforeEach(() => {
        git('checkout', '-q', '-B', 'feature', base0);
        git('reset', '-q', '--hard', base0);
        git('clean', '-qfd');
    });

    it('a — an UNCOMMITTED edit inside a listed symbol aborts 3 and names file, symbol and reach', () => {
        write(FILTER_FIXTURE_REL, editInside(read(FILTER_FIXTURE_REL), 'detectGrainCookingContext'));
        const r = runGate(base0);
        expect({ status: r.status, named: r.stderr.includes(`${FILTER_FIXTURE_REL} : detectGrainCookingContext`) })
            .toEqual({ status: 3, named: true });
        expect(r.stderr).toContain('ONE IMPORT HOP');
        expect(r.stderr).toContain('imported by src/lib/mapping/gather-candidates.ts');
    });

    it('a2 — the same for a CLAUSE-4 TABLE: the guard was blind to VOLUME_COOKED_GRAINS and is not now', () => {
        // the measured witness: 'bulgur' here flips detectGrainCookingContext to softCooked
        // while the function's own region is byte-identical.
        write(FILTER_FIXTURE_REL, read(FILTER_FIXTURE_REL)
            .replace("    'oats', 'oatmeal', 'couscous', 'barley', 'farro',",
                "    'oats', 'oatmeal', 'couscous', 'barley', 'farro', 'bulgur',"));
        const r = runGate(base0);
        expect({ status: r.status, named: r.stderr.includes(`${FILTER_FIXTURE_REL} : VOLUME_COOKED_GRAINS`) })
            .toEqual({ status: 3, named: true });
        expect(r.stderr).toContain('read by detectGrainCookingContext');
    });

    it('b — a COMMITTED edit with --base at the pre-edit ref aborts 3 (the normal state a branch is gated in)', () => {
        write(FILTER_FIXTURE_REL, editInside(read(FILTER_FIXTURE_REL), 'detectGrainCookingContext'));
        git('add', '-A');
        git('commit', '-qm', 'branch changes a listed symbol');
        const r = runGate(base0);
        expect({ status: r.status, hop: r.stderr.includes('ONE IMPORT HOP') }).toEqual({ status: 3, hop: true });
    });

    it('c — an edit OUTSIDE every listed region does NOT abort: filter-candidates.ts stays gateable', () => {
        write(FILTER_FIXTURE_REL, editInside(read(FILTER_FIXTURE_REL), 'hasCriticalModifierMismatch'));
        const r = runGate(base0);
        expect({ status: r.status, past: r.stderr.includes(PAST_MARKER) })
            .toEqual({ status: PAST_ALL_ABORTS, past: true });
    });

    it('d — a CLEAN and a TEST-ONLY change set both get PAST the one-hop block (the blocker-1 regression)', () => {
        // Without `|| true`, changed_paths' trailing `grep -vE` exits 1 on an empty result
        // and errexit kills the gate here: exit 1, no stderr, an exit code that is not in
        // the table. Both halves are the shape NON_REPLAY_PATHS exists to keep runnable.
        const clean = runGate(base0);
        expect({ case: 'clean', status: clean.status, past: clean.stderr.includes(PAST_MARKER) })
            .toEqual({ case: 'clean', status: PAST_ALL_ABORTS, past: true });

        write('src/lib/mapping/__tests__/one-hop-fixture.test.ts', '// test-only edit\n');
        const testOnly = runGate(base0);
        expect({ case: 'test-only', status: testOnly.status, past: testOnly.stderr.includes(PAST_MARKER) })
            .toEqual({ case: 'test-only', status: PAST_ALL_ABORTS, past: true });
    });

    it('e — the BASE REF moved a listed symbol and the branch touches a different file: no abort', () => {
        // the whole-line membership test is what makes this pass. Without it the region
        // compare reads the base ref's tip, sees ITS edit, and aborts on a branch that
        // never touched the file.
        fs.appendFileSync(path.join(repo, 'src/lib/mapping/corrupt-mark.ts'), '\n// branch edit\n');
        git('add', '-A');
        git('commit', '-qm', 'branch touches another file');
        const r = runGate('basesim');
        expect({ status: r.status, past: r.stderr.includes(PAST_MARKER) })
            .toEqual({ status: PAST_ALL_ABORTS, past: true });
    });

    it('f — BEHIND the base ref: the branch touches the listed FILE elsewhere, so it is blamed unless attribution runs', () => {
        // Membership is scoped to the MERGE BASE and the region compare reads the base
        // ref's TIP, so this branch sees an edit it does not contain. Still exit 3 (the
        // two trees do differ in a pool producer) but a DIFFERENT message: the printed
        // remedy for the other abort — SPLIT the edit off — cannot apply here.
        write(FILTER_FIXTURE_REL, editInside(read(FILTER_FIXTURE_REL), 'hasCriticalModifierMismatch'));
        git('add', '-A');
        git('commit', '-qm', 'branch edits an unlisted region of a listed file');
        const r = runGate('basesim');
        expect({ status: r.status, behind: r.stderr.includes('ABORT: BEHIND basesim') })
            .toEqual({ status: 3, behind: true });
        expect(r.stderr).toContain('merge and re-run');
        expect(r.stderr).not.toContain('ABORT: this branch changes a symbol');
    });

    it('g — RENAMING a listed file while editing its listed symbol still aborts 3 (refuter F1)', () => {
        // `git diff --name-only` reports only the NEW path for a rename, so before the
        // membership exemption the OLD path was not in the change set, the pre-filter
        // `continue`d, and this ran to exit 2 past all four aborts — the guard skipped
        // entirely on the move that most obviously relocates a pool producer.
        const moved = 'src/lib/mapping/candidate-filter.ts';
        git('mv', FILTER_FIXTURE_REL, moved);
        write(moved, editInside(read(moved), 'detectGrainCookingContext'));
        git('add', '-A');
        git('commit', '-qm', 'rename the listed file and edit the listed symbol');
        const r = runGate(base0);
        expect({ status: r.status, named: r.stderr.includes(`${FILTER_FIXTURE_REL} : detectGrainCookingContext`) })
            .toEqual({ status: 3, named: true });
        expect(r.stderr).toContain('ONE IMPORT HOP');
    });

    it('g2 — DELETING a listed file aborts 3 and says the file is absent, not "nothing listed"', () => {
        git('rm', '-q', 'src/lib/mapping/corrupt-mark.ts');
        git('commit', '-qm', 'delete a listed file');
        const r = runGate(base0);
        expect({ status: r.status, named: r.stderr.includes('src/lib/mapping/corrupt-mark.ts : isCorruptExclusionEnabled') })
            .toEqual({ status: 3, named: true });
    });

    it('h — a base ref with NO MERGE BASE is refused, not silently reduced to the uncommitted change set (refuter F5)', () => {
        // `git diff --name-only <base>...HEAD` exits 128 with no output when there is no
        // merge base, and it sits FIRST in a brace group whose status is the LAST
        // command's — so the whole COMMITTED change set vanished and this ran on to the
        // snapshot check with every abort asked about uncommitted work alone. Pre-existing
        // and it hit RETRIEVAL_PATHS and FROZEN_INPUT_PATHS identically, which is why the
        // fix is one preflight rather than four.
        git('checkout', '-q', '--orphan', 'unrelated');
        git('rm', '-q', '-rf', '.');
        write('unrelated.txt', 'no shared history\n');
        git('add', '-A');
        git('commit', '-qm', 'unrelated root');
        git('checkout', '-q', '-B', 'feature', base0);
        write(FILTER_FIXTURE_REL, editInside(read(FILTER_FIXTURE_REL), 'detectGrainCookingContext'));
        git('add', '-A');
        git('commit', '-qm', 'branch changes a listed symbol');
        const r = runGate('unrelated');
        expect({ status: r.status, refused: r.stderr.includes('NO MERGE BASE') })
            .toEqual({ status: 2, refused: true });
        // and it must not have reached the point where it reports on a truncated change set
        expect(r.stderr).not.toContain(PAST_MARKER);
    });

    it('h2 — a base ref that names no commit is refused by the same preflight', () => {
        const r = runGate('refs/heads/does-not-exist');
        expect({ status: r.status, refused: r.stderr.includes('does not name a commit') })
            .toEqual({ status: 2, refused: true });
    });

    it('EVERY listed entry aborts when its own region is edited — dropping any of them fails here', () => {
        for (const { file, symbol } of oneHopEntries()) {
            git('checkout', '-q', '-B', 'feature', base0);
            git('reset', '-q', '--hard', base0);
            git('clean', '-qfd');
            write(file, editInside(read(file), symbol));
            const r = runGate(base0);
            expect({ file, symbol, status: r.status, named: r.stderr.includes(`${file} : ${symbol}`) })
                .toEqual({ file, symbol, status: 3, named: true });
        }
    });
});

// ============================================================================
// The route rule isDeterministicSingleItemText transcribes — drift pin
// ============================================================================
/**
 * `isDeterministicSingleItemText()` in winner-diff-screens.ts is a HAND-TRANSCRIBED
 * mirror of `singleItemFromText()` in src/app/api/nlp/parse/route.ts, and its own
 * comment says "if the route's rule changes, this must change with it. It is pinned
 * by a test." That was half true: the behavioural cases above pin what the MIRROR
 * does, and nothing at all watched the ORIGINAL. Add `\bor\b` to the route's
 * MULTI_ITEM_SIGNALS and every one of them still passes while the golden screen
 * starts judging segmenter-bound cases as if a one-query replay reproduced them.
 *
 * winner-diff-screens.ts cannot hold this check itself — it declares "no I/O of any
 * kind", which is load-bearing for its testability — so the pin lives here, in the
 * one place that already reads shipped source off disk.
 *
 * WHAT IT COVERS, and why it is a REGION and not just the function: the rule is three
 * pieces of source. Both regexes are module-level constants the function only
 * references, so a hash over the function body alone would sit still through the most
 * likely edit there is — adding a separator to MULTI_ITEM_SIGNALS.
 *
 * WHEN THIS GOES RED: read both sides, decide whether the mirror must change, change
 * it, THEN re-pin. Re-pinning first is how a drift guard becomes a formality — this
 * repo has the receipts (PINNED_HELPERS_HASH, whose only two re-pins were both
 * measurement bugs rather than code changes, and which says so at the pin).
 *
 * Line endings are normalized before hashing. .gitattributes pins only the three files
 * the winner-diff drift guard reads, and route.ts is NOT among them, so on a Windows
 * checkout an un-normalized hash would flip with no source change — the exact bug that
 * cost this repo a false DRIFT banner on unchanged selection code.
 */
describe('the parse route rule that winner-diff-screens transcribes', () => {
    const ROUTE_REL = 'src/app/api/nlp/parse/route.ts';

    /** The three source pieces that decide the rule, extracted fail-closed. */
    function routeRuleSource(): string {
        const src = fs.readFileSync(path.join(REPO_ROOT, ROUTE_REL), 'utf8')
            .replace(/\r/g, '').split('\n');
        const out: string[] = [];
        for (const anchor of ['const MEAL_SUFFIX =', 'const MULTI_ITEM_SIGNALS =']) {
            const i = src.findIndex(l => l.trimStart().startsWith(anchor));
            if (i < 0) throw new Error(`drift pin: '${anchor}' not found in ${ROUTE_REL}`);
            out.push(src[i]);
        }
        const start = src.findIndex(l => l.trimStart().startsWith('function singleItemFromText('));
        if (start < 0) throw new Error(`drift pin: singleItemFromText not found in ${ROUTE_REL}`);
        let end = start;
        while (end < src.length && src[end].trimEnd() !== '}') end++;
        if (end >= src.length) {
            throw new Error(
                'drift pin: no closing brace for singleItemFromText before EOF. The anchor '
                + 'matched something else, or the function moved. Do NOT widen the capture — '
                + 'an over-broad region moves on unrelated edits and trains readers to re-pin '
                + 'without reading (see copiedHelperSource in winner-diff.ts).');
        }
        out.push(src.slice(start, end + 1).join('\n'));
        return out.join('\n---\n');
    }

    /** Re-pin ONLY after reconciling isDeterministicSingleItemText with the route. */
    const PINNED_ROUTE_RULE_HASH = '80719c0439bca3d4';

    it('has not drifted from the transcription in winner-diff-screens.ts', () => {
        const actual = createHash('sha256').update(routeRuleSource()).digest('hex').slice(0, 16);
        expect({ hash: actual, note: 'route rule vs isDeterministicSingleItemText' })
            .toEqual({ hash: PINNED_ROUTE_RULE_HASH, note: 'route rule vs isDeterministicSingleItemText' });
    });

    /**
     * A hash alone cannot say WHICH way it drifted, so pin the two constants by value
     * as well. These are the parts the mirror restates verbatim; a red here names the
     * edit, which is what makes the red above actionable rather than just alarming.
     */
    it('carries the two separator rules the mirror restates verbatim', () => {
        const src = routeRuleSource();
        expect(src).toContain('/\\s*(?:for|at|as)\\s+(breakfast|lunch|dinner|snacks?)\\s*\\.?\\s*$/i');
        expect(src).toContain('/[,;\\n+&]|\\b(?:and|with|plus)\\b/i');
        expect(src).toContain('trimmed.length > 60');
        expect(src).toContain("rawText.split(/\\s+/).length > 6");
    });

    /**
     * The mirror and the original must agree on real inputs, not just look alike. This
     * re-derives the route's decision from the extracted source rather than importing
     * the route (which would pull next/server, Supabase and Prisma into a suite that
     * deliberately touches none of them).
     */
    it('agrees with the mirror on the boundary cases the route decides', () => {
        const src = routeRuleSource();
        const mealRe = new RegExp(/\s*(?:for|at|as)\s+(breakfast|lunch|dinner|snacks?)\s*\.?\s*$/, 'i');
        const multiRe = new RegExp(/[,;\n+&]|\b(?:and|with|plus)\b/, 'i');
        // guard: the literals above are only a faithful stand-in while they are the
        // ones the route actually ships, which the previous case has just asserted.
        expect(src).toContain(mealRe.source);
        expect(src).toContain(multiRe.source);

        const routeSaysSingleItem = (text: string): boolean => {
            const trimmed = (text ?? '').trim();
            if (trimmed.length === 0 || trimmed.length > 60) return false;
            let rawText = trimmed;
            const m = trimmed.match(mealRe);
            if (m) rawText = trimmed.slice(0, m.index).trim();
            if (rawText.length === 0 || multiRe.test(rawText)) return false;
            return rawText.split(/\s+/).length <= 6;
        };

        for (const t of [
            '7up', '2 7up', 'three slices of bacon', 'chicken breast for lunch',
            '2 eggs and toast', 'coffee, bagel', 'a b c d e f g', 'x'.repeat(61),
            '   ', 'for lunch', 'toast with peanut butter', 'burger + fries',
            'noodles and company buttered noodles', 'grilled chicken at dinner',
        ]) {
            expect({ t, mirror: isDeterministicSingleItemText(t) })
                .toEqual({ t, mirror: routeSaysSingleItem(t) });
        }
    });
});

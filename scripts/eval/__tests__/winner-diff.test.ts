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
        expect(all.length).toBe(281);

        const n = (pred: (c: GoldenCase) => boolean) => all.filter(pred).length;
        expect(n(c => c.expectName.length > 0)).toBe(281);
        // 150 since 2026-08-15 (n-micro-01); 162 since 2026-08-17 (the twelve one-item prose lines)
        expect(n(c => !!c.grams)).toBe(166);              // the majority assertion
        // 66 since 2026-08-15 (n-micro-01's sodium100 band); 69 since 2026-08-17
        // (n-prose-01 protein100/fat100, n-prose-03 and n-prose-10 kcal100 as the
        // cooked-vs-dry discriminator the _readme's STANDING RULE asks for)
        // 75 since 2026-08-24: the six synonym-direction kcal100 bands.
        // 85 since 2026-08-24 (n-grd-01..07, every one carries a kcal100 band)
        expect(n(c => !!c.macros)).toBe(85);
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
        expect(n(c => !!c.total)).toBe(53);
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
        // UNCHANGED at 38 by the 2026-08-15 additions: all four carry a numeric band.
        // 42 since 2026-08-17: the four multi-item prose sentences (n-prose-13..16)
        // are identity + expectItems only, by the _readme's own rule — bands read
        // items[0], and index 0 of a seven-item sentence is a segmentation artefact.
        expect(n(c => !c.grams && !c.total && !c.macros)).toBe(42);

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
        expect([item.length, text.length]).toEqual([166, 115]);
        expect(item.filter(c => c.grams).length).toBe(119);
        expect(item.filter(c => c.macros).length).toBe(48);
        // 17 since 2026-08-07: n-mq-34 (item shape) gained a total.calories band.
        // 21 since 2026-08-15: n-chain-01..03 + n-micro-01.
        expect(item.filter(c => c.total).length).toBe(21);
        // 31 -> 43 and 47 -> 63 on 2026-08-17 (prose set; see the count pin above)
        // 47 since 2026-08-24: n-grd-06 `4 oz ground chicken` is text-shaped with a grams band.
        expect(text.filter(c => c.grams).length).toBe(47);
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
        expect(cov.cases).toBe(281);
        expect(kind('grams')).toEqual({ kind: 'grams', asserted: 166, blind: 166 });
        // 37 since 2026-08-07: n-mq-34's total.calories band (see the count pin above).
        expect(kind('total')).toEqual({ kind: 'total', asserted: 53, blind: 53 });
        expect(kind('expectItems')).toEqual({ kind: 'expectItems', asserted: 63, blind: 63 });
        // expectName is judgeable except on the segmenter-bound text lines
        const en = kind('expectName');
        expect(en.asserted).toBe(281);
        expect(en.blind).toBeGreaterThan(0);
        expect(en.blind).toBeLessThan(274);
        // every grams band in the corpus is unjudgeable here...
        expect(cov.gramsCases).toBe(166);
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

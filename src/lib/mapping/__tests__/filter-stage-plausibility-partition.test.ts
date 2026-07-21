/**
 * PR D pt3 (Lever B2/B4 mapper side) — rank-time plausibility partition +
 * denylist at the FILTER/SORT stage of map-ingredient-with-fallback (the
 * rerank-side partition is covered by plausibility-partition.test.ts).
 *
 * The load-bearing seam (adversarial finding 1): `sortedFiltered` is rebuilt
 * by a fresh score sort immediately before confidenceGate consumes it, and OFF
 * raw scores (~0-10) dwarf FDC's (~0-1.5) — so neither an upstream partition
 * of `filtered` nor the existing ×0.3 score multiply can stop a corrupt
 * high-score OFF record from winning basic_produce_bypass. The fix lives in
 * the sort comparator itself; these tests exercise exactly that ordering.
 *
 * Golden context: n-mq-27 (lemon kJ-as-kcal), n-mq-28 (onion), n-mq-24 (tuna).
 */

import {
    computeFloorHitIds,
    candidateHitsPlausibilityFloor,
    dropDenylistedCandidates,
    makeSortedFilteredComparator,
} from '../map-ingredient-with-fallback';
import type { UnifiedCandidate } from '../gather-candidates';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

function cand(overrides: Partial<UnifiedCandidate> & { id: string; name: string }): UnifiedCandidate {
    return {
        source: 'openfoodfacts',
        score: 1,
        ...overrides,
    } as UnifiedCandidate;
}

// Corrupt OFF produce record: kJ stored as kcal (lemon 383 "kcal"/100g) —
// trips the fresh-produce floor but is internally consistent enough to pass
// bounds/Atwater, and its raw OFF score dwarfs the FDC candidate's.
const corruptOffLemon = cand({
    id: 'off_0840609112113',
    name: 'Lemon',
    source: 'openfoodfacts',
    score: 9.4,
    nutrition: { kcal: 383, protein: 1.1, carbs: 9.3, fat: 0.3, per100g: true },
});
const plausibleFdcLemon = cand({
    id: 'fdc_167746',
    name: 'Lemon',
    source: 'fdc',
    score: 1.2,
    nutrition: { kcal: 29, protein: 1.1, carbs: 9.3, fat: 0.3, per100g: true },
});

const ORIGINAL_FLAG = process.env.RANK_PLAUSIBILITY_PARTITION;

afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.RANK_PLAUSIBILITY_PARTITION;
    else process.env.RANK_PLAUSIBILITY_PARTITION = ORIGINAL_FLAG;
});

describe('computeFloorHitIds', () => {
    it('flags the kJ-as-kcal produce record, not the plausible one', () => {
        const ids = computeFloorHitIds('lemon', [corruptOffLemon, plausibleFdcLemon]);
        expect(ids.has('off_0840609112113')).toBe(true);
        expect(ids.has('fdc_167746')).toBe(false);
    });

    it('never flags candidates without inline per-100g nutrition', () => {
        const noNutrition = cand({ id: 'off_x', name: 'Lemon', score: 5 });
        const ids = computeFloorHitIds('lemon', [noNutrition]);
        expect(ids.size).toBe(0);
    });

    it('kill-switch RANK_PLAUSIBILITY_PARTITION=0 disables flagging', () => {
        process.env.RANK_PLAUSIBILITY_PARTITION = '0';
        const ids = computeFloorHitIds('lemon', [corruptOffLemon]);
        expect(ids.size).toBe(0);
    });
});

describe('candidateHitsPlausibilityFloor (fallback-loop rejection, B4)', () => {
    it('flags a low-protein record for a lean-cut query (tuna 5.66g)', () => {
        const sauced = cand({
            id: 'off_0859710005238',
            name: 'Tuna',
            nutrition: { kcal: 180, protein: 5.66, carbs: 10, fat: 12, per100g: true },
        });
        expect(candidateHitsPlausibilityFloor('tuna', sauced)).toBe(true);
    });

    it('passes plausible records and honors the kill-switch', () => {
        expect(candidateHitsPlausibilityFloor('lemon', plausibleFdcLemon)).toBe(false);
        process.env.RANK_PLAUSIBILITY_PARTITION = '0';
        expect(candidateHitsPlausibilityFloor('lemon', corruptOffLemon)).toBe(false);
    });
});

describe('makeSortedFilteredComparator — the finding-1 seam', () => {
    it('ranks a plausible low-score record above a corrupt high-score one', () => {
        const floorHitIds = computeFloorHitIds('lemon', [corruptOffLemon, plausibleFdcLemon]);
        const sorted = [corruptOffLemon, plausibleFdcLemon].sort(
            makeSortedFilteredComparator('lemon', false, floorHitIds)
        );
        // This ordering is what confidenceGate's basic_produce_bypass consumes:
        // sortedFiltered[0] MUST be the plausible record despite the 9.4-vs-1.2
        // raw-score gap (the existing ×0.3 multiply demonstrably loses here).
        expect(sorted[0].id).toBe('fdc_167746');
        expect(sorted[1].id).toBe('off_0840609112113');
    });

    it('kill-switch off (empty floor set) restores pure score ordering', () => {
        const sorted = [plausibleFdcLemon, corruptOffLemon].sort(
            makeSortedFilteredComparator('lemon', false, new Set())
        );
        expect(sorted[0].id).toBe('off_0840609112113');
    });

    it('all-floor-hit input degrades to score ordering (comparative no-op)', () => {
        const corruptA = cand({
            id: 'off_a', name: 'Lemon', score: 3,
            nutrition: { kcal: 383, protein: 1, carbs: 9, fat: 0.3, per100g: true },
        });
        const corruptB = cand({
            id: 'off_b', name: 'Lemon Fresh', score: 7,
            nutrition: { kcal: 401, protein: 1, carbs: 9, fat: 0.3, per100g: true },
        });
        const floorHitIds = computeFloorHitIds('lemon', [corruptA, corruptB]);
        expect(floorHitIds.size).toBe(2);
        const sorted = [corruptA, corruptB].sort(
            makeSortedFilteredComparator('lemon', false, floorHitIds)
        );
        expect(sorted[0].id).toBe('off_b'); // higher score still wins within the floor tier
    });

    it('preserves the basic-produce FDC exact-match tiebreak below the floor clause', () => {
        const fs = cand({ id: 'fs-1', name: 'Spinach', source: 'ai_generated', score: 1.0 });
        const fdc = cand({ id: 'fdc-1', name: 'Spinach', source: 'fdc', score: 1.0 });
        const sorted = [fs, fdc].sort(makeSortedFilteredComparator('spinach', true, new Set()));
        expect(sorted[0].id).toBe('fdc-1');
    });
});

describe('dropDenylistedCandidates', () => {
    const denylisted = cand({ id: 'off_0062020001849', name: 'Nutella', score: 8 }); // triage-confirmed corrupt
    const clean = cand({ id: 'off_1234567890123', name: 'Hazelnut Spread', score: 2 });

    it('drops denylisted OFF records when alternatives remain', () => {
        const kept = dropDenylistedCandidates([denylisted, clean], 'nutella');
        expect(kept.map(c => c.id)).toEqual(['off_1234567890123']);
    });

    it('all-drop restore: keeps the original list when every candidate is denylisted', () => {
        const kept = dropDenylistedCandidates([denylisted], 'nutella');
        expect(kept).toHaveLength(1);
        expect(kept[0].id).toBe('off_0062020001849');
    });

    it('kill-switch RANK_PLAUSIBILITY_PARTITION=0 disables the drop', () => {
        process.env.RANK_PLAUSIBILITY_PARTITION = '0';
        const kept = dropDenylistedCandidates([denylisted, clean], 'nutella');
        expect(kept).toHaveLength(2);
    });

    it('leaves non-OFF and unknown ids untouched', () => {
        const fdc = cand({ id: 'fdc_171705', name: 'Peanut Butter', source: 'fdc', score: 1 });
        expect(dropDenylistedCandidates([fdc, clean], 'x')).toHaveLength(2);
    });
});

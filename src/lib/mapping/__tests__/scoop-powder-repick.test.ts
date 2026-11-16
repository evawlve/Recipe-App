/**
 * s459 SCOOP-PICK: on a scoop line, a ready-to-drink winner gives its seat to a powder record of the
 * same product (scoop-powder-repick.ts, wired at the end of simpleRerank()'s sort).
 *
 * The windows below are the real deploy-42 rerank windows (winner-diff snapshot cut on df56cd22, the
 * A1 replay's rerankWindowIds; s459 pd-scoop gate/). Candidate flags the mapper sets
 * (servingLabelMatch, countLabelMatch) are left unset, so these pin the re-pick, not the full score.
 */

import { simpleRerank, type RerankCandidate } from '../simple-rerank';
import {
    findScoopPowderRepick,
    isPowderSiblingOf,
    isRtdByNameAndPanel,
    isScoopLine,
    SCOOP_POWDER_MIN_SCORE,
} from '../scoop-powder-repick';

type Nutr = RerankCandidate['nutrition'];
function c(id: string, name: string, brandName: string | undefined, score: number, source: RerankCandidate['source'], nutrition: Nutr): RerankCandidate {
    return { id, name, brandName, score, source, nutrition };
}

// `1 scoop muscle milk chocolate`: its deploy-42 rerank window, base winner off_0052000066951.
const MM_CHOC: RerankCandidate[] = [
    c("off_0872163002012", "Muscle Milk Chocolate Protein Shake", "Muscle Milk", 12.75, 'openfoodfacts', { kcal: 41.1, protein: 6.04, carbs: 2.66, fat: 1.21, per100g: true }),
    c("fs_8905093", "Pro Series 40 Knockout Chocolate (14 oz)", "Muscle Milk", 1.425, 'fatsecret', { kcal: 55, protein: 10.08, carbs: 3.02, fat: 0.63, per100g: true }),
    c("off_0876063003131", "Muscle Milk (Knockout Chocolate)", "Muscle Milk", 9.8, 'openfoodfacts', { kcal: 51.5, protein: 9.7, carbs: 2.73, fat: 0.61, per100g: true }),
    c("fs_3852378", "Chocolate Protein Powder", "Muscle Milk", 1.395, 'fatsecret', { kcal: 386, protein: 45.71, carbs: 28.57, fat: 12.86, per100g: true }),
    c("off_0052000066951", "Muscle Milk PRO33g - Chocolate", "Muscle Milk", 9.75, 'openfoodfacts', { kcal: 61.54, protein: 10.15, carbs: 3.69, fat: 0.62, per100g: true }),
    c("fs_3827215", "Chocolate Milk Protein Shake (11 oz)", "Muscle Milk", 1.365, 'fatsecret', { kcal: 47.07, protein: 7.65, carbs: 3.24, fat: 0.44, per100g: true }),
    c("off_0057271163255", "Muscle milk protien chocolate", undefined, 5.8, 'openfoodfacts', { kcal: 48.48, protein: 7.58, carbs: 2.73, fat: 1.36, per100g: true }),
    c("fs_12854025", "Non Dairy Chocolate Protein Shake (11 oz)", "Muscle Milk", 1.335, 'fatsecret', { kcal: 55, protein: 8.02, carbs: 3.53, fat: 1.6, per100g: true }),
    c("off_0052000067088", "Muscle Milk Pro 33g Chocolate", "Muscle Milk", 9.75, 'openfoodfacts', { kcal: 61.54, protein: 10.15, carbs: 3.69, fat: 0.62, per100g: true }),
    c("fs_21911306", "Non Dairy Chocolate Protein Shake (14 oz)", "Muscle Milk", 1.305, 'fatsecret', { kcal: 43, protein: 6.55, carbs: 3.28, fat: 0.38, per100g: true }),
];

// `1 scoop proteína de vainilla`: its deploy-42 rerank window, base winner off_0834450000156.
const VANILLA_PROTEIN: RerankCandidate[] = [
    c("off_9345856101527", "Vanilla Protein", "Ultimat Plant Protein BRAW", 6.9, 'openfoodfacts', { kcal: 397.5, protein: 72, carbs: 11.5, fat: 6, per100g: true }),
    c("fs_5201877", "100% Whey Protein - Vanilla Cream", "Pure Protein", 1.425, 'fatsecret', { kcal: 308, protein: 64.1, carbs: 20.51, fat: 5.13, per100g: true }),
    c("off_0834450000156", "Vanilla Protein", "Ideal Protein", 6.9, 'openfoodfacts', { kcal: 38.81, protein: 5.97, carbs: 1.79, fat: 1.19, per100g: true }),
    c("fs_33100751", "Vanilla Protein Shake", "Quest", 1.395, 'fatsecret', { kcal: 52.31, protein: 9.23, carbs: 0.92, fat: 0.92, per100g: true }),
    c("off_9421907823652", "Vanilla protein", "Nothing Naughty", 6.9, 'openfoodfacts', { kcal: 424.47, protein: 77.6, carbs: 10.8, fat: 6.8, per100g: true }),
    c("fs_5678678", "Natural Whey Protein - Vanilla Creme", "Pure Protein", 1.365, 'fatsecret', { kcal: 394, protein: 75.76, carbs: 18.18, fat: 4.55, per100g: true }),
    c("off_86001151", "Vanilla Protein", "Spacemilk", 6.9, 'openfoodfacts', { kcal: 379.31, protein: 68.97, carbs: 13.79, fat: 5.17, per100g: true }),
    c("fs_43458372", "Vanilla Protein Powder", "Aloha", 1.335, 'fatsecret', { kcal: 343, protein: 51.43, carbs: 31.43, fat: 7.14, per100g: true }),
    c("off_9349093008977", "Vanilla Protein", "Prana On", 6.9, 'openfoodfacts', { kcal: 405, protein: 71.8, carbs: 10.5, fat: 9.5, per100g: true }),
    c("fs_439076", "Rockin' Refuel Low Fat Vanilla Protein Fortified Milk", "Shamrock Farms", 1.305, 'fatsecret', { kcal: 76.79, protein: 5.49, carbs: 12.34, fat: 1.1, per100g: true }),
];

// `1 scoop protein ice cream`: its deploy-42 rerank window, base winner off_6010344176686.
const PROTEIN_ICE_CREAM: RerankCandidate[] = [
    c("off_6010344176686", "Protein ice cream", undefined, 8.85, 'openfoodfacts', { kcal: 145, protein: 8.4, carbs: 9.9, fat: 6.9, per100g: true }),
    c("fs_135557865", "Protein Ice Cream", "David", 1.425, 'fatsecret', { kcal: 57, protein: 6.61, carbs: 10.58, fat: 1.76, per100g: true }),
    c("off_0850067366126", "Protein Ice Cream", "Pints", 8.85, 'openfoodfacts', { kcal: 144.44, protein: 4.44, carbs: 21.11, fat: 4.44, per100g: true }),
    c("fs_134009085", "High Protein Ice Cream - Salted Caramel", "Protein Pints", 1.395, 'fatsecret', { kcal: 80.05, protein: 6.16, carbs: 11.7, fat: 3.69, per100g: true }),
    c("off_9120070100774", "Protein Ice Cream Bar", "CoolBite", 8.8, 'openfoodfacts', { kcal: 370, protein: 17, carbs: 28, fat: 23, per100g: true }),
    c("fs_138196388", "Coffee Protein Ice Cream", "Swoop", 1.365, 'fatsecret', { kcal: 188, protein: 12.5, carbs: 17.5, fat: 8.75, per100g: true }),
    c("off_5025840006536", "Protein Ice Cream Vanilla", "Graham's", 8.8, 'openfoodfacts', { kcal: 141, protein: 10, carbs: 13.3, fat: 4.4, per100g: true }),
    c("fs_12076494", "Primal Protein Bar - Vanilla Ice Cream", "Julian Bakery", 1.245, 'fatsecret', { kcal: 317, protein: 33.33, carbs: 43.33, fat: 8.33, per100g: true }),
    c("off_9421907881645", "Protein Ice Cream Vanilla Custard", "Swole Foods", 8.75, 'openfoodfacts', { kcal: 86.4, protein: 4.72, carbs: 3.2, fat: 5.28, per100g: true }),
    c("off_5060208332247", "Grenade protein ice cream", undefined, 5.8, 'openfoodfacts', { kcal: 285, protein: 16, carbs: 19, fat: 18, per100g: true }),
];

// `two scoops in milk`: its deploy-42 rerank window, base winner fs_794.
const IN_MILK: RerankCandidate[] = [
    c("off_9421005280319", "Passionfruit In Milk Chocolate", "Bennetts NZ", 3.8, 'openfoodfacts', { kcal: 550, protein: 7, carbs: 52.3, fat: 34.7, per100g: true }),
    c("fs_7081", "Milk, Vinegar and Sugar Dressing", undefined, 1.14, 'fatsecret', { kcal: 131, protein: 2.9, carbs: 21.54, fat: 3.22, per100g: true }),
    c("off_0883572130401", "Milk", undefined, 0.95, 'openfoodfacts', { kcal: 50.85, protein: 4.66, carbs: 5.93, fat: 1.06, per100g: true }),
    c("fs_7324", "Milk, Vinegar and Artificial Sweetener Dressing", undefined, 1.116, 'fatsecret', { kcal: 81, protein: 3.48, carbs: 6.27, fat: 3.84, per100g: true }),
    c("off_5906153205109", "Almonds In Milk Chocolate", "Doti", 3.8, 'openfoodfacts', { kcal: 582, protein: 12, carbs: 43, fat: 39, per100g: true }),
    c("fs_799", "Milk (Other Than Whole, 1% or Skim)", undefined, 1.092, 'fatsecret', { kcal: 44.08, protein: 3.33, carbs: 4.81, fat: 1.28, per100g: true }),
    c("off_0883572120402", "Milk", undefined, 0.95, 'openfoodfacts', { kcal: 100, protein: 10, carbs: 13.33, fat: 0, per100g: true }),
    c("fs_888", "Whole Milk Chocolate Milk", undefined, 1.068, 'fatsecret', { kcal: 83, protein: 3.17, carbs: 10.34, fat: 3.39, per100g: true }),
    c("off_9421904793002", "Peanut Clusters in Milk Chocolate", "Potter Brothers", 3.75, 'openfoodfacts', { kcal: 557.07, protein: 15.5, carbs: 32.7, fat: 39.5, per100g: true }),
    c("fs_794", "Whole Milk", undefined, 1.044, 'fatsecret', { kcal: 60, protein: 3.22, carbs: 4.52, fat: 3.25, per100g: true }),
];

function pick(rawLine: string, query: string, pool: RerankCandidate[], brand?: string): string | undefined {
    return simpleRerank(query, pool, undefined, rawLine, !!brand, brand).winner?.id;
}

function pickSwitchedOff(rawLine: string, query: string, pool: RerankCandidate[], brand?: string): string | undefined {
    process.env.RANK_SCOOP_POWDER = '0';
    try {
        return pick(rawLine, query, pool, brand);
    } finally {
        delete process.env.RANK_SCOOP_POWDER;
    }
}

const RTD_IDS_MM = new Set(['off_0872163002012', 'fs_8905093', 'off_0876063003131', 'off_0052000066951', 'fs_3827215',
    'off_0057271163255', 'fs_12854025', 'off_0052000067088', 'fs_21911306']);

describe('the member windows', () => {
    test('1 scoop muscle milk chocolate -> Muscle Milk Chocolate Protein Powder (was a carton)', () => {
        expect(RTD_IDS_MM.has(pickSwitchedOff('1 scoop muscle milk chocolate', 'muscle milk chocolate', MM_CHOC, 'muscle milk')!)).toBe(true);
        expect(pick('1 scoop muscle milk chocolate', 'muscle milk chocolate', MM_CHOC, 'muscle milk')).toBe('fs_3852378');
        expect(pick('2 scoops muscle milk chocolate', 'muscle milk chocolate', MM_CHOC, 'muscle milk')).toBe('fs_3852378');
    });

    test('the re-pick is named, and its confidence clears the rerank floor', () => {
        const r = simpleRerank('muscle milk chocolate', MM_CHOC, undefined, '1 scoop muscle milk chocolate', true, 'muscle milk');
        expect(r.winner?.id).toBe('fs_3852378');
        expect(r.confidence).toBeGreaterThanOrEqual(0.70);
        expect(r.reason).toBe('scoop_powder_repick');
        expect(r.sortedCandidates[0].id).toBe('fs_3852378');
    });

    test('the same window without a scoop keeps the drink (bare, bottle, shake lines)', () => {
        const off = pickSwitchedOff('muscle milk chocolate', 'muscle milk chocolate', MM_CHOC, 'muscle milk');
        expect(simpleRerank('muscle milk chocolate', MM_CHOC, undefined, 'muscle milk chocolate', true, 'muscle milk').reason).not.toBe('scoop_powder_repick');
        expect(pick('muscle milk chocolate', 'muscle milk chocolate', MM_CHOC, 'muscle milk')).toBe(off);
        expect(pick('1 bottle muscle milk chocolate', 'muscle milk chocolate', MM_CHOC, 'muscle milk')).toBe(off);
        expect(RTD_IDS_MM.has(off!)).toBe(true);
    });

    test('1 scoop proteína de vainilla (the medida twin) -> a vanilla protein POWDER, not the Ideal Protein bottle', () => {
        expect(pickSwitchedOff('1 scoop proteína de vainilla', 'vanilla protein', VANILLA_PROTEIN)).toBe('off_0834450000156');
        const w = pick('1 scoop proteína de vainilla', 'vanilla protein', VANILLA_PROTEIN);
        const rec = VANILLA_PROTEIN.find(x => x.id === w)!;
        expect(rec.nutrition!.kcal).toBeGreaterThan(250);
        expect(rec.name.toLowerCase()).toContain('vanilla protein');
    });

    test('food scoops are not touched: protein ice cream, and `two scoops in milk`', () => {
        expect(pick('1 scoop protein ice cream', 'protein ice cream', PROTEIN_ICE_CREAM))
            .toBe(pickSwitchedOff('1 scoop protein ice cream', 'protein ice cream', PROTEIN_ICE_CREAM));
        expect(pick('two scoops in milk', 'milk', IN_MILK)).toBe(pickSwitchedOff('two scoops in milk', 'milk', IN_MILK));
    });
});

describe('the guards', () => {
    test('POOL GUARD: no powder of the asked product in the pool -> the drink stays', () => {
        const noPowder = MM_CHOC.filter(x => x.id !== 'fs_3852378');
        expect(pick('1 scoop muscle milk chocolate', 'muscle milk chocolate', noPowder, 'muscle milk'))
            .toBe(pickSwitchedOff('1 scoop muscle milk chocolate', 'muscle milk chocolate', noPowder, 'muscle milk'));
    });

    test('a dense record of ANOTHER product does not qualify (it must cover every query token)', () => {
        const foreign = [...MM_CHOC.filter(x => x.id !== 'fs_3852378'),
            c('fs_7920354', 'Whey Protein Rich Chocolate', 'Pure Protein', 1.395, 'fatsecret', { kcal: 381, protein: 75, carbs: 10, fat: 5, per100g: true })];
        expect(pick('1 scoop muscle milk chocolate', 'muscle milk chocolate', foreign, 'muscle milk'))
            .toBe(pickSwitchedOff('1 scoop muscle milk chocolate', 'muscle milk chocolate', foreign, 'muscle milk'));
    });

    test('PANEL GUARD: a powder-named record with no per-100 g panel never takes the seat', () => {
        const noPanel = MM_CHOC.map(x => (x.id === 'fs_3852378' ? { ...x, nutrition: undefined } : x));
        expect(pick('1 scoop muscle milk chocolate', 'muscle milk chocolate', noPanel, 'muscle milk'))
            .toBe(pickSwitchedOff('1 scoop muscle milk chocolate', 'muscle milk chocolate', noPanel, 'muscle milk'));
    });

    test('a sibling too weak to clear the confidence floor is not re-picked', () => {
        const ranked = [
            { candidate: { name: 'Muscle Milk PRO33g - Chocolate', brandName: 'Muscle Milk', nutrition: { kcal: 61.5, per100g: true } }, score: 1.2, plausibilityFloorHit: false, decisiveBrandBoost: 0 },
            { candidate: { name: 'Chocolate Protein Powder', brandName: 'Muscle Milk', nutrition: { kcal: 386, per100g: true } }, score: SCOOP_POWDER_MIN_SCORE - 0.01, plausibilityFloorHit: false, decisiveBrandBoost: 0 },
        ];
        expect(findScoopPowderRepick(ranked, 'muscle milk chocolate', '1 scoop muscle milk chocolate')).toBe(-1);
        ranked[1].score = SCOOP_POWDER_MIN_SCORE;
        expect(findScoopPowderRepick(ranked, 'muscle milk chocolate', '1 scoop muscle milk chocolate')).toBe(1);
        ranked[1].plausibilityFloorHit = true;
        expect(findScoopPowderRepick(ranked, 'muscle milk chocolate', '1 scoop muscle milk chocolate')).toBe(-1);
    });

    test('a decisive-brand winner is never re-picked out of its brand partition', () => {
        const ranked = [
            { candidate: { name: 'Vanilla Protein', brandName: 'Ideal Protein', nutrition: { kcal: 38.8, per100g: true } }, score: 1.2, plausibilityFloorHit: false, decisiveBrandBoost: 0.3 },
            { candidate: { name: 'Vanilla Protein', brandName: 'BRAW', nutrition: { kcal: 397.5, per100g: true } }, score: 1.2, plausibilityFloorHit: false, decisiveBrandBoost: 0 },
        ];
        expect(findScoopPowderRepick(ranked, 'vanilla protein', '1 scoop vanilla protein')).toBe(-1);
    });
});

describe('the predicates', () => {
    test('isScoopLine reads the raw line', () => {
        for (const l of ['1 scoop whey', '2 scoops muscle milk', 'a scoopful of protein', '.7 scoop of vanilla protein', '1.5 scoops dymatize casein',
            'half a scoop of rice', 'a scoop and a half of whey', 'scoop of vanilla ice cream', '1 heaping scoop of whey',
            'dos scoops de proteína', 'una medida de proteína', '2 medidas de proteína', 'media medida de proteína']) expect(isScoopLine(l)).toBe(true);
        // A trailing scoop parses with no unit; a powder picked for it bills the 100 g floor.
        for (const l of ['muscle milk', '1 bottle muscle milk', 'scooped ice cream', 'protein shake (1 scoop) w/ water',
            'protein shake with 2 scoops', 'vega sport protein one scoop', undefined]) expect(isScoopLine(l)).toBe(false);
    });

    test('isRtdByNameAndPanel: drink name + dilute panel; never a frozen or spoonable food, never a powder name', () => {
        expect(isRtdByNameAndPanel({ name: 'Muscle Milk PRO33g - Chocolate', nutrition: { kcal: 61.5, per100g: true } })).toBe(true);
        expect(isRtdByNameAndPanel({ name: 'Vanilla Protein', nutrition: { kcal: 38.8, per100g: true } })).toBe(true);
        expect(isRtdByNameAndPanel({ name: 'Protein ice cream', nutrition: { kcal: 145, per100g: true } })).toBe(false);
        expect(isRtdByNameAndPanel({ name: 'Chipotle, Fajita Vegetables', nutrition: { kcal: 55.5, per100g: true } })).toBe(false);
        expect(isRtdByNameAndPanel({ name: 'Cottage Cheese', nutrition: { kcal: 98, per100g: true } })).toBe(false);
        expect(isRtdByNameAndPanel({ name: 'Protein Powder', nutrition: { kcal: 120, per100g: true } })).toBe(false);
        expect(isRtdByNameAndPanel({ name: 'Muscle milk', nutrition: { kcal: 400, per100g: true } })).toBe(false);
        expect(isRtdByNameAndPanel({ name: 'Muscle milk', nutrition: undefined })).toBe(false);
    });

    test('isPowderSiblingOf: powder band, drink or powder name, no solid food, full query coverage', () => {
        const q = 'muscle milk chocolate';
        expect(isPowderSiblingOf({ name: 'Chocolate Protein Powder', brandName: 'Muscle Milk', nutrition: { kcal: 386, per100g: true } }, q)).toBe(true);
        expect(isPowderSiblingOf({ name: 'Milk chocolate candy crunch lean muscle minis bars', nutrition: { kcal: 382, per100g: true } }, q)).toBe(false);
        expect(isPowderSiblingOf({ name: 'Passionfruit In Milk Chocolate', brandName: 'Muscle Milk', nutrition: { kcal: 550, per100g: true } }, q)).toBe(false);
        expect(isPowderSiblingOf({ name: 'Chocolate Protein Powder', brandName: 'Muscle Milk', nutrition: { kcal: 180, per100g: true } }, q)).toBe(false);
        expect(isPowderSiblingOf({ name: 'Chocolate Protein Powder', brandName: 'Muscle Milk', nutrition: { kcal: 540, per100g: true } }, q)).toBe(false);
        expect(isPowderSiblingOf({ name: 'Chocolate Protein Powder', brandName: 'Pure Protein', nutrition: { kcal: 386, per100g: true } }, q)).toBe(false);
        // The drink-or-powder word must be in the NAME (the brand's `Milk` does not count): `Pro Series 50 Knockout Chocolate` (378) stays out.
        expect(isPowderSiblingOf({ name: 'Knockout Chocolate', brandName: 'Muscle Milk', nutrition: { kcal: 378, per100g: true } }, q)).toBe(false);
        expect(isPowderSiblingOf({ name: 'Chocolate Granola', brandName: 'Muscle Milk', nutrition: { kcal: 420, per100g: true } }, q)).toBe(false);
        expect(isPowderSiblingOf({ name: 'Vanilla Protein', brandName: 'Ultimat Plant Protein BRAW', nutrition: { kcal: 397.5, per100g: true } }, 'vanilla protein')).toBe(true);
    });

    test('isPowderSiblingOf: a `Protein <solid>` record in the powder band is not a powder (deploy-42 pools, s459 rf-scoop)', () => {
        for (const [name, kcal] of [['Protein Puffs', 380], ['Protein Pasta', 321], ['Protein Balls', 387], ['protein rolled oats classic', 380],
            ['Protein pancake mix', 370], ['Protein Donut', 278], ['Protein Smoothie bowl', 467], ['chocolate protein syrup beverages', 279]] as const) {
            expect(isPowderSiblingOf({ name, nutrition: { kcal, per100g: true } }, 'protein')).toBe(false);
        }
        expect(isPowderSiblingOf({ name: 'Protein', brandName: 'Nutrition Sport 90', nutrition: { kcal: 357, per100g: true } }, 'protein')).toBe(true);
    });
});

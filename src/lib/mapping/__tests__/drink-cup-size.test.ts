/**
 * Cafe cup sizes on a prepared-drink line (s459 LATTE-c).
 *
 * 1. simpleRerank(): FatSecret's Starbucks siblings carry the cup in the name and tied within
 *    0.001 (`a venti matcha latte` took `Matcha Latte (Tall)`, cold, deploy 40). A cup word on a
 *    prepared-drink line now names a size: branded lines through the variant adjustment, unbranded
 *    lines through the size-MISMATCH penalty only.
 * 2. buildFatSecretResult(): `a large matcha latte` on `Matcha Latte (Venti)` bills the record's
 *    own serving instead of asking the AI for a cup (the Tall record took a 250 g estimate live).
 *
 * The record fixtures are the box rows (FatSecretFood / FatSecretServing, read-only, 2026-11-15).
 */

const mockFatSecretFoodFindUnique = jest.fn();
const mockGetOrCreateAmbiguousServing = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: {
            findUnique: (...args: unknown[]) => mockFatSecretFoodFindUnique(...args),
        },
    },
}));

jest.mock('../ambiguous-unit-backfill', () => ({
    isAmbiguousUnit: jest.requireActual('../ambiguous-unit-backfill').isAmbiguousUnit,
    getOrCreateAmbiguousServing: (...args: unknown[]) => mockGetOrCreateAmbiguousServing(...args),
}));

import { simpleRerank, type RerankCandidate } from '../simple-rerank';
import { buildFatSecretResult } from '../build-fatsecret-result';
import { parseIngredientLine } from '../../parse/ingredient-line';
import { recordCupSizeClass, isPreparedDrinkLine } from '../drink-cup-size';

function fs(id: string, name: string, brandName: string | undefined, score = 1.2): RerankCandidate {
    return { id, name, brandName, score, source: 'fatsecret' };
}

// The four hot Starbucks siblings, in fsId order (the id seat is the last tiebreak).
const SIBLINGS: RerankCandidate[] = [
    fs('fs_103646753', 'Matcha Latte (Grande)', 'Starbucks'),
    fs('fs_103646763', 'Matcha Latte (Short)', 'Starbucks'),
    fs('fs_103646771', 'Matcha Latte (Tall)', 'Starbucks'),
    fs('fs_103646773', 'Matcha Latte (Venti)', 'Starbucks'),
];

function pick(rawLine: string, candidates: RerankCandidate[], query = 'matcha latte', brand?: string): string | undefined {
    return simpleRerank(query, candidates, undefined, rawLine, !!brand, brand).winner?.name;
}

function pickWithSwitchOff(rawLine: string, candidates: RerankCandidate[], query = 'matcha latte', brand?: string): string | undefined {
    process.env.RANK_DRINK_CUP_SIZE = '0';
    try {
        return pick(rawLine, candidates, query, brand);
    } finally {
        delete process.env.RANK_DRINK_CUP_SIZE;
    }
}

describe('recordCupSizeClass / isPreparedDrinkLine', () => {
    it.each([
        ['Matcha Latte (Tall)', 'small'], ['Matcha Latte (Grande)', 'medium'], ['Matcha Latte (Venti)', 'large'],
        ['Matcha Latte (Short)', 'short'], ['Iced Latte - Small', 'small'], ['Matcha Latte', null],
        ['Small Batch Large Latte', null], // two sizes named: no claim
    ])('%s -> %s', (name, cls) => {
        expect(recordCupSizeClass(name)).toBe(cls);
    });

    it.each([
        ['a venti matcha latte', true], ['matcha latte grande', true], ['a tall flat white', true],
        ['a tall glass of water', false], ['short ribs', false], ['a large egg', false], ['medium fries', false],
    ])('%s is a prepared-drink line: %s', (line, yes) => {
        expect(isPreparedDrinkLine(line, line)).toBe(yes);
    });
});

describe('simpleRerank: an unbranded cup word picks the sibling of that size', () => {
    it.each([
        ['a venti matcha latte', 'Matcha Latte (Venti)'],
        ['a grande matcha latte', 'Matcha Latte (Grande)'],
        ['a tall matcha latte', 'Matcha Latte (Tall)'],
        ['a short matcha latte', 'Matcha Latte (Short)'],
        ['a large matcha latte', 'Matcha Latte (Venti)'],
        ['a medium matcha latte', 'Matcha Latte (Grande)'],
        ['matcha latte venti', 'Matcha Latte (Venti)'],
    ])('%s -> %s', (line, name) => {
        // MUTATION: drop the unbranded branch (or the cup words) -> the id seat picks Grande every time.
        expect(pick(line, SIBLINGS)).toBe(name);
    });

    it('the rerank query may be an LLM canonical without the drink word; the raw line still gates it', () => {
        expect(pick('a venti matcha latte', SIBLINGS, 'matcha')).toBe('Matcha Latte (Venti)');
    });

    it('a sizeless line is untouched', () => {
        expect(pick('matcha latte', SIBLINGS)).toBe(pickWithSwitchOff('matcha latte', SIBLINGS));
    });

    it('nothing is boosted: a generic record that outscored the size-named siblings keeps the line', () => {
        const pool = [...SIBLINGS, { ...fs('off_1', 'Matcha Latte', undefined, 1.2), source: 'openfoodfacts' as const }];
        expect(pickWithSwitchOff('a venti matcha latte', pool)).toBe('Matcha Latte');
        expect(pick('a venti matcha latte', pool)).toBe('Matcha Latte');
    });

    it('no sibling of the asked size in the pool: nothing is demoted (replay r1, `a large iced matcha latte`)', () => {
        // Starbucks Tall / Grande in the window, Venti outside it, and another food beside them (the replay's
        // was a canned RTD). Demoting the two siblings handed the line to it; with no Venti to re-pick, the line keeps today's pick.
        // MUTATION: drop the `candidates.some(...)` guard -> `Iced Matcha Tea` wins.
        const pool: RerankCandidate[] = [
            fs('fs_103646676', 'Iced Matcha Latte (Tall)', 'Starbucks', 1.425),
            fs('fs_103646664', 'Iced Matcha Latte (Grande)', 'Starbucks', 1.395),
            fs('fs_77', 'Iced Matcha Tea', 'Starbucks', 1.2),
        ];
        const line = 'a large iced matcha latte';
        expect(pick(line, pool, 'iced matcha latte')).toBe(pickWithSwitchOff(line, pool, 'iced matcha latte'));
        expect(pick(line, pool, 'iced matcha latte')).not.toBe('Iced Matcha Tea');
    });
});

describe('simpleRerank: a branded cup word now counts as a size', () => {
    it('starbucks grande matcha latte -> Grande', () => {
        // MUTATION: drop the cup words from resolveVariantSize() -> the id seat picks Grande by luck; use venti.
        expect(pick('starbucks venti matcha latte', SIBLINGS, 'starbucks matcha latte', 'starbucks')).toBe('Matcha Latte (Venti)');
        expect(pick('starbucks tall matcha latte', SIBLINGS, 'starbucks matcha latte', 'starbucks')).toBe('Matcha Latte (Tall)');
    });

    it('a sizeless branded drink line scores exactly as before (no unrequested-size penalty from cup words)', () => {
        const pool = [...SIBLINGS, fs('fs_9', 'Matcha Green Tea Latte', 'Starbucks', 1.2)];
        const line = 'starbucks matcha latte';
        expect(pick(line, pool, line, 'starbucks')).toBe(pickWithSwitchOff(line, pool, line, 'starbucks'));
    });
});

describe('simpleRerank: lines that are not cafe drinks are untouched', () => {
    it.each([
        ['short ribs', 'short ribs', [fs('a', 'Braised Short Ribs', undefined), fs('b', 'Beef Ribs', undefined)]],
        ['a tall glass of water', 'water', [fs('a', 'Water', undefined), fs('b', 'Tall Water Bottle', undefined)]],
        ['a large egg', 'egg', [fs('a', 'Egg (Small)', undefined), fs('b', 'Egg (Large)', undefined), fs('c', 'Egg', undefined)]],
        ['medium fries', 'fries', [fs('a', 'French Fries (Small)', undefined), fs('b', 'French Fries (Medium)', undefined)]],
        ['taco bell grande nachos', 'taco bell nachos', [fs('a', 'Nachos BellGrande', 'Taco Bell'), fs('b', 'Nachos Grande', 'Taco Bell')]],
    ])('%s', (line, query, pool) => {
        const brand = line.startsWith('taco bell') ? 'taco bell' : undefined;
        expect(pick(line, pool as RerankCandidate[], query, brand)).toBe(pickWithSwitchOff(line, pool as RerankCandidate[], query, brand));
    });
});

// ---- builder (c2) -------------------------------------------------------------------------

type Panel = { calories: number; protein: number; carbs: number; fat: number };
// The box rows: a synthetic `100 g` panel row plus the gram-less `1 serving` Starbucks publishes.
function starbucks(fsId: string, name: string, per100: Panel, serving: Panel) {
    return {
        fsId, name, brandName: 'Starbucks', foodType: 'Brand',
        nutrientsPer100g: per100,
        defaultServingId: `${fsId}s`,
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: [
            { servingId: '0', description: '100 g', measurementDescription: 'g', grams: 100, volumeMl: null, numberOfUnits: 100,
              nutrients: { calories: per100.calories, protein: per100.protein, carbohydrate: per100.carbs, fat: per100.fat } },
            { servingId: `${fsId}s`, description: '1 serving', measurementDescription: 'serving', grams: null, volumeMl: null, numberOfUnits: 1,
              nutrients: { calories: serving.calories, protein: serving.protein, carbohydrate: serving.carbs, fat: serving.fat } },
        ],
    };
}
const TALL = starbucks('103646771', 'Matcha Latte (Tall)',
    { calories: 50, protein: 2.35, carbs: 6.47, fat: 1.47 }, { calories: 170, protein: 8, carbs: 22, fat: 5 });
const VENTI = starbucks('103646773', 'Matcha Latte (Venti)',
    { calories: 51, protein: 2.47, carbs: 7.23, fat: 1.41 }, { calories: 290, protein: 14, carbs: 41, fat: 8 });
const FRIES_MEDIUM = {
    ...starbucks('555', 'Chick-Fil-A Waffle Potato Fries - Medium',
        { calories: 336, protein: 4.3, carbs: 45, fat: 15.4 }, { calories: 420, protein: 5, carbs: 45, fat: 24 }),
    brandName: 'Chick-fil-A',
};

async function bill(line: string, rec: ReturnType<typeof starbucks>) {
    mockFatSecretFoodFindUnique.mockResolvedValue(rec);
    const candidate = { id: `fs_${rec.fsId}`, source: 'fatsecret' as const, name: rec.name, brandName: rec.brandName, score: 1, foodType: 'Brand', rawData: {} } as any;
    return buildFatSecretResult(candidate, parseIngredientLine(line), 0.9, line);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 250 });
});

describe('buildFatSecretResult: a size unit the record itself is bills the record', () => {
    it('a large matcha latte on Matcha Latte (Venti) bills its own serving, no estimate', async () => {
        // MUTATION: drop `!unitIsRecordCup` from the (c2) gate -> 250 g count_unit_ai.
        const r = await bill('a large matcha latte', VENTI);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
        expect(r!.servingTier).toBe('fs_serving_macros_only');
        expect(r!.grams).toBeCloseTo(567.2, 0); // panel inversion, as the live Venti siblings bill (567 g)
        expect(r!.kcal).toBeCloseTo(290, 0);
    });

    it('a small matcha latte on Matcha Latte (Tall) bills the Tall serving (340 g)', async () => {
        const r = await bill('a small matcha latte', TALL);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
        expect(r!.grams).toBeCloseTo(340, 0);
        expect(r!.kcal).toBeCloseTo(170, 0);
    });

    it('2 large matcha lattes bill two of the record', async () => {
        const r = await bill('2 large matcha lattes', VENTI);
        expect(r!.kcal).toBeCloseTo(580, 0);
    });

    it('a size the record does NOT state keeps the estimate (a large on the Tall record)', async () => {
        const r = await bill('a large matcha latte', TALL);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalled();
        expect(r!.servingTier).toBe('count_unit_ai');
        expect(r!.grams).toBe(250);
    });

    it('a panel-less record keeps the estimate (its serving grams would be fabricated)', async () => {
        // MUTATION: drop `per100 != null` -> fs_serving_macros_only_est at a 2.0 kcal/g weight (`a medium dunkin latte` 50 g in replay r1).
        const panelless = { ...starbucks('68000000', 'Hot Latte with Almond Milk - Medium',
            { calories: 40, protein: 1, carbs: 5, fat: 1.6 }, { calories: 100, protein: 3, carbs: 10, fat: 5 }),
            brandName: "Dunkin'", nutrientsPer100g: {} as any };
        panelless.servings = panelless.servings.filter(s => s.description !== '100 g');
        const r = await bill('a medium dunkin latte', panelless as any);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalled();
        expect(r!.servingTier).toBe('count_unit_ai');
    });

    it('a non-drink line keeps the estimate even when the record names the size', async () => {
        const r = await bill('a medium waffle fries', FRIES_MEDIUM as any);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalled();
        expect(r!.servingTier).toBe('count_unit_ai');
    });
});

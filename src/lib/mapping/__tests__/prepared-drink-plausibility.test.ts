import { assessMacroPlausibility, assessRankTimePlausibility, assessSaveTimePlausibility } from '../macro-plausibility';
import { simpleRerank, type RerankCandidate } from '../simple-rerank';

/**
 * Prepared-drink rank-time plausibility (S202 / C69).
 *
 * A prepared drink (`a matcha latte`, `london fog`) can resolve to a record
 * carrying the dry mix's per-100g panel (397 / 467 kcal/100g). The rule is
 * RANK-TIME ONLY (reason `rank:prepared_drink_kcal_*`, counted in floorHit)
 * and fires only when the drink word is the query's HEAD noun.
 */

const HIGH = { kcal: 397, protein: 10, carbs: 70, fat: 8 };
const LOW = { kcal: 50, protein: 3, carbs: 5, fat: 2 };

function drink(q: string, n: { kcal: number; protein: number; carbs: number; fat: number }, head?: string): boolean {
    return assessRankTimePlausibility(q, 'x', n, head).reasons.some((r) => r.startsWith('rank:prepared_drink_kcal_'));
}

const FIRES = [
    'a matcha latte', 'london fog', 'latte', '2 lattes', 'cappuccinos', 'frappé', 'flat whites',
    'latte with vanilla syrup', 'birthday cake frappuccino', 'latte grande', 'latte 16 oz', 'cappuccino x2',
    'starbucks iced matcha latte', 'dunkin macchiato', 'golden milk latte', 'earl grey london fog', 'iced latte w/ oat milk',
];
const SILENT = [
    'mocha almonds', 'mocha creamer', 'pumpkin spice latte creamer', 'matcha latte powder', 'chai latte mix',
    'latte cookie', 'macchiato cupcake', 'mocha protein bar', 'instant latte', 'mochi', 'hot chocolate', 'matcha', 'chai',
];

describe('prepared-drink rank-time plausibility', () => {
    it.each(FIRES)('fires with a powder panel: %s', (q) => {
        expect(drink(q, HIGH)).toBe(true);
        expect(assessRankTimePlausibility(q, 'x', HIGH).floorHit).toBe(true);
    });

    it.each(SILENT)('stays silent with a powder panel: %s', (q) => {
        expect(drink(q, HIGH)).toBe(false);
    });

    it('stays silent when the panel is plausible or unusable', () => {
        expect(drink('latte', LOW)).toBe(false);
        expect(drink('latte', { ...LOW, kcal: 150 })).toBe(false);
        expect(drink('latte', { ...LOW, kcal: NaN })).toBe(false);
    });

    it('headLine rescues a canonical that dropped the drink word', () => {
        expect(drink('matcha', HIGH, 'a matcha latte')).toBe(true);
        expect(drink('matcha', HIGH)).toBe(false);
    });

    it('leaves the save-time and macro paths untouched', () => {
        expect(assessMacroPlausibility('a matcha latte', 'Matcha Latte', HIGH).reasons.join('|')).not.toContain('prepared_drink');
        expect(assessSaveTimePlausibility('latte matcha', 'Matcha Latte', HIGH).reasons.join('|')).not.toContain('prepared_drink');
    });
});

describe('simpleRerank passes the raw line to the drink rule', () => {
    const high: RerankCandidate = {
        id: 'off_matcha_latte_powder_panel', name: 'Matcha Latte', score: 0.9, source: 'openfoodfacts',
        nutrition: { ...HIGH, per100g: true },
    };
    const low: RerankCandidate = {
        id: 'off_matcha_latte_tall', name: 'Matcha Latte (Tall)', score: 0.9, source: 'openfoodfacts',
        nutrition: { ...LOW, per100g: true },
    };

    it('demotes the powder panel when the rawLine names the drink', () => {
        const result = simpleRerank('matcha', [high, low], undefined, 'a matcha latte');
        expect(result.winner?.name).toBe('Matcha Latte (Tall)');
    });

    it('without rawLine the powder panel still wins (guards the rawLine pass-through)', () => {
        const result = simpleRerank('matcha', [high, low]);
        expect(result.winner?.name).toBe('Matcha Latte');
    });
});

/**
 * Unit tests for stripPrepModifiers and nutrition tiebreaker
 * 
 * Validates that non-nutritional prep modifiers are stripped from
 * rerank queries while identity-changing modifiers are preserved.
 * Also tests the nutrition-based tiebreaker for score-tied candidates.
 */

import { stripPrepModifiers, simpleRerank, type RerankCandidate, type AiNutritionEstimate } from '../simple-rerank';

describe('stripPrepModifiers', () => {
    // === Prep words that SHOULD be stripped ===

    it('strips cutting words: "green peppers cut in strips" → "green peppers"', () => {
        expect(stripPrepModifiers('green peppers cut in strips')).toBe('green peppers');
    });

    it('strips "finely diced onion" → "onion"', () => {
        expect(stripPrepModifiers('finely diced onion')).toBe('onion');
    });

    it('strips "celery sliced" → "celery"', () => {
        expect(stripPrepModifiers('celery sliced')).toBe('celery');
    });

    it('strips "peeled and deveined shrimp" → "shrimp"', () => {
        expect(stripPrepModifiers('peeled and deveined shrimp')).toBe('shrimp');
    });

    it('strips "roughly chopped parsley" → "parsley"', () => {
        expect(stripPrepModifiers('roughly chopped parsley')).toBe('parsley');
    });

    it('strips "thinly sliced red onion" → "red onion"', () => {
        expect(stripPrepModifiers('thinly sliced red onion')).toBe('red onion');
    });

    it('strips multiple prep words: "seeded and diced jalapeño" → "jalapeño"', () => {
        expect(stripPrepModifiers('seeded and diced jalapeño')).toBe('jalapeño');
    });

    it('strips "cored and quartered apples" → "apples"', () => {
        expect(stripPrepModifiers('cored and quartered apples')).toBe('apples');
    });

    it('strips shape words: "chicken breast chunks" → "chicken breast"', () => {
        expect(stripPrepModifiers('chicken breast chunks')).toBe('chicken breast');
    });

    // === Identity modifiers that should NOT be stripped ===

    it('preserves "fire roasted tomatoes" (roasted is identity)', () => {
        // "fire" is not a prep word, "roasted" is identity-changing — both preserved
        expect(stripPrepModifiers('fire roasted tomatoes')).toBe('fire roasted tomatoes');
    });

    it('preserves "ground cinnamon"', () => {
        expect(stripPrepModifiers('ground cinnamon')).toBe('ground cinnamon');
    });

    it('preserves "dried cranberries"', () => {
        expect(stripPrepModifiers('dried cranberries')).toBe('dried cranberries');
    });

    it('preserves "frozen peas"', () => {
        expect(stripPrepModifiers('frozen peas')).toBe('frozen peas');
    });

    it('preserves "canned tomatoes"', () => {
        expect(stripPrepModifiers('canned tomatoes')).toBe('canned tomatoes');
    });

    it('preserves "smoked paprika"', () => {
        expect(stripPrepModifiers('smoked paprika')).toBe('smoked paprika');
    });

    // === No prep words — unchanged ===

    it('leaves "chicken breast" unchanged', () => {
        expect(stripPrepModifiers('chicken breast')).toBe('chicken breast');
    });

    it('leaves "brown sugar" unchanged', () => {
        expect(stripPrepModifiers('brown sugar')).toBe('brown sugar');
    });

    it('leaves "fat free milk" unchanged', () => {
        expect(stripPrepModifiers('fat free milk')).toBe('fat free milk');
    });

    // === Edge cases ===

    it('connector "and" preserved when not in prep context: "salt and pepper"', () => {
        expect(stripPrepModifiers('salt and pepper')).toBe('salt and pepper');
    });

    it('never returns empty string — falls back to original', () => {
        // If somehow all words are prep (unlikely), return original
        expect(stripPrepModifiers('diced')).toBe('diced');
    });

    it('handles extra whitespace gracefully', () => {
        expect(stripPrepModifiers('  finely   diced   onion  ')).toBe('onion');
    });
});

describe('nutrition tiebreaker', () => {
    // Helper to create candidates that will score identically (same name, same score)
    function makeTiedCandidates(names: string[], kcals: number[]): RerankCandidate[] {
        return names.map((name, i) => ({
            id: `food_${i}`,
            name,
            brandName: `Brand${i}`,
            score: 1.0,
            source: 'fatsecret' as const,
            nutrition: {
                kcal: kcals[i],
                protein: 0,
                carbs: kcals[i] * 0.5,
                fat: 0,
                per100g: true,
            },
        }));
    }

    it('prefers candidate closest to AI calorie estimate when scores tie', () => {
        // Simulate rice vinegar: all named "Rice Vinegar", different brands/calories
        const candidates = makeTiedCandidates(
            ['Rice Vinegar', 'Rice Vinegar', 'Rice Vinegar'],
            [0, 167, 300]  // Kikkoman (plain), Marukan (light seasoned), Mizkan (seasoned)
        );
        const aiEstimate: AiNutritionEstimate = {
            caloriesPer100g: 18,
            proteinPer100g: 0,
            carbsPer100g: 4,
            fatPer100g: 0,
            confidence: 0.85,
        };

        const result = simpleRerank('rice vinegar', candidates, aiEstimate);
        expect(result).not.toBeNull();
        // food_0 (0 kcal) is closest to 18 kcal estimate (deviation=18)
        // food_1 (167 kcal) deviation=149, food_2 (300 kcal) deviation=282
        expect(result!.winner.id).toBe('food_0');
    });

    it('falls through to ID tiebreaker when no AI estimate is provided', () => {
        const candidates = makeTiedCandidates(
            ['Rice Vinegar', 'Rice Vinegar'],
            [0, 300]
        );

        const result = simpleRerank('rice vinegar', candidates, undefined);
        expect(result).not.toBeNull();
        // Without AI estimate, should fall through to ID tiebreaker (food_0 < food_1)
        expect(result!.winner.id).toBe('food_0');
    });

    it('skips nutrition tiebreaker when AI confidence is below gate', () => {
        const candidates = makeTiedCandidates(
            ['Rice Vinegar', 'Rice Vinegar'],
            [300, 0]  // food_0 is farther from estimate, but should win by ID if tiebreaker skips
        );
        const lowConfEstimate: AiNutritionEstimate = {
            caloriesPer100g: 18,
            proteinPer100g: 0,
            carbsPer100g: 4,
            fatPer100g: 0,
            confidence: 0.50,  // Below NUTRITION_CONFIDENCE_GATE (0.70)
        };

        const result = simpleRerank('rice vinegar', candidates, lowConfEstimate);
        expect(result).not.toBeNull();
        // food_0 wins by ID tiebreaker (nutrition tiebreaker skipped)
        expect(result!.winner.id).toBe('food_0');
    });
});


const logger = {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data),
    warn: (msg, data) => console.log(`[WARN] ${msg}`, data),
};

const DISH_TERMS = ['smoothie', 'pie', 'cake', 'cheesecake', 'cupcake', 'pancake', 'bread', 'muffin', 'juice', 'sauce', 'soup', 'stew', 'casserole', 'salad', 'pizza', 'sandwich', 'burger', 'dip', 'jam', 'jelly', 'yogurt', 'ice cream', 'shake', 'drink', 'beverage', 'flavored'];

const DIETARY_MODIFIERS = {
    fatFree: ['fat free', 'fat-free', 'nonfat', 'non-fat', 'skim'],
    reducedFat: ['reduced fat', 'low fat', 'lowfat', 'low-fat', 'lite', 'light', '2%', '1%'],
    unsweetened: ['unsweetened', 'no sugar', 'sugar free', 'sugar-free', 'no added sugar'],
    sweetened: ['sweetened', 'sugar', 'honey'],
    whole: ['whole', 'full fat', 'regular'],
};

function detectDietaryModifier(text) {
    const lower = text.toLowerCase();
    return {
        fatFree: DIETARY_MODIFIERS.fatFree.some(t => lower.includes(t)),
        reducedFat: DIETARY_MODIFIERS.reducedFat.some(t => lower.includes(t)),
        unsweetened: DIETARY_MODIFIERS.unsweetened.some(t => lower.includes(t)),
        sweetened: DIETARY_MODIFIERS.sweetened.some(t => lower.includes(t)),
        whole: DIETARY_MODIFIERS.whole.some(t => lower.includes(t)),
    };
}

function computePositionScore(
    query,
    foodName,
    position,
    options
) {
    // Base score from position (respects API order)
    // Position 0 = 0.95, Position 1 = 0.93, Position 9 = 0.77
    let score = Math.max(0.5, 0.95 - (position * 0.02));

    const queryLower = query.toLowerCase().replace(/[0-9]+/g, '').trim();
    const foodLower = foodName.toLowerCase().trim();

    console.log(`Analyzing: Query="${queryLower}" Food="${foodLower}" InitScore=${score}`);

    if (queryLower.includes('salsa') && foodLower.includes('roma')) {
        logger.info('computePositionScore.debug', { queryLower, foodLower, baseScore: score });
    }

    // ============================================================
    // Exact/Near-Exact Name Match Boost
    // ============================================================
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const mainIngredient = queryWords[queryWords.length - 1] || queryLower;
    const foodWords = foodLower.split(/\s+/).filter(w => w.length > 2);
    const foodMain = foodWords[foodWords.length - 1] || foodLower;

    // Check for exact main ingredient match
    if (mainIngredient === foodMain || mainIngredient === foodLower || foodMain === queryLower) {
        score *= 1.5;
        console.log(`Boost: Exact/Main Ingredient Match (1.5x) -> ${score}`);
    } else if (foodLower === mainIngredient || foodLower.startsWith(mainIngredient)) {
        score *= 1.4;
        console.log(`Boost: Starts With Main Ingredient (1.4x) -> ${score}`);
    } else if (foodLower.includes(mainIngredient)) {
        score *= 1.1;
        console.log(`Boost: Contains Main Ingredient (1.1x) -> ${score}`);
    }

    const queryCore = mainIngredient;

    const queryMods = detectDietaryModifier(query);
    const foodMods = detectDietaryModifier(foodName);

    // ============================================================
    // Missing Query Term Penalty (simplified)
    // ============================================================
    // omitted for brevity, focusing on Dish Term

    // ============================================================
    // Unexpected Dish Term Penalty
    // ============================================================

    // Only apply if query itself isn't asking for a dish
    const queryHasDishTerm = DISH_TERMS.some(term => queryLower.includes(term));
    console.log(`Query has dish term: ${queryHasDishTerm}`);

    if (!queryHasDishTerm) {
        const foodWordsSimple = foodLower.split(/\s+/).map(w => w.replace(/[^a-z]/g, ''));

        for (const term of DISH_TERMS) {
            if (foodWordsSimple.includes(term) || foodWordsSimple.includes(term + 's')) {
                score *= 0.6; // Heavy penalty for unexpected dish form
                console.log(`Penalty: Unexpected Dish Term "${term}" (0.6x) -> ${score}`);
                break;
            }
        }
    }

    return Math.max(0, Math.min(1, score));
}

// Test Cases
console.log('--- Case 1: Normalized Query "strawberries" ---');
computePositionScore("strawberries", "Strawberry-Flavored Drink", 6); // Position 7 (index 6) matches Debug Output #7

console.log('\n--- Case 2: Raw Query "2 cup stberry halves" ---');
computePositionScore("2 cup stberry halves", "Strawberry-Flavored Drink", 0);

console.log('\n--- Case 3: Normalized Query "strawberry halves" ---');
computePositionScore("strawberry halves", "Strawberry-Flavored Drink", 0);

console.log('\n--- Case 4: Target Match ---');
computePositionScore("strawberries", "Strawberries", 0);

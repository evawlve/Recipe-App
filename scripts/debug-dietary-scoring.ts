import 'dotenv/config';

const DIETARY_MODIFIERS = {
    fatFree: ['fat free', 'fat-free', 'nonfat', 'non-fat', 'skim'],
    reducedFat: ['reduced fat', 'low fat', 'lowfat', 'low-fat', 'lite', 'light', '2%', '1%'],
};

function detectDietaryModifier(text: string) {
    const lower = text.toLowerCase();
    return {
        fatFree: DIETARY_MODIFIERS.fatFree.some(t => lower.includes(t)),
        reducedFat: DIETARY_MODIFIERS.reducedFat.some(t => lower.includes(t)),
    };
}

function computePositionScore(
    query: string,
    foodName: string,
    position: number,
): number {
    let score = Math.max(0.5, 0.95 - (position * 0.02));
    console.log(`  Base position score: ${score.toFixed(3)}`);

    const queryMods = detectDietaryModifier(query);
    const foodMods = detectDietaryModifier(foodName);

    console.log(`  Query mods: fatFree=${queryMods.fatFree}, reducedFat=${queryMods.reducedFat}`);
    console.log(`  Food mods: fatFree=${foodMods.fatFree}, reducedFat=${foodMods.reducedFat}`);

    if (queryMods.fatFree) {
        if (foodMods.fatFree) {
            console.log(`  MATCH: fat-free → fat-free, bonus ×1.1`);
            score *= 1.1;
        } else if (foodMods.reducedFat) {
            console.log(`  MISMATCH: fat-free → reduced-fat, penalty ×0.4`);
            score *= 0.4;
        } else {
            console.log(`  NO MODIFIER: penalty ×0.7`);
            score *= 0.7;
        }
    }

    console.log(`  Final score: ${score.toFixed(3)}\n`);
    return score;
}

console.log('=== Testing Query: "fat free cheddar cheese" ===\n');

console.log('Food: "Reduced Fat Cheddar Cheese" (position 0)');
computePositionScore('fat free cheddar cheese', 'Reduced Fat Cheddar Cheese', 0);

console.log('Food: "Cheddar Cheese" (position 2)');
computePositionScore('fat free cheddar cheese', 'Cheddar Cheese', 2);

console.log('Food: "Cheese, cheddar, nonfat or fat free" (position 0)');
computePositionScore('fat free cheddar cheese', 'Cheese, cheddar, nonfat or fat free', 0);

/**
 * Show exactly which INGREDIENT_MACRO_PROFILE matches 'rice vinegar'
 */

// Replicate the matching logic from hasSuspiciousMacros
const PROFILES = [
    { name: 'ice/water', ingredients: ['ice', 'ice cubes', 'ice cube', 'crushed ice', 'shaved ice', 'water'], maxCalPer100g: 5 },
    { name: 'legumes', ingredients: ['lentils', 'lentil', 'chickpeas', 'chickpea', 'black beans', 'kidney beans', 'pinto beans'], maxFatPer100g: 3 },
    { name: 'olives', ingredients: ['olives', 'olive', 'kalamata'], minFatPer100g: 8, maxCarbPer100g: 8 },
    { name: 'raw vegetables', ingredients: ['potato', 'potatoes', 'carrot', 'carrots', 'broccoli', 'spinach', 'lettuce'], maxFatPer100g: 1 },
    { name: 'fresh berries', ingredients: ['strawberry', 'strawberries', 'blueberry', 'blueberries', 'raspberry', 'raspberries', 'blackberry', 'blackberries', 'berry', 'berries'], maxCalPer100g: 60 },
    { name: 'protein powders', ingredients: ['whey protein', 'protein powder', 'whey isolate', 'casein protein', 'protein isolate'], minProteinPer100g: 40, maxCarbPer100g: 35 },
    { name: 'unsweetened coconut milk', ingredients: ['unsweetened coconut milk', 'coconut milk unsweetened'], maxCalPer100g: 50 },
    { name: 'sweeteners', ingredients: ['sugar substitute', 'sweetener', 'splenda', 'stevia', 'sucralose', 'aspartame', 'monk fruit', 'erythritol'], maxCalPer100g: 100 },
    { name: 'ground beef 85%', ingredients: ['ground beef 85', 'ground beef 85%', '85/15 ground beef', '85% lean ground beef', '85 lean ground beef', 'ground beef 85 lean'], maxFatPer100g: 20, maxCalPer100g: 260 },
    { name: 'dried spices', ingredients: ['pepper flakes', 'crushed red pepper', 'red pepper flakes', 'chili flakes', 'cayenne', 'paprika', 'cumin', 'oregano', 'basil', 'thyme', 'rosemary', 'sage', 'garlic powder', 'onion powder', 'cinnamon', 'nutmeg', 'ginger powder', 'turmeric', 'curry powder', 'chili powder', 'black pepper', 'white pepper'], maxCalPer100g: 400 },
    { name: 'dark chocolate 70%', ingredients: ['70% dark chocolate', '70% cocoa', '70% cacao', 'dark chocolate 70'], maxCarbPer100g: 50 },
];

const query = 'rice vinegar';
const queryLower = query.toLowerCase();
const queryNormalized = queryLower.replace(/(\d+)\s*%/g, '$1').replace(/-/g, ' ');

console.log(`Query: "${query}" → lower: "${queryLower}" → normalized: "${queryNormalized}"\n`);

for (const profile of PROFILES) {
    for (const ing of profile.ingredients) {
        const ingNormalized = ing.replace(/(\d+)\s*%/g, '$1').replace(/-/g, ' ');
        const first3words = queryNormalized.split(' ').slice(0, 3).join(' ');

        const match1 = queryLower.includes(ing);
        const match2 = queryNormalized.includes(ingNormalized);
        const match3 = ingNormalized.includes(first3words);

        if (match1 || match2 || match3) {
            console.log(`MATCH! Profile: "${profile.name}" | Ingredient: "${ing}"`);
            console.log(`  queryLower.includes(ing): ${match1} ("${queryLower}".includes("${ing}"))`);
            console.log(`  queryNormalized.includes(ingNormalized): ${match2} ("${queryNormalized}".includes("${ingNormalized}"))`);
            console.log(`  ingNormalized.includes(first3words): ${match3} ("${ingNormalized}".includes("${first3words}"))`);
            console.log(`  Profile constraints: maxCal:${(profile as any).maxCalPer100g ?? 'none'} maxFat:${(profile as any).maxFatPer100g ?? 'none'} minFat:${(profile as any).minFatPer100g ?? 'none'} minProt:${(profile as any).minProteinPer100g ?? 'none'} maxCarb:${(profile as any).maxCarbPer100g ?? 'none'}`);
            console.log(`  Candidate: kcal:24, P:1.33, C:5.33, F:0`);

            // Check which constraint fails
            if ((profile as any).maxCalPer100g != null && 24 > (profile as any).maxCalPer100g) {
                console.log(`  → FAILS: calories 24 > maxCalPer100g ${(profile as any).maxCalPer100g}`);
            }
            if ((profile as any).maxFatPer100g != null && 0 > (profile as any).maxFatPer100g) {
                console.log(`  → FAILS: fat 0 > maxFatPer100g ${(profile as any).maxFatPer100g}`);
            }
            if ((profile as any).minFatPer100g != null && 0 < (profile as any).minFatPer100g) {
                console.log(`  → FAILS: fat 0 < minFatPer100g ${(profile as any).minFatPer100g}`);
            }
            if ((profile as any).minProteinPer100g != null && 1.33 < (profile as any).minProteinPer100g) {
                console.log(`  → FAILS: protein 1.33 < minProteinPer100g ${(profile as any).minProteinPer100g}`);
            }
            if ((profile as any).maxCarbPer100g != null && 5.33 > (profile as any).maxCarbPer100g) {
                console.log(`  → FAILS: carbs 5.33 > maxCarbPer100g ${(profile as any).maxCarbPer100g}`);
            }
            console.log();
        }
    }
}

console.log('Done');

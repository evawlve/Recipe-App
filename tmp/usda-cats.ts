import 'dotenv/config';
import fs from 'fs';

const raw = fs.readFileSync('data/usda/FoodData_Central_sr_legacy_food_json_2018-04.json', 'utf-8');
const data = JSON.parse(raw);
const foods: any[] = data.SRLegacyFoods ?? data.foods ?? data;

// Count by category
const catCounts = new Map<string, number>();
const excludedCats = new Set([
    'Baby Foods', 'Restaurant Foods', 'Infant Formulas',
    'Meals, Entrees, and Side Dishes', 'Fast Foods',
]);

let included = 0;
for (const f of foods) {
    const cat = typeof f.foodCategory === 'string' ? f.foodCategory : f.foodCategory?.description ?? 'Unknown';
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    if (!excludedCats.has(cat)) included++;
}

const sorted = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);
console.log('Category breakdown:');
for (const [cat, count] of sorted) {
    const skip = excludedCats.has(cat) ? ' [SKIP]' : '';
    console.log(`  ${String(count).padStart(5)}  ${cat}${skip}`);
}
console.log(`\nTotal: ${foods.length}, After category filter: ${included}`);

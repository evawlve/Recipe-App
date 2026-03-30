import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import * as fs from 'fs';

async function verify() {
  const ingredients = [
    "24 oz cole slaw mix",
    "1 slice center cut bacon",
    "6 oz italian dressing lite",
    "336 g veggie spirals pasta",
    "2 cup low carb baking mix"
  ];
  const results = [];
  for (const ing of ingredients) {
    const res = await mapIngredientWithFallback(ing);
    if (!res) {
      results.push({ input: ing, status: "FAILED" });
      continue;
    }
    results.push({
      input: ing,
      name: res.foodName,
      grams: res.grams,
      kcal: res.kcal
    });
  }
  fs.writeFileSync('C:\\Dev\\Recipe App\\scripts\\verify-results.json', JSON.stringify(results, null, 2));
}

verify().catch(console.error).finally(() => process.exit(0));

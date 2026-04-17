import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import * as fs from 'fs';

async function test() {
  const issues = [
    '1 tsp garlic salt',
    '3 peppers in adobo sauce',
    '8 oz part-skim mozzarella',
    '8 tbsp omega blended cooking oil',
    '16 small chicken leg skin eaten',
    '8 lettuce',
    '1 cup garlic and herb cream cheese low fat',
    '1 cup low-fat cottage cheese',
    '4 tbsp reduced-fat sour cream',
    '1  light creamy Swiss cheese wedge'
  ];

  const results: any[] = [];

  for (const line of issues) {
    try {
      const result = await mapIngredientWithFallback(line, { debug: true, skipCache: true });
      if (result && 'foodName' in result) {
        results.push({
          line,
          status: 'success',
          foodName: result.foodName,
          brandName: result.brandName,
          grams: result.grams,
          kcal: result.kcal,
          confidence: result.confidence
        });
      } else {
        results.push({ line, status: 'failed' });
      }
    } catch (err: any) {
        results.push({ line, status: 'error', message: err.message });
    }
  }

  fs.writeFileSync('tmp/test-issues-results.json', JSON.stringify(results, null, 2));
  console.log('RESULTS SAVED TO tmp/test-issues-results.json');
}

test().catch(console.error).finally(() => process.exit(0));

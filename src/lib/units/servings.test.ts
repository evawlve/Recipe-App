import { deriveServingOptions } from './servings';

test('includes food-specific units and derived volumes', () => {
  const opts = deriveServingOptions({
    units: [{ label: '1 scoop', grams: 32 }],
    densityGml: 0.5, // powder
    categoryId: 'whey',
  });
  const labels = opts.map(o => o.label);
  expect(labels).toEqual(expect.arrayContaining(['1 scoop','½ 1 scoop','2 × 1 scoop','1 oz','1 tbsp','1 cup']));
});

test('oil category with density produces correct tbsp serving', () => {
  const opts = deriveServingOptions({
    units: [{ label: '1 tbsp', grams: 13.6 }],
    densityGml: 0.91, // oil density
    categoryId: 'oil',
  });
  
  const labels = opts.map(o => o.label);
  expect(labels).toEqual(expect.arrayContaining(['100 g', '1 oz', '1 tbsp']));
  
  // Check 1 tbsp has correct grams for oil density (should be ~13.6g)
  const tbsp = opts.find(o => o.label === '1 tbsp');
  expect(tbsp).toBeDefined();
  expect(tbsp!.grams).toBeGreaterThan(13);
  expect(tbsp!.grams).toBeLessThan(14.5);
});


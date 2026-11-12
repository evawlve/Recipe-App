/**
 * cookingStateFor() — the `cookingState` rule table (s456 CS).
 * Record name states a cooking word -> 'cooked'; states raw/uncooked -> line says
 * raw/uncooked ? 'raw' : 'raw_default'; silent name -> only an OFF record claims
 * raw (same split) unless the line names a can/slices/deli/jerky; silent
 * fatsecret/fdc/ai_estimated -> null (omitted on the wire).
 */
import { cookingStateFor, type CookingState, type CookingStateSource } from '../cooking-state';

const CASES: [string, string, CookingStateSource, CookingState | null][] = [
  ['230g beef chuck', 'Beef Chuck', 'openfoodfacts', 'raw_default'],
  ['230g cooked beef chuck', 'Beef Chuck (Blade Roast, Trimmed to 1/8" Fat, Cooked, Braised)', 'fatsecret', 'cooked'],
  ['200g raw chicken breast', 'Chicken, broilers or fryers, breast, meat only, raw', 'fdc', 'raw'],
  ['200g uncooked beef', 'Beef', 'openfoodfacts', 'raw'],
  ['6 oz grilled salmon', 'Salmon', 'openfoodfacts', 'raw_default'],
  ['100g chicken thigh', 'Chicken Thigh', 'fatsecret', null],
  ['chicken tenders', 'Chicken Tenders', 'openfoodfacts', null],
  ['a turkey sandwich', 'Turkey Sandwich', 'fatsecret', null],
  ['a can of pink salmon', 'Pink salmon', 'openfoodfacts', null],
  ['2 slices of turkey breast', 'Turkey breast', 'openfoodfacts', null],
  ['an apple', 'Apples, raw, with skin', 'fdc', null],
  ['grilled chicken', 'Grilled Chicken', 'fatsecret', 'cooked'],
  ['100g chicken breast', 'Chicken Breast', 'ai_estimated', null],
  ['sautéed shrimp', 'Sautéed Shrimp', 'openfoodfacts', 'cooked'],
];

describe('cookingStateFor', () => {
  test.each(CASES)('%s | %s | %s -> %s', (rawText, foodName, source, want) => {
    expect(cookingStateFor({ rawText, foodName, source })).toBe(want);
  });
});

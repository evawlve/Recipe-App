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

/**
 * s457 P1 — the panel guard. kcal100 is the billed panel's kcal/100 g; brandName is the
 * resolved record's brand. Values are the live records' (MEL 30-day medians and the box's
 * FatSecretFood / OffFood panels, measured 2026-11-13). Ceilings: USDA SR Legacy raw max
 * per cut (RAW_MAX_KCAL); FatSecret generic -> 'cooked' above x1.08, OFF -> omitted above x1.25.
 */
const GUARD_CASES: [string, string, CookingStateSource, number | null, string | null, CookingState | null][] = [
  // (b) a silent UNBRANDED FatSecret plain cut whose panel is above every raw form of its cut
  ['100g chicken thigh', 'Chicken Thigh', 'fatsecret', 245, null, 'cooked'], // fs_1695
  ['chiken brest', 'Chicken Breast', 'fatsecret', 195, null, 'cooked'], // fs_1641
  ['chicken', 'Chicken', 'fatsecret', 237, null, 'cooked'], // fs_1623
  ['a turkey drumstick', 'Turkey Drumstick', 'fatsecret', 206, null, 'cooked'], // fs_1766
  ['a chicken thigh', 'Chicken Thigh (Skin Eaten)', 'fatsecret', 245, null, 'cooked'], // fs_1696: skin in parens stays in
  ['200g raw chicken breast', 'Chicken Breast', 'fatsecret', 195, null, 'cooked'], // the number billed is cooked-basis
  ['100g chicken thigh', 'Chicken Thigh', 'fatsecret', 230, null, null], // under 221 x 1.08
  ['a chicken leg quarter', 'Chicken Leg Quarter', 'fatsecret', 241, 'Perdue', null], // fs_32931817: branded = a raw retail label, no claim
  ['ground pork', 'Ground Pork', 'fatsecret', 263, null, null], // fs_36208: fat-ratio name, out of the guard
  ['80/20 ground beef', 'Ground Beef (80% Lean / 20% Fat)', 'fatsecret', 254, null, null], // fs_40406
  ['100g salmon', 'Salmon', 'fatsecret', 146, null, null], // fs_2057: fish out of the guard
  ['100g shrimp', 'Shrimp', 'fatsecret', 144, null, null], // fs_2178: shellfish out of the guard
  ['chicken skin', 'Chicken Skin', 'fatsecret', 450, null, null], // skin in the head: out
  ['100g chicken breast', 'Chicken Breast', 'ai_estimated', 195, null, null], // AI: unchanged, no claim
  // (a) a silent Open Food Facts plain cut whose panel no raw form of the cut reaches
  ['venison', 'Venison', 'openfoodfacts', 351, 'Epic', null], // off_0732153125377
  ['turkey breast', 'Turkey Breast', 'openfoodfacts', 205, 'Plainville Turkey Breast', null], // off_0260013109163
  ['two homemade beef tacos', 'Beef Cutlet', 'openfoodfacts', 290, 'Homemade', null], // off_00241351
  ['a brisket plate', 'Brisket', 'openfoodfacts', 306, 'Sadlers', 'raw_default'], // KNOWN MISS: raw brisket labels reach 310-353
  ['6 oz chicken breast', 'Skinless Chicken Breast', 'openfoodfacts', 116, "Mary's Chicken", 'raw_default'],
  ['chicken thigh', 'Chicken Thigh', 'openfoodfacts', 223, null, 'raw_default'], // retail raw label above USDA 221, under x1.25
  ['5 oz flank steak', 'Flank Steak', 'openfoodfacts', 179, null, 'raw_default'], // under 165 x 1.25
  ['six chicken wings', 'chicken wings', 'openfoodfacts', 223, null, 'raw_default'], // wings out of the guard
  ['230g beef chuck', 'Beef Chuck', 'openfoodfacts', null, null, 'raw_default'], // no panel: guard inert
  ['ground lamb', 'ground raw lamb', 'fdc', 282, null, 'raw_default'], // the NAME says raw: never second-guessed
  ['200g chicken breast', 'Raw Chicken Breast', 'openfoodfacts', 230, null, 'raw_default'], // NAME says raw, panel above 172 x 1.25: the name wins
  ['1/2 lb ground turkey', 'Ground Turkey', 'openfoodfacts', 214, null, 'raw_default'], // fat-ratio name: out (turkey x1.25 = 199)
  ['pork belly', 'Pork Belly', 'openfoodfacts', 518, null, 'raw_default'], // belly: out (pork x1.25 = 346)
];

describe('cookingStateFor — panel guard (s457 P1)', () => {
  test.each(GUARD_CASES)('%s | %s | %s | %s kcal | %s -> %s', (rawText, foodName, source, kcal100, brandName, want) => {
    expect(cookingStateFor({ rawText, foodName, source, kcal100, brandName })).toBe(want);
  });
});

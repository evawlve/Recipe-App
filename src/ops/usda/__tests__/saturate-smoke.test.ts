import { canonicalName, macroFingerprintSaturation } from '../dedupe';
import { mapUsdaToCategory } from '../category-map';

test('canonicalName + macroFingerprint are stable', () => {
  expect(canonicalName('Olive Oil (Extra Virgin)')).toBe('olive oil');
  expect(macroFingerprintSaturation({kcal100:884,protein100:0,carbs100:0,fat100:100})).toContain('|');
});

test('category mapping covers basics', () => {
  expect(mapUsdaToCategory('Olive Oil','Fats and Oils')).toBe('oil');
  expect(mapUsdaToCategory('Chicken breast, raw')).toBe('meat');
});

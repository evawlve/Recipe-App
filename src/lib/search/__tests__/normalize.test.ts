import { normalizeQuery } from '@/lib/search/normalize';

test('fat-mod synonym collapse', () => {
  expect(normalizeQuery('fat-free mozzarella')).toBe('nonfat mozzarella');
  expect(normalizeQuery('part-skim mozzarella')).toBe('part skim mozzarella');
  expect(normalizeQuery('skim milk')).toBe('nonfat milk');
  expect(normalizeQuery('2% milk')).toBe('2% milk');
});

test('normalize punctuation and spacing', () => {
  expect(normalizeQuery('non-fat cheddar')).toBe('nonfat cheddar');
  expect(normalizeQuery('fat free mozzarella')).toBe('nonfat mozzarella');
  expect(normalizeQuery('yoghurt')).toBe('yogurt');
});

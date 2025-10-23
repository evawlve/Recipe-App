import { generateAliasesForFood } from '../alias-rules';

test('cheddar gets nonfat permutations', () => {
  const a = generateAliasesForFood('Cheese, cheddar, nonfat or fat free', 'cheese');
  const s = a.join('|');
  expect(s).toMatch(/nonfat cheddar/);
  expect(s).toMatch(/cheddar nonfat/);
  expect(s).toMatch(/fat free cheddar/);
});

test('milk gets nonfat permutations', () => {
  const a = generateAliasesForFood('Milk, nonfat', 'dairy');
  const s = a.join('|');
  expect(s).toMatch(/nonfat milk/);
  expect(s).toMatch(/milk nonfat/);
  expect(s).toMatch(/skim milk/);
});

test('mozzarella gets part skim permutations', () => {
  const a = generateAliasesForFood('Cheese, mozzarella, part skim', 'cheese');
  const s = a.join('|');
  expect(s).toMatch(/part skim mozzarella/);
  expect(s).toMatch(/mozzarella part skim/);
  expect(s).toMatch(/part-skim mozzarella/);
});

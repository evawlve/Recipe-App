import { generateAliasesForFood } from '../alias-rules';

test('whey gets powder aliases', () => {
  const a = generateAliasesForFood('Whey Protein Isolate (Generic)', 'whey');
  expect(a).toEqual(expect.arrayContaining(['whey protein powder','protein powder','whey isolate']));
});

test('mozzarella fat modifiers present', () => {
  const a = generateAliasesForFood('Cheese, mozzarella, part skim', 'cheese');
  expect(a.join(' ')).toMatch(/part[- ]skim/);
  expect(a).toEqual(expect.arrayContaining(['mozz','mozzarella cheese','cheese'])); // broad cheese set
});

test('yogurt gets dairy aliases', () => {
  const a = generateAliasesForFood('Greek Yogurt, Plain', 'dairy');
  expect(a).toEqual(expect.arrayContaining(['yoghurt','greek yogurt','greek yoghurt']));
});

test('flour gets powder aliases', () => {
  const a = generateAliasesForFood('Oat Flour', 'flour');
  expect(a).toEqual(expect.arrayContaining(['oat powder','powder','oat flour']));
});

test('oil gets cooking oil alias', () => {
  const a = generateAliasesForFood('Olive Oil', 'oil');
  expect(a).toEqual(expect.arrayContaining(['olive','cooking oil']));
});

test('egg whites get specific aliases', () => {
  const a = generateAliasesForFood('Egg Whites, Carton', null);
  expect(a).toEqual(expect.arrayContaining(['egg','eggs','egg white','egg whites','carton egg whites']));
});

test('rice gets common aliases', () => {
  const a = generateAliasesForFood('White Rice, Long Grain', 'rice_uncooked');
  expect(a).toEqual(expect.arrayContaining(['white rice','brown rice']));
});

test('oats get oatmeal aliases', () => {
  const a = generateAliasesForFood('Rolled Oats', 'oats');
  expect(a).toEqual(expect.arrayContaining(['rolled oats','old fashioned oats','oatmeal']));
});

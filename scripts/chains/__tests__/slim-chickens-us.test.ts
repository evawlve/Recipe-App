import slim from '../adapters/slim-chickens-us';

// A small synthetic page in the chain's shape (never a copy of the real one).
const p = (serving: string, g: number, kcal: number, fat: number, carbs: number, protein: number) =>
  `<p>Serving size: ${serving} | Serving size (g): ${g} | Calories: ${kcal} | Fat Cals: 0 | Total Fat (g): ${fat} | Saturated Fat (g): 1 | Trans Fat (g): 0 | Cholesterol (mg): 10 | Sodium (mg): 300 | Total Carbs (g): ${carbs} | Dietary Fiber (g): 1 | Sugar (g): 2 | Protein (g): ${protein}</p><p>Allergens: None</p>`;
const li = (name: string, body: string) => `<li><h3>${name}</h3>${body}</li>`;
const section = (h: string, lis: string[]) => `<section><h2>${h}</h2><ul>${lis.join('')}</ul></section>`;

const html = [
  section('Sandwiches &amp; Wraps', [
    li('Crispy Chicken Sandwich&reg;', p('1 sandwich', 250, 590, 25, 60, 30)),
    li('Honey Jalapeno Pimento Sandwich', p('1 sandwich', 300, 720, 37, 114, 49)),
    li('Boneless Haul', '<p>1290-2320 calories</p>'),
  ]),
  section('Drinks', [
    li('Coke – 12oz', p('12 fl oz', 360, 140, 0, 39, 0)),
    li('Coke – 20oz', p('20 fl oz', 600, 240, 0, 65, 0)),
    li('Sweet Tea – 1 gallon', p('1 gallon', 3800, 800, 0, 200, 0)),
    li('Lemonade – 1 gallon', p('1 gallon', 1800, 900, 0, 220, 0)),
  ]),
  section('Sides', [
    li('Fries', p('1 each', 100, 300, 15, 40, 4)),
    li('Fries', p('1 each', 100, 300, 15, 40, 4)),
  ]),
  section('Sauces &amp; Dressings', [
    li('Ranch', p('1.5 fl oz', 36, 163, 16, 1, 1)),
    li('Cayenne Ranch', p('1.5 fl oz', 36, 163, 16, 1, 1)),
  ]),
].join('');

describe('slim-chickens-us parse', () => {
  const { items, components } = slim.parse({ nutrition: html });
  const byKey = new Map(items.map((i) => [i.key, i]));

  it('maps the labelled fields onto the panel and leaves added sugar null', () => {
    const it = byKey.get('slim-chickens-crispy-chicken-sandwich');
    expect(it?.name).toBe('Crispy Chicken Sandwich');
    expect(it?.servingG).toBe(250);
    expect(it?.panel).toMatchObject({ kcal: 590, fatG: 25, carbsG: 60, proteinG: 30, sodiumMg: 300, addedSugarG: null });
  });
  it('splits a size off a Drinks name into the key and the variant, and leaves bulk rows out', () => {
    expect(byKey.get('slim-chickens-coke-12oz')?.variant).toBe('size=12oz');
    expect(byKey.get('slim-chickens-coke-20oz')?.name).toBe('Coke');
    expect(byKey.get('slim-chickens-lemonade-1-gallon')?.variant).toBe('size=1-gallon');
    expect(byKey.has('slim-chickens-sweet-tea-1-gallon')).toBe(false); // 3,800 g is over the bulk rule
  });
  it('keeps one of two identical rows under the same key', () => {
    expect(items.filter((i) => i.key === 'slim-chickens-fries')).toHaveLength(1);
  });
  it('leaves the SOURCE_ERRORS row out and skips a range-only row', () => {
    expect(byKey.has('slim-chickens-honey-jalapeno-pimento-sandwich')).toBe(false);
    expect(byKey.has('slim-chickens-boneless-haul')).toBe(false);
  });
  it('turns Sauces & Dressings into components with one portion labelled by the serving string', () => {
    expect(components.map((c) => c.key)).toEqual(['slim-chickens-ranch', 'slim-chickens-cayenne-ranch']);
    expect(components[0].portions).toEqual([expect.objectContaining({ label: '1.5 fl oz', grams: 36, sourceId: 'nutrition' })]);
    expect(items.some((i) => i.key.endsWith('ranch'))).toBe(false);
  });
  it('stops on the same key with different rows', () => {
    const bad = section('Sides', [li('Fries', p('1 each', 100, 300, 15, 40, 4)), li('Fries', p('1 each', 100, 310, 15, 40, 4))]);
    expect(() => slim.parse({ nutrition: bad })).toThrow(/appears twice with different rows/);
  });
  it('cleans whitespace in a name before keying, so a padded duplicate is the same row', () => {
    const two = section('Sides', [li('Fries', p('1 each', 100, 300, 15, 40, 4)), li('Fries ', p('1 each', 100, 300, 15, 40, 4))]);
    expect(slim.parse({ nutrition: two }).items).toHaveLength(1);
  });
});
